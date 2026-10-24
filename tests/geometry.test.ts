import { describe, expect, it } from 'vitest';
import { createAttachment } from '../src/core/attachment';
import { createPiece } from '../src/core/piece';
import { buildAttachmentGeometry } from '../src/render/attachmentMesh';
import { ClayMesh } from '../src/render/clayMesh';

describe('fixed clay mesh', () => {
  it('keeps the same geometry and vertex count across updates', () => {
    const piece = createPiece('porcelain', 0.7);
    const mesh = new ClayMesh(piece.grid.rings, piece.grid.segments);
    const id = mesh.geometry.uuid;
    expect(mesh.vertexCount).toBe(piece.grid.rings * (piece.grid.segments + 1) * 2);
    mesh.update(piece.grid);
    piece.grid.revision++;
    mesh.update(piece.grid);
    expect(mesh.geometry.uuid).toBe(id);
    expect(mesh.geometry.getAttribute('position').count).toBe(mesh.vertexCount);
    expect(mesh.geometry.getAttribute('uv').count).toBe(mesh.vertexCount);
  });
});

describe('attachment tube', () => {
  it('sweeps a flared tube with u around and v along', () => {
    const attachment = createAttachment({
      kind: 'handle',
      joinBlend: 0.22,
      tubularSegments: 20,
      radialSegments: 8,
      points: [
        { x: 0.05, y: 0.04, z: 0, radius: 0.006 },
        { x: 0.075, y: 0.08, z: 0.01, radius: 0.006 },
        { x: 0.05, y: 0.12, z: 0, radius: 0.006 },
      ],
    });
    const geometry = buildAttachmentGeometry(attachment);
    const uv = geometry.getAttribute('uv');
    const position = geometry.getAttribute('position');
    expect(uv.count).toBe((20 + 1) * (8 + 1));
    let minU = 1;
    let maxU = 0;
    let minV = 1;
    let maxV = 0;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(minU).toBe(0);
    expect(maxU).toBe(1);
    expect(minV).toBe(0);
    expect(maxV).toBe(1);

    const cols = 9;
    const radiusOf = (row: number) => {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let j = 0; j < cols; j++) {
        const index = row * cols + j;
        cx += position.getX(index);
        cy += position.getY(index);
        cz += position.getZ(index);
      }
      cx /= cols;
      cy /= cols;
      cz /= cols;
      let radius = 0;
      for (let j = 0; j < cols; j++) {
        const index = row * cols + j;
        radius += Math.hypot(position.getX(index) - cx, position.getY(index) - cy, position.getZ(index) - cz);
      }
      return radius / cols;
    };
    expect(radiusOf(0)).toBeGreaterThan(radiusOf(10) * 1.15);
  });
});
