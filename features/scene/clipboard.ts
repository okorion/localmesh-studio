import { sceneObjectSchema, type SceneObject } from "./schema";

const COPY_NAME_MAX_LENGTH = 80;
const PASTE_POSITION_OFFSET = 0.35;

type ClipboardShortcutEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "isComposing"
  | "key"
  | "metaKey"
  | "repeat"
  | "shiftKey"
>;

type SceneClipboardShortcutContext = {
  hasClipboard: boolean;
  hasSelectedObject: boolean;
  hasSelectedPageContent: boolean;
  interactionLocked: boolean;
  isEditableTarget: boolean;
};

type PasteObjectOptions = {
  id?: string;
  now?: number;
};

export type SceneClipboardShortcut = "copy" | "paste";

export function getSceneClipboardShortcut(
  event: ClipboardShortcutEvent,
): SceneClipboardShortcut | null {
  if (
    (!event.ctrlKey && !event.metaKey) ||
    event.altKey ||
    event.shiftKey
  ) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "c") return "copy";
  if (key === "v") return "paste";
  return null;
}

export function resolveSceneClipboardShortcut(
  event: ClipboardShortcutEvent,
  context: SceneClipboardShortcutContext,
): SceneClipboardShortcut | null {
  const shortcut = getSceneClipboardShortcut(event);
  if (
    shortcut === null ||
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    context.interactionLocked ||
    context.isEditableTarget
  ) {
    return null;
  }

  if (shortcut === "copy") {
    return context.hasSelectedObject && !context.hasSelectedPageContent
      ? "copy"
      : null;
  }

  return context.hasClipboard ? "paste" : null;
}

export function captureSceneObject(source: SceneObject): SceneObject {
  return sceneObjectSchema.parse(structuredClone(source));
}

function createCopyName(sourceName: string, pasteIndex: number): string {
  const suffix = pasteIndex === 1 ? " 복사본" : ` 복사본 ${pasteIndex}`;
  const maxBaseLength = COPY_NAME_MAX_LENGTH - suffix.length;
  let base = sourceName.trim().slice(0, maxBaseLength).trimEnd();

  if (/[\uD800-\uDBFF]$/.test(base)) {
    base = base.slice(0, -1);
  }

  return `${base}${suffix}`.trim();
}

export function createPastedSceneObject(
  source: SceneObject,
  existingObjects: readonly SceneObject[],
  pasteIndex: number,
  options: PasteObjectOptions = {},
): SceneObject {
  if (!Number.isSafeInteger(pasteIndex) || pasteIndex < 1) {
    throw new RangeError("pasteIndex must be a positive safe integer");
  }

  const copied = captureSceneObject(source);
  const latestCreatedAt = existingObjects.reduce(
    (latest, object) => Math.max(latest, object.createdAt),
    -1,
  );
  const now = options.now ?? Date.now();
  const offsetX = copied.position[0] + PASTE_POSITION_OFFSET * pasteIndex;

  return sceneObjectSchema.parse({
    ...copied,
    id: options.id ?? crypto.randomUUID(),
    name: createCopyName(copied.name, pasteIndex),
    position: [
      Number.isFinite(offsetX) ? offsetX : copied.position[0],
      copied.position[1],
      copied.position[2],
    ],
    createdAt: Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(now, latestCreatedAt + 1),
    ),
  });
}
