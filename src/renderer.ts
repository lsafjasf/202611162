import { add, cross, dot, hashString, normalize, rotateView, scale, subtract, vec3 } from "./math3d";
import type {
  LabelLayout,
  LightingId,
  MaterialId,
  Mesh,
  MeshKind,
  ProjectedPoint,
  RenderMetrics,
  Scene,
  Vec3,
  ViewParams
} from "./types";
import { DEG_TO_RAD } from "./math3d";

const WIDTH = 960;
const HEIGHT = 640;
const CAMERA_DISTANCE = 8.8;
const BASE_FOCAL = 720;

type Rgb = [number, number, number];

interface Light {
  direction: Vec3;
  color: Rgb;
  intensity: number;
}

interface LightingProfile {
  label: string;
  ambient: Rgb;
  ambientStrength: number;
  lights: [Light, Light];
  rim: Rgb;
}

interface MaterialProfile {
  name: string;
  alpha: Record<MeshKind, number>;
  bronzeSpec: number;
  edge: Rgb;
  baseColor: (kind: MeshKind, tone: number, normal: Vec3) => Rgb;
}

const LIGHTING: Record<LightingId, LightingProfile> = {
  dawn: {
    label: "DAWN",
    ambient: [42, 76, 86],
    ambientStrength: 0.43,
    lights: [
      { direction: normalize(vec3(-0.52, 0.72, 0.46)), color: [255, 205, 130], intensity: 0.92 },
      { direction: normalize(vec3(0.7, 0.14, -0.42)), color: [99, 187, 211], intensity: 0.5 }
    ],
    rim: [255, 193, 111]
  },
  gallery: {
    label: "GALLERY",
    ambient: [52, 61, 79],
    ambientStrength: 0.36,
    lights: [
      { direction: normalize(vec3(0.18, 0.93, -0.31)), color: [228, 239, 255], intensity: 1.03 },
      { direction: normalize(vec3(0.75, 0.08, 0.55)), color: [255, 151, 108], intensity: 0.43 }
    ],
    rim: [159, 225, 255]
  }
};

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ];
}

