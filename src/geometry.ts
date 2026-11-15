import {
  add,
  cross,
  dot,
  mulberry32,
  normalize,
  round,
  scale,
  subtract,
  vec3
} from "./math3d";
import type { Face, GeometrySummary, Mesh, Scene, Vec3 } from "./types";

const GOLDEN = (1 + Math.sqrt(5)) / 2;
const SCENE_SEED = 20261116;

function orientFace(vertices: Vec3[], face: Face, center: Vec3): Face {
  const a = vertices[face.a];
  const b = vertices[face.b];
  const c = vertices[face.c];
  const centroid = scale(add(add(a, b), c), 1 / 3);
  const normal = cross(subtract(b, a), subtract(c, a));
  return dot(normal, subtract(centroid, center)) < 0 ? { ...face, b: face.c, c: face.b } : face;
}

function makeIcosphere(radius: number, seed: number): { vertices: Vec3[]; faces: Face[] } {
  const random = mulberry32(seed);
  const base: Vec3[] = [
    vec3(-1, GOLDEN, 0),
    vec3(1, GOLDEN, 0),
    vec3(-1, -GOLDEN, 0),
    vec3(1, -GOLDEN, 0),
    vec3(0, -1, GOLDEN),
    vec3(0, 1, GOLDEN),
    vec3(0, -1, -GOLDEN),
    vec3(0, 1, -GOLDEN),
    vec3(GOLDEN, 0, -1),
    vec3(GOLDEN, 0, 1),
    vec3(-GOLDEN, 0, -1),
    vec3(-GOLDEN, 0, 1)
  ].map((vertex) => {
    const irregularity = 0.94 + random() * 0.1;
    return scale(normalize(vertex), radius * irregularity);
  });

  const baseFaces: Array<[number, number, number]> = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1]
  ];

  const vertices = [...base];
  const midpointCache = new Map<string, number>();

  function midpoint(first: number, second: number): number {
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const middle = scale(add(vertices[first], vertices[second]), 0.5);
    const offset = radius * (0.985 + random() * 0.055);
    const index = vertices.length;
    vertices.push(scale(normalize(middle), offset));
    midpointCache.set(key, index);
    return index;
  }

  const faces: Face[] = [];
  for (const [a, b, c] of baseFaces) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    const triangles: Array<[number, number, number]> = [
      [a, ab, ca],
      [b, bc, ab],
      [c, ca, bc],
      [ab, bc, ca]
    ];
    for (const [triA, triB, triC] of triangles) {
      const face = orientFace(vertices, { a: triA, b: triB, c: triC, tone: random() }, vec3());
      faces.push(face);
    }
  }
  return { vertices, faces };
}

function makeTetrahedron(seed: number, radius: number): { vertices: Vec3[]; faces: Face[] } {
  const random = mulberry32(seed);
  const raw = [
    vec3(0, 1, 0),
    vec3(0.943, -0.333, 0),
    vec3(-0.471, -0.333, 0.816),
    vec3(-0.471, -0.333, -0.816)
  ];
  const vertices = raw.map((vertex) => scale(vertex, radius * (0.8 + random() * 0.35)));
  const indices: Array<[number, number, number]> = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 1],
    [1, 3, 2]
  ];
  const faces = indices.map(([a, b, c]) =>
    orientFace(vertices, { a, b, c, tone: random() }, vec3())
  );
  return { vertices, faces };
}

interface Tier {
  bottomY: number;
  topY: number;
  bottomRadius: number;
  topRadius: number;
  sides: number;
}

function addTier(
  tiers: Tier[],
  vertices: Vec3[],
  faces: Face[],
  tier: Tier,
  random: () => number
): void {
  const start = vertices.length;
  for (let side = 0; side < tier.sides; side += 1) {
    const angle = (side / tier.sides) * Math.PI * 2 + Math.PI / tier.sides;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    vertices.push(vec3(x * tier.bottomRadius, tier.bottomY, z * tier.bottomRadius));
    vertices.push(vec3(x * tier.topRadius, tier.topY, z * tier.topRadius));
  }

  for (let side = 0; side < tier.sides; side += 1) {
    const next = (side + 1) % tier.sides;
    const lower = start + side * 2;
    const upper = lower + 1;
    const nextLower = start + next * 2;
    const nextUpper = nextLower + 1;
    faces.push({ a: lower, b: nextLower, c: upper, tone: random() });
    faces.push({ a: upper, b: nextLower, c: nextUpper, tone: random() });
  }

  const bottomCenter = vertices.length;
  vertices.push(vec3(0, tier.bottomY, 0));
  const topCenter = vertices.length;
  vertices.push(vec3(0, tier.topY, 0));
  for (let side = 0; side < tier.sides; side += 1) {
    const next = (side + 1) % tier.sides;
    const lower = start + side * 2;
    const upper = lower + 1;
    const nextLower = start + next * 2;
    const nextUpper = nextLower + 1;
    faces.push({ a: bottomCenter, b: lower, c: nextLower, tone: random() });
    faces.push({ a: topCenter, b: nextUpper, c: upper, tone: random() });
  }
  tiers.push(tier);
}

