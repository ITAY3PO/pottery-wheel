/** One fixed sim step. A restart after idle must not pretend the gap was work. */
export const SIM_STEP = 1 / 60;
/** Long hitch cap while the loop is already running. */
export const MAX_FRAME = 0.25;

export interface FrameStep {
  /** Seconds the wheel and the tools should advance. */
  elapsed: number;
  /** Wall gap for the quality controller. Null skips the sample. */
  sample: number | null;
  lastMs: number;
}

/**
 * Gap since the previous frame.
 * Restarting from idle is one sim step and is not a quality sample: the clock
 * was stopped, so the wall gap is not a hold and not a slow frame.
 */
export function stepFrameClock(nowMs: number, lastMs: number, restarting: boolean): FrameStep {
  if (restarting) {
    return { elapsed: SIM_STEP, sample: null, lastMs: nowMs };
  }
  const raw = Math.max(0, (nowMs - lastMs) / 1000);
  return { elapsed: Math.min(MAX_FRAME, raw), sample: raw, lastMs: nowMs };
}
