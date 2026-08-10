import { z } from "zod";

export const primitiveKindSchema = z.enum(["box", "sphere", "cylinder"]);
export const csgOperationSchema = z.enum(["union", "subtract", "intersect"]);

export const vector3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

export const MAX_MESH_TRIANGLES = 20_000;
export const MAX_MESH_ATTRIBUTE_VALUES = MAX_MESH_TRIANGLES * 9;

const meshAttributeSchema = z
  .array(z.number().finite())
  .min(9)
  .max(MAX_MESH_ATTRIBUTE_VALUES);

export const meshGeometrySchema = z
  .object({
    positions: meshAttributeSchema,
    normals: meshAttributeSchema,
    operation: csgOperationSchema,
    topology: z.literal("csg-engine-output-v1"),
  })
  .superRefine((geometry, context) => {
    if (geometry.positions.length !== geometry.normals.length) {
      context.addIssue({
        code: "custom",
        message: "positions and normals must have the same length",
        path: ["normals"],
      });
    }

    if (geometry.positions.length % 9 !== 0) {
      context.addIssue({
        code: "custom",
        message: "mesh attributes must contain complete non-indexed triangles",
        path: ["positions"],
      });
    }
  });

const sceneObjectBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  position: vector3Schema,
  rotation: vector3Schema,
  scale: vector3Schema,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  createdAt: z.number().int().nonnegative(),
});

export const primitiveSceneObjectSchema = z.discriminatedUnion("kind", [
  sceneObjectBaseSchema.extend({ kind: z.literal("box") }),
  sceneObjectBaseSchema.extend({ kind: z.literal("sphere") }),
  sceneObjectBaseSchema.extend({ kind: z.literal("cylinder") }),
]);

export const meshSceneObjectSchema = sceneObjectBaseSchema.extend({
  kind: z.literal("mesh"),
  geometry: meshGeometrySchema,
});

export const sceneObjectSchema = z.discriminatedUnion("kind", [
  ...primitiveSceneObjectSchema.options,
  meshSceneObjectSchema,
]);

export type PrimitiveKind = z.infer<typeof primitiveKindSchema>;
export type CsgOperation = z.infer<typeof csgOperationSchema>;
export type MeshGeometry = z.infer<typeof meshGeometrySchema>;
export type PrimitiveSceneObject = z.infer<typeof primitiveSceneObjectSchema>;
export type MeshSceneObject = z.infer<typeof meshSceneObjectSchema>;
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
  overrides: Partial<Omit<PrimitiveSceneObject, "kind">> = {},
): PrimitiveSceneObject {
  return primitiveSceneObjectSchema.parse({
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
