"use client";

import { useEffect, useRef } from "react";
import { Move3D, Rotate3D, Scale3D } from "lucide-react";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  TransformControls,
  type TransformControlsMode,
} from "three/addons/controls/TransformControls.js";
import type { SceneObject, Vector3Tuple } from "@/features/scene/schema";
import type { SceneObjectUpdates } from "@/features/scene/commands";
import { createSceneObjectGeometry } from "@/features/scene/geometry";

type SceneViewportProps = {
  objects: SceneObject[];
  selectedId: string | null;
  csgSecondaryId: string | null;
  transformMode: TransformMode;
  isTransforming: boolean;
  interactionLocked: boolean;
  onSelect: (objectId: string | null) => void;
  onTransform: (objectId: string, updates: SceneObjectUpdates) => void;
  onTransformModeChange: (mode: TransformMode) => void;
  onTransformingChange: (isTransforming: boolean) => void;
  onRendererChange: (rendererName: string) => void;
};

export type TransformMode = "translate" | "rotate" | "scale";

type Renderer = THREE.WebGLRenderer | WebGPURenderer;
type ViewportRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  controls: OrbitControls;
  transformControls: TransformControls;
  transformHelper: THREE.Object3D;
  objectGroup: THREE.Group;
  selectionHelper: THREE.BoxHelper | null;
  secondarySelectionHelper: THREE.BoxHelper | null;
  isCancellingTransform: boolean;
  activePointerIds: Set<number>;
  suspendOrbitUntilPointersUp: boolean;
};

type TransformSnapshot = Pick<SceneObject, "position" | "rotation" | "scale"> & {
  objectId: string;
};

const TRANSFORM_MODES = [
  { mode: "translate", label: "이동", shortcut: "W", icon: Move3D },
  { mode: "rotate", label: "회전", shortcut: "E", icon: Rotate3D },
  { mode: "scale", label: "크기", shortcut: "R", icon: Scale3D },
] satisfies Array<{
  mode: TransformMode;
  label: string;
  shortcut: string;
  icon: typeof Move3D;
}>;

const MIN_GIZMO_SCALE = 0.01;
const MAX_GIZMO_SCALE = 100;

function disposeObject(object: THREE.Object3D): void {
  if (!(object instanceof THREE.Mesh)) return;
  object.geometry.dispose();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) material.dispose();
}

function disposeSelectionHelper(runtime: ViewportRuntime): void {
  if (!runtime.selectionHelper) return;
  runtime.scene.remove(runtime.selectionHelper);
  runtime.selectionHelper.dispose();
  runtime.selectionHelper = null;
}

function disposeSecondarySelectionHelper(runtime: ViewportRuntime): void {
  if (!runtime.secondarySelectionHelper) return;
  runtime.scene.remove(runtime.secondarySelectionHelper);
  runtime.secondarySelectionHelper.dispose();
  runtime.secondarySelectionHelper = null;
}

function cancelActiveTransform(runtime: ViewportRuntime): void {
  if (!runtime.transformControls.dragging) return;
  runtime.suspendOrbitUntilPointersUp = runtime.activePointerIds.size > 0;
  runtime.isCancellingTransform = true;
  try {
    if (runtime.transformControls.object) runtime.transformControls.reset();
    runtime.transformControls.pointerUp(null);
    runtime.controls.enabled = !runtime.suspendOrbitUntilPointersUp;
  } finally {
    runtime.isCancellingTransform = false;
  }
}

