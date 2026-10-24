import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import type { Attachment } from '../core/types';

/**
 * Tube swept along the attachment spline in piece-local space.
 * UVs are u around the tube and v along the spline, including the flared joins.
 */
export function buildAttachmentGeometry(attachment: Attachment): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.userData.meshId = attachment.id;
  if (attachment.points.length < 2) {
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0], 3));
    const emptyUv = new Float32BufferAttribute([0, 0], 2);
    emptyUv.name = 'uv';
    geometry.setAttribute('uv', emptyUv);
    return geometry;
  }

  const tubular = Math.max(2, attachment.tubularSegments | 0);
  const radial = Math.max(3, attachment.radialSegments | 0);
  const count = (tubular + 1) * (radial + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  fillTube(attachment, tubular, radial, positions, normals, uvs);

  const indices = new Uint32Array(tubular * radial * 6);
  let w = 0;
  const cols = radial + 1;
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[w++] = a;
      indices[w++] = b;
      indices[w++] = c;
      indices[w++] = b;
      indices[w++] = d;
      indices[w++] = c;
    }
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  const uv = new Float32BufferAttribute(uvs, 2);
  uv.name = 'uv';
  geometry.setAttribute('uv', uv);
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  return geometry;
}

/**
 * Rewrite an existing tube when the point list changes but the segment
 * counts do not. Returns false when the topology differs and the caller
 * should build a new geometry instead of disposing every drag frame.
 */
export function writeAttachmentGeometry(geometry: BufferGeometry, attachment: Attachment): boolean {
  if (attachment.points.length < 2) return false;
  const position = geometry.getAttribute('position') as Float32BufferAttribute | undefined;
  const normal = geometry.getAttribute('normal') as Float32BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as Float32BufferAttribute | undefined;
  if (!position || !normal || !uv) return false;
  const tubular = Math.max(2, attachment.tubularSegments | 0);
  const radial = Math.max(3, attachment.radialSegments | 0);
  const count = (tubular + 1) * (radial + 1);
  if (position.count !== count || normal.count !== count || uv.count !== count) return false;
  fillTube(
    attachment,
    tubular,
    radial,
    position.array as Float32Array,
    normal.array as Float32Array,
    uv.array as Float32Array,
  );
  position.needsUpdate = true;
  normal.needsUpdate = true;
  uv.needsUpdate = true;
  return true;
}

function fillTube(
  attachment: Attachment,
  tubular: number,
  radial: number,
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
): void {
  resetVectorPool();
  const curve = new CatmullRomCurve3(
    attachment.points.map((point) => pooledVector(point.x, point.y, point.z)),
    false,
    'catmullrom',
    0.5,
  );
  const frames = parallelFrames(curve, tubular);
  const radii = radiusSamples(attachment, tubular);
  const cols = radial + 1;

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const edge = Math.min(t, 1 - t);
    const blend = attachment.joinBlend <= 1e-4 ? 0 : Math.max(0, 1 - edge / attachment.joinBlend);
    const flare = 1 + blend * 0.55;
    const flatten = 1 - blend * 0.35;
    const center = frames.points[i];
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const radius = radii[i] * flare;
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius * flatten;
      const vx = normal.x * cx + binormal.x * cy;
      const vy = normal.y * cx + binormal.y * cy;
      const vz = normal.z * cx + binormal.z * cy;
      const idx = i * cols + j;
      positions[idx * 3] = center.x + vx;
      positions[idx * 3 + 1] = center.y + vy;
      positions[idx * 3 + 2] = center.z + vz;
      const len = Math.hypot(vx, vy, vz) || 1;
      normals[idx * 3] = vx / len;
      normals[idx * 3 + 1] = vy / len;
      normals[idx * 3 + 2] = vz / len;
      uvs[idx * 2] = j / radial;
      uvs[idx * 2 + 1] = t;
    }
  }
}

const vectorPool: Vector3[] = [];
let vectorCursor = 0;

function pooledVector(x: number, y: number, z: number): Vector3 {
  let vector = vectorPool[vectorCursor];
  if (!vector) {
    vector = new Vector3();
    vectorPool[vectorCursor] = vector;
  }
  vectorCursor += 1;
  return vector.set(x, y, z);
}

function resetVectorPool(): void {
  vectorCursor = 0;
}

function parallelFrames(curve: CatmullRomCurve3, tubular: number) {
  const points: Vector3[] = [];
  const tangents: Vector3[] = [];
  const normals: Vector3[] = [];
  const binormals: Vector3[] = [];
  const up = new Vector3(0, 1, 0);
  const alt = new Vector3(1, 0, 0);
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    points.push(point);
    tangents.push(tangent);
    if (i === 0) {
      const helper = Math.abs(tangent.dot(up)) > 0.9 ? alt : up;
      const normal = new Vector3().crossVectors(tangent, helper).normalize();
      normals.push(normal);
      binormals.push(new Vector3().crossVectors(tangent, normal).normalize());
    } else {
      const previous = normals[i - 1];
      const projected = previous.clone().addScaledVector(tangent, -previous.dot(tangent));
      if (projected.lengthSq() < 1e-8) projected.crossVectors(tangent, binormals[i - 1]);
      projected.normalize();
      normals.push(projected);
      binormals.push(new Vector3().crossVectors(tangent, projected).normalize());
    }
  }
  return { points, normals, binormals };
}

function radiusSamples(attachment: Attachment, tubular: number): Float32Array {
  const points = attachment.points;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cumulative.push(cumulative[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  const radii = new Float32Array(tubular + 1);
  for (let i = 0; i <= tubular; i++) {
    const dist = (i / tubular) * total;
    let k = 1;
    while (k < cumulative.length - 1 && cumulative[k] < dist) k++;
    const span = cumulative[k] - cumulative[k - 1] || 1;
    const f = (dist - cumulative[k - 1]) / span;
    radii[i] = points[k - 1].radius + (points[k].radius - points[k - 1].radius) * Math.max(0, Math.min(1, f));
  }
  return radii;
}
