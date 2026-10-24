import { beforeEach, describe, expect, it } from 'vitest';
import { currentProfile, noteFrame, resetQualityForTests, setQualityMode } from '../src/render/quality';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('adaptive quality', () => {
  beforeEach(() => {
    resetQualityForTests({ dpr: 2.625, coarse: true, storage: memory() });
  });

  it('starts a phone on medium, without shadows', () => {
    const profile = currentProfile();
    expect(profile.mode).toBe('auto');
    expect(profile.level).toBe('medium');
    expect(profile.pixelRatio).toBe(1.25);
    expect(profile.shadows).toBe(false);
    expect(profile.maxRings).toBe(120);
    expect(profile.maxSegments).toBe(48);
  });

  it('steps a fast phone up to full mesh and then shadows', () => {
    for (let i = 0; i < 40; i++) noteFrame(0.008);
    let sawFull = false;
    for (let i = 0; i < 800; i++) {
      noteFrame(0.008);
      const profile = currentProfile();
      if (profile.maxRings > 1000) sawFull = true;
      if (profile.shadows) break;
    }
    const profile = currentProfile();
    expect(sawFull).toBe(true);
    expect(profile.shadows).toBe(true);
    expect(profile.pixelRatio).toBe(2);
    expect(profile.level).toBe('high');
  });

  it('steps down when frames stay slower than 60fps', () => {
    for (let i = 0; i < 40; i++) noteFrame(0.016);
    for (let i = 0; i < 30; i++) noteFrame(0.03);
    const profile = currentProfile();
    expect(profile.level).toBe('low');
    expect(profile.pixelRatio).toBe(1);
    expect(profile.maxRings).toBe(80);
    expect(profile.shadows).toBe(false);
  });

  it('keeps a manual high setting while frames are slow', () => {
    const profile = setQualityMode('high');
    expect(profile.shadows).toBe(true);
    expect(profile.pixelRatio).toBe(2);
    for (let i = 0; i < 80; i++) noteFrame(0.04);
    expect(currentProfile().shadows).toBe(true);
    expect(currentProfile().pixelRatio).toBe(2);
    expect(currentProfile().mode).toBe('high');
  });

  it('remembers the manual override', () => {
    const store = memory();
    resetQualityForTests({ dpr: 2, coarse: false, storage: store });
    setQualityMode('low');
    resetQualityForTests({ dpr: 2, coarse: false, storage: store });
    expect(currentProfile().mode).toBe('low');
    expect(currentProfile().level).toBe('low');
  });
});
