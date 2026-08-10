import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import type { SceneCommand } from "./commands";
import { SceneDocument } from "./scene-document";
import { createSceneObject, sceneObjectSchema } from "./schema";

test("applyMany replaces operands atomically and supports undo and redo", () => {
  const scene = new SceneDocument();
  const a = createSceneObject("box", { id: "a", createdAt: 1 });
  const b = createSceneObject("sphere", { id: "b", createdAt: 2 });
  scene.applyMany(
    [
      { type: "object.create", object: a },
      { type: "object.create", object: b },
    ],
    "user",
  );

  const result = sceneObjectSchema.parse({
    id: "result",
    name: "Result",
    kind: "mesh",
    geometry: {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      operation: "union",
      topology: "csg-engine-output-v1",
    },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#123456",
    createdAt: 3,
  });
  const replacement: SceneCommand[] = [
    { type: "object.delete", objectId: a.id },
    { type: "object.delete", objectId: b.id },
    { type: "object.create", object: result },
  ];

  scene.applyMany(replacement, "user");
  assert.deepEqual(scene.getSnapshot().map(({ id }) => id), ["result"]);

  if (result.kind === "mesh") result.geometry.positions[0] = 99;
  const stored = scene.getSnapshot()[0];
  assert.equal(stored.kind === "mesh" ? stored.geometry.positions[0] : null, 0);

  scene.undo();
  assert.deepEqual(scene.getSnapshot().map(({ id }) => id), ["a", "b"]);
  scene.redo();
  assert.deepEqual(scene.getSnapshot().map(({ id }) => id), ["result"]);

  const exported = JSON.parse(scene.exportJson()) as {
    format: string;
    version: number;
  };
  assert.deepEqual(
    { format: exported.format, version: exported.version },
    { format: "localmesh.scene", version: 2 },
  );
});

test("applyMany parses the complete batch before opening a transaction", () => {
  const scene = new SceneDocument();
  const valid = createSceneObject("box", { id: "valid" });
  const invalidBatch = [
    { type: "object.create", object: valid },
    { type: "object.create", object: { ...valid, id: "", name: "Invalid" } },
  ] as SceneCommand[];

  assert.throws(() => scene.applyMany(invalidBatch, "user"));
  assert.deepEqual(scene.getSnapshot(), []);
});

test("baked mesh geometry round-trips through a Yjs update", () => {
  const source = new SceneDocument();
  const mesh = sceneObjectSchema.parse({
    id: "mesh-roundtrip",
    name: "Mesh roundtrip",
    kind: "mesh",
    geometry: {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      operation: "intersect",
      topology: "csg-engine-output-v1",
    },
    position: [1, 2, 3],
    rotation: [0.1, 0.2, 0.3],
    scale: [1.5, 0.8, 2],
    color: "#123456",
    createdAt: 4,
  });
  source.apply({ type: "object.create", object: mesh }, "user");

  const replicatedDoc = new Y.Doc();
  Y.applyUpdate(replicatedDoc, Y.encodeStateAsUpdate(source.doc));
  const replica = new SceneDocument(replicatedDoc);

  assert.deepEqual(replica.getSnapshot(), [mesh]);
});
