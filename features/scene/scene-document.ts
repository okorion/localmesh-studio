import * as Y from "yjs";
import {
  sceneCommandSchema,
  type CommandOrigin,
  type SceneCommand,
  type SceneObjectUpdates,
} from "./commands";
import {
  createSceneObject,
  sceneObjectSchema,
  type SceneObject,
  type Vector3Tuple,
} from "./schema";

const OBJECTS_KEY = "scene.objects";
const META_KEY = "scene.meta";
const INITIAL_OBJECT_ID = "localmesh-initial-cube";
const VECTOR_FIELDS = ["position", "rotation", "scale"] as const;
const VECTOR_AXES = ["x", "y", "z"] as const;

type VectorField = (typeof VECTOR_FIELDS)[number];

function isVectorField(key: string): key is VectorField {
  return VECTOR_FIELDS.includes(key as VectorField);
}

export class SceneDocument {
  readonly doc: Y.Doc;
  private readonly objects: Y.Map<Y.Map<unknown>>;
  private readonly meta: Y.Map<unknown>;
  private readonly listeners = new Set<() => void>();
  private readonly undoManager: Y.UndoManager;
  private snapshot: SceneObject[] = [];

  constructor(doc = new Y.Doc()) {
    this.doc = doc;
    this.objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
    this.meta = doc.getMap(META_KEY);
    this.undoManager = new Y.UndoManager(this.objects, {
      trackedOrigins: new Set<CommandOrigin>(["user", "ai"]),
    });
    this.refreshSnapshot();
    this.objects.observeDeep(this.handleObjectsChanged);
  }

  readonly getSnapshot = (): SceneObject[] => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initializeIfNeeded(): void {
    if (this.meta.get("initialized") === true) return;

    this.doc.transact(() => {
      if (this.objects.size === 0) {
        const initialObject = createSceneObject("box", {
          id: INITIAL_OBJECT_ID,
          name: "Starter Cube",
          createdAt: 0,
        });
        this.objects.set(initialObject.id, this.toYMap(initialObject));
      }
      this.meta.set("initialized", true);
    }, "system" satisfies CommandOrigin);
  }

  apply(command: SceneCommand, origin: CommandOrigin = "user"): void {
    const parsed = sceneCommandSchema.parse(command);

    this.doc.transact(() => {
      if (parsed.type === "object.create") {
        this.objects.set(parsed.object.id, this.toYMap(parsed.object));
        return;
      }

      if (parsed.type === "object.delete") {
        this.objects.delete(parsed.objectId);
        return;
      }

      const objectMap = this.objects.get(parsed.objectId);
      if (!objectMap) return;
      this.applyObjectUpdates(objectMap, parsed.updates);
    }, origin);

    this.undoManager.stopCapturing();
  }

  applyMany(commands: SceneCommand[], origin: CommandOrigin): void {
    const parsedCommands = structuredClone(
      commands.map((command) => sceneCommandSchema.parse(command)),
    );

    this.doc.transact(() => {
      for (const parsed of parsedCommands) {
        if (parsed.type === "object.create") {
          this.objects.set(parsed.object.id, this.toYMap(parsed.object));
        } else if (parsed.type === "object.delete") {
          this.objects.delete(parsed.objectId);
        } else {
          const objectMap = this.objects.get(parsed.objectId);
          if (!objectMap) continue;
          this.applyObjectUpdates(objectMap, parsed.updates);
        }
      }
    }, origin);
    this.undoManager.stopCapturing();
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  exportJson(): string {
    return JSON.stringify(
      { format: "localmesh.scene", version: 2, objects: this.snapshot },
      null,
      2,
    );
  }

  private readonly handleObjectsChanged = (): void => {
    this.refreshSnapshot();
    for (const listener of this.listeners) listener();
  };

  private refreshSnapshot(): void {
    const next: SceneObject[] = [];
    for (const objectMap of this.objects.values()) {
      const values = Object.fromEntries(objectMap.entries());
      for (const field of VECTOR_FIELDS) {
        values[field] = this.resolveVector(objectMap, field);
      }
      const parsed = sceneObjectSchema.safeParse(values);
      if (parsed.success) next.push(parsed.data);
    }
    this.snapshot = next.toSorted((a, b) => a.createdAt - b.createdAt);
  }

  private toYMap(object: SceneObject): Y.Map<unknown> {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(object)) {
      map.set(key, structuredClone(value));
    }
    return map;
  }

  private applyObjectUpdates(
    objectMap: Y.Map<unknown>,
    updates: SceneObjectUpdates,
  ): void {
    for (const [key, value] of Object.entries(updates)) {
      if (isVectorField(key) && Array.isArray(value)) {
        const current = this.resolveVector(objectMap, key);
        const next = value as Vector3Tuple;
        for (const [index, axis] of VECTOR_AXES.entries()) {
          if (current[index] !== next[index]) {
            objectMap.set(`${key}.${axis}`, next[index]);
          }
        }
        continue;
      }
      objectMap.set(key, value);
    }
  }

  private resolveVector(
    objectMap: Y.Map<unknown>,
    field: VectorField,
  ): [unknown, unknown, unknown] {
    const legacy = objectMap.get(field);
    const base = Array.isArray(legacy) ? legacy : [];
    return VECTOR_AXES.map((axis, index) => {
      const componentKey = `${field}.${axis}`;
      return objectMap.has(componentKey)
        ? objectMap.get(componentKey)
        : base[index];
    }) as [unknown, unknown, unknown];
  }
}
