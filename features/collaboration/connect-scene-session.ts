"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import type { SceneDocument } from "@/features/scene/scene-document";

export type CollaborationStatus =
  | "local"
  | "connecting"
  | "connected"
  | "disconnected";

export type Collaborator = {
  clientId: number;
  name: string;
  color: string;
};

type SessionOptions = {
  sceneDocument: SceneDocument;
  roomId: string;
  socketUrl?: string;
  onStatus: (status: CollaborationStatus) => void;
  onCollaborators: (collaborators: Collaborator[]) => void;
};

const COLORS = ["#7c6df2", "#31b985", "#f59e5b", "#3b82f6", "#ec4899"];

export function connectSceneSession({
  sceneDocument,
  roomId,
  socketUrl,
  onStatus,
  onCollaborators,
}: SessionOptions): () => void {
  const persistence = new IndexeddbPersistence(
    `localmesh:${roomId}`,
    sceneDocument.doc,
  );
  let localSynced = false;
  let remoteSynced = !socketUrl;
  let disposed = false;

  const initializeWhenReady = () => {
    if (!disposed && localSynced && remoteSynced) {
      sceneDocument.initializeIfNeeded();
    }
  };

  void persistence.whenSynced.then(() => {
    localSynced = true;
    initializeWhenReady();
  });

  if (!socketUrl) {
    onStatus("local");
    onCollaborators([]);
    return () => {
      disposed = true;
      persistence.destroy();
    };
  }

  const localClientId = sceneDocument.doc.clientID;
  const guestNumber = (localClientId % 90) + 10;
  const provider = new HocuspocusProvider({
    url: socketUrl,
    name: roomId,
    document: sceneDocument.doc,
    onStatus: ({ status }) => onStatus(status),
    onSynced: ({ state }) => {
      remoteSynced = state;
      initializeWhenReady();
    },
    onAwarenessChange: ({ states }) => {
      const collaborators = states.flatMap((state) => {
        const user = state.user as Partial<Collaborator> | undefined;
        if (!user?.name || !user.color) return [];
        return [{ clientId: state.clientId, name: user.name, color: user.color }];
      });
      onCollaborators(collaborators);
    },
  });

  provider.setAwarenessField("user", {
    name: `Guest ${guestNumber}`,
    color: COLORS[localClientId % COLORS.length],
  });

  return () => {
    disposed = true;
    provider.destroy();
    persistence.destroy();
  };
}
