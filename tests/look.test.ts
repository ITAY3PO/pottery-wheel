import { describe, expect, it } from 'vitest';
import { createClayMaterial } from '../src/render/materials';
import { dressAttachmentMaterial, glazeBreakAmount } from '../src/firing/look';
import { getGlaze } from '../src/surface/catalog';

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('fired look', () => {
  it('keeps a full tenmoku coat near-black and breaks only where the coat is thin', () => {
    const tenmoku = getGlaze(4);
    expect(luminance(tenmoku.fired)).toBeLessThan(30);
    expect(tenmoku.fired.toLowerCase()).toBe('#1a120c');
    expect(luminance(tenmoku.breakColor)).toBeGreaterThan(luminance(tenmoku.fired) + 40);
    expect(glazeBreakAmount(0.32, tenmoku.break, 1)).toBeLessThan(0.05);
    expect(glazeBreakAmount(0.05, tenmoku.break, 1)).toBeGreaterThan(0.75);
  });

  it('keeps an attachment material dielectric clay, not chrome', () => {
    const handle = createClayMaterial();
    handle.metalness = 1;
    handle.vertexColors = true;
    handle.clearcoat = 0.9;
    handle.envMapIntensity = 0.95;
    handle.sheen = 0.2;
    dressAttachmentMaterial(handle);
    expect(handle.metalness).toBe(0);
    expect(handle.vertexColors).toBe(false);
    expect(handle.sheen).toBe(0);
    expect(handle.clearcoat).toBeLessThanOrEqual(0.4);
    expect(handle.envMapIntensity).toBeLessThanOrEqual(0.4);
  });
});
