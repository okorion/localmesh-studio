import { z } from "zod";

export const primitiveKindSchema = z.enum(["box", "sphere", "cylinder"]);

export const vector3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

export const sceneObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  kind: primitiveKindSchema,
  position: vector3Schema,
  rotation: vector3Schema,
  scale: vector3Schema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  createdAt: z.number().int().nonnegative(),
});

export type PrimitiveKind = z.infer<typeof primitiveKindSchema>;
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type Vector3Tuple = z.infer<typeof vector3Schema>;

const DEFAULT_NAMES: Record<PrimitiveKind, string> = {
  box: "Cube",
  sphere: "Sphere",
  cylinder: "Cylinder",
};

const DEFAULT_COLORS: Record<PrimitiveKind, string> = {
  box: "#7c6df2",
  sphere: "#31b985",
  cylinder: "#f59e5b",
};

export function createSceneObject(
  kind: PrimitiveKind,
  overrides: Partial<SceneObject> = {},
): SceneObject {
  return sceneObjectSchema.parse({
    id: crypto.randomUUID(),
    name: DEFAULT_NAMES[kind],
    kind,
    position: [0, kind === "sphere" ? 0.75 : 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: DEFAULT_COLORS[kind],
    createdAt: Date.now(),
    ...overrides,
  });
}
