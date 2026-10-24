import type { Stage } from './types';

type StageModule = { stage?: Stage };

const stageModules = import.meta.glob('../stages/*.ts', { eager: true }) as Record<string, StageModule>;

/** Every `export const stage` under src/stages, in `order`. */
export function loadStages(): Stage[] {
  const stages: Stage[] = [];
  for (const mod of Object.values(stageModules)) {
    if (mod?.stage) stages.push(mod.stage);
  }
  stages.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return stages;
}

export function stageById(id: string, stages: readonly Stage[] = loadStages()): Stage | undefined {
  return stages.find((stage) => stage.id === id);
}
