import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry } from "three";
import { CsgError, evaluateCsg } from "./csg";
import {
  createSceneObject,
  meshSceneObjectSchema,
  sceneObjectSchema,
  type MeshSceneObject,
  type PrimitiveKind,
} from "./schema";

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

function meshOperand(
  id: string,
  positions: number[],
  normals = Array.from({ length: positions.length / 3 }, () => [0, 0, 1]).flat(),
): MeshSceneObject {
  return meshSceneObjectSchema.parse({
    id,
    name: id,
    kind: "mesh",
    geometry: {
      positions,
      normals,
      operation: "union",
      topology: "csg-engine-output-v1",
    },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#123456",
    createdAt: 3,
  });
}

function openBoxOperand(id: string, segments: number): MeshSceneObject {
  const geometry = new BoxGeometry(
    1.35,
    1.35,
    1.35,
    segments,
    segments,
    segments,
  ).toNonIndexed();
  const removedFace = geometry.groups.at(-1);
  assert.ok(removedFace);
  const positionAttribute = geometry.getAttribute("position");
  const normalAttribute = geometry.getAttribute("normal");
  const positions = Array.from(positionAttribute.array).slice(
    0,
    removedFace.start * positionAttribute.itemSize,
  );
  const normals = Array.from(normalAttribute.array).slice(
    0,
    removedFace.start * normalAttribute.itemSize,
  );
  geometry.dispose();
  return meshOperand(id, positions, normals);
}

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
    (error: unknown) => error instanceof CsgError && error.code === "INVALID_RESULT",
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

test("handles overlapping sphere operands within the topology budget", async () => {
  const sphereA = createSceneObject("sphere", {
    id: "sphere-a",
    position: [0, 0, 0],
  });
  const sphereB = createSceneObject("sphere", {
    id: "sphere-b",
    position: [0.3, 0, 0],
  });

  const result = await evaluateCsg("union", sphereA, sphereB);
  assert.equal(result.kind, "mesh");
});

const PRIMITIVE_KINDS = ["box", "sphere", "cylinder"] as const;

for (const aKind of PRIMITIVE_KINDS) {
  for (const bKind of PRIMITIVE_KINDS) {
    if (aKind === bKind) continue;
    for (const operation of ["union", "subtract", "intersect"] as const) {
      test(`handles ${aKind} A and ${bKind} B for ${operation}`, async () => {
        const a = createSceneObject(aKind, { id: `matrix-a-${aKind}-${bKind}` });
        const b = createSceneObject(bKind, {
          id: `matrix-b-${aKind}-${bKind}`,
          position: [0.35, primitiveY(bKind), 0],
        });

        const result = await evaluateCsg(operation, a, b);
        assert.equal(result.kind, "mesh");
      });
    }
  }
}

function primitiveY(kind: PrimitiveKind): number {
  return kind === "sphere" ? 0.75 : 0.5;
}

for (const offset of [0.3, 0.35]) {
  test(`handles sphere A and added box B at x=${offset} for union`, async () => {
    const sphere = createSceneObject("sphere", {
      id: `ordered-sphere-${offset}`,
      position: [0, 0.75, 0],
    });
    const box = createSceneObject("box", {
      id: `ordered-box-${offset}`,
      position: [offset, 0.5, 0],
    });

    const result = await evaluateCsg("union", sphere, box);
    assert.equal(result.kind, "mesh");
  });
}

for (const operation of ["union", "subtract"] as const) {
  test(`handles the calibrated transformed box and sphere for ${operation}`, async () => {
    const box = createSceneObject("box", {
      id: `calibrated-box-${operation}`,
      position: [0, 0.4, 0],
      rotation: [0.08, -0.05, 0.03],
      scale: [1.05, 0.95, 1.1],
    });
    const sphere = createSceneObject("sphere", {
      id: `calibrated-sphere-${operation}`,
      position: [0.28, 0.42, 0.12],
      rotation: [-0.04, 0.12, 0.07],
      scale: [0.85, 1.1, 0.9],
    });

    const result = await evaluateCsg(operation, box, sphere);
    assert.equal(result.kind, "mesh");
  });
}

for (const operation of ["union", "subtract", "intersect"] as const) {
  test(`handles the default UI box and sphere for ${operation}`, async () => {
    const box = createSceneObject("box", {
      id: `ui-box-${operation}`,
      position: [0, 0.5, 0],
    });
    const sphere = createSceneObject("sphere", {
      id: `ui-sphere-${operation}`,
      position: [0, 0.75, 0],
    });

    const result = await evaluateCsg(operation, box, sphere);
    assert.equal(result.kind, "mesh");
  });
}

test("reuses a default UI baked union as a later CSG operand", async () => {
  const box = createSceneObject("box", {
    id: "ui-chain-box",
    position: [0, 0.5, 0],
  });
  const sphere = createSceneObject("sphere", {
    id: "ui-chain-sphere",
    position: [0, 0.75, 0],
  });
  const baked = await evaluateCsg("union", box, sphere);
  const cutter = createSceneObject("cylinder", {
    id: "ui-chain-cutter",
    position: [0, 0.5, 0],
    scale: [0.35, 1, 0.35],
  });

  const chained = await evaluateCsg("subtract", baked, cutter);
  assert.equal(chained.kind, "mesh");
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

for (const operation of ["union", "intersect"] as const) {
  test(`rejects an open oblique triangle operand for ${operation} without mutating inputs`, async () => {
    const openTriangle = meshOperand("open-triangle", [
      0, 0, 0,
      1, 0.2, 0.1,
      0.15, 1, 0.6,
    ]);
    const originalTriangle = structuredClone(openTriangle);
    const originalRight = structuredClone(right);

    await assert.rejects(
      evaluateCsg(operation, openTriangle, right),
      (error: unknown) =>
        error instanceof CsgError && error.code === "INVALID_GEOMETRY",
    );
    assert.deepEqual(openTriangle, originalTriangle);
    assert.deepEqual(right, originalRight);
  });
}

test("rejects an edge-balanced shell that encloses zero volume", async () => {
  const zeroVolume = meshOperand("zero-volume", [
    0, 0, 0,
    1, 0.2, 0.1,
    0.15, 1, 0.6,
    0, 0, 0,
    0.15, 1, 0.6,
    1, 0.2, 0.1,
  ]);

  await assert.rejects(
    evaluateCsg("union", zeroVolume, right),
    (error: unknown) =>
      error instanceof CsgError && error.code === "INVALID_GEOMETRY",
  );
});

for (const operation of ["union", "subtract", "intersect"] as const) {
  test(`rejects a tagged cube with one missing face for ${operation}`, async () => {
    const openCube = openBoxOperand(`open-cube-${operation}`, 1);

    await assert.rejects(
      evaluateCsg(operation, openCube, right),
      (error: unknown) =>
        error instanceof CsgError && error.code === "INVALID_GEOMETRY",
    );
  });
}

for (const operation of ["union", "subtract", "intersect"] as const) {
  test(`rejects a tagged subdivided cube with one missing face for ${operation}`, async () => {
    const openCube = openBoxOperand(`subdivided-open-cube-${operation}`, 4);

    await assert.rejects(
      evaluateCsg(operation, openCube, right),
      (error: unknown) =>
        error instanceof CsgError && error.code === "INVALID_GEOMETRY",
    );
  });
}

test("rejects zero scale with a typed validation error", async () => {
  const flat = createSceneObject("box", {
    id: "flat",
    scale: [1, 0, 1],
  });

  await assert.rejects(
    evaluateCsg("union", flat, right),
    (error: unknown) => error instanceof CsgError && error.code === "INVALID_SCALE",
  );
});