function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`;
}

const MATERIALS: Record<MaterialId, MaterialProfile> = {
  bronze: {
    name: "PATINA BRONZE",
    alpha: { relic: 1, pedestal: 1, halo: 0.46, shard: 1 },
    bronzeSpec: 22,
    edge: [248, 216, 164],
    baseColor: (kind, tone, normal) => {
      if (kind === "pedestal") return mix([29, 48, 48], [61, 78, 66], tone);
      if (kind === "halo") return mix([170, 119, 54], [246, 200, 111], tone);
      const metal = mix([104, 72, 35], [217, 170, 83], tone);
      const patina = Math.max(0, normal.y) * 0.2 + Math.max(0, tone - 0.68) * 0.45;
      return mix(metal, [57, 124, 101], patina);
    }
  },
  resin: {
    name: "LUMEN RESIN",
    alpha: { relic: 0.68, pedestal: 1, halo: 0.34, shard: 0.62 },
    bronzeSpec: 42,
    edge: [189, 242, 242],
    baseColor: (kind, tone, normal) => {
      if (kind === "pedestal") return mix([21, 39, 50], [52, 64, 74], tone);
      if (kind === "halo") return mix([72, 171, 181], [240, 177, 130], tone);
      const cool = mix([24, 82, 100], [80, 176, 177], tone);
      const warm = Math.max(0, normal.y) * 0.28;
      return mix(cool, [224, 137, 137], warm + tone * 0.16);
    }
  }
};

function projectWorld(point: Vec3, params: ViewParams): ProjectedPoint {
  const view = rotateView(point, params.yaw * DEG_TO_RAD, params.pitch * DEG_TO_RAD);
  const depth = CAMERA_DISTANCE - view.z;
  const focal = BASE_FOCAL * params.zoom;
  if (depth <= 0.15) return { x: 0, y: 0, depth, visible: false };
  return {
    x: WIDTH / 2 + (view.x * focal) / depth,
    y: HEIGHT * 0.505 - (view.y * focal) / depth,
    depth,
    visible: true
  };
}

function meshCenter(mesh: Mesh): Vec3 {
  if (mesh.vertices.length === 0) return mesh.position;
  let center = vec3();
  for (const vertex of mesh.vertices) center = add(center, vertex);
  return add(scale(center, 1 / mesh.vertices.length), mesh.position);
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize(cross(subtract(b, a), subtract(c, a)));
}

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  const background = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  background.addColorStop(0, "#071116");
  background.addColorStop(0.48, "#0b1a1f");
  background.addColorStop(1, "#071014");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(WIDTH * 0.49, HEIGHT * 0.43, 20, WIDTH * 0.49, HEIGHT * 0.46, 420);
  glow.addColorStop(0, "rgba(76, 135, 129, 0.20)");
  glow.addColorStop(0.5, "rgba(48, 95, 94, 0.08)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(201, 230, 219, 0.21)";
  for (let index = 0; index < 42; index += 1) {
    const x = (index * 197 + 83) % WIDTH;
    const y = (index * 113 + 41) % 300;
    const radius = index % 7 === 0 ? 1.1 : 0.55;
    ctx.globalAlpha = 0.25 + ((index * 17) % 55) / 100;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const floor = ctx.createLinearGradient(0, HEIGHT * 0.58, 0, HEIGHT);
  floor.addColorStop(0, "rgba(4, 10, 13, 0)");
  floor.addColorStop(0.48, "rgba(5, 14, 17, 0.74)");
  floor.addColorStop(1, "#050b0e");
  ctx.fillStyle = floor;
  ctx.fillRect(0, HEIGHT * 0.55, WIDTH, HEIGHT * 0.45);
}

function drawFloorRings(ctx: CanvasRenderingContext2D, params: ViewParams): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (let ring = 0; ring < 6; ring += 1) {
    const radius = 1.72 + ring * 0.58;
    ctx.beginPath();
    let started = false;
    for (let segment = 0; segment <= 64; segment += 1) {
      const angle = (segment / 64) * Math.PI * 2;
      const point = projectWorld(
        vec3(Math.cos(angle) * radius, -2.18, Math.sin(angle) * radius),
        params
      );
      if (!point.visible) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(point.x, point.y);
        started = true;
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.strokeStyle = `rgba(105, 163, 157, ${0.16 - ring * 0.019})`;
    ctx.stroke();
  }

  for (let spoke = 0; spoke < 12; spoke += 1) {
    const angle = (spoke / 12) * Math.PI * 2;
    const inner = projectWorld(vec3(Math.cos(angle) * 1.7, -2.18, Math.sin(angle) * 1.7), params);
    const outer = projectWorld(vec3(Math.cos(angle) * 4.4, -2.18, Math.sin(angle) * 4.4), params);
    if (!inner.visible || !outer.visible) continue;
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = "rgba(105, 163, 157, 0.055)";
    ctx.stroke();
  }
  ctx.restore();
}

function drawGroundShadow(ctx: CanvasRenderingContext2D, params: ViewParams): void {
  const center = projectWorld(vec3(0, -2.17, 0), params);
  const offset = projectWorld(vec3(0.25, -2.17, 0.12), params);
  if (!center.visible) return;
  const radius = (1.55 * BASE_FOCAL * params.zoom) / center.depth;
  ctx.save();
  ctx.translate(center.x, center.y + 3);
  ctx.scale(1, 0.26);
  const shadow = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius * 1.2);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.68)");
  shadow.addColorStop(0.58, "rgba(0, 0, 0, 0.33)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y);
  ctx.lineTo(offset.x, offset.y);
  ctx.strokeStyle = "rgba(219, 197, 142, 0.12)";
  ctx.stroke();
}

function shadeFace(
  base: Rgb,
  normal: Vec3,
  viewDirection: Vec3,
  frontFacing: boolean,
  profile: LightingProfile,
  specularPower: number
): Rgb {
  const ambientScale = 0.22 + profile.ambientStrength * 0.33;
  const result: Rgb = [
    base[0] * ambientScale,
    base[1] * ambientScale,
    base[2] * ambientScale
  ];

  for (const light of profile.lights) {
    let lambert = dot(normal, light.direction);
    lambert = frontFacing ? Math.max(0, lambert) : Math.abs(lambert) * 0.72;
    if (lambert <= 0) continue;
    const energy = lambert * light.intensity * 0.93;
    result[0] += base[0] * (light.color[0] / 255) * energy;
    result[1] += base[1] * (light.color[1] / 255) * energy;
    result[2] += base[2] * (light.color[2] / 255) * energy;

    const halfVector = normalize(add(light.direction, viewDirection));
    const specular =
      Math.pow(Math.max(0, dot(normal, halfVector)), specularPower) *
      light.intensity *
      (frontFacing ? 0.34 : 0.12);
    result[0] += light.color[0] * specular;
    result[1] += light.color[1] * specular;
    result[2] += light.color[2] * specular;
  }

  const rim = Math.pow(1 - Math.min(1, Math.abs(dot(normal, viewDirection))), 2.3) * 0.18;
  result[0] += profile.rim[0] * rim;
  result[1] += profile.rim[1] * rim;
  result[2] += profile.rim[2] * rim;
  return [
    Math.max(0, Math.min(255, result[0])),
    Math.max(0, Math.min(255, result[1])),
    Math.max(0, Math.min(255, result[2]))
  ];
}

function buildLabels(params: ViewParams): LabelLayout[] {
  const definitions = [
    {
      id: "relic",
      text: "FACETED RELIC",
      subtext: "80 PLANES / CODE-GENERATED",
      anchor: vec3(0.67, 1.72, 0.33),
      side: 1 as const,
      width: 184
    },
    {
      id: "normals",
      text: "TWO-SIDED SURFACE",
      subtext: "OUTWARD NORMAL FIELD",
      anchor: vec3(-1.13, -0.24, 0.72),
      side: -1 as const,
      width: 188
    },
    {
      id: "plinth",
      text: "TIERED PLINTH",
      subtext: "24 PROCEDURAL SIDES",
      anchor: vec3(0.82, -1.71, 0.54),
      side: 1 as const,
      width: 168
    }
  ];

  return definitions.map((definition) => {
    const anchor = projectWorld(definition.anchor, params);
    const height = 48;
    const gap = 23;
    let x =
      definition.side > 0
        ? anchor.x + gap
        : anchor.x - gap - definition.width;
    x = Math.max(22, Math.min(WIDTH - definition.width - 22, x));
    const y = Math.max(132, Math.min(HEIGHT - height - 30, anchor.y - height / 2 - 18));
    return {
      id: definition.id,
      text: definition.text,
      subtext: definition.subtext,
      anchor,
      box: { x, y, width: definition.width, height },
      leader: {
        x: definition.side > 0 ? x : x + definition.width,
        y: y + height / 2
      }
    };
  });
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: LabelLayout[], lighting: LightingId): void {
  const accent = lighting === "dawn" ? "rgba(236, 192, 119, 0.82)" : "rgba(159, 225, 255, 0.82)";
  const accentSoft = lighting === "dawn" ? "rgba(236, 192, 119, 0.28)" : "rgba(159, 225, 255, 0.28)";
  ctx.save();
  ctx.textBaseline = "middle";
  for (const label of labels) {
    if (!label.anchor.visible) continue;
    ctx.strokeStyle = accentSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(label.anchor.x, label.anchor.y);
    ctx.lineTo(label.leader.x, label.leader.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(7, 15, 18, 0.78)";
    ctx.strokeStyle = "rgba(171, 209, 200, 0.2)";
    ctx.beginPath();
    ctx.roundRect(label.box.x, label.box.y, label.box.width, label.box.height, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.fillRect(label.box.x, label.box.y, 2, label.box.height);
    ctx.fillStyle = "rgba(226, 238, 232, 0.92)";
    ctx.font = '600 10px "Trebuchet MS", sans-serif';
    ctx.letterSpacing = "1px";
    ctx.fillText(label.text, label.box.x + 12, label.box.y + 17);
    ctx.fillStyle = "rgba(155, 182, 178, 0.72)";
    ctx.font = '500 8px "Trebuchet MS", sans-serif';
    ctx.letterSpacing = "1.15px";
    ctx.fillText(label.subtext, label.box.x + 12, label.box.y + 33);

    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.arc(label.anchor.x, label.anchor.y, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(7, 15, 18, 0.95)";
    ctx.beginPath();
    ctx.arc(label.anchor.x, label.anchor.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const vignette = ctx.createRadialGradient(
    WIDTH / 2,
    HEIGHT / 2,
    HEIGHT * 0.28,
    WIDTH / 2,
    HEIGHT / 2,
    WIDTH * 0.67
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.78, "rgba(0, 0, 0, 0.18)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.56)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

interface FaceRecord {
  meshId: string;
  meshIndex: number;
  faceIndex: number;
  depth: number;
  points: ProjectedPoint[];
  color: Rgb;
  alpha: number;
  frontFacing: boolean;
}

function projectViewPoint(view: Vec3, zoom: number): ProjectedPoint {
  const depth = CAMERA_DISTANCE - view.z;
  const focal = BASE_FOCAL * zoom;
  if (depth <= 0.15) return { x: 0, y: 0, depth, visible: false };
  return {
    x: WIDTH / 2 + (view.x * focal) / depth,
    y: HEIGHT * 0.505 - (view.y * focal) / depth,
    depth,
    visible: true
  };
}

function makeFaceRecords(scene: Scene, params: ViewParams, material: MaterialProfile, lighting: LightingProfile): {
  records: FaceRecord[];
  culledFaces: number;
  minOutwardDot: number;
} {
  const records: FaceRecord[] = [];
  let culledFaces = 0;
  let minOutwardDot = 1;
  const camera = vec3(0, 0, CAMERA_DISTANCE);
  const yaw = params.yaw * DEG_TO_RAD;
  const pitch = params.pitch * DEG_TO_RAD;

  scene.meshes.forEach((mesh, meshIndex) => {
    const viewCenter = rotateView(meshCenter(mesh), yaw, pitch);
    const viewVertices = mesh.vertices.map((vertex) =>
      rotateView(add(vertex, mesh.position), yaw, pitch)
    );

    mesh.faces.forEach((face, faceIndex) => {
      const a = viewVertices[face.a];
      const b = viewVertices[face.b];
      const c = viewVertices[face.c];
      const centroid = scale(add(add(a, b), c), 1 / 3);
      let normal = faceNormal(a, b, c);
      const outwardDot = dot(normal, subtract(centroid, viewCenter));
      if (outwardDot < 0) normal = scale(normal, -1);
      minOutwardDot = Math.min(minOutwardDot, Math.abs(outwardDot));
      const viewDirection = normalize(subtract(camera, centroid));
      const frontFacing = dot(normal, viewDirection) > 0;
      const baseAlpha = material.alpha[mesh.kind] * mesh.alpha;
      if (!frontFacing && baseAlpha >= 0.999) {
        culledFaces += 1;
        return;
      }

      const points = [projectViewPoint(a, params.zoom), projectViewPoint(b, params.zoom), projectViewPoint(c, params.zoom)];
      if (points.some((point) => !point.visible)) {
        culledFaces += 1;
        return;
      }
      if (
        points.every((point) => point.x < -40) ||
        points.every((point) => point.x > WIDTH + 40) ||
        points.every((point) => point.y < -40) ||
        points.every((point) => point.y > HEIGHT + 40)
      ) {
        culledFaces += 1;
        return;
      }

      const base = material.baseColor(mesh.kind, face.tone, normal);
      const color = shadeFace(
        base,
        normal,
        viewDirection,
        frontFacing,
        lighting,
        material.bronzeSpec
      );
      const alpha = frontFacing ? baseAlpha : baseAlpha * 0.48;
      records.push({
        meshId: mesh.id,
        meshIndex,
        faceIndex,
        depth: CAMERA_DISTANCE - centroid.z,
        points,
        color,
        alpha,
        frontFacing
      });
    });
  });

  records.sort(
    (first, second) =>
      second.depth - first.depth ||
      first.meshIndex - second.meshIndex ||
      first.faceIndex - second.faceIndex
  );
  return { records, culledFaces, minOutwardDot };
}

function drawFaces(
  ctx: CanvasRenderingContext2D,
  records: FaceRecord[],
  material: MaterialProfile
): void {
  ctx.save();
  ctx.lineJoin = "round";
  for (const record of records) {
    const [a, b, c] = record.points;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();

    if (record.alpha > 0.985) {
      const gradient = ctx.createLinearGradient(a.x, a.y, c.x, c.y);
      gradient.addColorStop(0, rgba(mix(record.color, [255, 255, 255], 0.07), record.alpha));
      gradient.addColorStop(1, rgba(scaleRgb(record.color, 0.8), record.alpha));
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = rgba(record.color, record.alpha);
    }
    ctx.fill();

    ctx.lineWidth = record.frontFacing ? 0.66 : 0.45;
    ctx.strokeStyle = rgba(
      material.edge,
      record.alpha * (record.frontFacing ? 0.18 : 0.07)
    );
    ctx.stroke();
  }
  ctx.restore();
}

function scaleRgb(color: Rgb, amount: number): Rgb {
  return [color[0] * amount, color[1] * amount, color[2] * amount];
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  params: ViewParams
): RenderMetrics {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackdrop(ctx);
  drawFloorRings(ctx, params);
  drawGroundShadow(ctx, params);

  const material = MATERIALS[params.material];
  const lighting = LIGHTING[params.lighting];
  const { records, culledFaces, minOutwardDot } = makeFaceRecords(scene, params, material, lighting);
  drawFaces(ctx, records, material);
  drawVignette(ctx);

  const labels = buildLabels(params);
  drawLabels(ctx, labels, params.lighting);

  ctx.restore();
  return {
    drawnFaces: records.length,
    culledFaces,
    backfaceFaces: records.filter((record) => !record.frontFacing).length,
    transparentFaces: records.filter((record) => record.alpha < 0.985).length,
    normalsOutward: minOutwardDot >= 0,
    minOutwardDot,
    depthOrderMonotonic: records.every(
      (record, index) => index === 0 || records[index - 1].depth >= record.depth - 1e-9
    ),
    drawOrderDigest: hashString(
      records.map((record) => `${record.meshId}:${record.faceIndex}`).join("|")
    ),
    labels,
    objectCount: scene.meshes.length
  };
}

export function canvasDigest(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "no-context";
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < pixels.length; index += 1) {
    first ^= pixels[index];
    first = Math.imul(first, 0x01000193);
    if ((index & 3) === 0) {
      second ^= pixels[index] + (pixels[index + 1] << 8) + (pixels[index + 2] << 16);
      second = Math.imul(second, 0x85ebca6b);
    }
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export const CANVAS_WIDTH = WIDTH;
export const CANVAS_HEIGHT = HEIGHT;

export function projectWorldPoint(point: Vec3, params: ViewParams): ProjectedPoint {
  return projectWorld(point, params);
}
