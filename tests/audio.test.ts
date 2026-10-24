import { describe, expect, it } from 'vitest';
import { installAudio, muteControl } from '../src/audio/bind';
import { events } from '../src/core/events';
import {
  MUTE_STORAGE_KEY,
  createAudio,
  squishCenter,
  squishLevel,
  wheelFundamental,
  wheelLevel,
  wheelWind,
} from '../src/audio/engine';
import type { Audio, SoundId } from '../src/audio/types';
import { createPiece } from '../src/core/piece';
import type { PieceState } from '../src/core/types';
import { Wheel } from '../src/core/wheel';
import { MockContext, lastTarget, memoryStorage, type MockParam } from './mockAudio';

function rig(options?: { now?: () => number; storage?: Storage }) {
  const ctx = new MockContext();
  const storage = options?.storage ?? memoryStorage();
  const engine = createAudio({
    storage,
    now: options?.now,
    createContext: () => ctx as unknown as AudioContext,
  });
  return { ctx, engine, storage };
}

function gainTargets(ctx: MockContext): MockParam[] {
  return ctx.gains.map((gain) => gain.gain).filter((param) => lastTarget(param));
}

describe('audio levels', () => {
  it('winds the motor up faster than it winds down', () => {
    expect(wheelWind(true).frequency).toBeLessThan(wheelWind(false).frequency);
    expect(wheelWind(true).gain).toBeLessThan(wheelWind(false).gain);
    expect(wheelFundamental(1)).toBeGreaterThan(wheelFundamental(0));
    expect(wheelLevel(0)).toBeLessThan(wheelLevel(1));
  });

  it('makes the squish follow pressure and moisture', () => {
    expect(squishLevel(1, 1)).toBeCloseTo(squishLevel(0.5, 0.5) * 4);
    expect(squishLevel(1, 0)).toBe(0);
    expect(squishLevel(0, 1)).toBe(0);
    expect(squishCenter(1)).toBeLessThan(squishCenter(0.2));
  });
});

