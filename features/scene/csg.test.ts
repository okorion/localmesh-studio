import assert from "node:assert/strict";
import test from "node:test";
import { CsgError, evaluateCsg } from "./csg";
import { createSceneObject, sceneObjectSchema } from "./schema";

const left = createSceneObject("box", {
  id: "left",
  name: "Left",
  position: [0, 0, 0],
  createdAt: 1,
});
const right = createSceneObject("box", {
  id: "right",
  name: "Right",
  position: [0.55, 0, 0],
  createdAt: 2,
});

function xBounds(positions: number[]): [number, number] {
  const values = positions.filter((_, index) => index % 3 === 0);
  return [Math.min(...values), Math.max(...values)];
}

const EXPECTED_X_BOUNDS = {
  union: [-0.675, 1.225],
  subtract: [-0.675, -0.125],
  intersect: [-0.125, 0.675],
} satisfies Record<string, [number, number]>;

for (const operation of ["union", "subtract", "intersect"] as const) {
  test(`evaluates ${operation} into a valid baked mesh`, async () => {
    const result = await evaluateCsg(operation, left, right);
    assert.equal(result.kind, "mesh");
    assert.equal(sceneObjectSchema.safeParse(result).success, true);
    if (result.kind === "mesh") {
      assert.equal(result.geometry.operation, operation);
      assert.ok(result.geometry.positions.length >= 9);
      assert.equal(result.geometry.positions.length, result.geometry.normals.length);
      assert.equal(result.geometry.positions.length % 9, 0);
      const actualBounds = xBounds(result.geometry.positions);
      assert.ok(
        actualBounds.every(
          (value, index) =>
            Math.abs(value - EXPECTED_X_BOUNDS[operation][index]) < 1e-4,
        ),
      );
    }
  });
}

test("reports an empty disjoint intersection with a typed error", async () => {
  const distant = createSceneObject("sphere", {
    id: "distant",
    position: [20, 0, 0],
  });

  await assert.rejects(
    evaluateCsg("intersect", left, distant),
    (error: unknown) => error instanceof CsgError && error.code === "EMPTY_RESULT",
  );
});

test("rejects a face-tangent intersection as a degenerate solid", async () => {
  const tangent = createSceneObject("box", {
    id: "tangent",
    position: [1.35, 0, 0],
  });

  await assert.rejects(
    evaluateCsg("intersect", left, tangent),
    (error: unknown) => error instanceof CsgError && error.code === "EMPTY_RESULT",
  );
});

test("keeps operand A local transform on transformed inputs", async () => {
  const transformedA = createSceneObject("box", {
    id: "transformed-a",
    position: [2, 3, 4],
    rotation: [0.15, -0.25, 0.1],
    scale: [1.2, 0.9, 1.1],
  });
  const transformedB = createSceneObject("sphere", {
    id: "transformed-b",
    position: [2.25, 3, 4],
    rotation: [0, 0.2, 0],
    scale: [0.8, 1.1, 0.9],
  });

  const result = await evaluateCsg("union", transformedA, transformedB);
  assert.deepEqual(result.position, transformedA.position);
  assert.deepEqual(result.rotation, transformedA.rotation);
  assert.deepEqual(result.scale, transformedA.scale);
});

test("uses a baked result as a later CSG operand", async () => {
  const union = await evaluateCsg("union", left, right);
  const cutter = createSceneObject("cylinder", {
    id: "cutter",
    position: [0, 0, 0],
    scale: [0.4, 1, 0.4],
  });

  const chained = await evaluateCsg("subtract", union, cutter);
  assert.equal(chained.kind, "mesh");
  if (chained.kind === "mesh") {
    assert.equal(chained.geometry.operation, "subtract");
    assert.ok(chained.geometry.positions.length >= 9);
  }
});

test("rejects zero scale before loading the CSG engine", async () => {
  const flat = createSceneObject("box", {
    id: "flat",
    scale: [1, 0, 1],
  });

  await assert.rejects(
    evaluateCsg("union", flat, right),
    (error: unknown) => error instanceof CsgError && error.code === "INVALID_SCALE",
  );
});
