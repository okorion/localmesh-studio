import type { SceneObject } from "@/features/scene/schema";
import type { AiSceneResponse } from "./ai-actions";

export type ModelProgress = {
  progress: number;
  text: string;
};

export interface SceneAiProvider {
  readonly id: string;
  generate(
    prompt: string,
    objects: SceneObject[],
    onProgress: (progress: ModelProgress) => void,
  ): Promise<AiSceneResponse>;
}