describe('synthesized audio', () => {
  it('does nothing dangerous when the platform has no AudioContext', () => {
    const engine = createAudio({
      storage: memoryStorage(),
      createContext: () => null,
    });
    expect(() => {
      engine.setWheel(1);
      engine.setContact(1, 1);
      engine.play('wire');
      engine.play('splash');
      engine.play('kilnDoor');
      engine.play('kilnLoop');
      engine.play('ting');
      engine.stop('kilnLoop');
      engine.unlock();
      engine.play('kilnLoop');
      engine.stop('kilnLoop');
      engine.setMuted(true);
      engine.setMuted(false);
    }).not.toThrow();
  });

  it('swallows a context constructor that throws', () => {
    const engine = createAudio({
      storage: memoryStorage(),
      createContext: () => {
        throw new Error('AudioContext blocked');
      },
    });
    expect(() => {
      engine.play('wire');
      engine.unlock();
      engine.setWheel(1);
      engine.play('ting');
    }).not.toThrow();
  });

  it('stays quiet until unlock, then plays a wire that was requested early', () => {
    const { ctx, engine } = rig();
    engine.play('wire');
    engine.setWheel(1);
    expect(ctx.oscillators).toHaveLength(0);
    engine.unlock();
    expect(ctx.state).toBe('running');
    expect(ctx.filters.some((filter) => filter.type === 'highpass')).toBe(true);
    const hum = ctx.oscillators.find(
      (osc) => lastTarget(osc.frequency)?.timeConstant === wheelWind(true).frequency && osc.type === 'triangle',
    );
    expect(hum?.started).toBe(true);
    expect(lastTarget(hum?.frequency)?.value).toBeCloseTo(wheelFundamental(1));
  });

  it('limits one-shots queued before unlock', () => {
    const { ctx, engine } = rig();
    for (let i = 0; i < 6; i++) engine.play('wire');
    engine.unlock();
    expect(ctx.oscillators).toHaveLength(4);
  });

  it('ramps the hum down more slowly than it ramps up, then stops the motor', () => {
    let now = 1_000;
    const { ctx, engine } = rig({ now: () => now });
    engine.unlock();
    engine.setWheel(1);
    const hum = ctx.oscillators[0];
    const up = lastTarget(hum?.frequency);
    expect(up?.timeConstant).toBe(wheelWind(true).frequency);
    const upGain = gainTargets(ctx).map((param) => lastTarget(param));
    expect(upGain.some((event) => event?.timeConstant === wheelWind(true).gain)).toBe(true);

    engine.setWheel(0);
    const down = lastTarget(hum?.frequency);
    expect(down?.value).toBeCloseTo(wheelFundamental(0));
    expect(down?.timeConstant).toBe(wheelWind(false).frequency);
    expect(down?.timeConstant ?? 0).toBeGreaterThan(up?.timeConstant ?? 1);
    expect(hum?.stopped).toBe(false);

    now += 3_200;
    engine.setWheel(0);
    expect(hum?.stopped).toBe(true);
    expect(ctx.sources.every((source) => source.stopped)).toBe(true);
  });

  it('keeps a looping squish in proportion to pressure and moisture', () => {
    const { ctx, engine } = rig();
    engine.unlock();
    engine.setContact(1, 0);
    engine.setContact(0, 1);
    expect(ctx.filters.some((filter) => filter.type === 'bandpass')).toBe(false);

    engine.setContact(1, 1);
    const band = ctx.filters.find((filter) => filter.type === 'bandpass');
    expect(band).toBeDefined();
    expect(lastTarget(band?.frequency)?.value).toBeCloseTo(squishCenter(1));
    expect(gainTargets(ctx).some((param) => lastTarget(param)?.value === squishLevel(1, 1))).toBe(true);
    expect(ctx.sources.some((source) => source.loop && source.started)).toBe(true);

    engine.setContact(0.5, 0.5);
    expect(gainTargets(ctx).some((param) => Math.abs((lastTarget(param)?.value ?? 0) - squishLevel(0.5, 0.5)) < 1e-6)).toBe(true);

    engine.setContact(1, 0.2);
    expect(lastTarget(band?.frequency)?.value).toBeCloseTo(squishCenter(0.2));
    expect(squishCenter(0.2)).toBeGreaterThan(squishCenter(1));

    engine.setContact(0, 1);
    expect(gainTargets(ctx).some((param) => (lastTarget(param)?.value ?? 1) <= 0.001)).toBe(true);
  });

  it('plays splash, kiln door, and ting as short voices', () => {
    const { ctx, engine } = rig();
    engine.unlock();
    engine.play('splash');
    engine.play('kilnDoor');
    engine.play('ting');
    expect(ctx.filters.some((filter) => filter.type === 'lowpass')).toBe(true);
    expect(ctx.filters.some((filter) => filter.type === 'bandpass')).toBe(true);
    expect(ctx.oscillators.filter((osc) => osc.type === 'sine').length).toBeGreaterThanOrEqual(4);
    expect(ctx.oscillators.every((osc) => osc.started && osc.stopTime > 0)).toBe(true);
    expect(ctx.sources.every((source) => !source.loop && source.started)).toBe(true);
  });

  it('latches the kiln roar across unlock and ignores a second play', () => {
    const { ctx, engine } = rig();
    engine.play('kilnDoor');
    engine.play('kilnLoop');
    engine.play('ting');
    engine.stop('kilnLoop');
    engine.unlock();
    expect(ctx.sources.filter((source) => source.loop)).toHaveLength(0);

    engine.play('kilnLoop');
    engine.play('kilnLoop');
    const loops = ctx.sources.filter((source) => source.loop);
    expect(loops).toHaveLength(1);
    expect(loops[0]?.started).toBe(true);
    expect(loops[0]?.stopped).toBe(false);
    engine.stop('kilnLoop');
    expect(loops[0]?.stopped).toBe(true);
    engine.stop('kilnLoop');
    engine.play('kilnLoop');
    expect(ctx.sources.filter((source) => source.loop && !source.stopped)).toHaveLength(1);
  });

  it('saves mute, skips one-shots while muted, and resumes a latched kiln', () => {
    let built = 0;
    const ctx = new MockContext();
    const storage = memoryStorage({ [MUTE_STORAGE_KEY]: '1' });
    const engine = createAudio({
      storage,
      createContext: () => {
        built += 1;
        return ctx as unknown as AudioContext;
      },
    });
    expect(engine.muted).toBe(true);
    engine.play('ting');
    engine.play('kilnLoop');
    engine.unlock();
    expect(built).toBe(0);

    engine.setMuted(false);
    expect(storage.getItem(MUTE_STORAGE_KEY)).toBe('0');
    expect(built).toBe(1);
    expect(ctx.state).toBe('running');
    expect(ctx.gains[0]?.gain.value).toBeCloseTo(0.8);
    expect(ctx.sources.filter((source) => source.loop)).toHaveLength(1);
    expect(ctx.oscillators.some((osc) => osc.frequency.value === 1760)).toBe(false);

    engine.play('ting');
    expect(ctx.oscillators.some((osc) => osc.frequency.value === 1760)).toBe(true);

    const count = ctx.oscillators.length;
    engine.setMuted(true);
    expect(storage.getItem(MUTE_STORAGE_KEY)).toBe('1');
    expect(ctx.state).toBe('suspended');
    expect(ctx.gains[0]?.gain.value).toBe(0);
    engine.play('splash');
    expect(ctx.oscillators).toHaveLength(count);

    engine.setMuted(false);
    expect(ctx.state).toBe('running');
    expect(ctx.sources.filter((source) => source.loop && !source.stopped)).toHaveLength(1);
  });

  it('forgets one-shots queued before mute', () => {
    const { ctx, engine } = rig();
    engine.play('ting');
    engine.setMuted(true);
    engine.setMuted(false);
    engine.unlock();
    expect(ctx.oscillators.some((osc) => osc.frequency.value === 1760)).toBe(false);
  });

  it('ignores non-finite wheel and contact values', () => {
    const { ctx, engine } = rig();
    engine.unlock();
    engine.setWheel(Number.NaN);
    engine.setContact(Number.POSITIVE_INFINITY, 1);
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.sources).toHaveLength(0);
    engine.setWheel(2);
    expect(lastTarget(ctx.oscillators[0]?.frequency)?.value).toBeCloseTo(wheelFundamental(1));
  });
});

