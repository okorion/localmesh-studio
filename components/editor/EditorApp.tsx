"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectSceneSession, type Collaborator, type CollaborationStatus } from "@/features/collaboration/connect-scene-session";
import {
  CsgError,
  evaluateCsg,
  getCsgOperandSignature,
  type CsgOperation,
} from "@/features/scene/csg";
import {
  captureSceneObject,
  createPastedSceneObject,
  getSceneClipboardShortcut,
  resolveSceneClipboardShortcut,
} from "@/features/scene/clipboard";
import { SceneDocument } from "@/features/scene/scene-document";
import {
  createSceneObject,
  type PrimitiveKind,
  type SceneObject,
} from "@/features/scene/schema";
import { useSceneSnapshot } from "@/features/scene/use-scene-snapshot";
import type { SceneCommand, SceneObjectUpdates } from "@/features/scene/commands";
import { AiPanel } from "./AiPanel";
import type { CsgStatus } from "./CsgPanel";
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
const CSG_OPERATION_LABELS: Record<CsgOperation, string> = {
  union: "합집합",
  subtract: "차집합 (A − B)",
  intersect: "교집합",
};

class CsgUiError extends Error {}

function getCsgErrorMessage(error: unknown): string {
  if (error instanceof CsgUiError) return error.message;
  if (!(error instanceof CsgError)) {
    return "CSG 계산에 실패해 원본 오브젝트를 유지했습니다.";
  }

  switch (error.code) {
    case "INVALID_OPERATION":
      return "지원하지 않는 CSG 연산입니다. 다른 연산을 선택하세요.";
    case "INVALID_INPUT":
      return "A와 B 입력을 확인할 수 없어 원본을 유지했습니다.";
    case "INVALID_SCALE":
      return "A 또는 B의 크기 값이 CSG 허용 범위를 벗어났습니다.";
    case "INVALID_GEOMETRY":
      return "A 또는 B의 형상 데이터가 올바르지 않아 계산하지 못했습니다.";
    case "INVALID_RESULT":
      return "CSG 결과가 유효한 solid 조건을 충족하지 않아 원본 오브젝트를 유지했습니다.";
    case "EMPTY_RESULT":
      return "CSG 결과가 비어 있어 원본 오브젝트를 유지했습니다.";
    case "RESULT_TOO_COMPLEX":
      return "CSG 결과가 너무 복잡해 적용하지 않았습니다. 더 단순한 형상으로 다시 시도하세요.";
    case "ENGINE_FAILURE":
      return "CSG 엔진이 계산을 완료하지 못해 원본 오브젝트를 유지했습니다.";
  }
}

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

type SceneClipboard = {
  snapshot: SceneObject;
  pasteCount: number;
};

