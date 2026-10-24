import { describe, expect, it } from 'vitest';
import { loadStages, loadTools } from '../src/core/registry';

describe('registries', () => {
  it('discovers tools and stages by file, without a hand-written index', () => {
    expect(loadTools().map((tool) => tool.id)).toEqual(['center', 'open', 'pull', 'press', 'compress', 'wire']);
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
});
