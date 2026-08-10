"use client";

import { useEffect, useRef, useState } from "react";
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

type SceneViewportProps = {
  objects: SceneObject[];
  selectedId: string | null;
  onSelect: (objectId: string | null) => void;
  onTransform: (objectId: string, updates: SceneObjectUpdates) => void;
  onRendererChange: (rendererName: string) => void;
};

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
  isCancellingTransform: boolean;
};

type TransformSnapshot = Pick<SceneObject, "position" | "rotation" | "scale"> & {
  objectId: string;
};

const TRANSFORM_MODES = [
  { mode: "translate", label: "이동", icon: Move3D },
  { mode: "rotate", label: "회전", icon: Rotate3D },
  { mode: "scale", label: "크기", icon: Scale3D },
] satisfies Array<{
  mode: TransformControlsMode;
  label: string;
  icon: typeof Move3D;
}>;

const MIN_GIZMO_SCALE = 0.01;
const MAX_GIZMO_SCALE = 100;

function createGeometry(kind: SceneObject["kind"]): THREE.BufferGeometry {
  if (kind === "sphere") return new THREE.SphereGeometry(0.75, 40, 24);
  if (kind === "cylinder") return new THREE.CylinderGeometry(0.65, 0.65, 1.5, 36);
  return new THREE.BoxGeometry(1.35, 1.35, 1.35);
}

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

function cancelActiveTransform(runtime: ViewportRuntime): void {
  if (!runtime.transformControls.dragging) return;
  runtime.isCancellingTransform = true;
  try {
    if (runtime.transformControls.object) runtime.transformControls.reset();
    runtime.transformControls.pointerUp(null);
    runtime.controls.enabled = true;
  } finally {
    runtime.isCancellingTransform = false;
  }
}

function syncSelection(runtime: ViewportRuntime, selectedMesh?: THREE.Mesh): void {
  if (
    runtime.transformControls.dragging &&
    runtime.transformControls.object !== selectedMesh
  ) {
    cancelActiveTransform(runtime);
  }

  if (!selectedMesh) {
    runtime.transformControls.detach();
    disposeSelectionHelper(runtime);
    return;
  }

  if (runtime.transformControls.object !== selectedMesh) {
    runtime.transformControls.attach(selectedMesh);
  }

  if (runtime.selectionHelper?.object === selectedMesh) {
    runtime.selectionHelper.update();
    return;
  }

  disposeSelectionHelper(runtime);
  const helper = new THREE.BoxHelper(selectedMesh, "#6f60e8");
  helper.material.depthTest = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.9;
  helper.renderOrder = 2;
  runtime.scene.add(helper);
  runtime.selectionHelper = helper;
}

function syncSceneObjects(
  runtime: ViewportRuntime,
  objects: SceneObject[],
  selectedId: string | null,
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
        createGeometry(object.kind),
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
    material.emissive.set(selectedId === object.id ? "#3f2f9c" : "#000000");
    material.emissiveIntensity = selectedId === object.id ? 0.38 : 0;
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
  syncSelection(runtime, selectedMesh);
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
  onSelect,
  onTransform,
  onRendererChange,
}: SceneViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const objectsRef = useRef(objects);
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onTransformRef = useRef(onTransform);
  const transformModeRef = useRef<TransformControlsMode>("translate");
  const [transformMode, setTransformMode] =
    useState<TransformControlsMode>("translate");

  useEffect(() => {
    objectsRef.current = objects;
    selectedIdRef.current = selectedId;
    onSelectRef.current = onSelect;
    onTransformRef.current = onTransform;
    const runtime = runtimeRef.current;
    if (runtime) syncSceneObjects(runtime, objects, selectedId);
  }, [objects, selectedId, onSelect, onTransform]);

  useEffect(() => {
    transformModeRef.current = transformMode;
    runtimeRef.current?.transformControls.setMode(transformMode);
  }, [transformMode]);

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
        isCancellingTransform: false,
      };
      runtimeRef.current = runtime;
      syncSceneObjects(runtime, objectsRef.current, selectedIdRef.current);

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
          syncSceneObjects(runtime, objectsRef.current, selectedIdRef.current);
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
        const activeVector = current[
          event.mode === "translate"
            ? "position"
            : event.mode === "rotate"
              ? "rotation"
              : "scale"
        ];
        if (!vectorIsFinite(activeVector)) {
          scheduleSceneResync();
        } else if (event.mode === "translate" && !vectorsMatch(start.position, current.position)) {
          onTransformRef.current(current.objectId, { position: current.position });
        } else if (event.mode === "rotate" && !vectorsMatch(start.rotation, current.rotation)) {
          onTransformRef.current(current.objectId, { rotation: current.rotation });
        } else if (event.mode === "scale" && !vectorsMatch(start.scale, current.scale)) {
          onTransformRef.current(current.objectId, { scale: current.scale });
        } else {
          scheduleSceneResync();
        }
      };
      const onDraggingChanged = (event: { value: unknown }) => {
        controls.enabled = !Boolean(event.value);
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
      const onPointerCancel = () => {
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
      runtime.controls.enabled = true;
      runtime.controls.dispose();
      runtime.transformControls.detach();
      runtime.scene.remove(runtime.transformHelper);
      runtime.transformControls.dispose();
      disposeSelectionHelper(runtime);
      for (const object of runtime.objectGroup.children) disposeObject(object);
      runtime.renderer.dispose();
      runtimeRef.current = null;
    };
  }, [onRendererChange]);

  return (
    <div className="viewport-wrap">
      <canvas ref={canvasRef} className="viewport-canvas" aria-label="3D 장면 뷰포트" />
      <div className="transform-toolbar" role="group" aria-label="트랜스폼 도구">
        {TRANSFORM_MODES.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={transformMode === mode ? "is-active" : ""}
            aria-pressed={selectedId !== null && transformMode === mode}
            disabled={selectedId === null}
            onClick={() => setTransformMode(mode)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="viewport-help">
        {selectedId
          ? "기즈모 드래그: 변형 · 빈 공간 드래그: 회전 · 휠: 확대"
          : "오브젝트 클릭: 선택 · 빈 공간 드래그: 회전 · 휠: 확대"}
      </div>
      <div className="view-cube" aria-hidden="true">
        <span>TOP</span>
        <strong>FRONT</strong>
      </div>
    </div>
  );
}