function makePedestal(seed: number): Mesh {
  const random = mulberry32(seed);
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  addTier(
    [],
    vertices,
    faces,
    { bottomY: -2.16, topY: -1.91, bottomRadius: 1.48, topRadius: 1.36, sides: 8 },
    random
  );
  addTier(
    [],
    vertices,
    faces,
    { bottomY: -1.91, topY: -1.48, bottomRadius: 0.79, topRadius: 0.61, sides: 8 },
    random
  );
  addTier(
    [],
    vertices,
    faces,
    { bottomY: -1.48, topY: -1.27, bottomRadius: 1.12, topRadius: 0.96, sides: 8 },
    random
  );
  return {
    id: "pedestal",
    name: "Tiered plinth",
    kind: "pedestal",
    vertices,
    faces,
    position: vec3(0, 0, 0),
    alpha: 1
  };
}

function makeHalo(seed: number): Mesh {
  const random = mulberry32(seed);
  const vertices: Vec3[] = [];
  const faces: Face[] = [];
  const segments = 30;
  const sides = 4;
  const majorRadius = 2.02;
  const minorRadius = 0.075;
  const tilt = 0.24;

  for (let segment = 0; segment < segments; segment += 1) {
    const u = (segment / segments) * Math.PI * 2;
    for (let side = 0; side < sides; side += 1) {
      const v = (side / sides) * Math.PI * 2;
      const radius = majorRadius + Math.cos(v) * minorRadius;
      const x = Math.cos(u) * radius;
      const z = Math.sin(u) * radius;
      const y = Math.sin(v) * minorRadius;
      vertices.push(
        vec3(x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt))
      );
    }
  }

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides;
      const a = segment * sides + side;
      const b = segment * sides + nextSide;
      const c = next * sides + side;
      const d = next * sides + nextSide;
      faces.push({ a, b, c, tone: random() });
      faces.push({ a: b, b: d, c, tone: random() });
    }
  }

  return {
    id: "halo",
    name: "Orbital band",
    kind: "halo",
    vertices,
    faces,
    position: vec3(0, 0.24, 0),
    alpha: 0.58
  };
}

export function buildScene(): Scene {
  const relic = makeIcosphere(1.55, SCENE_SEED);
  const meshes: Mesh[] = [
    {
      id: "relic",
      name: "Faceted relic",
      kind: "relic",
      vertices: relic.vertices,
      faces: relic.faces,
      position: vec3(0, 0.37, 0),
      alpha: 1
    },
    makePedestal(SCENE_SEED + 1),
    makeHalo(SCENE_SEED + 2)
  ];

  const shardData = [
    { id: "shard-a", position: vec3(-1.78, 1.47, 0.26), radius: 0.25, seed: 4 },
    { id: "shard-b", position: vec3(1.73, 0.77, -0.3), radius: 0.19, seed: 7 },
    { id: "shard-c", position: vec3(1.28, -0.63, 0.53), radius: 0.15, seed: 11 }
  ];
  for (const data of shardData) {
    const shard = makeTetrahedron(SCENE_SEED + data.seed, data.radius);
    meshes.push({
      id: data.id,
      name: data.id.replace("-", " "),
      kind: "shard",
      vertices: shard.vertices,
      faces: shard.faces,
      position: data.position,
      alpha: 1
    });
  }

  return { meshes, seed: SCENE_SEED };
}

export function summarizeGeometry(scene: Scene): GeometrySummary {
  const objectPositions: Record<string, [number, number, number]> = {};
  const objectBounds: GeometrySummary["objectBounds"] = {};
  const serialized: string[] = [];
  let vertexCount = 0;
  let triangleCount = 0;

  for (const mesh of scene.meshes) {
    objectPositions[mesh.id] = [round(mesh.position.x), round(mesh.position.y), round(mesh.position.z)];
    vertexCount += mesh.vertices.length;
    triangleCount += mesh.faces.length;
    serialized.push(mesh.id, `${mesh.vertices.length}:${mesh.faces.length}`);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (const vertex of mesh.vertices) {
      minX = Math.min(minX, vertex.x);
      minY = Math.min(minY, vertex.y);
      minZ = Math.min(minZ, vertex.z);
      maxX = Math.max(maxX, vertex.x);
      maxY = Math.max(maxY, vertex.y);
      maxZ = Math.max(maxZ, vertex.z);
      sumX += vertex.x;
      sumY += vertex.y;
      sumZ += vertex.z;
      serialized.push(`${round(vertex.x, 4)},${round(vertex.y, 4)},${round(vertex.z, 4)}`);
    }
    const divisor = Math.max(1, mesh.vertices.length);
    objectBounds[mesh.id] = {
      min: [round(minX), round(minY), round(minZ)],
      max: [round(maxX), round(maxY), round(maxZ)],
      centroid: [round(sumX / divisor), round(sumY / divisor), round(sumZ / divisor)]
    };
    for (const face of mesh.faces) {
      serialized.push(`${face.a}/${face.b}/${face.c}/${round(face.tone, 4)}`);
    }
  }

  let hash = 0x811c9dc5;
  const input = serialized.join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return {
    objectCount: scene.meshes.length,
    vertexCount,
    triangleCount,
    geometryDigest: (hash >>> 0).toString(16).padStart(8, "0"),
    objectPositions,
    objectBounds
  };
}
