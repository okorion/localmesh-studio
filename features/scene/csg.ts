import {
  BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
} from "three";
import type { Brush } from "three-bvh-csg";
import { createSceneObjectGeometry } from "./geometry";
import {
  MAX_MESH_ATTRIBUTE_VALUES,
  csgOperationSchema,
  sceneObjectSchema,
  type CsgOperation as SceneCsgOperation,
  type MeshSceneObject,
  type SceneObject,
} from "./schema";

export type CsgOperation = SceneCsgOperation;

export type CsgErrorCode =
  | "INVALID_OPERATION"
  | "INVALID_INPUT"
  | "INVALID_SCALE"
  | "INVALID_GEOMETRY"
  | "INVALID_RESULT"
  | "EMPTY_RESULT"
  | "RESULT_TOO_COMPLEX"
  | "ENGINE_FAILURE";

export class CsgError extends Error {
  readonly code: CsgErrorCode;

  constructor(code: CsgErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CsgError";
    this.code = code;
  }
}

const MIN_SCALE = 0.01;
const MAX_SCALE = 100;
const POSITION_WELD_RELATIVE_TOLERANCE = 1e-8;
const POSITION_WELD_ABSOLUTE_TOLERANCE = 1e-9;
const TOPOLOGY_WELD_RELATIVE_TOLERANCE = 1e-7;
const TOPOLOGY_WELD_ABSOLUTE_TOLERANCE = 1e-8;
const DEGENERATE_AREA_RELATIVE_TOLERANCE = 1e-12;
const NON_ZERO_VOLUME_RELATIVE_TOLERANCE = 1e-12;
const PRACTICAL_BOUNDARY_RELATIVE_LIMIT = 0.75;
const MAX_TOPOLOGY_SPLIT_CHECKS = 5_000_000;
const MAX_TOPOLOGY_GRID_VISITS = 1_000_000;
export const MAX_CSG_INPUT_TRIANGLES = 20_000;

type GeometryStage = "input" | "output";
type GeometryValidationMode = "strict" | "practical";

interface ValidatedGeometry {
  position: BufferAttribute | InterleavedBufferAttribute;
  normal: BufferAttribute | InterleavedBufferAttribute;
  start: number;
  count: number;
}

type Position = [number, number, number];

interface EdgeUse {
  count: number;
  directionBalance: number;
  firstTriangle: number;
}

function throwTopologyError(stage: GeometryStage, message: string): never {
  throw new CsgError(
    stage === "output" ? "INVALID_RESULT" : "INVALID_GEOMETRY",
    `${stage} geometry ${message}`,
  );
}

function vertexIndexAt(
  geometry: BufferGeometry,
  drawOffset: number,
): number {
  return geometry.getIndex()?.getX(drawOffset) ?? drawOffset;
}

function assertPracticalNonZeroSolid(
  geometry: BufferGeometry,
  validated: ValidatedGeometry,
  stage: GeometryStage,
  minimum: Position,
  maximum: Position,
  maximumExtent: number,
): void {
  const { position, start, count } = validated;
  if (count / 3 < 4) {
    throwTopologyError(stage, "does not contain enough faces to enclose a solid.");
  }
  const origin = minimum.map(
    (value, axis) => (value + maximum[axis]) / 2,
  ) as Position;
  const areaTolerance = Math.max(
    maximumExtent * maximumExtent * DEGENERATE_AREA_RELATIVE_TOLERANCE,
    Number.EPSILON,
  );
  let hasMeasurableTriangle = false;
  let signedVolume = 0;
  let compensation = 0;

  for (let drawOffset = start; drawOffset < start + count; drawOffset += 3) {
    const points = [0, 1, 2].map((corner) => {
      const vertex = vertexIndexAt(geometry, drawOffset + corner);
      return [
        position.getX(vertex) - origin[0],
        position.getY(vertex) - origin[1],
        position.getZ(vertex) - origin[2],
      ] as Position;
    });
    const [a, b, c] = points;
    const ab: Position = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Position = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross: Position = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const doubledArea = Math.hypot(...cross);
    if (Number.isFinite(doubledArea) && doubledArea > areaTolerance) {
      hasMeasurableTriangle = true;
    }

    const term =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    const corrected = term - compensation;
    const next = signedVolume + corrected;
    compensation = next - signedVolume - corrected;
    signedVolume = next;
  }

  const volumeTolerance = Math.max(
    maximumExtent ** 3 * NON_ZERO_VOLUME_RELATIVE_TOLERANCE,
    Number.EPSILON,
  );
  if (
    !hasMeasurableTriangle ||
    !Number.isFinite(signedVolume) ||
    Math.abs(signedVolume) <= volumeTolerance
  ) {
    throwTopologyError(stage, "does not enclose a measurable non-zero volume.");
  }
}