describe('wheel wiring', () => {
  function follow(piece: PieceState | null = createPiece('stoneware', 1)) {
    const wheel = new Wheel();
    let current = piece;
    let pointer: { pressure: number; height: number } | null = null;
    let tool: () => string | null = () => null;
    const events: string[] = [];
    const bus: Audio = {
      unlock() {
        events.push('unlock');
      },
      setWheel(speed) {
        events.push(`wheel:${speed}`);
      },
      setContact(pressure, moisture) {
        events.push(`contact:${pressure}:${moisture}`);
      },
      play(id: SoundId) {
        events.push(`play:${id}`);
      },
      stop() {
        events.push('stop');
      },
      setMuted(muted) {
        events.push(`muted:${muted}`);
      },
    };
    const binding = installAudio(
      {
        wheel,
        getPiece: () => current,
        getPointer: () => pointer,
        getTool: () => tool(),
      },
      bus,
    );
    return {
      wheel,
      events,
      binding,
      piece: () => current,
      setPiece(next: PieceState | null) {
        current = next;
      },
      setPointer(next: { pressure: number; height: number } | null) {
        pointer = next;
      },
      setTool(next: () => string | null) {
        tool = next;
      },
    };
  }

  it('reports normalized wheel speed and the moisture under the hand', () => {
    const live = follow();
    const piece = live.piece();
    expect(piece).not.toBeNull();
    if (!piece) return;
    live.wheel.omega = live.wheel.maxOmega / 2;
    piece.grid.moisture.fill(0.15);
    piece.grid.moisture[20] = 0.83;
    live.setPointer({ pressure: 0.7, height: piece.grid.y[20] ?? 0 });
    live.binding.tick();
    expect(live.events.at(-2)).toBe('wheel:0.5');
    expect(live.events.at(-1)).toBe(`contact:0.7:${piece.grid.moisture[20]}`);

    live.wheel.omega = -live.wheel.maxOmega * 4;
    live.setPointer(null);
    live.binding.tick();
    expect(live.events.at(-2)).toBe('wheel:1');
    expect(live.events.at(-1)).toBe('contact:0:0');
  });

  it('plays the wire once when a wet piece leaves the wheel', () => {
    const live = follow();
    const piece = live.piece();
    if (!piece) return;
    live.binding.tick();
    expect(live.events.some((event) => event === 'play:wire')).toBe(false);
    piece.onWheel = false;
    live.binding.tick();
    live.binding.tick();
    expect(live.events.filter((event) => event === 'play:wire')).toHaveLength(1);
  });

  it('does not treat discard, drying, or a piece that loaded off the wheel as a cut', () => {
    const cut = follow();
    const piece = cut.piece();
    if (!piece) return;
    cut.binding.tick();
    cut.setPiece(null);
    cut.binding.tick();
    expect(cut.events.some((event) => event === 'play:wire')).toBe(false);

    const drying = follow();
    const wet = drying.piece();
    if (!wet) return;
    wet.onWheel = false;
    drying.binding.tick();
    wet.stage = 'leather-hard';
    drying.binding.tick();
    expect(drying.events.some((event) => event === 'play:wire')).toBe(false);

    const resumed = createPiece('stoneware', 1);
    resumed.onWheel = false;
    const loaded = follow(resumed);
    loaded.binding.tick();
    expect(loaded.events.some((event) => event === 'play:wire')).toBe(false);

    const leather = createPiece('stoneware', 1);
    leather.stage = 'leather-hard';
    const trim = follow(leather);
    trim.binding.tick();
    leather.onWheel = false;
    trim.binding.tick();
    expect(trim.events.some((event) => event === 'play:wire')).toBe(false);
  });

  it('splashes once per water stroke and stays quiet for the wire', () => {
    const live = follow();
    const piece = live.piece();
    if (!piece) throw new Error('expected a piece');
    let tool: string | null = 'water';
    live.setTool(() => tool);
    piece.grid.moisture.fill(0.9);
    live.setPointer({ pressure: 0.8, height: piece.grid.y[8] ?? 0 });
    live.binding.tick();
    live.binding.tick();
    expect(live.events.filter((event) => event === 'play:splash')).toHaveLength(1);
    expect(live.events.some((event) => event.startsWith('contact:0.8:'))).toBe(true);

    live.setPointer(null);
    live.binding.tick();
    tool = 'wire';
    live.setPointer({ pressure: 0.8, height: piece.grid.y[2] ?? 0 });
    live.binding.tick();
    expect(live.events.filter((event) => event === 'play:splash')).toHaveLength(1);
    expect(live.events.at(-1)).toBe('contact:0:0');
  });

  it('samples on the frame event and plays a wire cut once', () => {
    const live = follow();
    const piece = live.piece();
    if (!piece) throw new Error('expected a piece');
    live.binding.start();
    try {
      live.wheel.omega = live.wheel.maxOmega;
      events.emit('frame', { dt: 0.016, piece });
      expect(live.events.at(-2)).toBe('wheel:1');

      piece.onWheel = false;
      events.emit('wire-cut', { piece });
      events.emit('frame', { dt: 0.016, piece });
      expect(live.events.filter((event) => event === 'play:wire')).toHaveLength(1);

      piece.stage = 'leather-hard';
      events.emit('stage-change', { piece, from: 'wet', to: 'leather-hard' });
      events.emit('frame', { dt: 0.016, piece });
      expect(live.events.filter((event) => event === 'play:wire')).toHaveLength(1);
    } finally {
      live.binding.stop();
    }
  });

  it('splashes again on the next stroke without waiting for the pointer to lift', () => {
    const live = follow();
    const piece = live.piece();
    if (!piece) throw new Error('expected a piece');
    live.setTool(() => 'water');
    piece.grid.moisture.fill(0.9);
    live.setPointer({ pressure: 0.8, height: piece.grid.y[8] ?? 0 });
    live.binding.start();
    try {
      events.emit('stroke-start', { piece, toolId: 'water' });
      events.emit('frame', { dt: 0.016, piece });
      events.emit('frame', { dt: 0.016, piece });
      expect(live.events.filter((event) => event === 'play:splash')).toHaveLength(1);
      events.emit('stroke-end', { piece, toolId: 'water' });
      events.emit('stroke-start', { piece, toolId: 'water' });
      events.emit('frame', { dt: 0.016, piece });
      expect(live.events.filter((event) => event === 'play:splash')).toHaveLength(2);
    } finally {
      live.binding.stop();
    }
  });

  it('names the mute control from the saved preference', () => {
    expect(muteControl(false)).toEqual({ pressed: false, label: 'Mute sound', text: 'Sound' });
    expect(muteControl(true)).toEqual({ pressed: true, label: 'Unmute sound', text: 'Muted' });
  });
});
