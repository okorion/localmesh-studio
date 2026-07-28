"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { connectSceneSession, type Collaborator, type CollaborationStatus } from "@/features/collaboration/connect-scene-session";
import { SceneDocument } from "@/features/scene/scene-document";
import { createSceneObject, type PrimitiveKind } from "@/features/scene/schema";
import { useSceneSnapshot } from "@/features/scene/use-scene-snapshot";
import type { SceneCommand } from "@/features/scene/commands";
import { AiPanel } from "./AiPanel";
import { InspectorPanel } from "./InspectorPanel";
import { ScenePanel } from "./ScenePanel";
import { SceneViewport } from "./SceneViewport";
import { TopBar } from "./TopBar";

const ROOM_ID = "localmesh-demo";

export function EditorApp() {
  const [sceneDocument] = useState(() => new SceneDocument());
  const objects = useSceneSnapshot(sceneDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collaborationStatus, setCollaborationStatus] =
    useState<CollaborationStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [rendererName, setRendererName] = useState("준비 중");

  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedId) ?? objects[0] ?? null,
    [objects, selectedId],
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
        onUndo={() => sceneDocument.undo()}
        onRedo={() => sceneDocument.redo()}
        onExport={exportScene}
      />
      <div className="editor-workspace">
        <ScenePanel
          objects={objects}
          selectedId={selectedObject?.id ?? null}
          onSelect={setSelectedId}
          onAdd={addPrimitive}
          onDelete={(objectId) => {
            sceneDocument.apply({ type: "object.delete", objectId });
            if (selectedId === objectId) setSelectedId(null);
          }}
        />
        <section className="viewport-column" aria-label="3D 편집 영역">
          <SceneViewport
            objects={objects}
            selectedId={selectedObject?.id ?? null}
            onSelect={setSelectedId}
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
