import { z } from "zod";
import {
  sceneObjectSchema,
  vector3Schema,
  type SceneObject,
} from "./schema";

const objectUpdatesSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    position: vector3Schema,
    rotation: vector3Schema,
    scale: vector3Schema,
  })
  .partial();

export const sceneCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("object.create"), object: sceneObjectSchema }),
  z.object({
    type: z.literal("object.update"),
    objectId: z.string().min(1),
    updates: objectUpdatesSchema,
  }),
  z.object({ type: z.literal("object.delete"), objectId: z.string().min(1) }),
]);

export type SceneCommand = z.infer<typeof sceneCommandSchema>;
export type SceneObjectUpdates = z.infer<typeof objectUpdatesSchema>;
export type CommandOrigin = "user" | "ai" | "system";

export function updateObjectCommand(
  object: SceneObject,
  updates: SceneObjectUpdates,
): SceneCommand {
  return sceneCommandSchema.parse({
    type: "object.update",
    objectId: object.id,
    updates,
  });
}
