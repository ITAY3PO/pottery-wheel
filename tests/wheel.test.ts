import { describe, expect, it } from 'vitest';
import { Wheel } from '../src/core/wheel';

describe('wheel physics', () => {
  it('spins up toward the speed knob and bogs down under tool drag', () => {
    const wheel = new Wheel();
    wheel.running = true;
    wheel.speed = 1;
    for (let i = 0; i < 240; i++) wheel.step(1 / 60);
    const fast = wheel.omega;
    expect(fast).toBeGreaterThan(wheel.maxOmega * 0.75);
    expect(wheel.angle).not.toBe(0);
    for (let i = 0; i < 150; i++) {
      wheel.addDrag(1);
      wheel.step(1 / 60);
    }
    expect(wheel.omega).toBeLessThan(fast * 0.7);
    expect(wheel.omega).toBeGreaterThan(2);
  });

  it('coasts to a stop when the motor is off', () => {
    const wheel = new Wheel();
    wheel.running = true;
    wheel.speed = 0.8;
    for (let i = 0; i < 180; i++) wheel.step(1 / 60);
    wheel.running = false;
    for (let i = 0; i < 400; i++) wheel.step(1 / 60);
    expect(wheel.omega).toBe(0);
  });
});
