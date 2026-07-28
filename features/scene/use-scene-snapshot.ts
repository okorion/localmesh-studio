"use client";

import { useSyncExternalStore } from "react";
import type { SceneDocument } from "./scene-document";

export function useSceneSnapshot(sceneDocument: SceneDocument) {
  return useSyncExternalStore(
    sceneDocument.subscribe,
    sceneDocument.getSnapshot,
    sceneDocument.getSnapshot,
  );
}
