import { describe, expect, it } from 'vitest';
import { centeredness, createCylinderGrid, meanChannel, pieceHeight, volume } from '../src/clay/grid';
import { createPiece, deserializePiece, serializePiece } from '../src/core/piece';
import { loadStages, loadTools, toolsFor } from '../src/core/registry';
import { remountOnWheel, skipDrying, transition } from '../src/core/stateMachine';
import type { ClayGrid, PieceState, ToolContext } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { centerForTrim, tapForTrim, trimWithLoop, type LoopKind, type TrimStroke } from '../src/tools/trim-carve';
import { activeTrimChips, resetTrimChips, spawnTrimChips, stepTrimChips } from '../src/tools/trim-chips';
import { baseIsPierced, flipGrid, isBaseUp, isSeated, mountBaseUp, unmountUpright } from '../src/tools/trim-pose';

const spin: TrimStroke = { pressure: 0.95, omega: 16, segment: 0, dt: 0.05 };
const HOLLOW = 0.0016;

function leatherPot(): PieceState {
  const piece = createPiece('stoneware', 1);
  piece.grid = createCylinderGrid({
    radius: 0.05,
    height: 0.08,
    innerRadius: 0.03,
    floor: 0.016,
    rings: 40,
    segments: 24,
  });
  piece.grid.moisture.fill(1);
  expect(skipDrying(piece)).toBe(true);
  return piece;
}

function topY(piece: PieceState): number {
  return piece.grid.y[piece.grid.rings - 1];
}

function prepare(piece: PieceState): void {
  mountBaseUp(piece);
  for (let i = 0; i < 24; i++) centerForTrim(piece, spin);
  expect(tapForTrim(piece, topY(piece), spin)).toBe(true);
}

function cut(piece: PieceState, kind: LoopKind, frames: number, radius = 0.028): void {
  const y = topY(piece);
  for (let i = 0; i < frames; i++) trimWithLoop(piece, kind, y, radius, spin);
}

function footStats(grid: ClayGrid): { face: number; deep: number; floors: number; width: number; rings: number } {
  const segs = grid.segments;
  const hollows: number[] = [];
  for (let r = 0; r < grid.rings; r++) {
    if (meanChannel(grid.inner, r, segs) < HOLLOW) break;
    hollows.push(r);
  }
  let floors = 0;
  for (let r = hollows.length; r < grid.rings; r++) {
    if (meanChannel(grid.inner, r, segs) >= HOLLOW) break;
    floors++;
  }
  const faceRing = hollows[0] ?? 0;
  const deepRing = hollows[hollows.length - 1] ?? 0;
  const face = hollows.length ? meanChannel(grid.inner, faceRing, segs) : 0;
  const deep = hollows.length ? meanChannel(grid.inner, deepRing, segs) : 0;
  const outer = meanChannel(grid.outer, faceRing, segs);
  return { face, deep, floors, width: outer - face, rings: hollows.length };
}

function fire(piece: PieceState): void {
  expect(skipDrying(piece)).toBe(true);
  expect(transition(piece, 'bisque')).toBe(true);
  expect(transition(piece, 'glazed')).toBe(true);
  expect(transition(piece, 'glaze-fired')).toBe(true);
}

describe('trimming pose', () => {
  it('turns the pot base-up on remount and restores it when it comes off', () => {
    const piece = leatherPot();
    const wheel = new Wheel();
    const stage = loadStages().find((entry) => entry.id === 'leather-hard');
    const remount = stage?.actions?.find((action) => action.id === 'remount');
    const unmount = stage?.actions?.find((action) => action.id === 'unmount');
    expect(remount?.enabled?.({ piece, wheel })).toBe(true);
    remount?.run({ piece, wheel });
    expect(piece.onWheel).toBe(true);
    expect(isBaseUp(piece.grid)).toBe(true);
    expect(isSeated(piece.grid)).toBe(false);
    expect(centeredness(piece.grid)).toBeLessThan(0.7);
    expect(stage?.hint({ piece, wheel })).toMatch(/Center/);

    const before = volume(piece.grid);
    for (let i = 0; i < 24; i++) centerForTrim(piece, spin);
    expect(centeredness(piece.grid)).toBeGreaterThan(0.8);
    expect(Math.abs(volume(piece.grid) - before) / before).toBeLessThan(0.02);
    expect(tapForTrim(piece, 0.002, spin)).toBe(false);
    expect(tapForTrim(piece, topY(piece), { ...spin, pressure: 0.1 })).toBe(false);
    expect(tapForTrim(piece, topY(piece), spin)).toBe(true);
    expect(isSeated(piece.grid)).toBe(true);
    expect(stage?.hint({ piece, wheel })).toMatch(/foot/);

    unmount?.run({ piece, wheel });
    expect(piece.onWheel).toBe(false);
    expect(isBaseUp(piece.grid)).toBe(false);
    expect(piece.grid.stress).toBe(0);
  });

  it('flips the grid twice back to itself, arcs included', () => {
    const grid = createCylinderGrid({ radius: 0.04, height: 0.06, innerRadius: 0.02, floor: 0.01, rings: 20, segments: 12 });
    grid.arcOuter = Float32Array.from({ length: grid.rings }, (_, i) => i / (grid.rings - 1));
    grid.arcInner = grid.arcOuter.slice();
    grid.outer[5] = 0.033;
    grid.moisture[2] = 0.2;
    const y = grid.y.slice();
    const outer = grid.outer.slice();
    const inner = grid.inner.slice();
    const arc = grid.arcOuter.slice();
    flipGrid(grid);
    flipGrid(grid);
    for (let i = 0; i < grid.y.length; i++) expect(grid.y[i]).toBeCloseTo(y[i], 6);
    for (let i = 0; i < outer.length; i++) {
      expect(grid.outer[i]).toBeCloseTo(outer[i], 6);
      expect(grid.inner[i]).toBeCloseTo(inner[i], 6);
    }
    for (let i = 0; i < arc.length; i++) expect(grid.arcOuter?.[i]).toBeCloseTo(arc[i], 6);
    expect(grid.moisture[2]).toBeCloseTo(0.2, 6);
  });

  it('keeps the upside-down pose through save and load', () => {
    const piece = leatherPot();
    mountBaseUp(piece);
    const loaded = deserializePiece(serializePiece(piece));
    expect(loaded.grid.stress).toBeLessThan(0);
    expect(loaded.onWheel).toBe(true);
    expect(loaded.grid.outer[30]).toBeCloseTo(piece.grid.outer[30], 5);
    unmountUpright(loaded);
    expect(loaded.grid.stress).toBe(0);
    expect(isBaseUp(loaded.grid)).toBe(false);
  });
});

