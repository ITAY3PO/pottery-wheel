import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshPhysicalMaterial,
  Sphere,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import { currentArc } from '../clay/grid';
import type { ClayGrid } from '../core/types';
import { createClayMaterial } from './materials';

/**
 * Fixed-topology clay body. Vertex count is (rings * (segments + 1) * 2)
 * and never changes for a given grid size — positions are rewritten in place.
 */
export class ClayMesh {
  readonly geometry: BufferGeometry;
  readonly mesh: Mesh;
  readonly rings: number;
  readonly segments: number;
  private readonly cols: number;
  private seenRevision = -1;
  private readonly sphere = new Sphere(new Vector3(), 0.3);

  constructor(rings: number, segments: number, material: MeshPhysicalMaterial = createClayMaterial()) {
    this.rings = rings;
    this.segments = segments;
    this.cols = segments + 1;
    this.geometry = new BufferGeometry();
    const count = rings * this.cols * 2;
    this.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2));
    this.geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setIndex(new Uint32BufferAttribute(buildIndices(rings, segments), 1));
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.userData.meshId = 'body';
    this.mesh.frustumCulled = false;
  }

  get vertexCount(): number {
    return this.rings * this.cols * 2;
  }

  /** Upload positions if the grid changed. Returns true when buffers were rewritten. */
  update(grid: ClayGrid): boolean {
    if (grid.rings !== this.rings || grid.segments !== this.segments) {
      throw new Error('ClayMesh grid size is fixed; construct a new mesh when it changes');
    }
    if (grid.revision === this.seenRevision) return false;
    this.seenRevision = grid.revision;
    this.write(grid);
    return true;
  }

  private write(grid: ClayGrid): void {
    const position = this.geometry.getAttribute('position') as Float32BufferAttribute;
    const normal = this.geometry.getAttribute('normal') as Float32BufferAttribute;
    const uv = this.geometry.getAttribute('uv') as Float32BufferAttribute;
    const color = this.geometry.getAttribute('color') as Float32BufferAttribute;
    const pos = position.array as Float32Array;
    const nor = normal.array as Float32Array;
    const uvs = uv.array as Float32Array;
    const col = color.array as Float32Array;
    const { rings, segments, cols } = this;
    const arcOuter = currentArc(grid, 'outer');
    const arcInner = currentArc(grid, 'inner');
    let maxRadius = 0.05;

    const vert = (surface: 0 | 1, ring: number, colIndex: number) => (surface * rings + ring) * cols + colIndex;

    for (let surface = 0; surface < 2; surface++) {
      const radii = surface === 0 ? grid.outer : grid.inner;
      const arcs = surface === 0 ? arcOuter : arcInner;
      for (let ring = 0; ring < rings; ring++) {
        const y = grid.y[ring];
        const yPrev = grid.y[Math.max(0, ring - 1)];
        const yNext = grid.y[Math.min(rings - 1, ring + 1)];
        for (let c = 0; c <= segments; c++) {
          const seg = c % segments;
          const theta = (c / segments) * Math.PI * 2;
          const radius = radii[ring * segments + seg];
          if (radius > maxRadius) maxRadius = radius;
          const rPrev = radii[Math.max(0, ring - 1) * segments + seg];
          const rNext = radii[Math.min(rings - 1, ring + 1) * segments + seg];
          const sin = Math.sin(theta);
          const cos = Math.cos(theta);
          const vi = vert(surface as 0 | 1, ring, c);
          pos[vi * 3] = radius * sin;
          pos[vi * 3 + 1] = y;
          pos[vi * 3 + 2] = radius * cos;

          const dr = rNext - rPrev;
          const dy = yNext - yPrev || 0.0001;
          let nr = surface === 0 ? dy : -dy;
          let ny = surface === 0 ? -dr : dr;
          if (ring > rings - 3) ny += 0.9;
          if (ring < 2) ny -= 0.55;
          if (radius < 0.0008) {
            nr = 0;
            ny = surface === 0 ? -1 : 1;
          }
          const len = Math.hypot(nr, ny) || 1;
          nr /= len;
          ny /= len;
          const nLen = Math.hypot(nr * sin, ny, nr * cos) || 1;
          nor[vi * 3] = (nr * sin) / nLen;
          nor[vi * 3 + 1] = ny / nLen;
          nor[vi * 3 + 2] = (nr * cos) / nLen;

          uvs[vi * 2] = c / segments;
          uvs[vi * 2 + 1] = arcs[ring] ?? ring / (rings - 1);

          const torn = grid.torn[ring * segments + seg] === 1;
          let shade = surface === 1 ? 0.74 : 1;
          if (ring === 0) shade *= 0.68;
          if (torn) {
            col[vi * 3] = 0.42 * shade;
            col[vi * 3 + 1] = 0.24 * shade;
            col[vi * 3 + 2] = 0.2 * shade;
          } else {
            col[vi * 3] = shade;
            col[vi * 3 + 1] = shade;
            col[vi * 3 + 2] = shade;
          }
        }
      }
    }

    position.needsUpdate = true;
    normal.needsUpdate = true;
    uv.needsUpdate = true;
    color.needsUpdate = true;
    const height = grid.y[rings - 1] ?? 0.1;
    this.sphere.center.set(0, height * 0.45, 0);
    this.sphere.radius = Math.max(0.15, height, maxRadius) * 1.35;
    this.geometry.boundingSphere = this.sphere;
  }
}

function buildIndices(rings: number, segments: number): Uint32Array {
  const cols = segments + 1;
  const vert = (surface: 0 | 1, ring: number, col: number) => (surface * rings + ring) * cols + col;
  const quads = (rings - 1) * segments * 2 + segments * 2;
  const indices = new Uint32Array(quads * 6);
  let w = 0;
  const push = (a: number, b: number, c: number) => {
    indices[w++] = a;
    indices[w++] = b;
    indices[w++] = c;
  };
  for (let r = 0; r < rings - 1; r++) {
    for (let c = 0; c < segments; c++) {
      const o00 = vert(0, r, c);
      const o10 = vert(0, r, c + 1);
      const o01 = vert(0, r + 1, c);
      const o11 = vert(0, r + 1, c + 1);
      push(o00, o10, o01);
      push(o10, o11, o01);
      const i00 = vert(1, r, c);
      const i10 = vert(1, r, c + 1);
      const i01 = vert(1, r + 1, c);
      const i11 = vert(1, r + 1, c + 1);
      push(i00, i01, i10);
      push(i01, i11, i10);
    }
  }
  const top = rings - 1;
  for (let c = 0; c < segments; c++) {
    const o = vert(0, top, c);
    const o2 = vert(0, top, c + 1);
    const i = vert(1, top, c);
    const i2 = vert(1, top, c + 1);
    push(o, o2, i);
    push(o2, i2, i);
    const ob = vert(0, 0, c);
    const ob2 = vert(0, 0, c + 1);
    const ib = vert(1, 0, c);
    const ib2 = vert(1, 0, c + 1);
    push(ob, ib, ob2);
    push(ob2, ib, ib2);
  }
  return indices;
}