function hasSelectedPageContent(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

function yieldToPendingSceneUpdates(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function EditorApp() {
  const [sceneDocument] = useState(() => new SceneDocument());
  const objects = useSceneSnapshot(sceneDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [csgSecondaryId, setCsgSecondaryId] = useState<string | null>(null);
  const [isCsgProcessing, setIsCsgProcessing] = useState(false);
  const [csgStatus, setCsgStatus] = useState<CsgStatus | null>(null);
  const [transformMode, setTransformMode] =
    useState<TransformMode>("translate");
  const [isTransforming, setIsTransforming] = useState(false);
  const isTransformingRef = useRef(false);
  const isCsgProcessingRef = useRef(false);
  const hasRemoteCollaboratorsRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const csgSecondaryIdRef = useRef<string | null>(null);
  const csgRunSequenceRef = useRef(0);
  const csgStatusSequenceRef = useRef(0);
  const announcementSequenceRef = useRef(0);
  const sceneClipboardRef = useRef<SceneClipboard | null>(null);
  const [hasSceneClipboard, setHasSceneClipboard] = useState(false);
  const [sceneAnnouncement, setSceneAnnouncement] =
    useState<SceneAnnouncement | null>(null);
  const [collaborationStatus, setCollaborationStatus] =
    useState<CollaborationStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [rendererName, setRendererName] = useState("준비 중");

  const selectedObject = objects.find((object) => object.id === selectedId) ?? null;
  const selectedObjectId = selectedObject?.id ?? null;
  const hasRemoteCollaborators = collaborators.length > 1;

  const selectCsgSecondary = useCallback((objectId: string | null) => {
    const nextId =
      objectId !== null && objectId !== selectedIdRef.current
        ? objectId
        : null;
    csgSecondaryIdRef.current = nextId;
    setCsgSecondaryId(nextId);
  }, []);

  const selectObject = useCallback((objectId: string | null) => {
    selectedIdRef.current = objectId;
    setSelectedId(objectId);
    if (
      objectId === null ||
      objectId === csgSecondaryIdRef.current
    ) {
      csgSecondaryIdRef.current = null;
      setCsgSecondaryId(null);
    }
  }, []);

  const selectObjectFromUser = useCallback(
    (objectId: string | null) => {
      if (isCsgProcessingRef.current) return;
      setCsgStatus(null);
      selectObject(objectId);
    },
    [selectObject],
  );

  const selectCsgSecondaryFromUser = useCallback(
    (objectId: string | null) => {
      if (isCsgProcessingRef.current) return;
      setCsgStatus(null);
      selectCsgSecondary(objectId);
    },
    [selectCsgSecondary],
  );

  const handleCollaborators = useCallback((next: Collaborator[]) => {
    hasRemoteCollaboratorsRef.current = next.length > 1;
    setCollaborators(next);
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedObjectId;
    csgSecondaryIdRef.current = csgSecondaryId;
  }, [csgSecondaryId, objects, selectedObjectId]);

  useEffect(() => {
    setCsgSecondaryId((currentId) => {
      const remainsValid =
        selectedObjectId !== null &&
        currentId !== null &&
        currentId !== selectedObjectId &&
        objects.some((object) => object.id === currentId);
      if (remainsValid) return currentId;
      csgSecondaryIdRef.current = null;
      return null;
    });
  }, [objects, selectedObjectId]);

  useEffect(
    () => () => {
      csgRunSequenceRef.current += 1;
      isCsgProcessingRef.current = false;
    },
    [],
  );

  useEffect(
    () =>
      sceneDocument.subscribe(() => {
        const snapshot = sceneDocument.getSnapshot();
        const currentPrimaryId = selectedIdRef.current;
        const currentSecondaryId = csgSecondaryIdRef.current;
        if (
          currentPrimaryId !== null &&
          !snapshot.some((object) => object.id === currentPrimaryId)
        ) {
          selectObject(null);
        }
        if (
          currentSecondaryId !== null &&
          !snapshot.some((object) => object.id === currentSecondaryId)
        ) {
          selectCsgSecondary(null);
        }
      }),
    [sceneDocument, selectCsgSecondary, selectObject],
  );

  useEffect(() => {
    const developmentSocket =
      process.env.NODE_ENV === "development" ? "ws://localhost:1234" : undefined;
    return connectSceneSession({
      sceneDocument,
      roomId: ROOM_ID,
      socketUrl: process.env.NEXT_PUBLIC_COLLABORATION_URL ?? developmentSocket,
      onStatus: setCollaborationStatus,
      onCollaborators: handleCollaborators,
    });
  }, [handleCollaborators, sceneDocument]);

  const addPrimitive = useCallback(
    (kind: PrimitiveKind) => {
      if (isCsgProcessingRef.current) return;
      setCsgStatus(null);
      const object = createSceneObject(kind, {
        position: [objects.length * 0.35 - 0.35, kind === "sphere" ? 0.75 : 0.5, 0],
      });
      sceneDocument.apply({ type: "object.create", object });
      selectObject(object.id);
    },
    [objects.length, sceneDocument, selectObject],
  );

  const applyCommand = useCallback(
    (command: SceneCommand) => {
      if (!isCsgProcessingRef.current) {
        setCsgStatus(null);
        sceneDocument.apply(command);
      }
    },
    [sceneDocument],
  );

  const transformObject = useCallback(
    (objectId: string, updates: SceneObjectUpdates) => {
      if (!isCsgProcessingRef.current) {
        setCsgStatus(null);
        sceneDocument.apply({ type: "object.update", objectId, updates });
      }
    },
    [sceneDocument],
  );

  const deleteObject = useCallback(
    (objectId: string) => {
      if (isTransformingRef.current || isCsgProcessingRef.current) return;

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

      if (deletedObject) setCsgStatus(null);
      sceneDocument.apply({ type: "object.delete", objectId });
      if (selectedIdRef.current === objectId) selectObject(null);
      if (csgSecondaryIdRef.current === objectId) selectCsgSecondary(null);

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
    [objects, sceneDocument, selectCsgSecondary, selectObject],
  );

  const announceSceneChange = useCallback((message: string) => {
    announcementSequenceRef.current += 1;
    setSceneAnnouncement({
      id: announcementSequenceRef.current,
      message,
    });
  }, []);

  const copySelectedObject = useCallback((): boolean => {
    if (isTransformingRef.current || isCsgProcessingRef.current) return false;

    const objectId = selectedIdRef.current;
    const source = sceneDocument
      .getSnapshot()
      .find((object) => object.id === objectId);
    if (!source) return false;

    sceneClipboardRef.current = {
      snapshot: captureSceneObject(source),
      pasteCount: 0,
    };
    setHasSceneClipboard(true);
    announceSceneChange(`${source.name} 복사됨`);
    return true;
  }, [announceSceneChange, sceneDocument]);

  const pasteSceneObject = useCallback((): boolean => {
    if (isTransformingRef.current || isCsgProcessingRef.current) return false;

    const clipboard = sceneClipboardRef.current;
    if (!clipboard) return false;

    const pasteCount = clipboard.pasteCount + 1;
    const pasted = createPastedSceneObject(
      clipboard.snapshot,
      sceneDocument.getSnapshot(),
      pasteCount,
    );
    sceneDocument.apply({ type: "object.create", object: pasted }, "user");
    clipboard.pasteCount = pasteCount;
    setCsgStatus(null);
    selectObject(pasted.id);
    announceSceneChange(`${pasted.name} 붙여넣음`);
    return true;
  }, [announceSceneChange, sceneDocument, selectObject]);

  const undo = useCallback(() => {
    if (!isTransformingRef.current && !isCsgProcessingRef.current) {
      sceneDocument.undo();
      setCsgStatus(null);
    }
  }, [sceneDocument]);
  const redo = useCallback(() => {
    if (!isTransformingRef.current && !isCsgProcessingRef.current) {
      sceneDocument.redo();
      setCsgStatus(null);
    }
  }, [sceneDocument]);
  const changeTransformMode = useCallback((mode: TransformMode) => {
    if (!isTransformingRef.current) setTransformMode(mode);
  }, []);
  const handleTransformingChange = useCallback((isTransforming: boolean) => {
    isTransformingRef.current = isTransforming;
    setIsTransforming(isTransforming);
  }, []);

  const runCsg = useCallback(
    async (operation: CsgOperation) => {
      if (
        isCsgProcessingRef.current ||
        isTransformingRef.current ||
        hasRemoteCollaboratorsRef.current
      ) {
        return;
      }

      const primaryId = selectedIdRef.current;
      const secondaryId = csgSecondaryIdRef.current;
      const currentObjects = sceneDocument.getSnapshot();
      const primary = currentObjects.find((object) => object.id === primaryId);
      const secondary = currentObjects.find(
        (object) => object.id === secondaryId,
      );
      if (!primary || !secondary || primary.id === secondary.id) return;

      const operandSignature = [
        primary.id,
        getCsgOperandSignature(primary),
        secondary.id,
        getCsgOperandSignature(secondary),
      ].join("\u001f");
      const runId = csgRunSequenceRef.current + 1;
      csgRunSequenceRef.current = runId;
      isCsgProcessingRef.current = true;
      setIsCsgProcessing(true);
      csgStatusSequenceRef.current += 1;
      setCsgStatus({
        id: csgStatusSequenceRef.current,
        tone: "working",
        message: `${primary.name} A와 ${secondary.name} B의 ${CSG_OPERATION_LABELS[operation]} 계산 중`,
      });

      try {
        const result = await evaluateCsg(operation, primary, secondary);
        await yieldToPendingSceneUpdates();
        if (csgRunSequenceRef.current !== runId) return;

        if (hasRemoteCollaboratorsRef.current) {
          throw new CsgUiError(
            "다른 협업자가 연결되어 결과를 적용하지 않았습니다. 단독 연결 상태에서 다시 실행하세요.",
          );
        }

        const latestObjects = sceneDocument.getSnapshot();
        const latestPrimary = latestObjects.find(
          (object) => object.id === primary.id,
        );
        const latestSecondary = latestObjects.find(
          (object) => object.id === secondary.id,
        );
        const latestSignature =
          latestPrimary && latestSecondary
            ? [
                latestPrimary.id,
                getCsgOperandSignature(latestPrimary),
                latestSecondary.id,
                getCsgOperandSignature(latestSecondary),
              ].join("\u001f")
            : null;
        const operandsAreCurrent =
          selectedIdRef.current === primary.id &&
          csgSecondaryIdRef.current === secondary.id &&
          latestSignature === operandSignature;

        if (!operandsAreCurrent || isTransformingRef.current) {
          throw new CsgUiError(
            "계산 중 A 또는 B가 변경되어 결과를 적용하지 않았습니다. 다시 실행하세요.",
          );
        }
        if (
          result.kind !== "mesh" ||
          result.geometry.positions.length < 9 ||
          result.geometry.positions.length % 9 !== 0
        ) {
          throw new CsgUiError("CSG 결과가 비어 있어 원본을 유지했습니다.");
        }

        sceneDocument.applyMany(
          [
            { type: "object.delete", objectId: primary.id },
            { type: "object.delete", objectId: secondary.id },
            { type: "object.create", object: result },
          ],
          "user",
        );
        selectObject(result.id);
        selectCsgSecondary(null);
        csgStatusSequenceRef.current += 1;
        setCsgStatus({
          id: csgStatusSequenceRef.current,
          tone: "success",
          message: `${CSG_OPERATION_LABELS[operation]} 완료. ${result.name}을 선택했습니다.`,
        });

        window.setTimeout(() => {
          const resultButton = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-scene-object-select]",
            ),
          ).find(
            (button) => button.dataset.sceneObjectSelect === result.id,
          );
          resultButton?.focus();
        });
      } catch (error: unknown) {
        if (csgRunSequenceRef.current !== runId) return;
        csgStatusSequenceRef.current += 1;
        setCsgStatus({
          id: csgStatusSequenceRef.current,
          tone: "error",
          message: getCsgErrorMessage(error),
        });
      } finally {
        if (csgRunSequenceRef.current === runId) {
          isCsgProcessingRef.current = false;
          setIsCsgProcessing(false);
        }
      }
    },
    [sceneDocument, selectCsgSecondary, selectObject],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editableTarget = isEditableTarget(event.target);
      const clipboardChord = getSceneClipboardShortcut(event);
      const clipboardShortcut = resolveSceneClipboardShortcut(event, {
        hasClipboard: sceneClipboardRef.current !== null,
        hasSelectedObject:
          selectedIdRef.current !== null &&
          sceneDocument
            .getSnapshot()
            .some((object) => object.id === selectedIdRef.current),
        hasSelectedPageContent:
          clipboardChord === "copy" && hasSelectedPageContent(),
        interactionLocked:
          isCsgProcessingRef.current || isTransformingRef.current,
        isEditableTarget: editableTarget,
      });
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        editableTarget
      ) {
        return;
      }

      const hasCommandModifier = event.ctrlKey || event.metaKey;
      const hasDirectModifier =
        hasCommandModifier || event.altKey || event.shiftKey;
      const key = event.key.toLowerCase();
      const allowsTransformShortcut = isTransformShortcutTarget(event.target);
      const isEscape = event.key === "Escape" && !hasDirectModifier;
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

      if (isCsgProcessingRef.current) {
        if (
          isEscape ||
          isUndo ||
          isRedo ||
          isTransformShortcut ||
          isDeleteShortcut
        ) {
          event.preventDefault();
        }
        return;
      }

      if (isEscape) {
        if (selectedId !== null || isTransformingRef.current) {
          event.preventDefault();
          selectObjectFromUser(null);
        }
        return;
      }

      if (isTransformingRef.current) {
        if (
          isUndo ||
          isRedo ||
          isTransformShortcut ||
          isDeleteShortcut
        ) {
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
      if (clipboardShortcut === "copy") {
        if (copySelectedObject()) event.preventDefault();
        return;
      }
      if (clipboardShortcut === "paste") {
        if (pasteSceneObject()) event.preventDefault();
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
  }, [
    changeTransformMode,
    copySelectedObject,
    deleteObject,
    pasteSceneObject,
    redo,
    sceneDocument,
    selectObjectFromUser,
    selectedId,
    selectedObjectId,
    undo,
  ]);

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
        historyDisabled={isTransforming || isCsgProcessing}
        copyDisabled={
          selectedObjectId === null || isTransforming || isCsgProcessing
        }
        pasteDisabled={
          !hasSceneClipboard || isTransforming || isCsgProcessing
        }
        onCopy={copySelectedObject}
        onPaste={pasteSceneObject}
        onUndo={undo}
        onRedo={redo}
        onExport={exportScene}
      />
      <div className="editor-workspace">
        <ScenePanel
          objects={objects}
          selectedId={selectedObjectId}
          csgSecondaryId={csgSecondaryId}
          csgStatus={csgStatus}
          isCsgProcessing={isCsgProcessing}
          csgCollaborationBlocked={hasRemoteCollaborators}
          announcement={sceneAnnouncement}
          deleteDisabled={isTransforming || isCsgProcessing}
          editDisabled={isCsgProcessing}
          isTransforming={isTransforming}
          onSelect={selectObjectFromUser}
          onCsgSecondaryChange={selectCsgSecondaryFromUser}
          onCsgRun={(operation) => void runCsg(operation)}
          onAdd={addPrimitive}
          onDelete={deleteObject}
        />
        <section className="viewport-column" aria-label="3D 편집 영역">
          <SceneViewport
            objects={objects}
            selectedId={selectedObjectId}
            csgSecondaryId={csgSecondaryId}
            transformMode={transformMode}
            isTransforming={isTransforming}
            interactionLocked={isCsgProcessing}
            onSelect={selectObjectFromUser}
            onTransform={transformObject}
            onTransformModeChange={changeTransformMode}
            onTransformingChange={handleTransformingChange}
            onRendererChange={setRendererName}
          />
          <div
            className={`editor-lock-region ai-lock-region ${isCsgProcessing ? "is-locked" : ""}`}
            aria-disabled={isCsgProcessing}
            inert={isCsgProcessing ? true : undefined}
            title={
              isCsgProcessing
                ? "CSG 계산이 끝난 뒤 AI 명령을 적용하세요."
                : undefined
            }
          >
            <AiPanel
              objects={objects}
              onApply={(commands) => {
                if (!isCsgProcessingRef.current) {
                  setCsgStatus(null);
                  sceneDocument.applyMany(commands, "ai");
                }
              }}
            />
          </div>
        </section>
        <div
          className={`editor-lock-region inspector-lock-region ${isCsgProcessing ? "is-locked" : ""}`}
          aria-disabled={isCsgProcessing}
          inert={isCsgProcessing ? true : undefined}
          title={
            isCsgProcessing
              ? "CSG 계산이 끝난 뒤 속성을 편집하세요."
              : undefined
          }
        >
          <InspectorPanel object={selectedObject} onCommand={applyCommand} />
        </div>
      </div>
    </main>
  );
}
