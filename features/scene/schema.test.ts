import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MESH_ATTRIBUTE_VALUES,
  sceneObjectSchema,
} from "./schema";

const VALID_TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const VALID_NORMALS = [0, 0, 1, 0, 0, 1, 0, 0, 1];

function meshObject(positions: number[], normals: number[]) {
  return {
    id: "mesh-1",
    name: "Baked mesh",
    kind: "mesh" as const,
    geometry: {
      positions,
      normals,
      operation: "union" as const,
      topology: "csg-engine-output-v1" as const,
    },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#123456",
    createdAt: 1,
  };
}

test("baked mesh schema accepts complete non-indexed triangles", () => {
  assert.equal(
    sceneObjectSchema.safeParse(meshObject(VALID_TRIANGLE, VALID_NORMALS))
      .success,
    true,
  );
});

test("baked mesh schema requires the CSG topology marker", () => {
  const object = meshObject(VALID_TRIANGLE, VALID_NORMALS);
  const geometryWithoutMarker = {
    positions: object.geometry.positions,
    normals: object.geometry.normals,
    operation: object.geometry.operation,
  };

  assert.equal(
    sceneObjectSchema.safeParse({
      ...object,
      geometry: geometryWithoutMarker,
    }).success,
    false,
  );
});

test("baked mesh schema rejects unequal, incomplete, and non-finite attributes", () => {
  assert.equal(
    sceneObjectSchema.safeParse(meshObject(VALID_TRIANGLE, VALID_NORMALS.slice(3)))
      .success,
    false,
  );
  assert.equal(
    sceneObjectSchema.safeParse(
      meshObject([...VALID_TRIANGLE, 1], [...VALID_NORMALS, 0]),
    ).success,
    false,
  );
  assert.equal(
    sceneObjectSchema.safeParse(
      meshObject(
        VALID_TRIANGLE.map((value, index) => (index === 0 ? Number.NaN : value)),
        VALID_NORMALS,
      ),
    ).success,
    false,
  );
});

test("baked mesh schema accepts exactly 20,000 triangles and rejects one more", () => {
  const boundaryPositions = Array.from(
    { length: MAX_MESH_ATTRIBUTE_VALUES },
    (_, index) => VALID_TRIANGLE[index % VALID_TRIANGLE.length],
  );
  const boundaryNormals = Array.from(
    { length: MAX_MESH_ATTRIBUTE_VALUES },
    (_, index) => VALID_NORMALS[index % VALID_NORMALS.length],
  );
  assert.equal(
    sceneObjectSchema.safeParse(meshObject(boundaryPositions, boundaryNormals))
      .success,
    true,
  );

  assert.equal(
    sceneObjectSchema.safeParse(
      meshObject(
        [...boundaryPositions, ...VALID_TRIANGLE],
        [...boundaryNormals, ...VALID_NORMALS],
      ),
    ).success,
    false,
  );
});

test("scene object schema keeps accepting version 1 primitive object shapes", () => {
  const legacyPrimitive = {
    id: "legacy-box",
    name: "Legacy Box",
    kind: "box",
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#7c6df2",
    createdAt: 1,
  };

  assert.deepEqual(sceneObjectSchema.parse(legacyPrimitive), legacyPrimitive);
});
