"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneObject } from "@/features/scene/schema";

type SceneViewportProps = {
  objects: SceneObject[];
  selectedId: string | null;
  onSelect: (objectId: string | null) => void;
  onRendererChange: (rendererName: string) => void;
};

type Renderer = THREE.WebGLRenderer | WebGPURenderer;
type ViewportRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  controls: OrbitControls;
  objectGroup: THREE.Group;
};

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

function syncSceneObjects(
  group: THREE.Group,
  objects: SceneObject[],
  selectedId: string | null,
): void {
  const existing = new Map(group.children.map((child) => [child.userData.objectId as string, child]));

  for (const object of objects) {
    let mesh = existing.get(object.id) as THREE.Mesh | undefined;
    if (!mesh || mesh.userData.kind !== object.kind) {
      if (mesh) {
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
    mesh.position.fromArray(object.position);
    mesh.rotation.fromArray([...object.rotation, "XYZ"]);
    mesh.scale.fromArray(object.scale);
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.set(object.color);
    material.emissive.set(selectedId === object.id ? "#2d245f" : "#000000");
    material.emissiveIntensity = selectedId === object.id ? 0.28 : 0;
  }

  for (const staleObject of existing.values()) {
    group.remove(staleObject);
    disposeObject(staleObject);
  }
}

export function SceneViewport({
  objects,
  selectedId,
  onSelect,
  onRendererChange,
}: SceneViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const objectsRef = useRef(objects);
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    objectsRef.current = objects;
    selectedIdRef.current = selectedId;
    onSelectRef.current = onSelect;
    const group = runtimeRef.current?.objectGroup;
    if (group) syncSceneObjects(group, objects, selectedId);
  }, [objects, selectedId, onSelect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let removePointerListener: (() => void) | undefined;

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

      const runtime = { scene, camera, renderer, controls, objectGroup };
      runtimeRef.current = runtime;
      syncSceneObjects(objectGroup, objectsRef.current, selectedIdRef.current);

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
      const onPointerDown = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(objectGroup.children, false)[0];
        onSelectRef.current((hit?.object.userData.objectId as string | undefined) ?? null);
      };
      canvas.addEventListener("pointerdown", onPointerDown);
      removePointerListener = () => canvas.removeEventListener("pointerdown", onPointerDown);

      renderer.setAnimationLoop(() => {
        controls.update();
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
      removePointerListener?.();
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.renderer.setAnimationLoop(null);
      runtime.controls.dispose();
      for (const object of runtime.objectGroup.children) disposeObject(object);
      runtime.renderer.dispose();
      runtimeRef.current = null;
    };
  }, [onRendererChange]);

  return (
    <div className="viewport-wrap">
      <canvas ref={canvasRef} className="viewport-canvas" aria-label="3D 장면 뷰포트" />
      <div className="viewport-help">드래그: 회전 · 휠: 확대 · 오브젝트 클릭: 선택</div>
      <div className="view-cube" aria-hidden="true">
        <span>TOP</span>
        <strong>FRONT</strong>
      </div>
    </div>
  );
}
