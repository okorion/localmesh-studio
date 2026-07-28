"use client";

import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type { SceneObject } from "@/features/scene/schema";
import {
  AI_RESPONSE_JSON_SCHEMA,
  aiResponseSchema,
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
  return [
    "You convert a user's Korean or English request into 3D scene actions.",
    "Return JSON only, exactly matching the supplied schema.",
    "Use only box, sphere, or cylinder primitives.",
    "For update/delete, targetId must exactly match an existing object id.",
    "Positions and scales are [x,y,z]. Rotations are degrees.",
    "Keep actions minimal. Do not invent unsupported properties.",
    `Existing objects: ${JSON.stringify(objects)}`,
  ].join("\n");
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

    const completion = await engine.chat.completions.create({
      messages: [
        { role: "system", content: buildSystemPrompt(objects) },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
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

    return aiResponseSchema.parse(JSON.parse(content));
  },
};
