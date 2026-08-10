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
const TRANSFORM_MODE_BY_KEY: Partial<Record<string, TransformMode>> = {
  w: "translate",
  e: "rotate",
  r: "scale",
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

function isTransformShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-transform-shortcuts]") !== null
  );
}

type SceneAnnouncement = {
  id: number;
  message: string;
};

export function EditorApp() {
  const [sceneDocument] = useState(() => new SceneDocument());
  const objects = useSceneSnapshot(sceneDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transformMode, setTransformMode] =
    useState<TransformMode>("translate");
  const [isTransforming, setIsTransforming] = useState(false);
  const isTransformingRef = useRef(false);
  const announcementSequenceRef = useRef(0);
  const [sceneAnnouncement, setSceneAnnouncement] =
    useState<SceneAnnouncement | null>(null);
  const [collaborationStatus, setCollaborationStatus] =
    useState<CollaborationStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [rendererName, setRendererName] = useState("준비 중");

  const selectedObject = objects.find((object) => object.id === selectedId) ?? null;
  const selectedObjectId = selectedObject?.id ?? null;

  useEffect(
    () =>
      sceneDocument.subscribe(() => {
        setSelectedId((currentId) => {
          if (currentId === null) return null;
          const stillExists = sceneDocument
            .getSnapshot()
            .some((object) => object.id === currentId);
          return stillExists ? currentId : null;
        });
      }),
    [sceneDocument],
  );

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
      if (isTransformingRef.current) return;

      const deletedIndex = objects.findIndex((object) => object.id === objectId);
      const deletedObject = objects[deletedIndex];
      const nextFocusId =
        objects[deletedIndex + 1]?.id ?? objects[deletedIndex - 1]?.id ?? null;
      const activeElement = document.activeElement;
      const activeRow =
        activeElement instanceof Element
          ? activeElement.closest("[data-scene-object-row]")
          : null;
      const shouldMoveSceneFocus =
        activeRow?.getAttribute("data-scene-object-row") === objectId;

      sceneDocument.apply({ type: "object.delete", objectId });
      setSelectedId((currentId) => (currentId === objectId ? null : currentId));

      if (deletedObject) {
        announcementSequenceRef.current += 1;
        setSceneAnnouncement({
          id: announcementSequenceRef.current,
          message: `${deletedObject.name} 삭제됨`,
        });
      }

      if (shouldMoveSceneFocus) {
        window.setTimeout(() => {
          const sceneButtons = Array.from(
            document.querySelectorAll<HTMLElement>("[data-scene-object-select]"),
          );
          const nextButton = sceneButtons.find(
            (button) => button.dataset.sceneObjectSelect === nextFocusId,
          );
          const addButton = document.querySelector<HTMLElement>(
            '[data-add-primitive="box"]',
          );
          (nextButton ?? addButton)?.focus();
        });
      }
    },
    [objects, sceneDocument],
  );

  const undo = useCallback(() => {
    if (!isTransformingRef.current) sceneDocument.undo();
  }, [sceneDocument]);
  const redo = useCallback(() => {
    if (!isTransformingRef.current) sceneDocument.redo();
  }, [sceneDocument]);
  const changeTransformMode = useCallback((mode: TransformMode) => {
    if (!isTransformingRef.current) setTransformMode(mode);
  }, []);
  const handleTransformingChange = useCallback((isTransforming: boolean) => {
    isTransformingRef.current = isTransforming;
    setIsTransforming(isTransforming);
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
      const key = event.key.toLowerCase();
      const allowsTransformShortcut = isTransformShortcutTarget(event.target);

      if (event.key === "Escape" && !hasDirectModifier) {
        if (selectedId !== null || isTransformingRef.current) {
          event.preventDefault();
          setSelectedId(null);
        }
        return;
      }

      const isUndo =
        hasCommandModifier &&
        !event.altKey &&
        !event.shiftKey &&
        key === "z";
      const isRedo =
        hasCommandModifier &&
        !event.altKey &&
        ((event.shiftKey && key === "z") || (!event.shiftKey && key === "y"));
      const transformModeForKey = TRANSFORM_MODE_BY_KEY[key];
      const isDelete = event.key === "Delete" || event.key === "Backspace";
      const isTransformShortcut =
        Boolean(transformModeForKey) &&
        !hasDirectModifier &&
        allowsTransformShortcut;
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

      if (
        transformModeForKey &&
        selectedObjectId !== null &&
        allowsTransformShortcut
      ) {
        event.preventDefault();
        changeTransformMode(transformModeForKey);
        return;
      }
      if (isDelete && selectedObjectId !== null) {
        event.preventDefault();
        deleteObject(selectedObjectId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeTransformMode, deleteObject, redo, selectedId, selectedObjectId, undo]);

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
        historyDisabled={isTransforming}
        onUndo={undo}
        onRedo={redo}
        onExport={exportScene}
      />
      <div className="editor-workspace">
        <ScenePanel
          objects={objects}
          selectedId={selectedObjectId}
          announcement={sceneAnnouncement}
          deleteDisabled={isTransforming}
          onSelect={setSelectedId}
          onAdd={addPrimitive}
          onDelete={deleteObject}
        />
        <section className="viewport-column" aria-label="3D 편집 영역">
          <SceneViewport
            objects={objects}
            selectedId={selectedObjectId}
            transformMode={transformMode}
            isTransforming={isTransforming}
            onSelect={setSelectedId}
            onTransform={transformObject}
            onTransformModeChange={changeTransformMode}
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