function syncSelection(
  runtime: ViewportRuntime,
  selectedMesh?: THREE.Mesh,
  secondaryMesh?: THREE.Mesh,
): void {
  if (
    runtime.transformControls.dragging &&
    runtime.transformControls.object !== selectedMesh
  ) {
    cancelActiveTransform(runtime);
  }

  if (!selectedMesh) {
    runtime.transformControls.detach();
    disposeSelectionHelper(runtime);
  } else if (runtime.transformControls.object !== selectedMesh) {
    runtime.transformControls.attach(selectedMesh);
  }

  if (selectedMesh && runtime.selectionHelper?.object === selectedMesh) {
    runtime.selectionHelper.update();
  } else if (selectedMesh) {
    disposeSelectionHelper(runtime);
    const helper = new THREE.BoxHelper(selectedMesh, "#6f60e8");
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.9;
    helper.renderOrder = 2;
    runtime.scene.add(helper);
    runtime.selectionHelper = helper;
  }

  if (!secondaryMesh || secondaryMesh === selectedMesh) {
    disposeSecondarySelectionHelper(runtime);
  } else if (runtime.secondarySelectionHelper?.object === secondaryMesh) {
    runtime.secondarySelectionHelper.update();
  } else {
    disposeSecondarySelectionHelper(runtime);
    const helper = new THREE.BoxHelper(secondaryMesh, "#f59e0b");
    helper.material.depthTest = false;
    helper.material.transparent = true;
    helper.material.opacity = 0.82;
    helper.renderOrder = 2;
    runtime.scene.add(helper);
    runtime.secondarySelectionHelper = helper;
  }
}

function syncSceneObjects(
  runtime: ViewportRuntime,
  objects: SceneObject[],
  selectedId: string | null,
  csgSecondaryId: string | null,
): void {
  const { objectGroup: group, transformControls } = runtime;
  const existing = new Map(group.children.map((child) => [child.userData.objectId as string, child]));
  const attachedObject = transformControls.object;
  const attachedId = attachedObject?.userData.objectId as string | undefined;
  const nextAttachedObject = attachedId
    ? objects.find((object) => object.id === attachedId)
    : undefined;
  if (
    transformControls.dragging &&
    (!attachedObject ||
      selectedId !== attachedId ||
      !nextAttachedObject ||
      nextAttachedObject.kind !== attachedObject.userData.kind)
  ) {
    cancelActiveTransform(runtime);
  }

  for (const object of objects) {
    let mesh = existing.get(object.id) as THREE.Mesh | undefined;
    if (!mesh || mesh.userData.kind !== object.kind) {
      if (mesh) {
        if (transformControls.object === mesh) transformControls.detach();
        group.remove(mesh);
        disposeObject(mesh);
      }
      mesh = new THREE.Mesh(
        createSceneObjectGeometry(object),
        new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.06 }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.objectId = object.id;
      mesh.userData.kind = object.kind;
      group.add(mesh);
    }

    existing.delete(object.id);
    if (!(transformControls.dragging && transformControls.object === mesh)) {
      mesh.position.fromArray(object.position);
      mesh.rotation.fromArray([...object.rotation, "XYZ"]);
      mesh.scale.fromArray(object.scale);
    }
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.set(object.color);
    const isPrimary = selectedId === object.id;
    const isSecondary = !isPrimary && csgSecondaryId === object.id;
    material.emissive.set(
      isPrimary ? "#3f2f9c" : isSecondary ? "#8a4b00" : "#000000",
    );
    material.emissiveIntensity = isPrimary ? 0.38 : isSecondary ? 0.3 : 0;
  }

  for (const staleObject of existing.values()) {
    if (transformControls.object === staleObject) transformControls.detach();
    group.remove(staleObject);
    disposeObject(staleObject);
  }

  const selectedMesh = selectedId
    ? (group.children.find((child) => child.userData.objectId === selectedId) as
        | THREE.Mesh
        | undefined)
    : undefined;
  const secondaryMesh =
    csgSecondaryId && csgSecondaryId !== selectedId
      ? (group.children.find(
          (child) => child.userData.objectId === csgSecondaryId,
        ) as THREE.Mesh | undefined)
      : undefined;
  syncSelection(runtime, selectedMesh, secondaryMesh);
}

function readTransform(object: THREE.Object3D): TransformSnapshot {
  return {
    objectId: object.userData.objectId as string,
    position: object.position.toArray() as Vector3Tuple,
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: object.scale.toArray() as Vector3Tuple,
  };
}

function vectorsMatch(left: Vector3Tuple, right: Vector3Tuple): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) < 1e-6);
}

