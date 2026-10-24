import { describe, expect, it } from 'vitest';
import { MAX_FRAME, SIM_STEP, stepFrameClock } from '../src/core/frameClock';

describe('frame clock', () => {
  it('treats the first frame after idle as one sim step and skips quality', () => {
    const last = 1_000;
    const now = last + 2_000;
    const step = stepFrameClock(now, last, true);
    expect(step.elapsed).toBe(SIM_STEP);
    expect(step.elapsed).toBeLessThan(0.02);
    expect(step.sample).toBeNull();
    expect(step.lastMs).toBe(now);
    expect(step.elapsed).not.toBe(MAX_FRAME);
  });

  it('keeps a running hitch clamped, and still reports it', () => {
    const step = stepFrameClock(5_000, 4_600, false);
    expect(step.elapsed).toBe(MAX_FRAME);
    expect(step.sample).toBeCloseTo(0.4);
    expect(step.lastMs).toBe(5_000);
  });
});
