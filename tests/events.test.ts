import { describe, expect, it } from 'vitest';
import { events } from '../src/core/events';
import { createPiece } from '../src/core/piece';
import { removeFromWheel, skipDrying } from '../src/core/stateMachine';

describe('studio events', () => {
  it('emits wire-cut and stage-change from the lifecycle', () => {
    const stages: string[] = [];
    const wires: number[] = [];
    const stopStage = events.on('stage-change', ({ from, to }) => {
      stages.push(`${from}->${to}`);
    });
    const stopWire = events.on('wire-cut', () => {
      wires.push(1);
    });
    try {
      const piece = createPiece('stoneware', 1);
      removeFromWheel(piece);
      expect(wires).toEqual([1]);
      removeFromWheel(piece);
      expect(wires).toEqual([1]);
      expect(skipDrying(piece)).toBe(true);
      expect(stages).toEqual(['wet->leather-hard']);
    } finally {
      stopStage();
      stopWire();
    }
  });

  it('stops delivering after unsubscribe', () => {
    const seen: number[] = [];
    const stop = events.on('frame', ({ dt }) => {
      seen.push(dt);
    });
    events.emit('frame', { dt: 0.016, piece: null });
    stop();
    events.emit('frame', { dt: 1, piece: null });
    expect(seen).toEqual([0.016]);
  });
});