function mergeChangedComponents(
  start: Vector3Tuple,
  preview: Vector3Tuple,
  latest: Vector3Tuple,
): Vector3Tuple {
  return preview.map((value, index) =>
    Math.abs(value - start[index]) >= 1e-6 ? value : latest[index],
  ) as Vector3Tuple;
}

function vectorIsFinite(vector: Vector3Tuple): boolean {
  return vector.every(Number.isFinite);
}

function clampGizmoScale(value: number, fallback: number): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(safeValue)) return 1;
  return Math.min(MAX_GIZMO_SCALE, Math.max(MIN_GIZMO_SCALE, safeValue));
}

export function SceneViewport({
  objects,
  selectedId,
  csgSecondaryId,
  transformMode,
  isTransforming,
  interactionLocked,
  onSelect,
  onTransform,
  onTransformModeChange,
  onTransformingChange,
  onRendererChange,
}: SceneViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const objectsRef = useRef(objects);
  const selectedIdRef = useRef(selectedId);
  const csgSecondaryIdRef = useRef(csgSecondaryId);
  const onSelectRef = useRef(onSelect);
  const onTransformRef = useRef(onTransform);
  const onTransformingChangeRef = useRef(onTransformingChange);
  const transformModeRef = useRef<TransformMode>(transformMode);
  const interactionLockedRef = useRef(interactionLocked);

  useEffect(() => {
    objectsRef.current = objects;
    selectedIdRef.current = selectedId;
    csgSecondaryIdRef.current = csgSecondaryId;
    onSelectRef.current = onSelect;
    onTransformRef.current = onTransform;
    onTransformingChangeRef.current = onTransformingChange;
    const runtime = runtimeRef.current;
    if (runtime) syncSceneObjects(runtime, objects, selectedId, csgSecondaryId);
  }, [
    csgSecondaryId,
    objects,
    selectedId,
    onSelect,
    onTransform,
    onTransformingChange,
  ]);

  useEffect(() => {
    transformModeRef.current = transformMode;
    runtimeRef.current?.transformControls.setMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    interactionLockedRef.current = interactionLocked;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (interactionLocked && runtime.transformControls.dragging) {
      cancelActiveTransform(runtime);
    }
    runtime.transformControls.enabled = !interactionLocked;
  }, [interactionLocked]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let removeEventListeners: (() => void) | undefined;

    const initialize = async () => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#eef1f7");
      scene.fog = new THREE.Fog("#eef1f7", 18, 42);

      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(5.5, 4.2, 7.5);

      let renderer: Renderer;
      if ("gpu" in navigator) {
        const webGpuRenderer = new WebGPURenderer({ canvas, antialias: true });
        await webGpuRenderer.init();
        renderer = webGpuRenderer;
        onRendererChange("WebGPU");
      } else {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        onRendererChange("WebGL 호환 모드");
      }

      if (disposed) {
        renderer.dispose();
        return;
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.target.set(0, 0.65, 0);

      const transformControls = new TransformControls(camera, canvas);
      transformControls.setMode(transformModeRef.current);
      transformControls.setSize(0.82);
      transformControls.enabled = !interactionLockedRef.current;
      const transformHelper = transformControls.getHelper();
      scene.add(transformHelper);

      const hemisphere = new THREE.HemisphereLight("#ffffff", "#94a3b8", 2.5);
      scene.add(hemisphere);
      const keyLight = new THREE.DirectionalLight("#ffffff", 4.2);
      keyLight.position.set(5, 8, 4);
      keyLight.castShadow = true;
      scene.add(keyLight);

      const grid = new THREE.GridHelper(30, 30, "#b7becd", "#d7dce6");
      scene.add(grid);
      const objectGroup = new THREE.Group();
      scene.add(objectGroup);

      const runtime: ViewportRuntime = {
        scene,
        camera,
        renderer,
        controls,
        transformControls,
        transformHelper,
        objectGroup,
        selectionHelper: null,
        secondarySelectionHelper: null,
        isCancellingTransform: false,
        activePointerIds: new Set<number>(),
        suspendOrbitUntilPointersUp: false,
      };
      runtimeRef.current = runtime;
      syncSceneObjects(
        runtime,
        objectsRef.current,
        selectedIdRef.current,
        csgSecondaryIdRef.current,
      );

      const resize = () => {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (width === 0 || height === 0) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      resize();

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let pointerStart: { x: number; y: number; pointerId: number } | null = null;
      let suppressSelectionForPointer = false;
      let transformStart: TransformSnapshot | null = null;
      const scheduleSceneResync = () => {
        queueMicrotask(() => {
          if (disposed || runtimeRef.current !== runtime) return;
          syncSceneObjects(
            runtime,
            objectsRef.current,
            selectedIdRef.current,
            csgSecondaryIdRef.current,
          );
        });
      };

      const onTransformMouseDown = () => {
        const object = transformControls.object;
        if (!object) return;
        suppressSelectionForPointer = true;
        transformStart = readTransform(object);
      };
      const onTransformMouseUp = (event: { mode: TransformControlsMode }) => {
        const object = transformControls.object;
        const start = transformStart;
        transformStart = null;
        if (runtime.isCancellingTransform) {
          scheduleSceneResync();
          return;
        }
        if (!object || !start || object.userData.objectId !== start.objectId) {
          scheduleSceneResync();
          return;
        }

        const current = readTransform(object);
        const activeField =
          event.mode === "translate"
            ? "position"
            : event.mode === "rotate"
              ? "rotation"
              : "scale";
        const startVector = start[activeField];
        const previewVector = current[activeField];
        const latestObject = objectsRef.current.find(
          (sceneObject) => sceneObject.id === current.objectId,
        );
        if (
          !latestObject ||
          !vectorIsFinite(previewVector) ||
          vectorsMatch(startVector, previewVector)
        ) {
          scheduleSceneResync();
          return;
        }

        const mergedVector = mergeChangedComponents(
          startVector,
          previewVector,
          latestObject[activeField],
        );
        if (
          !vectorIsFinite(mergedVector) ||
          vectorsMatch(latestObject[activeField], mergedVector)
        ) {
          scheduleSceneResync();
          return;
        }

        const updates: SceneObjectUpdates =
          activeField === "position"
            ? { position: mergedVector }
            : activeField === "rotation"
              ? { rotation: mergedVector }
              : { scale: mergedVector };
        onTransformRef.current(current.objectId, updates);
        scheduleSceneResync();
      };
      const onDraggingChanged = (event: { value: unknown }) => {
        const isDragging = Boolean(event.value);
        controls.enabled = !isDragging && !runtime.suspendOrbitUntilPointersUp;
        onTransformingChangeRef.current(isDragging);
      };
      const onTransformObjectChange = () => {
        if (
          runtime.isCancellingTransform ||
          transformControls.mode !== "scale" ||
          !transformControls.object
        ) {
          return;
        }
        const fallback = transformStart?.scale ?? [1, 1, 1];
        transformControls.object.scale.set(
          clampGizmoScale(transformControls.object.scale.x, fallback[0]),
          clampGizmoScale(transformControls.object.scale.y, fallback[1]),
          clampGizmoScale(transformControls.object.scale.z, fallback[2]),
        );
      };
      transformControls.addEventListener("mouseDown", onTransformMouseDown);
      transformControls.addEventListener("mouseUp", onTransformMouseUp);
      transformControls.addEventListener("dragging-changed", onDraggingChanged);
      transformControls.addEventListener("objectChange", onTransformObjectChange);

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        runtime.activePointerIds.add(event.pointerId);
        canvas.focus({ preventScroll: true });
        if (transformControls.dragging || transformControls.axis !== null) {
          suppressSelectionForPointer = true;
          pointerStart = null;
          return;
        }
        suppressSelectionForPointer = false;
        pointerStart = {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
        };
      };
      const onPointerUp = (event: PointerEvent) => {
        runtime.activePointerIds.delete(event.pointerId);
        if (
          runtime.activePointerIds.size === 0 &&
          runtime.suspendOrbitUntilPointersUp
        ) {
          runtime.suspendOrbitUntilPointersUp = false;
          controls.enabled = !transformControls.dragging;
        }
        if (event.button !== 0) return;
        if (suppressSelectionForPointer) {
          suppressSelectionForPointer = false;
          pointerStart = null;
          return;
        }

        const start = pointerStart;
        pointerStart = null;
        if (!start || start.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;

        const bounds = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(objectGroup.children, false)[0];
        onSelectRef.current((hit?.object.userData.objectId as string | undefined) ?? null);
      };
      const onPointerCancel = (event: PointerEvent) => {
        runtime.activePointerIds.delete(event.pointerId);
        if (runtime.activePointerIds.size === 0) {
          runtime.suspendOrbitUntilPointersUp = false;
          controls.enabled = !transformControls.dragging;
        }
        pointerStart = null;
        suppressSelectionForPointer = false;
        if (!transformControls.dragging) return;
        transformStart = null;
        cancelActiveTransform(runtime);
        scheduleSceneResync();
      };
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      removeEventListeners = () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        transformControls.removeEventListener("mouseDown", onTransformMouseDown);
        transformControls.removeEventListener("mouseUp", onTransformMouseUp);
        transformControls.removeEventListener("dragging-changed", onDraggingChanged);
        transformControls.removeEventListener("objectChange", onTransformObjectChange);
      };

      renderer.setAnimationLoop(() => {
        controls.update();
        runtime.selectionHelper?.update();
        runtime.secondarySelectionHelper?.update();
        renderer.render(scene, camera);
      });
    };

    void initialize().catch((error: unknown) => {
      console.error("Failed to initialize 3D renderer", error);
      onRendererChange("렌더러 오류");
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      removeEventListeners?.();
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.renderer.setAnimationLoop(null);
      runtime.activePointerIds.clear();
      runtime.suspendOrbitUntilPointersUp = false;
      runtime.controls.enabled = true;
      runtime.controls.dispose();
      runtime.transformControls.detach();
      runtime.scene.remove(runtime.transformHelper);
      runtime.transformControls.dispose();
      disposeSelectionHelper(runtime);
      disposeSecondarySelectionHelper(runtime);
      for (const object of runtime.objectGroup.children) disposeObject(object);
      runtime.renderer.dispose();
      runtimeRef.current = null;
      onTransformingChangeRef.current(false);
    };
  }, [onRendererChange]);

  return (
    <div className="viewport-wrap" data-transform-shortcuts>
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        aria-label="3D 장면 뷰포트"
        aria-keyshortcuts={
          interactionLocked
            ? undefined
            : isTransforming
            ? "Escape"
            : selectedId
              ? "W E R Escape Delete Backspace"
              : undefined
        }
        tabIndex={0}
      />
      <div className="transform-toolbar" role="group" aria-label="트랜스폼 도구">
        {TRANSFORM_MODES.map(({ mode, label, shortcut, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={transformMode === mode ? "is-active" : ""}
            aria-pressed={selectedId !== null && transformMode === mode}
            aria-keyshortcuts={
              selectedId !== null && !isTransforming && !interactionLocked
                ? shortcut
                : undefined
            }
            disabled={selectedId === null || isTransforming || interactionLocked}
            title={
              interactionLocked
                ? "CSG 계산이 끝난 뒤 트랜스폼하세요."
                : `${label} (${shortcut})`
            }
            onClick={() => onTransformModeChange(mode)}
          >
            <Icon size={16} />
            <span>{label}</span>
            <kbd aria-hidden="true">{shortcut}</kbd>
          </button>
        ))}
      </div>
      <div className="viewport-help" role="status" aria-live="polite" aria-atomic="true">
        {interactionLocked
          ? "CSG 계산 중 · 장면 편집은 결과가 준비될 때까지 잠깁니다."
          : selectedId
            ? `현재 모드: ${TRANSFORM_MODES.find(({ mode }) => mode === transformMode)?.label} · 뷰포트/도구 포커스 후 W/E/R 전환 · Esc 해제 · Delete/Backspace 삭제`
            : "오브젝트 클릭: 선택 · 빈 공간 드래그: 회전 · 휠: 확대"}
      </div>
      <div className="view-cube" aria-hidden="true">
        <span>TOP</span>
        <strong>FRONT</strong>
      </div>
    </div>
  );
}
