import * as Y from "yjs";
import {
  sceneCommandSchema,
  type CommandOrigin,
  type SceneCommand,
} from "./commands";
import {
  createSceneObject,
  sceneObjectSchema,
  type SceneObject,
} from "./schema";

const OBJECTS_KEY = "scene.objects";
const META_KEY = "scene.meta";
const INITIAL_OBJECT_ID = "localmesh-initial-cube";

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
      for (const [key, value] of Object.entries(parsed.updates)) {
        objectMap.set(key, Array.isArray(value) ? [...value] : value);
      }
    }, origin);

    this.undoManager.stopCapturing();
  }

  applyMany(commands: SceneCommand[], origin: CommandOrigin): void {
    this.doc.transact(() => {
      for (const command of commands) {
        const parsed = sceneCommandSchema.parse(command);
        if (parsed.type === "object.create") {
          this.objects.set(parsed.object.id, this.toYMap(parsed.object));
        } else if (parsed.type === "object.delete") {
          this.objects.delete(parsed.objectId);
        } else {
          const objectMap = this.objects.get(parsed.objectId);
          if (!objectMap) continue;
          for (const [key, value] of Object.entries(parsed.updates)) {
            objectMap.set(key, Array.isArray(value) ? [...value] : value);
          }
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
      { format: "localmesh.scene", version: 1, objects: this.snapshot },
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
      const parsed = sceneObjectSchema.safeParse(
        Object.fromEntries(objectMap.entries()),
      );
      if (parsed.success) next.push(parsed.data);
    }
    this.snapshot = next.toSorted((a, b) => a.createdAt - b.createdAt);
  }

  private toYMap(object: SceneObject): Y.Map<unknown> {
    const map = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(object)) {
      map.set(key, Array.isArray(value) ? [...value] : value);
    }
    return map;
  }
}
