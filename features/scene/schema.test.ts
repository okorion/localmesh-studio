import assert from "node:assert/strict";
import test from "node:test";
import { sceneObjectSchema } from "./schema";

const VALID_TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const VALID_NORMALS = [0, 0, 1, 0, 0, 1, 0, 0, 1];

function meshObject(positions: number[], normals: number[]) {
  return {
    id: "mesh-1",
    name: "Baked mesh",
    kind: "mesh" as const,
    geometry: { positions, normals, operation: "union" as const },
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
