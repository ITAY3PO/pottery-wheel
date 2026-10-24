import { describe, expect, it } from 'vitest';
import { createCylinderGrid, freezeProfile, pieceHeight } from '../src/clay/grid';
import { createPiece, deserializePiece, serializePiece } from '../src/core/piece';
import { createSurfaceMap } from '../src/core/surfaceMap';
import type { PieceState } from '../src/core/types';
import { decodeShare, encodeShare, SHARE_HASH_BUDGET, SHARE_HASH_MAX_CHARS, SHARE_INFLATE_MAX_BYTES, withShareHash } from '../src/gallery/codec';
import { bindShareHash } from '../src/gallery/hash';

function pieceFrom(grid: ReturnType<typeof createCylinderGrid>, patch: Partial<PieceState> = {}): PieceState {
  const now = 1_700_000_000_000;
  return {
    version: 1,
    id: 'pot-test',
    clayTypeId: 'earthenware',
    weightKg: 1.2,
    stage: 'glaze-fired',
    onWheel: false,
    grid,
    attachments: [],
    surfaces: [],
    speedSetting: 0.5,
    createdAt: now,
    updatedAt: now + 5000,
    ...patch,
  };
}

describe('share links', () => {
  it('round-trips shape, attachments, and surface maps', async () => {
    const grid = createCylinderGrid({ rings: 20, segments: 16, radius: 0.06, height: 0.11, innerRadius: 0.03, floor: 0.02 });
    grid.outer[3 * 16 + 4] = 0.045;
    grid.moisture[5] = 0.42;
    grid.torn[8] = 1;
    grid.stress = 12.34;
    grid.failure = 'slumped';
    freezeProfile(grid);
    const map = createSurfaceMap(8, 8);
    map.glazeId[10] = 4;
    map.thickness[10] = 1.2;
    map.wax[11] = 1;
    map.underglazeId[12] = 2;
    const piece = pieceFrom(grid, {
      onWheel: true,
      speedSetting: 0.5,
      attachments: [
        {
          id: 'handle-a',
          kind: 'handle',
          joinBlend: 0.18,
          tubularSegments: 24,
          radialSegments: 10,
          points: [
            { x: 0.04, y: 0.03, z: 0.01, radius: 0.006 },
            { x: 0.07, y: 0.08, z: -0.02, radius: 0.005 },
          ],
        },
      ],
      surfaces: [{ meshId: 'body', map }],
    });

    const encoded = await encodeShare(piece);
    expect(encoded).not.toBeNull();
    expect(encoded?.hash.startsWith('p1.')).toBe(true);
    expect(encoded?.degraded).toBe(false);
    expect(encoded?.oversize).toBe(false);
    expect(encoded && encoded.hash.length).toBeLessThanOrEqual(SHARE_HASH_BUDGET);

    const back = await decodeShare(encoded?.hash ?? '');
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back.clayTypeId).toBe('earthenware');
    expect(back.stage).toBe('glaze-fired');
    expect(back.weightKg).toBe(1.2);
    expect(back.onWheel).toBe(true);
    expect(back.grid.rings).toBe(20);
    expect(back.grid.segments).toBe(16);
    expect(back.grid.uvFrozen).toBe(true);
    expect(back.grid.failure).toBe('slumped');
    expect(back.grid.stress).toBeCloseTo(12.34, 1);
    expect(back.speedSetting).toBeCloseTo(0.5, 1);
    expect(Math.abs(back.createdAt - piece.createdAt)).toBeLessThan(1000);
    expect(pieceHeight(back.grid)).toBeCloseTo(pieceHeight(grid), 4);
    expect(back.grid.outer[0]).toBeCloseTo(grid.outer[0] ?? 0, 4);
    expect(back.grid.outer[3 * 16 + 4]).toBeCloseTo(0.045, 4);
    expect(back.grid.inner[10 * 16]).toBeCloseTo(0.03, 4);
    expect(back.grid.moisture[5]).toBeCloseTo(0.42, 1);
    expect(back.grid.torn[8]).toBe(1);
    expect(back.grid.torn[0]).toBe(0);
    expect(back.grid.arcOuter?.[19]).toBeCloseTo(1, 3);
    expect(back.attachments[0]?.id).toBe('handle-a');
    expect(back.attachments[0]?.kind).toBe('handle');
    expect(back.attachments[0]?.points[1]?.y).toBeCloseTo(0.08, 3);
    expect(back.attachments[0]?.joinBlend).toBeCloseTo(0.18, 2);
    expect(back.surfaces[0]?.map.glazeId[10]).toBe(4);
    expect(back.surfaces[0]?.map.thickness[10]).toBeCloseTo(1.2, 1);
    expect(back.surfaces[0]?.map.wax[11]).toBe(1);
    expect(back.surfaces[0]?.map.underglazeId[12]).toBe(2);
    expect(back.surfaces[0]?.map.width).toBe(8);

    const stored = deserializePiece(serializePiece(back));
    expect(stored.id).toBe('pot-test');
    expect(stored.grid.outer[3 * 16 + 4]).toBeCloseTo(0.045, 4);

    const url = withShareHash('https://itay3po.github.io/pottery-wheel/', encoded?.hash ?? '');
    expect(url.startsWith('https://itay3po.github.io/pottery-wheel/#p1.')).toBe(true);
    const fromUrl = await decodeShare(url);
    expect(fromUrl?.id).toBe('pot-test');
  });

  it('keeps a thrown lump inside a shareable hash', async () => {
    const piece = createPiece('porcelain', 0.6);
    const height = pieceHeight(piece.grid);
    const encoded = await encodeShare(piece);
    expect(encoded).not.toBeNull();
    expect(encoded && encoded.hash.length).toBeLessThanOrEqual(SHARE_HASH_BUDGET);
    const back = await decodeShare(`#${encoded?.hash ?? ''}`);
    expect(back).not.toBeNull();
    if (!back || !encoded) return;
    expect(back.clayTypeId).toBe('porcelain');
    expect(back.stage).toBe('wet');
    expect(Math.abs(pieceHeight(back.grid) - height)).toBeLessThan(0.004);
    expect(piece.grid.rings).toBe(160);
  });

  it('steps the grid down when the hash budget is tight, without editing the original', async () => {
    const grid = createCylinderGrid({ rings: 48, segments: 36, radius: 0.05, height: 0.12 });
    for (let r = 0; r < grid.rings; r++) {
      for (let s = 0; s < grid.segments; s++) {
        const index = r * grid.segments + s;
        const noise = Math.abs(Math.sin(r * 12.9898 + s * 78.233) * 43758.5453);
        const unit = noise - Math.floor(noise);
        grid.outer[index] = 0.03 + unit * 0.04;
        grid.inner[index] = unit > 0.5 ? 0.01 + (unit - 0.5) * 0.015 : 0;
      }
    }
    const map = createSurfaceMap(32, 32);
    for (let i = 0; i < map.glazeId.length; i++) map.glazeId[i] = (i * 17) % 255;
    const piece = pieceFrom(grid, { surfaces: [{ meshId: 'body', map }] });
    const encoded = await encodeShare(piece, { maxChars: 700 });
    expect(encoded).not.toBeNull();
    expect(encoded && encoded.rings).toBeLessThan(48);
    expect(piece.grid.rings).toBe(48);
    expect(piece.grid.outer[0]).toBe(grid.outer[0]);
    const back = await decodeShare(encoded?.hash ?? '');
    expect(back).not.toBeNull();
    if (!back) return;
    expect(back.grid.rings).toBe(encoded?.rings);
    expect(Math.abs(pieceHeight(back.grid) - pieceHeight(grid))).toBeLessThan(0.02);
    expect(back.stage).toBe('glaze-fired');
  });

  it('rejects a hash that is not a pot', async () => {
    expect(await decodeShare('')).toBeNull();
    expect(await decodeShare('#nope')).toBeNull();
    expect(await decodeShare('#p1.!!!!')).toBeNull();
    expect(await decodeShare('https://itay3po.github.io/pottery-wheel/#about')).toBeNull();
  });

  it('rejects a hash longer than the raw cap without decoding it', async () => {
    const hash = `#p1.${'A'.repeat(SHARE_HASH_MAX_CHARS)}`;
    await expect(decodeShare(hash)).resolves.toBeNull();
  });

  it('rejects a short hash that inflates past the byte cap', async () => {
    const zeros = new Uint8Array(SHARE_INFLATE_MAX_BYTES + 64);
    const compressed = new Uint8Array(
      await new Response(new Blob([zeros]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
    let binary = '';
    for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i] ?? 0);
    const hash = `p1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
    expect(hash.length).toBeLessThan(SHARE_HASH_MAX_CHARS);
    await expect(decodeShare(hash)).resolves.toBeNull();
  });

  it('opens a share hash on load and again when the hash changes', () => {
    const listeners: Array<() => void> = [];
    const opened: string[] = [];
    let hash = '#p1.first';
    bindShareHash(
      { addEventListener: (_type, listener) => listeners.push(listener) },
      () => hash,
      (value) => opened.push(value),
    );
    expect(opened).toEqual(['#p1.first']);
    hash = '#p1.pasted';
    listeners[0]?.();
    hash = '#about';
    listeners[0]?.();
    expect(opened).toEqual(['#p1.first', '#p1.pasted']);
    expect(listeners).toHaveLength(1);
  });
});
