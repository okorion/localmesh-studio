import {
  BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
} from "three";
import type { Brush } from "three-bvh-csg";
import { createSceneObjectGeometry } from "./geometry";
import {
  MAX_MESH_ATTRIBUTE_VALUES,
  csgOperationSchema,
  sceneObjectSchema,
  type CsgOperation as SceneCsgOperation,
  type MeshSceneObject,
  type SceneObject,
} from "./schema";

export type CsgOperation = SceneCsgOperation;

export type CsgErrorCode =
  | "INVALID_OPERATION"
  | "INVALID_INPUT"
  | "INVALID_SCALE"
  | "INVALID_GEOMETRY"
  | "EMPTY_RESULT"
  | "RESULT_TOO_COMPLEX"
  | "ENGINE_FAILURE";

export class CsgError extends Error {
  readonly code: CsgErrorCode;

  constructor(code: CsgErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CsgError";
    this.code = code;
  }
}

const MIN_SCALE = 0.01;
const MAX_SCALE = 100;
const MIN_RESULT_EXTENT = 1e-6;
export const MAX_CSG_INPUT_TRIANGLES = 20_000;

type GeometryStage = "input" | "output";

interface ValidatedGeometry {
  position: BufferAttribute | InterleavedBufferAttribute;
  normal: BufferAttribute | InterleavedBufferAttribute;
  start: number;
  count: number;
}

function assertScale(object: SceneObject): void {
  if (
    object.scale.some(
      (component) =>
        !Number.isFinite(component) ||
        component < MIN_SCALE ||
        component > MAX_SCALE,
    )
  ) {
    throw new CsgError(
      "INVALID_SCALE",
      `CSG operand ${object.id} must have a positive, finite scale between ${MIN_SCALE} and ${MAX_SCALE}.`,
    );
  }
}

function assertFiniteAttribute(
  attribute: BufferAttribute | InterleavedBufferAttribute,
  label: string,
): void {
  for (let index = 0; index < attribute.count; index += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      if (!Number.isFinite(attribute.getComponent(index, component))) {
        throw new CsgError(
          "INVALID_GEOMETRY",
          `${label} contains a non-finite value.`,
        );
      }
    }
  }
}

function validateGeometry(
  geometry: BufferGeometry,
  stage: GeometryStage,
): ValidatedGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || !normal || position.itemSize !== 3 || normal.itemSize !== 3) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} geometry requires position and normal vec3 attributes.`,
    );
  }
  if (position.count !== normal.count) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} geometry position and normal counts differ.`,
    );
  }

  const index = geometry.getIndex();
  const availableCount = index?.count ?? position.count;
  const { start, count: configuredCount } = geometry.drawRange;
  const count = configuredCount === Infinity ? availableCount - start : configuredCount;
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    !Number.isInteger(count) ||
    count < 0 ||
    start + count > availableCount ||
    start % 3 !== 0 ||
    count % 3 !== 0
  ) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} geometry has an invalid triangle draw range.`,
    );
  }
  if (count === 0) {
    throw new CsgError(
      stage === "output" ? "EMPTY_RESULT" : "INVALID_GEOMETRY",
      stage === "output" ? "CSG produced no triangles." : "CSG input is empty.",
    );
  }
  if (stage === "input" && count / 3 > MAX_CSG_INPUT_TRIANGLES) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `CSG input exceeds the ${MAX_CSG_INPUT_TRIANGLES.toLocaleString("en-US")}-triangle limit.`,
    );
  }
  if (stage === "output" && count * 3 > MAX_MESH_ATTRIBUTE_VALUES) {
    throw new CsgError(
      stage === "output" ? "RESULT_TOO_COMPLEX" : "INVALID_GEOMETRY",
      `${stage} geometry exceeds the mesh complexity limit.`,
    );
  }

  if (index) {
    for (let offset = start; offset < start + count; offset += 1) {
      const value = index.getX(offset);
      if (!Number.isInteger(value) || value < 0 || value >= position.count) {
        throw new CsgError(
          "INVALID_GEOMETRY",
          `${stage} geometry contains an invalid index.`,
        );
      }
    }
  } else if (position.count % 3 !== 0) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} non-indexed geometry contains an incomplete triangle.`,
    );
  }

  assertFiniteAttribute(position, `${stage} position`);
  assertFiniteAttribute(normal, `${stage} normal`);
  return { position, normal, start, count };
}

