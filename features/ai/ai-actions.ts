import { z } from "zod";
import {
  createSceneObject,
  primitiveKindSchema,
  vector3Schema,
  type SceneObject,
} from "@/features/scene/schema";
import type { SceneCommand } from "@/features/scene/commands";

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

const PRIMITIVE_ALIASES = new Map<string, "box" | "sphere" | "cylinder">([
  ["box", "box"],
  ["cube", "box"],
  ["cuboid", "box"],
  ["큐브", "box"],
  ["박스", "box"],
  ["정육면체", "box"],
  ["직육면체", "box"],
  ["sphere", "sphere"],
  ["ball", "sphere"],
  ["globe", "sphere"],
  ["구", "sphere"],
  ["구체", "sphere"],
  ["공", "sphere"],
  ["cylinder", "cylinder"],
  ["원기둥", "cylinder"],
  ["실린더", "cylinder"],
]);

const ACTION_ALIASES = new Map<string, "create" | "update" | "delete">([
  ["create", "create"],
  ["add", "create"],
  ["make", "create"],
  ["생성", "create"],
  ["추가", "create"],
  ["만들기", "create"],
  ["update", "update"],
  ["edit", "update"],
  ["modify", "update"],
  ["move", "update"],
  ["수정", "update"],
  ["변경", "update"],
  ["이동", "update"],
  ["delete", "delete"],
  ["remove", "delete"],
  ["삭제", "delete"],
  ["제거", "delete"],
]);

type UnknownRecord = Record<string, unknown>;

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizePrimitive(value: unknown): unknown {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return candidate;
  return PRIMITIVE_ALIASES.get(normalizeLabel(candidate)) ?? candidate;
}

function normalizeAction(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return ACTION_ALIASES.get(normalizeLabel(value)) ?? value;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function normalizeVector(value: unknown): unknown {
  const record = asRecord(value);
  const candidate = Array.isArray(value)
    ? value.slice(0, 3)
    : record
      ? [record.x, record.y, record.z]
      : null;

  if (!candidate || candidate.length !== 3) return value;
  const numbers = candidate.map(Number);
  return numbers.every(Number.isFinite) ? numbers : value;
}

function resolveTargetId(
  action: UnknownRecord,
  objects: SceneObject[],
): unknown {
  const candidates = [
    action.targetId,
    action.targetName,
    action.objectId,
    action.objectName,
    action.target,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const direct = objects.find((object) => object.id === candidate);
    if (direct) return direct.id;

    const label = normalizeLabel(candidate);
    const byName = objects.find(
      (object) => normalizeLabel(object.name) === label,
    );
    if (byName) return byName.id;

    const kind = normalizePrimitive(candidate);
    if (typeof kind === "string") {
      const byKind = objects.filter((object) => object.kind === kind);
      if (byKind.length === 1) return byKind[0].id;
    }
  }

  return action.targetId;
}

function normalizeAiAction(value: unknown, objects: SceneObject[]): unknown {
  const action = asRecord(value);
  if (!action) return value;
  const actionType = normalizeAction(action.action);

  return {
    ...action,
    action: actionType,
    ...(action.primitive === undefined
      ? {}
      : { primitive: normalizePrimitive(action.primitive) }),
    ...(actionType === "create"
      ? {}
      : { targetId: resolveTargetId(action, objects) }),
    ...(action.position === undefined
      ? {}
      : { position: normalizeVector(action.position) }),
    ...(action.rotationDegrees === undefined
      ? {}
      : { rotationDegrees: normalizeVector(action.rotationDegrees) }),
    ...(action.scale === undefined
      ? {}
      : { scale: normalizeVector(action.scale) }),
  };
}

const createActionSchema = z.object({
  action: z.literal("create"),
  primitive: primitiveKindSchema,
  name: z.string().trim().min(1).max(80).optional(),
  color: colorSchema.optional(),
  position: vector3Schema.optional(),
  scale: vector3Schema.optional(),
});

const updateActionSchema = z.object({
  action: z.literal("update"),
  targetId: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  color: colorSchema.optional(),
  position: vector3Schema.optional(),
  rotationDegrees: vector3Schema.optional(),
  scale: vector3Schema.optional(),
});

const deleteActionSchema = z.object({
  action: z.literal("delete"),
  targetId: z.string().min(1),
});

export const aiResponseSchema = z.object({
  summary: z.string().trim().min(1).max(200),
  actions: z
    .array(z.discriminatedUnion("action", [createActionSchema, updateActionSchema, deleteActionSchema]))
    .min(1)
    .max(8),
});

export type AiSceneResponse = z.infer<typeof aiResponseSchema>;

export function parseAiSceneResponse(
  value: unknown,
  objects: SceneObject[],
): AiSceneResponse {
  const response = asRecord(value);
  if (!response) return aiResponseSchema.parse(value);

  const rawActions = Array.isArray(response.actions)
    ? response.actions
    : response.actions
      ? [response.actions]
      : [];

  return aiResponseSchema.parse({
    ...response,
    summary:
      typeof response.summary === "string" && response.summary.trim()
        ? response.summary
        : "장면 변경 제안",
    actions: rawActions.map((action) => normalizeAiAction(action, objects)),
  });
}

export function aiResponseToCommands(
  response: AiSceneResponse,
  objects: SceneObject[],
): SceneCommand[] {
  const existingIds = new Set(objects.map((object) => object.id));

  return response.actions.flatMap((action): SceneCommand[] => {
    if (action.action === "create") {
      const overrides = {
        ...(action.name ? { name: action.name } : {}),
        ...(action.color ? { color: action.color } : {}),
        ...(action.position ? { position: action.position } : {}),
        ...(action.scale ? { scale: action.scale } : {}),
      };
      return [
        {
          type: "object.create",
          object: createSceneObject(action.primitive, overrides),
        },
      ];
    }

    if (!existingIds.has(action.targetId)) return [];

    if (action.action === "delete") {
      return [{ type: "object.delete", objectId: action.targetId }];
    }

    const updates = {
      ...(action.name ? { name: action.name } : {}),
      ...(action.color ? { color: action.color } : {}),
      ...(action.position ? { position: action.position } : {}),
      ...(action.scale ? { scale: action.scale } : {}),
      ...(action.rotationDegrees
        ? {
            rotation: action.rotationDegrees.map(
              (degrees) => (degrees * Math.PI) / 180,
            ) as [number, number, number],
          }
        : {}),
    };

    return [{ type: "object.update", objectId: action.targetId, updates }];
  });
}

export const AI_RESPONSE_JSON_SCHEMA = JSON.stringify(
  z.toJSONSchema(aiResponseSchema),
);
