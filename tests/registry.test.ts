import { describe, expect, it } from 'vitest';
import { loadStages, loadTools } from '../src/core/registry';

describe('registries', () => {
  it('discovers tools and stages by file, without a hand-written index', () => {
    const ids = loadTools().map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'center',
        'open',
        'pull',
        'press',
        'compress',
        'wire',
        'water',
        'rib',
        'sponge',
        'needle',
        'knife',
        'trim-center',
        'trim-tap',
        'trim-round',
        'trim-square',
        'trim-ribbon',
        'handle',
        'coil',
        'sprig',
        'score',
        'slip',
      ]),
    );
    expect(loadStages().map((stage) => stage.id)).toEqual([
      'setup',
      'wet',
      'leather-hard',
      'bone-dry',
      'bisque',
      'glazed',
      'glaze-fired',
    ]);
  });

  it('keeps two-finger orbit on during the wet throwing stage', () => {
    const wet = loadStages().find((stage) => stage.id === 'wet');
    expect(wet?.allowOrbit).toBe(true);
  });
});