describe('loop tools', () => {
  it('only cuts leather-hard clay that is base-up on the wheel', () => {
    const wet = createPiece('porcelain', 1);
    const wetVolume = volume(wet.grid);
    trimWithLoop(wet, 'round', pieceHeight(wet.grid), 0.02, spin);
    expect(volume(wet.grid)).toBe(wetVolume);

    const loose = leatherPot();
    remountOnWheel(loose);
    const looseVolume = volume(loose.grid);
    trimWithLoop(loose, 'square', topY(loose), 0.02, spin);
    expect(volume(loose.grid)).toBe(looseVolume);
    expect(isBaseUp(loose.grid)).toBe(false);

    const dry = leatherPot();
    expect(skipDrying(dry)).toBe(true);
    const dryVolume = volume(dry.grid);
    trimWithLoop(dry, 'ribbon', topY(dry), 0.02, spin);
    expect(volume(dry.grid)).toBe(dryVolume);
    expect(dry.stage).toBe('bone-dry');
  });

  it('carves a foot ring and spends the clay', () => {
    const piece = leatherPot();
    prepare(piece);
    const seated = volume(piece.grid);
    cut(piece, 'square', 18, 0.028);
    expect(volume(piece.grid)).toBeLessThan(seated * 0.99);
    expect(baseIsPierced(piece.grid)).toBe(false);
    expect(piece.weightKg).toBe(1);
    expect(piece.stage).toBe('leather-hard');
    unmountUpright(piece);
    const foot = footStats(piece.grid);
    expect(foot.rings).toBeGreaterThan(1);
    expect(foot.face).toBeGreaterThan(0.012);
    expect(foot.width).toBeGreaterThan(0.003);
    expect(foot.floors).toBeGreaterThan(0);
  });

  it('cuts less until the pot has been tapped down', () => {
    const loose = leatherPot();
    mountBaseUp(loose);
    for (let i = 0; i < 24; i++) centerForTrim(loose, spin);
    const seated = leatherPot();
    prepare(seated);
    const looseBefore = volume(loose.grid);
    const seatedBefore = volume(seated.grid);
    cut(loose, 'round', 14, 0.028);
    cut(seated, 'round', 14, 0.028);
    const looseLost = looseBefore - volume(loose.grid);
    const seatedLost = seatedBefore - volume(seated.grid);
    expect(seatedLost).toBeGreaterThan(looseLost * 1.4);
  });

  it('shapes a bowl with the round loop and a shelf with the square loop', () => {
    const round = leatherPot();
    const square = leatherPot();
    prepare(round);
    prepare(square);
    cut(round, 'round', 18, 0.028);
    cut(square, 'square', 18, 0.028);
    unmountUpright(round);
    unmountUpright(square);
    const roundFoot = footStats(round.grid);
    const squareFoot = footStats(square.grid);
    expect(roundFoot.face - roundFoot.deep).toBeGreaterThan(squareFoot.face - squareFoot.deep + 0.004);
    expect(squareFoot.face).toBeGreaterThan(0.012);
  });

  it('lets the ribbon shave the wall without opening as deep a foot', () => {
    const ribbon = leatherPot();
    const round = leatherPot();
    prepare(ribbon);
    prepare(round);
    cut(ribbon, 'ribbon', 18, 0.028);
    cut(round, 'round', 18, 0.028);
    unmountUpright(ribbon);
    unmountUpright(round);
    const ribbonFoot = footStats(ribbon.grid);
    const roundFoot = footStats(round.grid);
    expect(roundFoot.rings).toBeGreaterThan(ribbonFoot.rings);
    expect(roundFoot.face).toBeGreaterThan(0.012);
    const band = (grid: ClayGrid) => {
      const r0 = Math.floor(grid.rings * 0.12);
      const r1 = Math.floor(grid.rings * 0.4);
      let sum = 0;
      let n = 0;
      for (let r = r0; r <= r1; r++) {
        sum += meanChannel(grid.outer, r, grid.segments);
        n++;
      }
      return sum / n;
    };
    expect(band(ribbon.grid)).toBeLessThan(band(round.grid) - 0.0004);
  });

  it('leaves a flat where a still finger rests', () => {
    const piece = leatherPot();
    prepare(piece);
    const top = piece.grid.rings - 1;
    const segs = piece.grid.segments;
    const still: TrimStroke = { ...spin, omega: 0, segment: 0 };
    for (let i = 0; i < 12; i++) trimWithLoop(piece, 'square', topY(piece), 0.028, still);
    const inner0 = piece.grid.inner[top * segs];
    const innerOpp = piece.grid.inner[top * segs + segs / 2];
    expect(inner0).toBeGreaterThan(0.01);
    expect(innerOpp).toBeLessThan(inner0 * 0.3);
  });

  it('cuts through the base when the loop is held too long, and the hole survives firing', () => {
    const piece = leatherPot();
    prepare(piece);
    cut(piece, 'round', 90, 0.03);
    expect(baseIsPierced(piece.grid)).toBe(true);
    expect(piece.grid.failure).toBe('torn');
    const stage = loadStages().find((entry) => entry.id === 'leather-hard');
    expect(stage?.hint({ piece, wheel: new Wheel() })).toMatch(/cut through/);
    unmountUpright(piece);
    expect(baseIsPierced(piece.grid)).toBe(true);
    fire(piece);
    expect(piece.stage).toBe('glaze-fired');
    expect(baseIsPierced(piece.grid)).toBe(true);
    expect(piece.grid.torn.some((sample) => sample === 1)).toBe(true);
  });

  it('carries the trimmed foot through drying and both fires', () => {
    const trimmed = leatherPot();
    const twin = leatherPot();
    prepare(trimmed);
    cut(trimmed, 'square', 18, 0.028);
    unmountUpright(trimmed);
    const leatherFoot = footStats(trimmed.grid);
    expect(volume(trimmed.grid)).toBeLessThan(volume(twin.grid));
    fire(trimmed);
    fire(twin);
    const fired = footStats(trimmed.grid);
    const plain = footStats(twin.grid);
    expect(trimmed.stage).toBe('glaze-fired');
    expect(fired.face).toBeGreaterThan(0.008);
    expect(fired.floors).toBeGreaterThan(0);
    expect(fired.face).toBeLessThan(leatherFoot.face);
    expect(plain.face).toBeLessThan(0.001);
    expect(volume(trimmed.grid)).toBeLessThan(volume(twin.grid));
    expect(trimmed.weightKg).toBe(twin.weightKg);
  });
});

