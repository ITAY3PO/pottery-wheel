import { describe, expect, it } from 'vitest';
import { loadStages, loadTools } from '../src/core/registry';

describe('registries', () => {
  it('discovers tools and stages by file, without a hand-written index', () => {
    const ids = loadTools().map((tool) => tool.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(ids).toEqual(expect.arrayContaining(['center', 'open', 'pull', 'press', 'compress', 'wire']));
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