function assertValidSolidTopology(
  geometry: BufferGeometry,
  validated: ValidatedGeometry,
  stage: GeometryStage,
  mode: GeometryValidationMode,
): void {
  const { position, start, count } = validated;
  const end = start + count;
  const minimum: Position = [Infinity, Infinity, Infinity];
  const maximum: Position = [-Infinity, -Infinity, -Infinity];

  for (let drawOffset = start; drawOffset < end; drawOffset += 1) {
    const vertexIndex = vertexIndexAt(geometry, drawOffset);
    const coordinates: Position = [
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], coordinates[axis]);
      maximum[axis] = Math.max(maximum[axis], coordinates[axis]);
    }
  }

  const extents = minimum.map(
    (value, axis) => maximum[axis] - value,
  ) as Position;
  const maximumExtent = Math.max(...extents);
  if (!Number.isFinite(maximumExtent) || maximumExtent <= 0) {
    throwTopologyError(stage, "has no measurable extent.");
  }
  if (mode === "practical") {
    assertPracticalNonZeroSolid(
      geometry,
      validated,
      stage,
      minimum,
      maximum,
      maximumExtent,
    );
  }

  const weldTolerance = Math.max(
    maximumExtent * POSITION_WELD_RELATIVE_TOLERANCE,
    POSITION_WELD_ABSOLUTE_TOLERANCE,
  );
  const weldToleranceSquared = weldTolerance * weldTolerance;
  const buckets = new Map<string, number[]>();
  const weldedPositions: Position[] = [];
  const sourceVertexToWelded = new Map<number, number>();

  const weldVertex = (sourceVertex: number): number => {
    const cached = sourceVertexToWelded.get(sourceVertex);
    if (cached !== undefined) return cached;

    const coordinates: Position = [
      position.getX(sourceVertex),
      position.getY(sourceVertex),
      position.getZ(sourceVertex),
    ];
    const cell = coordinates.map((coordinate, axis) =>
      Math.floor((coordinate - minimum[axis]) / weldTolerance),
    ) as Position;

    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          const candidates = buckets.get(
            `${cell[0] + xOffset}:${cell[1] + yOffset}:${cell[2] + zOffset}`,
          );
          if (!candidates) continue;
          for (const candidate of candidates) {
            const welded = weldedPositions[candidate];
            const dx = coordinates[0] - welded[0];
            const dy = coordinates[1] - welded[1];
            const dz = coordinates[2] - welded[2];
            if (dx * dx + dy * dy + dz * dz <= weldToleranceSquared) {
              sourceVertexToWelded.set(sourceVertex, candidate);
              return candidate;
            }
          }
        }
      }
    }

    const weldedIndex = weldedPositions.length;
    weldedPositions.push(coordinates);
    const bucketKey = `${cell[0]}:${cell[1]}:${cell[2]}`;
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(weldedIndex);
    else buckets.set(bucketKey, [weldedIndex]);
    sourceVertexToWelded.set(sourceVertex, weldedIndex);
    return weldedIndex;
  };

  const triangleCount = count / 3;
  const parent = Array.from({ length: triangleCount }, (_, index) => index);
  const find = (triangle: number): number => {
    let root = triangle;
    while (parent[root] !== root) root = parent[root];
    while (parent[triangle] !== triangle) {
      const next = parent[triangle];
      parent[triangle] = root;
      triangle = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const triangleEdges: Array<Array<readonly [number, number]>> = [];
  const signedTriangleVolumes = new Array<number>(triangleCount);
  const areaTolerance = Math.max(
    maximumExtent * maximumExtent * DEGENERATE_AREA_RELATIVE_TOLERANCE,
    Number.EPSILON,
  );

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const drawOffset = start + triangle * 3;
    const vertices = [0, 1, 2].map((corner) =>
      weldVertex(vertexIndexAt(geometry, drawOffset + corner)),
    );
    if (
      vertices[0] === vertices[1] ||
      vertices[1] === vertices[2] ||
      vertices[2] === vertices[0]
    ) {
      if (mode === "practical") {
        signedTriangleVolumes[triangle] = 0;
        triangleEdges.push([]);
        continue;
      }
      throwTopologyError(stage, "contains a degenerate triangle after position welding.");
    }

    const a = weldedPositions[vertices[0]];
    const b = weldedPositions[vertices[1]];
    const c = weldedPositions[vertices[2]];
    const ab: Position = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Position = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross: Position = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const doubledArea = Math.hypot(...cross);
    if (!Number.isFinite(doubledArea) || doubledArea <= areaTolerance) {
      if (mode === "practical") {
        signedTriangleVolumes[triangle] = 0;
        triangleEdges.push([]);
        continue;
      }
      throwTopologyError(stage, "contains a degenerate triangle.");
    }

    signedTriangleVolumes[triangle] =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;

    const directedEdges = [
      [vertices[0], vertices[1]],
      [vertices[1], vertices[2]],
      [vertices[2], vertices[0]],
    ] as const;
    triangleEdges.push(directedEdges.map((edge) => edge));
  }

  const forbiddenTopologyMerges = new Set<string>();
  const forbiddenMergeKey = (left: number, right: number): string =>
    `${Math.min(left, right)}:${Math.max(left, right)}`;
  for (const directedEdges of triangleEdges) {
    if (directedEdges.length !== 3) continue;
    const vertices = [
      directedEdges[0][0],
      directedEdges[0][1],
      directedEdges[1][1],
    ];
    forbiddenTopologyMerges.add(forbiddenMergeKey(vertices[0], vertices[1]));
    forbiddenTopologyMerges.add(forbiddenMergeKey(vertices[1], vertices[2]));
    forbiddenTopologyMerges.add(forbiddenMergeKey(vertices[2], vertices[0]));
  }

  const topologyTolerance = Math.max(
    maximumExtent * TOPOLOGY_WELD_RELATIVE_TOLERANCE,
    TOPOLOGY_WELD_ABSOLUTE_TOLERANCE,
  );
  const topologyToleranceSquared = topologyTolerance * topologyTolerance;
  const topologyBuckets = new Map<string, number[]>();
  const topologyPositions: Position[] = [];
  const topologyMembers: number[][] = [];
  const topologyVertexByWelded = new Array<number>(weldedPositions.length);
  for (let vertex = 0; vertex < weldedPositions.length; vertex += 1) {
    const coordinates = weldedPositions[vertex];
    const cell = coordinates.map((coordinate, axis) =>
      Math.floor((coordinate - minimum[axis]) / topologyTolerance),
    ) as Position;
    let topologyVertex: number | undefined;
    for (let xOffset = -1; xOffset <= 1 && topologyVertex === undefined; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1 && topologyVertex === undefined; yOffset += 1) {
        for (let zOffset = -1; zOffset <= 1 && topologyVertex === undefined; zOffset += 1) {
          const candidates = topologyBuckets.get(
            `${cell[0] + xOffset}:${cell[1] + yOffset}:${cell[2] + zOffset}`,
          );
          if (!candidates) continue;
          for (const candidate of candidates) {
            if (
              topologyMembers[candidate].some((member) =>
                forbiddenTopologyMerges.has(forbiddenMergeKey(vertex, member)),
              )
            ) {
              continue;
            }
            const representative = topologyPositions[candidate];
            const dx = coordinates[0] - representative[0];
            const dy = coordinates[1] - representative[1];
            const dz = coordinates[2] - representative[2];
            if (dx * dx + dy * dy + dz * dz <= topologyToleranceSquared) {
              topologyVertex = candidate;
              break;
            }
          }
        }
      }
    }
    if (topologyVertex === undefined) {
      topologyVertex = topologyPositions.length;
      topologyPositions.push(coordinates);
      topologyMembers.push([]);
      const key = `${cell[0]}:${cell[1]}:${cell[2]}`;
      const bucket = topologyBuckets.get(key);
      if (bucket) bucket.push(topologyVertex);
      else topologyBuckets.set(key, [topologyVertex]);
    }
    topologyMembers[topologyVertex].push(vertex);
    topologyVertexByWelded[vertex] = topologyVertex;
  }

  const topologyTriangleEdges = triangleEdges.map((directedEdges) =>
    directedEdges.map(
      ([from, to]) =>
        [topologyVertexByWelded[from], topologyVertexByWelded[to]] as const,
    ),
  );
  const rawEdges = new Map<string, EdgeUse>();
  for (let triangle = 0; triangle < topologyTriangleEdges.length; triangle += 1) {
    for (const [from, to] of topologyTriangleEdges[triangle]) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const key = `${low}:${high}`;
      const direction = from === low ? 1 : -1;
      const use = rawEdges.get(key);
      if (use) {
        use.count += 1;
        use.directionBalance += direction;
      } else {
        rawEdges.set(key, {
          count: 1,
          directionBalance: direction,
          firstTriangle: triangle,
        });
      }
    }
  }

  const rawEdgeIsBalanced = (from: number, to: number): boolean => {
    const raw = rawEdges.get(`${Math.min(from, to)}:${Math.max(from, to)}`);
    return raw?.count === 2 && raw.directionBalance === 0;
  };
  const edges = new Map<string, EdgeUse>();
  const addEdge = (from: number, to: number, triangle: number): void => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const key = `${low}:${high}`;
    const direction = from === low ? 1 : -1;
    const use = edges.get(key);
    if (use) {
      use.count += 1;
      use.directionBalance += direction;
      union(use.firstTriangle, triangle);
    } else {
      edges.set(key, {
        count: 1,
        directionBalance: direction,
        firstTriangle: triangle,
      });
    }
  };
  const gridResolution = Math.max(1, Math.ceil(Math.cbrt(topologyPositions.length)));
  const gridCellSize = Math.max(
    maximumExtent / gridResolution,
    topologyTolerance * 2,
  );
  const segmentBuckets = new Map<string, number[]>();
  const segmentCell = (coordinates: Position): Position =>
    coordinates.map((coordinate, axis) =>
      Math.floor((coordinate - minimum[axis]) / gridCellSize),
    ) as Position;
  for (let vertex = 0; vertex < topologyPositions.length; vertex += 1) {
    const cell = segmentCell(topologyPositions[vertex]);
    const key = `${cell[0]}:${cell[1]}:${cell[2]}`;
    const bucket = segmentBuckets.get(key);
    if (bucket) bucket.push(vertex);
    else segmentBuckets.set(key, [vertex]);
  }

  let topologySplitChecks = 0;
  let topologyGridVisits = 0;
  const segmentCandidates = (from: number, to: number): Set<number> => {
    const a = topologyPositions[from];
    const b = topologyPositions[to];
    const direction: Position = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const current = segmentCell(a);
    const target = segmentCell(b);
    const step = direction.map((component) => Math.sign(component)) as Position;
    const delta = direction.map((component) =>
      component === 0 ? Infinity : gridCellSize / Math.abs(component),
    ) as Position;
    const maximumParameter = direction.map((component, axis) => {
      if (component === 0 || current[axis] === target[axis]) return Infinity;
      const boundary =
        minimum[axis] +
        (current[axis] + (step[axis] > 0 ? 1 : 0)) * gridCellSize;
      return (boundary - a[axis]) / component;
    }) as Position;
    const candidates = new Set<number>();
    const visited = new Set<string>();
    while (true) {
      const currentKey = `${current[0]}:${current[1]}:${current[2]}`;
      if (!visited.has(currentKey)) {
        visited.add(currentKey);
        topologyGridVisits += 1;
        if (topologyGridVisits > MAX_TOPOLOGY_GRID_VISITS) {
          throwTopologyError(stage, "requires too much topology normalization.");
        }
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
            for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
              const bucket = segmentBuckets.get(
                `${current[0] + xOffset}:${current[1] + yOffset}:${current[2] + zOffset}`,
              );
              if (bucket) for (const vertex of bucket) candidates.add(vertex);
            }
          }
        }
      }
      if (
        current[0] === target[0] &&
        current[1] === target[1] &&
        current[2] === target[2]
      ) {
        break;
      }
      const nextParameter = Math.min(...maximumParameter);
      if (!Number.isFinite(nextParameter)) break;
      for (let axis = 0; axis < 3; axis += 1) {
        if (maximumParameter[axis] <= nextParameter + Number.EPSILON) {
          current[axis] += step[axis];
          maximumParameter[axis] =
            current[axis] === target[axis]
              ? Infinity
              : maximumParameter[axis] + delta[axis];
        }
      }
    }
    return candidates;
  };

  for (let triangle = 0; triangle < topologyTriangleEdges.length; triangle += 1) {
    for (const [from, to] of topologyTriangleEdges[triangle]) {
      if (rawEdgeIsBalanced(from, to)) {
        addEdge(from, to, triangle);
        continue;
      }

      const a = topologyPositions[from];
      const b = topologyPositions[to];
      const direction: Position = [
        b[0] - a[0],
        b[1] - a[1],
        b[2] - a[2],
      ];
      const lengthSquared =
        direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
      const parameterTolerance = topologyTolerance / Math.sqrt(lengthSquared);
      const intermediate: Array<{ vertex: number; parameter: number }> = [];
      for (const vertex of segmentCandidates(from, to)) {
        if (vertex === from || vertex === to) continue;
        topologySplitChecks += 1;
        if (topologySplitChecks > MAX_TOPOLOGY_SPLIT_CHECKS) {
          throwTopologyError(stage, "requires too much topology normalization.");
        }
        const point = topologyPositions[vertex];
        const relative: Position = [
          point[0] - a[0],
          point[1] - a[1],
          point[2] - a[2],
        ];
        const parameter =
          (relative[0] * direction[0] +
            relative[1] * direction[1] +
            relative[2] * direction[2]) /
          lengthSquared;
        if (
          parameter <= parameterTolerance ||
          parameter >= 1 - parameterTolerance
        ) {
          continue;
        }
        const dx = relative[0] - parameter * direction[0];
        const dy = relative[1] - parameter * direction[1];
        const dz = relative[2] - parameter * direction[2];
        if (dx * dx + dy * dy + dz * dz <= topologyToleranceSquared) {
          intermediate.push({ vertex, parameter });
        }
      }

      intermediate.sort((left, right) => left.parameter - right.parameter);
      let segmentStart = from;
      for (const { vertex } of intermediate) {
        addEdge(segmentStart, vertex, triangle);
        segmentStart = vertex;
      }
      addEdge(segmentStart, to, triangle);
    }
  }

  let maximumUnbalancedEdgeLength = 0;
  const unbalancedAdjacency = new Map<number, Set<number>>();
  for (const [key, edge] of edges) {
    if (edge.count !== 2 || edge.directionBalance !== 0) {
      const [from, to] = key.split(":").map(Number);
      const a = topologyPositions[from];
      const b = topologyPositions[to];
      maximumUnbalancedEdgeLength = Math.max(
        maximumUnbalancedEdgeLength,
        Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      );
      if (mode === "practical") {
        const fromNeighbors = unbalancedAdjacency.get(from) ?? new Set<number>();
        fromNeighbors.add(to);
        unbalancedAdjacency.set(from, fromNeighbors);
        const toNeighbors = unbalancedAdjacency.get(to) ?? new Set<number>();
        toNeighbors.add(from);
        unbalancedAdjacency.set(to, toNeighbors);
        continue;
      }
      throwTopologyError(
        stage,
        "has an open or inconsistently oriented boundary.",
      );
    }
  }
  if (mode === "practical") {
    let maximumBoundaryComponentSpan = 0;
    const visited = new Set<number>();
    for (const startVertex of unbalancedAdjacency.keys()) {
      if (visited.has(startVertex)) continue;
      const componentMinimum: Position = [Infinity, Infinity, Infinity];
      const componentMaximum: Position = [-Infinity, -Infinity, -Infinity];
      const pending = [startVertex];
      visited.add(startVertex);
      while (pending.length > 0) {
        const vertex = pending.pop() as number;
        const coordinates = topologyPositions[vertex];
        for (let axis = 0; axis < 3; axis += 1) {
          componentMinimum[axis] = Math.min(
            componentMinimum[axis],
            coordinates[axis],
          );
          componentMaximum[axis] = Math.max(
            componentMaximum[axis],
            coordinates[axis],
          );
        }
        for (const neighbor of unbalancedAdjacency.get(vertex) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
      maximumBoundaryComponentSpan = Math.max(
        maximumBoundaryComponentSpan,
        ...componentMinimum.map(
          (value, axis) => componentMaximum[axis] - value,
        ),
      );
    }
    if (
      maximumUnbalancedEdgeLength >
        maximumExtent * PRACTICAL_BOUNDARY_RELATIVE_LIMIT ||
      maximumBoundaryComponentSpan >
        maximumExtent * PRACTICAL_BOUNDARY_RELATIVE_LIMIT
    ) {
      throwTopologyError(stage, "has a gross open boundary.");
    }
    return;
  }

  const componentVolumes = new Map<number, number>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(triangle);
    componentVolumes.set(
      root,
      (componentVolumes.get(root) ?? 0) + signedTriangleVolumes[triangle],
    );
  }
  const volume = [...componentVolumes.values()].reduce(
    (sum, componentVolume) => sum + Math.abs(componentVolume),
    0,
  );
  const volumeTolerance = Math.max(
    maximumExtent ** 3 * NON_ZERO_VOLUME_RELATIVE_TOLERANCE,
    Number.EPSILON,
  );
  if (!Number.isFinite(volume) || volume <= volumeTolerance) {
    throwTopologyError(stage, "does not enclose a non-zero volume.");
  }
}

