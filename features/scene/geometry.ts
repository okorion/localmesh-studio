import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  SphereGeometry,
} from "three";
import {
  sceneObjectSchema,
  type PrimitiveKind,
  type SceneObject,
} from "./schema";

export function createPrimitiveGeometry(kind: PrimitiveKind): BufferGeometry {
  if (kind === "sphere") return new SphereGeometry(0.75, 40, 24);
  if (kind === "cylinder") {
    return new CylinderGeometry(0.65, 0.65, 1.5, 36);
  }
  return new BoxGeometry(1.35, 1.35, 1.35);
}

export function createSceneObjectGeometry(object: SceneObject): BufferGeometry {
  const parsed = sceneObjectSchema.parse(object);
  if (parsed.kind !== "mesh") return createPrimitiveGeometry(parsed.kind);

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(parsed.geometry.positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array(parsed.geometry.normals), 3),
  );
  return geometry;
}