describe('trimming chips and registry', () => {
  it('throws chips off the loop and lets them fall', () => {
    resetTrimChips();
    spawnTrimChips({ x: 0.04, y: 0.06, z: 0 }, 5e-6, 12);
    expect(activeTrimChips().length).toBeGreaterThan(0);
    const start = activeTrimChips()[0].y;
    stepTrimChips(0.12);
    expect(activeTrimChips()[0].y).toBeLessThan(start);
  });

  it('spawns chips from a finger stroke on the round loop', () => {
    resetTrimChips();
    const piece = leatherPot();
    prepare(piece);
    const tool = loadTools().find((entry) => entry.id === 'trim-round');
    expect(tool).toBeDefined();
    const wheel = new Wheel();
    wheel.omega = 16;
    const height = topY(piece);
    const ctx: ToolContext = {
      piece,
      wheel,
      pointer: { radius: 0.028, height, pressure: 0.9, side: 1, segment: 0, x: 0.028, y: height },
      previous: null,
      dt: 0.05,
    };
    tool?.onPointerDown(ctx);
    expect(activeTrimChips().length).toBeGreaterThan(0);
  });

  it('offers the loop tools only at leather-hard, on the wheel', () => {
    const ids = toolsFor('leather-hard', true)
      .map((tool) => tool.id)
      .filter((id) => id.startsWith('trim-'));
    expect(ids).toEqual(['trim-center', 'trim-tap', 'trim-round', 'trim-square', 'trim-ribbon']);
    expect(toolsFor('wet', true).map((tool) => tool.id)).not.toContain('trim-round');
    expect(toolsFor('leather-hard', false).map((tool) => tool.id)).not.toContain('trim-square');
    expect(toolsFor('bone-dry', true).map((tool) => tool.id)).not.toContain('trim-ribbon');
    for (const id of ids) {
      const tool = loadTools().find((entry) => entry.id === id);
      expect(tool?.allowedStages).toEqual(['leather-hard']);
      expect(tool?.requiresWheel).toBe(true);
    }
  });
});
