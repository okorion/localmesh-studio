import assert from "node:assert/strict";
import test from "node:test";
import {
  captureSceneObject,
  createPastedSceneObject,
  getSceneClipboardShortcut,
  resolveSceneClipboardShortcut,
} from "./clipboard";
import { SceneDocument } from "./scene-document";
import { createSceneObject, sceneObjectSchema } from "./schema";

test("captureSceneObject preserves the copy-time snapshot", () => {
  const source = createSceneObject("box", {
    id: "source",
    name: "Original",
    position: [1, 2, 3],
    createdAt: 10,
  });
  const captured = captureSceneObject(source);

  source.position[0] = 99;

  assert.equal(captured.position[0], 1);
  assert.notStrictEqual(captured.position, source.position);
});

test("createPastedSceneObject assigns fresh identity, names, and offsets", () => {
  const source = createSceneObject("sphere", {
    id: "source",
    name: "Sphere",
    position: [1, 2, 3],
    createdAt: 10,
  });
  const first = createPastedSceneObject(source, [source], 1, {
    id: "copy-1",
    now: 10,
  });
  const second = createPastedSceneObject(source, [source, first], 2, {
    id: "copy-2",
    now: 10,
  });

  assert.deepEqual(
    [first.id, first.name, first.position, first.createdAt],
    ["copy-1", "Sphere 복사본", [1.35, 2, 3], 11],
  );
  assert.deepEqual(
    [second.id, second.name, second.position, second.createdAt],
    ["copy-2", "Sphere 복사본 2", [1.7, 2, 3], 12],
  );
  assert.deepEqual(first.rotation, source.rotation);
  assert.deepEqual(first.scale, source.scale);
  assert.equal(first.color, source.color);
});

test("createPastedSceneObject deep-clones baked mesh geometry", () => {
  const mesh = sceneObjectSchema.parse({
    id: "mesh",
    name: "Mesh",
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
    createdAt: 1,
  });
  const captured = captureSceneObject(mesh);
  const pasted = createPastedSceneObject(captured, [mesh], 1, {
    id: "mesh-copy",
    now: 2,
  });

  assert.equal(mesh.kind, "mesh");
  assert.equal(captured.kind, "mesh");
  assert.equal(pasted.kind, "mesh");
  if (
    mesh.kind !== "mesh" ||
    captured.kind !== "mesh" ||
    pasted.kind !== "mesh"
  ) {
    return;
  }

  mesh.geometry.positions[0] = 9;
  captured.geometry.normals[0] = 8;

  assert.equal(captured.geometry.positions[0], 0);
  assert.equal(pasted.geometry.positions[0], 0);
  assert.equal(pasted.geometry.normals[0], 0);
  assert.notStrictEqual(pasted.geometry.positions, captured.geometry.positions);
  assert.notStrictEqual(pasted.geometry.normals, captured.geometry.normals);
});

test("copy names remain valid at the 80-character boundary", () => {
  const source = createSceneObject("cylinder", {
    name: "가".repeat(80),
  });
  const pasted = createPastedSceneObject(source, [source], 123, {
    id: "long-name-copy",
    now: 1,
  });

  assert.equal(pasted.name.length, 80);
  assert.match(pasted.name, / 복사본 123$/);
});

test("createdAt stays within the schema boundary", () => {
  const source = createSceneObject("box", {
    id: "latest",
    createdAt: Number.MAX_SAFE_INTEGER,
  });
  const pasted = createPastedSceneObject(source, [source], 1, {
    id: "safe-time-copy",
    now: 1,
  });

  assert.equal(pasted.createdAt, Number.MAX_SAFE_INTEGER);
});

test("a pasted object is one undo and redo unit", () => {
  const scene = new SceneDocument();
  const source = createSceneObject("box", {
    id: "source",
    createdAt: 1,
  });
  scene.apply({ type: "object.create", object: source }, "system");
  const pasted = createPastedSceneObject(source, [source], 1, {
    id: "copy",
    now: 2,
  });

  scene.apply({ type: "object.create", object: pasted }, "user");
  assert.deepEqual(scene.getSnapshot().map(({ id }) => id), ["source", "copy"]);

  scene.undo();
  assert.deepEqual(scene.getSnapshot().map(({ id }) => id), ["source"]);

  scene.redo();
  assert.deepEqual(scene.getSnapshot().map(({ id }) => id), ["source", "copy"]);
});

test("clipboard shortcuts require an unmodified Ctrl or Command chord", () => {
  const shortcut = (
    key: string,
    overrides: Partial<Parameters<typeof getSceneClipboardShortcut>[0]> = {},
  ) =>
    getSceneClipboardShortcut({
      key,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      defaultPrevented: false,
      isComposing: false,
      repeat: false,
      shiftKey: false,
      ...overrides,
    });

  assert.equal(shortcut("c"), "copy");
  assert.equal(shortcut("V", { ctrlKey: false, metaKey: true }), "paste");
  assert.equal(shortcut("c", { shiftKey: true }), null);
  assert.equal(shortcut("v", { altKey: true }), null);
  assert.equal(shortcut("c", { ctrlKey: false }), null);
  assert.equal(shortcut("x"), null);
});

test("clipboard shortcut policy preserves browser and locked interactions", () => {
  const event: Parameters<typeof resolveSceneClipboardShortcut>[0] = {
    key: "c",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    shiftKey: false,
  };
  const context: Parameters<typeof resolveSceneClipboardShortcut>[1] = {
    hasClipboard: true,
    hasSelectedObject: true,
    hasSelectedPageContent: false,
    interactionLocked: false,
    isEditableTarget: false,
  };

  assert.equal(resolveSceneClipboardShortcut(event, context), "copy");
  assert.equal(
    resolveSceneClipboardShortcut({ ...event, key: "v" }, context),
    "paste",
  );

  for (const ignoredEvent of [
    { ...event, defaultPrevented: true },
    { ...event, isComposing: true },
    { ...event, repeat: true },
  ]) {
    assert.equal(resolveSceneClipboardShortcut(ignoredEvent, context), null);
  }

  for (const ignoredContext of [
    { ...context, hasSelectedObject: false },
    { ...context, hasSelectedPageContent: true },
    { ...context, interactionLocked: true },
    { ...context, isEditableTarget: true },
  ]) {
    assert.equal(resolveSceneClipboardShortcut(event, ignoredContext), null);
  }

  assert.equal(
    resolveSceneClipboardShortcut(
      { ...event, key: "v" },
      { ...context, hasClipboard: false },
    ),
    null,
  );
});