function assertScale(object: SceneObject): void {
  if (
    object.scale.some(
      (component) =>
        !Number.isFinite(component) ||
        component < MIN_SCALE ||
        component > MAX_SCALE,
    )
  ) {
    throw new CsgError(
      "INVALID_SCALE",
      `CSG operand ${object.id} must have a positive, finite scale between ${MIN_SCALE} and ${MAX_SCALE}.`,
    );
  }
}

function assertFiniteAttribute(
  attribute: BufferAttribute | InterleavedBufferAttribute,
  label: string,
): void {
  for (let index = 0; index < attribute.count; index += 1) {
    for (let component = 0; component < attribute.itemSize; component += 1) {
      if (!Number.isFinite(attribute.getComponent(index, component))) {
        throw new CsgError(
          "INVALID_GEOMETRY",
          `${label} contains a non-finite value.`,
        );
      }
    }
  }
}

function validateGeometry(
  geometry: BufferGeometry,
  stage: GeometryStage,
  mode: GeometryValidationMode = "strict",
): ValidatedGeometry {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || !normal || position.itemSize !== 3 || normal.itemSize !== 3) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} geometry requires position and normal vec3 attributes.`,
    );
  }
  if (position.count !== normal.count) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} geometry position and normal counts differ.`,
    );
  }

  const index = geometry.getIndex();
  const availableCount = index?.count ?? position.count;
  const { start, count: configuredCount } = geometry.drawRange;
  const count = configuredCount === Infinity ? availableCount - start : configuredCount;
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    !Number.isInteger(count) ||
    count < 0 ||
    start + count > availableCount ||
    start % 3 !== 0 ||
    count % 3 !== 0
  ) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} geometry has an invalid triangle draw range.`,
    );
  }
  if (count === 0) {
    throw new CsgError(
      stage === "output" ? "EMPTY_RESULT" : "INVALID_GEOMETRY",
      stage === "output" ? "CSG produced no triangles." : "CSG input is empty.",
    );
  }
  if (stage === "input" && count / 3 > MAX_CSG_INPUT_TRIANGLES) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `CSG input exceeds the ${MAX_CSG_INPUT_TRIANGLES.toLocaleString("en-US")}-triangle limit.`,
    );
  }
  if (stage === "output" && count * 3 > MAX_MESH_ATTRIBUTE_VALUES) {
    throw new CsgError(
      stage === "output" ? "RESULT_TOO_COMPLEX" : "INVALID_GEOMETRY",
      `${stage} geometry exceeds the mesh complexity limit.`,
    );
  }

  if (index) {
    for (let offset = start; offset < start + count; offset += 1) {
      const value = index.getX(offset);
      if (!Number.isInteger(value) || value < 0 || value >= position.count) {
        throw new CsgError(
          "INVALID_GEOMETRY",
          `${stage} geometry contains an invalid index.`,
        );
      }
    }
  } else if (position.count % 3 !== 0) {
    throw new CsgError(
      "INVALID_GEOMETRY",
      `${stage} non-indexed geometry contains an incomplete triangle.`,
    );
  }

  assertFiniteAttribute(position, `${stage} position`);
  assertFiniteAttribute(normal, `${stage} normal`);
  const validated = { position, normal, start, count };
  assertValidSolidTopology(geometry, validated, stage, mode);
  return validated;
}

function serializeOutputGeometry(
  geometry: BufferGeometry,
  operation: CsgOperation,
): MeshSceneObject["geometry"] {
  const { position, normal, start, count } = validateGeometry(
    geometry,
    "output",
    "practical",
  );
  const positions: number[] = [];
  const normals: number[] = [];
  const end = start + count;
  const indexAttribute = geometry.getIndex();

  for (let drawOffset = start; drawOffset < end; drawOffset += 1) {
    const vertexIndex = indexAttribute
      ? indexAttribute.getX(drawOffset)
      : drawOffset;
    const coordinates = [
      position.getX(vertexIndex),
      position.getY(vertexIndex),
      position.getZ(vertexIndex),
    ];
    positions.push(...coordinates);
    normals.push(
      normal.getX(vertexIndex),
      normal.getY(vertexIndex),
      normal.getZ(vertexIndex),
    );
  }

  return {
    positions,
    normals,
    operation,
    topology: "csg-engine-output-v1",
  };
}

function formatResultName(
  operation: CsgOperation,
  a: SceneObject,
  b: SceneObject,
): string {
  const label =
    operation === "union"
      ? "Union"
      : operation === "subtract"
        ? "Subtract"
        : "Intersect";
  return `${label} (${a.name}, ${b.name})`.slice(0, 80).trim();
}

export function getCsgOperandSignature(object: SceneObject): string {
  return JSON.stringify(sceneObjectSchema.parse(object));
}

export async function evaluateCsg(
  operation: CsgOperation,
  a: SceneObject,
  b: SceneObject,
): Promise<SceneObject> {
  const parsedOperation = csgOperationSchema.safeParse(operation);
  if (!parsedOperation.success) {
    throw new CsgError("INVALID_OPERATION", "Unsupported CSG operation.");
  }

  const parsedA = sceneObjectSchema.safeParse(a);
  const parsedB = sceneObjectSchema.safeParse(b);
  if (!parsedA.success || !parsedB.success || parsedA.data.id === parsedB.data.id) {
    throw new CsgError(
      "INVALID_INPUT",
      "CSG requires two distinct, valid scene objects.",
    );
  }
  assertScale(parsedA.data);
  assertScale(parsedB.data);

  const geometryA = createSceneObjectGeometry(parsedA.data);
  const geometryB = createSceneObjectGeometry(parsedB.data);
  let outputGeometry: BufferGeometry | undefined;
  let brushA: Brush | undefined;
  let brushB: Brush | undefined;
  let outputBrush: Brush | undefined;

  try {
    validateGeometry(
      geometryA,
      "input",
      parsedA.data.kind === "mesh" ? "practical" : "strict",
    );
    validateGeometry(
      geometryB,
      "input",
      parsedB.data.kind === "mesh" ? "practical" : "strict",
    );

    const engine = await import("three-bvh-csg");
    brushA = new engine.Brush(geometryA);
    brushB = new engine.Brush(geometryB);
    brushA.position.fromArray(parsedA.data.position);
    brushA.rotation.set(...parsedA.data.rotation);
    brushA.scale.fromArray(parsedA.data.scale);
    brushA.updateMatrixWorld(true);
    brushB.position.fromArray(parsedB.data.position);
    brushB.rotation.set(...parsedB.data.rotation);
    brushB.scale.fromArray(parsedB.data.scale);
    brushB.updateMatrixWorld(true);

    const evaluator = new engine.Evaluator();
    evaluator.useGroups = false;
    evaluator.attributes = ["position", "normal"];
    const engineOperation = {
      union: engine.ADDITION,
      subtract: engine.SUBTRACTION,
      intersect: engine.INTERSECTION,
    }[parsedOperation.data];
    const evaluated = evaluator.evaluate(brushA, brushB, engineOperation);
    outputBrush = evaluated;
    outputGeometry = evaluated.geometry;
    const geometry = serializeOutputGeometry(outputGeometry, parsedOperation.data);

    return sceneObjectSchema.parse({
      id: crypto.randomUUID(),
      name: formatResultName(parsedOperation.data, parsedA.data, parsedB.data),
      kind: "mesh",
      geometry,
      position: [...parsedA.data.position],
      rotation: [...parsedA.data.rotation],
      scale: [...parsedA.data.scale],
      color: parsedA.data.color,
      createdAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof CsgError) throw error;
    throw new CsgError("ENGINE_FAILURE", "CSG evaluation failed.", {
      cause: error,
    });
  } finally {
    brushA?.disposeCacheData();
    brushB?.disposeCacheData();
    outputBrush?.disposeCacheData();
    geometryA.dispose();
    geometryB.dispose();
    outputGeometry?.dispose();
  }
}