function serializeOutputGeometry(
  geometry: BufferGeometry,
  operation: CsgOperation,
): MeshSceneObject["geometry"] {
  const { position, normal, start, count } = validateGeometry(geometry, "output");
  const positions: number[] = [];
  const normals: number[] = [];
  const end = start + count;
  const indexAttribute = geometry.getIndex();
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];

  for (let drawOffset = start; drawOffset < end; drawOffset += 1) {
    const vertexIndex = indexAttribute
      ? indexAttribute.getX(drawOffset)
      : drawOffset;
    const coordinates = [
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
    ];
    positions.push(...coordinates);
    normals.push(
      normal.getX(vertexIndex),
      normal.getY(vertexIndex),
      normal.getZ(vertexIndex),
    );
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], coordinates[axis]);
      maximum[axis] = Math.max(maximum[axis], coordinates[axis]);
    }
  }

  if (
    minimum.some((value, axis) => {
      const extent = maximum[axis] - value;
      return !Number.isFinite(extent) || extent <= MIN_RESULT_EXTENT;
    })
  ) {
    throw new CsgError(
      "EMPTY_RESULT",
      "CSG produced an empty or degenerate solid.",
    );
  }

  return { positions, normals, operation };
}

function formatResultName(
  operation: CsgOperation,
  a: SceneObject,
  b: SceneObject,
): string {
  const label =
    operation === "union"
      ? "Union"
      : operation === "subtract"
        ? "Subtract"
        : "Intersect";
  return `${label} (${a.name}, ${b.name})`.slice(0, 80).trim();
}

export function getCsgOperandSignature(object: SceneObject): string {
  return JSON.stringify(sceneObjectSchema.parse(object));
}

export async function evaluateCsg(
  operation: CsgOperation,
  a: SceneObject,
  b: SceneObject,
): Promise<SceneObject> {
  const parsedOperation = csgOperationSchema.safeParse(operation);
  if (!parsedOperation.success) {
    throw new CsgError("INVALID_OPERATION", "Unsupported CSG operation.");
  }

  const parsedA = sceneObjectSchema.safeParse(a);
  const parsedB = sceneObjectSchema.safeParse(b);
  if (!parsedA.success || !parsedB.success || parsedA.data.id === parsedB.data.id) {
    throw new CsgError(
      "INVALID_INPUT",
      "CSG requires two distinct, valid scene objects.",
    );
  }
  assertScale(parsedA.data);
  assertScale(parsedB.data);

  const geometryA = createSceneObjectGeometry(parsedA.data);
  const geometryB = createSceneObjectGeometry(parsedB.data);
  let outputGeometry: BufferGeometry | undefined;
  let brushA: Brush | undefined;
  let brushB: Brush | undefined;
  let outputBrush: Brush | undefined;

  try {
    validateGeometry(geometryA, "input");
    validateGeometry(geometryB, "input");

    const engine = await import("three-bvh-csg");
    brushA = new engine.Brush(geometryA);
    brushB = new engine.Brush(geometryB);
    brushA.position.fromArray(parsedA.data.position);
    brushA.rotation.set(...parsedA.data.rotation);
    brushA.scale.fromArray(parsedA.data.scale);
    brushA.updateMatrixWorld(true);
    brushB.position.fromArray(parsedB.data.position);
    brushB.rotation.set(...parsedB.data.rotation);
    brushB.scale.fromArray(parsedB.data.scale);
    brushB.updateMatrixWorld(true);

    const evaluator = new engine.Evaluator();
    evaluator.useGroups = false;
    evaluator.attributes = ["position", "normal"];
    const engineOperation = {
      union: engine.ADDITION,
      subtract: engine.SUBTRACTION,
      intersect: engine.INTERSECTION,
    }[parsedOperation.data];
    const evaluated = evaluator.evaluate(brushA, brushB, engineOperation);
    outputBrush = evaluated;
    outputGeometry = evaluated.geometry;
    const geometry = serializeOutputGeometry(outputGeometry, parsedOperation.data);

    return sceneObjectSchema.parse({
      id: crypto.randomUUID(),
      name: formatResultName(parsedOperation.data, parsedA.data, parsedB.data),
      kind: "mesh",
      geometry,
      position: [...parsedA.data.position],
      rotation: [...parsedA.data.rotation],
      scale: [...parsedA.data.scale],
      color: parsedA.data.color,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof CsgError) throw error;
    throw new CsgError("ENGINE_FAILURE", "CSG evaluation failed.", {
      cause: error,
    });
  } finally {
    brushA?.disposeCacheData();
    brushB?.disposeCacheData();
    outputBrush?.disposeCacheData();
    geometryA.dispose();
    geometryB.dispose();
    outputGeometry?.dispose();
  }
}
