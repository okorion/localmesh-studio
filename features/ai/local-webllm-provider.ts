"use client";

import type {
  ChatCompletionMessageParam,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import { z } from "zod";
import type { SceneObject } from "@/features/scene/schema";
import {
  AI_RESPONSE_JSON_SCHEMA,
  parseAiSceneResponse,
  type AiSceneResponse,
} from "./ai-actions";
import type { ModelProgress, SceneAiProvider } from "./provider";

export const DEFAULT_LOCAL_MODEL = "Qwen3-0.6B-q4f16_1-MLC";

let enginePromise: Promise<MLCEngineInterface> | undefined;
let progressListener: ((progress: ModelProgress) => void) | undefined;

async function getEngine(): Promise<MLCEngineInterface> {
  if (!enginePromise) {
    const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
    const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), {
      type: "module",
    });
    enginePromise = CreateWebWorkerMLCEngine(worker, DEFAULT_LOCAL_MODEL, {
      initProgressCallback: (report) => {
        progressListener?.({ progress: report.progress, text: report.text });
      },
    });
    void enginePromise.catch(() => {
      enginePromise = undefined;
      worker.terminate();
    });
  }
  return enginePromise;
}

function buildSystemPrompt(objects: SceneObject[]): string {
  const sceneContext = objects.map(
    ({ id, name, kind, position, rotation, scale, color }) => ({
      id,
      name,
      kind,
      position,
      rotation,
      scale,
      color,
    }),
  );

  return [
    "You convert a user's Korean or English request into 3D scene actions.",
    "Return JSON only, exactly matching the supplied schema.",
    "Use only box, sphere, or cylinder primitives.",
    "Use create only when the user explicitly asks to add or create an object.",
    "Use update when the user asks to move, rotate, resize, recolor, or rename an existing object.",
    "For update/delete, targetId must exactly match an existing object id.",
    "Positions and scales are [x,y,z]. Rotations are degrees.",
    "For relative movement, calculate and return the final absolute position from the existing position.",
    "If the user says 옆으로 without left/right, move +1 on the X axis.",
    "Example: 큐브를 옆으로 1칸 움직여줘 means update the existing box target and add 1 to its X position; never create a new cube.",
    "Keep actions minimal. Do not invent unsupported properties.",
    `Existing objects: ${JSON.stringify(sceneContext)}`,
  ].join("\n");
}

const EDIT_INTENT =
  /(move|edit|update|modify|rotate|resize|scale|recolor|rename|delete|remove|움직|옮기|이동|수정|변경|회전|키우|줄이|색|이름|삭제|제거)/i;
const CREATE_INTENT = /(create|add|make|생성|추가|만들)/i;

function parseModelJson(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function validateIntent(
  prompt: string,
  response: AiSceneResponse,
): AiSceneResponse {
  if (
    EDIT_INTENT.test(prompt) &&
    !CREATE_INTENT.test(prompt) &&
    response.actions.some((action) => action.action === "create")
  ) {
    throw new Error(
      "The user requested an edit to an existing object, but the response tried to create a new object.",
    );
  }
  return response;
}

function parseModelResponse(
  content: string,
  prompt: string,
  objects: SceneObject[],
): AiSceneResponse {
  return validateIntent(
    prompt,
    parseAiSceneResponse(parseModelJson(content), objects),
  );
}

function describeValidationFailure(cause: unknown): string {
  if (cause instanceof z.ZodError) {
    return cause.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
  }
  return cause instanceof Error ? cause.message : "Unknown validation failure";
}

async function complete(
  engine: MLCEngineInterface,
  messages: ChatCompletionMessageParam[],
): Promise<string> {
  const completion = await engine.chat.completions.create({
    messages,
    temperature: 0.05,
    max_tokens: 700,
    response_format: {
      type: "json_object",
      schema: AI_RESPONSE_JSON_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message.content;
  if (typeof content !== "string") {
    throw new Error("로컬 모델이 장면 명령을 반환하지 않았습니다.");
  }
  return content;
}

export const localWebLlmProvider: SceneAiProvider = {
  id: "local-webllm",
  async generate(prompt, objects, onProgress) {
    if (!("gpu" in navigator)) {
      throw new Error("이 브라우저에서는 WebGPU를 사용할 수 없습니다.");
    }

    progressListener = onProgress;
    onProgress({ progress: 0, text: "로컬 모델을 준비하고 있습니다." });
    const engine = await getEngine();
    onProgress({ progress: 1, text: "장면 명령을 생성하고 있습니다." });

    const systemPrompt = buildSystemPrompt(objects);
    const content = await complete(engine, [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ]);

    try {
      return parseModelResponse(content, prompt, objects);
    } catch (firstFailure) {
      onProgress({ progress: 1, text: "응답 형식을 자동으로 교정하고 있습니다." });
      const repairContent = await complete(engine, [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
        { role: "assistant", content: content.slice(0, 4_000) },
        {
          role: "user",
          content: [
            "The previous JSON was invalid or did not match the user's intent.",
            `Validation issue: ${describeValidationFailure(firstFailure)}`,
            "Return one corrected JSON object only. For an edit request, use update with an exact existing targetId.",
          ].join("\n"),
        },
      ]);

      try {
        return parseModelResponse(repairContent, prompt, objects);
      } catch (repairFailure) {
        console.warn("Local AI response repair failed", {
          firstFailure,
          repairFailure,
        });
        throw new Error(
          "로컬 모델의 명령 형식을 자동으로 교정하지 못했습니다. 대상 이름과 동작을 조금 더 구체적으로 입력해 주세요.",
        );
      }
    }
  },
};
