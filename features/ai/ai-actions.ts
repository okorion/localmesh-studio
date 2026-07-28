import { z } from "zod";
import {
  createSceneObject,
  primitiveKindSchema,
  vector3Schema,
  type SceneObject,
} from "@/features/scene/schema";
import type { SceneCommand } from "@/features/scene/commands";

const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

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

export const AI_RESPONSE_JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    summary: { type: "string" },
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          action: { enum: ["create", "update", "delete"] },
          primitive: { enum: ["box", "sphere", "cylinder"] },
          targetId: { type: "string" },
          name: { type: "string" },
          color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          rotationDegrees: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        },
        required: ["action"],
      },
    },
  },
  required: ["summary", "actions"],
});
