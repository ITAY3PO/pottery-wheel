import { getClay } from '../clay/clays';
import { meanMoisture, sanitizeGrid, scaleGaps, scaleRadii, touchGrid, volume } from '../clay/grid';
import { events } from '../core/events';
import { canTransition, transition } from '../core/stateMachine';
import type { ClayGrid, PieceState } from '../core/types';
import { attachmentWillCrack } from '../handbuild/join';

/** A clay slumps only once the peak is past its rating by this much. */
export const OVERFIRE_MARGIN_C = 10;

export type MoistureFate = 'ok' | 'cracked' | 'exploded';
export type HeatFate = 'ok' | 'slumped';

export interface FiringPlan {
  advance: boolean;
  to: 'bisque' | 'glaze-fired' | null;
  moisture: MoistureFate;
  heat: HeatFate;
  lostIds: string[];
  tempC: number;
}

/** Shown on the stage that is still open after a bad fire, and on the reveal. */
export let lastFiringNote = '';

events.on('piece-change', () => {
  lastFiringNote = '';
});

export function planFiring(piece: PieceState, tempC: number, to: 'bisque' | 'glaze-fired'): FiringPlan {
  const moistureMean = meanMoisture(piece.grid);
  let moisture: MoistureFate = 'ok';
  if (moistureMean > 0.55) moisture = 'exploded';
  else if (moistureMean > 0.12) moisture = 'cracked';

  const expected = to === 'bisque' ? 'bone-dry' : 'glazed';
  const legal = piece.stage === expected && canTransition(piece.stage, to);
  const advance = moisture === 'ok' && legal;
  const clay = getClay(piece.clayTypeId);
  const heat: HeatFate = advance && tempC > clay.maxTempC + OVERFIRE_MARGIN_C ? 'slumped' : 'ok';
  const lostIds = advance ? piece.attachments.filter((attachment) => attachmentWillCrack(attachment)).map((attachment) => attachment.id) : [];
  return { advance, to: advance ? to : null, moisture, heat, lostIds, tempC };
}

export function describeFiring(plan: FiringPlan): string {
  if (plan.moisture === 'exploded') return 'Still wet. The piece exploded in the kiln.';
  if (plan.moisture === 'cracked') return 'Too damp for the kiln. It cracked. Start a new piece.';
  if (plan.heat === 'slumped') return 'Too hot for this clay. It slumped.';
  if (plan.lostIds.length > 0) return 'A join that was not scored and slipped cracked off.';
  return '';
}

/** Bisque fire. Cone 06 is 999°C. */
export function fireBisque(piece: PieceState, tempC = 999): FiringPlan {
  return commitFiring(piece, tempC, 'bisque');
}

/** Glaze fire. Cone 6 is 1222°C. */
export function fireGlaze(piece: PieceState, tempC = 1222): FiringPlan {
  return commitFiring(piece, tempC, 'glaze-fired');
}

export function commitFiring(piece: PieceState, tempC: number, to: 'bisque' | 'glaze-fired'): FiringPlan {
  const plan = planFiring(piece, tempC, to);
  lastFiringNote = describeFiring(plan);
  if (!plan.advance) {
    if (plan.moisture === 'exploded') rupture(piece.grid, 'explode');
    else if (plan.moisture === 'cracked') rupture(piece.grid, 'crack');
    piece.updatedAt = Date.now();
    return plan;
  }
  if (plan.lostIds.length > 0) {
    const lost = new Set(plan.lostIds);
    piece.attachments = piece.attachments.filter((attachment) => !lost.has(attachment.id));
    piece.surfaces = piece.surfaces.filter((surface) => !lost.has(surface.meshId));
  }
  if (plan.heat === 'slumped') slumpInKiln(piece.grid);
  transition(piece, to);
  return plan;
}

function rupture(grid: ClayGrid, kind: 'crack' | 'explode'): void {
  const { rings, segments } = grid;
  if (kind === 'crack') {
    const band = Math.max(1, Math.round(segments * 0.15));
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < band; s++) grid.torn[r * segments + s] = 1;
    }
  } else {
    const start = Math.floor(rings * 0.12);
    for (let r = start; r < rings; r++) {
      const base = r * segments;
      for (let s = 0; s < segments; s++) {
        if ((s + r) % 3 === 0) continue;
        const i = base + s;
        grid.torn[i] = 1;
        const inner = grid.inner[i] ?? 0;
        const outer = grid.outer[i] ?? 0;
        grid.outer[i] = Math.max(0.001, inner * 0.4 + outer * 0.15);
      }
    }
    scaleGaps(grid, Math.floor(rings * 0.2), 0.72);
  }
  grid.failure = 'torn';
  sanitizeGrid(grid);
  touchGrid(grid);
}

/**
 * Hot collapse. Heights are squashed from the foot, then the belly swells.
 * Volume goes back into the radii. A short throwing lump cannot get much
 * shorter than the grid's minimum ring gap, so the belly is the visible slump.
 */
function slumpInKiln(grid: ClayGrid): void {
  const target = volume(grid);
  const foot = grid.y[0] ?? 0;
  for (let r = 1; r < grid.rings; r++) {
    grid.y[r] = foot + (grid.y[r] - foot) * 0.62;
  }
  const n = grid.rings;
  for (let r = 0; r < n; r++) {
    const t = n <= 1 ? 0 : r / (n - 1);
    const belly = Math.exp(-((t - 0.45) ** 2) / 0.02);
    const k = 1 + 0.34 * belly;
    const base = r * grid.segments;
    for (let s = 0; s < grid.segments; s++) {
      const i = base + s;
      grid.outer[i] *= k;
      if (grid.inner[i] > 0.001) grid.inner[i] *= 1 + 0.26 * belly;
    }
  }
  sanitizeGrid(grid);
  const now = volume(grid);
  if (now > 1e-12 && target > 0) scaleRadii(grid, Math.sqrt(target / now));
  sanitizeGrid(grid);
  grid.failure = 'slumped';
  touchGrid(grid);
}
