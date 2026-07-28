"use client";

import { useState } from "react";
import { Bot, Check, Cpu, Sparkles } from "lucide-react";
import { aiResponseToCommands } from "@/features/ai/ai-actions";
import {
  DEFAULT_LOCAL_MODEL,
  localWebLlmProvider,
} from "@/features/ai/local-webllm-provider";
import type { ModelProgress } from "@/features/ai/provider";
import type { SceneCommand } from "@/features/scene/commands";
import type { SceneObject } from "@/features/scene/schema";

type AiPanelProps = {
  objects: SceneObject[];
  onApply: (commands: SceneCommand[]) => void;
};

type Preview = {
  summary: string;
  commands: SceneCommand[];
};

const EXAMPLES = ["보라색 구를 오른쪽에 추가해줘", "Starter Cube를 두 배로 키워줘"];

function describeCommand(command: SceneCommand, objects: SceneObject[]): string {
  if (command.type === "object.create") {
    return `${command.object.name} 생성`;
  }
  const target = objects.find((object) => object.id === command.objectId);
  return `${target?.name ?? command.objectId} ${command.type === "object.delete" ? "삭제" : "수정"}`;
}

export function AiPanel({ objects, onApply }: AiPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [progress, setProgress] = useState<ModelProgress | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async () => {
    const request = prompt.trim();
    if (!request || isGenerating) return;

    setIsGenerating(true);
    setPreview(null);
    setError(null);
    try {
      const response = await localWebLlmProvider.generate(request, objects, setProgress);
      const commands = aiResponseToCommands(response, objects);
      if (commands.length === 0) {
        throw new Error("현재 장면에 적용할 수 있는 명령을 찾지 못했습니다.");
      }
      setPreview({ summary: response.summary, commands });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로컬 AI 실행에 실패했습니다.");
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  };

  return (
    <section className="ai-panel" aria-label="로컬 AI 장면 편집">
      <div className="ai-heading">
        <span className="ai-icon"><Bot size={17} /></span>
        <div>
          <strong>로컬 AI 편집</strong>
          <span><Cpu size={12} /> WebGPU · {DEFAULT_LOCAL_MODEL}</span>
        </div>
      </div>
      <div className="ai-composer">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void generate();
          }}
          placeholder="예: 주황색 원기둥을 큐브 왼쪽에 추가해줘"
          rows={2}
        />
        <button
          className="ai-run-button"
          type="button"
          onClick={() => void generate()}
          disabled={!prompt.trim() || isGenerating}
        >
          <Sparkles size={16} />
          {isGenerating ? "생성 중" : "명령 만들기"}
        </button>
      </div>
      <div className="prompt-examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" onClick={() => setPrompt(example)}>
            {example}
          </button>
        ))}
      </div>
      {progress ? (
        <div className="ai-progress" role="status">
          <span style={{ width: `${Math.max(progress.progress * 100, 4)}%` }} />
          <p>{progress.text}</p>
        </div>
      ) : null}
      {error ? <p className="ai-error" role="alert">{error}</p> : null}
      {preview ? (
        <div className="ai-preview">
          <div>
            <strong>{preview.summary}</strong>
            <ul>
              {preview.commands.map((command, index) => (
                <li key={`${command.type}-${index}`}>{describeCommand(command, objects)}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => {
              onApply(preview.commands);
              setPreview(null);
              setPrompt("");
            }}
          >
            <Check size={15} /> 승인 후 적용
          </button>
        </div>
      ) : (
        <p className="ai-privacy-note">
          첫 실행 시 모델을 한 번 내려받아 브라우저에 캐시합니다. 프롬프트와 장면 데이터는 서버로 전송하지 않습니다.
        </p>
      )}
    </section>
  );
}
