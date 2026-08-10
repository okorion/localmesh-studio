"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectSceneSession, type Collaborator, type CollaborationStatus } from "@/features/collaboration/connect-scene-session";
import { SceneDocument } from "@/features/scene/scene-document";
import { createSceneObject, type PrimitiveKind } from "@/features/scene/schema";
import { useSceneSnapshot } from "@/features/scene/use-scene-snapshot";
import type { SceneCommand, SceneObjectUpdates } from "@/features/scene/commands";
import { AiPanel } from "./AiPanel";
import { InspectorPanel } from "./InspectorPanel";
import { ScenePanel } from "./ScenePanel";
import { SceneViewport, type TransformMode } from "./SceneViewport";
import { TopBar } from "./TopBar";

const ROOM_ID = "localmesh-demo";
const TRANSFORM_MODE_BY_CODE: Partial<Record<string, TransformMode>> = {
  KeyW: "translate",
  KeyE: "rotate",
  KeyR: "scale",
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    ) !== null
  );
}

export function EditorApp() {
  const [sceneDocument] = useState(() => new SceneDocument());
  const objects = useSceneSnapshot(sceneDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] =
    useState<TransformMode>("translate");
  const isTransformingRef = useRef(false);
  const [collaborationStatus, setCollaborationStatus] =
    useState<CollaborationStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [rendererName, setRendererName] = useState("준비 중");

  const selectedObject = objects.find((object) => object.id === selectedId) ?? null;
  const selectedObjectId = selectedObject?.id ?? null;

  useEffect(() => {
    const developmentSocket =
      process.env.NODE_ENV === "development" ? "ws://localhost:1234" : undefined;
    return connectSceneSession({
      sceneDocument,
      roomId: ROOM_ID,
      socketUrl: process.env.NEXT_PUBLIC_COLLABORATION_URL ?? developmentSocket,
      onStatus: setCollaborationStatus,
      onCollaborators: setCollaborators,
    });
  }, [sceneDocument]);

  const addPrimitive = useCallback(
    (kind: PrimitiveKind) => {
      const object = createSceneObject(kind, {
        position: [objects.length * 0.35 - 0.35, kind === "sphere" ? 0.75 : 0.5, 0],
      });
      sceneDocument.apply({ type: "object.create", object });
      setSelectedId(object.id);
    },
    [objects.length, sceneDocument],
  );

  const applyCommand = useCallback(
    (command: SceneCommand) => sceneDocument.apply(command),
    [sceneDocument],
  );

  const transformObject = useCallback(
    (objectId: string, updates: SceneObjectUpdates) => {
      sceneDocument.apply({ type: "object.update", objectId, updates });
    },
    [sceneDocument],
  );

  const deleteObject = useCallback(
    (objectId: string) => {
      sceneDocument.apply({ type: "object.delete", objectId });
      setSelectedId((currentId) => (currentId === objectId ? null : currentId));
    },
    [sceneDocument],
  );

  const undo = useCallback(() => sceneDocument.undo(), [sceneDocument]);
  const redo = useCallback(() => sceneDocument.redo(), [sceneDocument]);
  const handleTransformingChange = useCallback((isTransforming: boolean) => {
    isTransformingRef.current = isTransforming;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const hasCommandModifier = event.ctrlKey || event.metaKey;
      const hasDirectModifier =
        hasCommandModifier || event.altKey || event.shiftKey;

      if (event.code === "Escape" && !hasDirectModifier) {
        if (selectedObjectId !== null || isTransformingRef.current) {
          event.preventDefault();
          setSelectedId(null);
        }
        return;
      }

      const isUndo =
        hasCommandModifier &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyZ";
      const isRedo =
        hasCommandModifier &&
        !event.altKey &&
        ((event.shiftKey && event.code === "KeyZ") ||
          (!event.shiftKey && event.code === "KeyY"));
      const transformModeForKey = TRANSFORM_MODE_BY_CODE[event.code];
      const isDelete = event.code === "Delete" || event.code === "Backspace";
      const isTransformShortcut = Boolean(transformModeForKey) && !hasDirectModifier;
      const isDeleteShortcut = isDelete && !hasDirectModifier;

      if (isTransformingRef.current) {
        if (isUndo || isRedo || isTransformShortcut || isDeleteShortcut) {
          event.preventDefault();
        }
        return;
      }

      if (isUndo) {
        event.preventDefault();
        undo();
        return;
      }
      if (isRedo) {
        event.preventDefault();
        redo();
        return;
      }
      if (hasDirectModifier) return;

      if (transformModeForKey && selectedObjectId !== null) {
        event.preventDefault();
        setTransformMode(transformModeForKey);
        return;
      }
      if (isDelete && selectedObjectId !== null) {
        event.preventDefault();
        deleteObject(selectedObjectId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteObject, redo, selectedObjectId, undo]);

  const exportScene = useCallback(() => {
    const blob = new Blob([sceneDocument.exportJson()], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "localmesh-scene.json";
    link.click();
    URL.revokeObjectURL(url);
  }, [sceneDocument]);

  return (
    <main className="editor-shell">
      <TopBar
        collaborators={collaborators}
        collaborationStatus={collaborationStatus}
        rendererName={rendererName}
        onUndo={undo}
        onRedo={redo}
        onExport={exportScene}
      />
      <div className="editor-workspace">
        <ScenePanel
          objects={objects}
          selectedId={selectedObjectId}
          onSelect={setSelectedId}
          onAdd={addPrimitive}
          onDelete={deleteObject}
        />
        <section className="viewport-column" aria-label="3D 편집 영역">
          <SceneViewport
            objects={objects}
            selectedId={selectedObjectId}
            transformMode={transformMode}
            onSelect={setSelectedId}
            onTransform={transformObject}
            onTransformModeChange={setTransformMode}
            onTransformingChange={handleTransformingChange}
            onRendererChange={setRendererName}
          />
          <AiPanel
            objects={objects}
            onApply={(commands) => sceneDocument.applyMany(commands, "ai")}
          />
        </section>
        <InspectorPanel object={selectedObject} onCommand={applyCommand} />
      </div>
    </main>
  );
}
