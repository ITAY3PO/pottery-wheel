import type { Stage, StageId, Tool } from './types';

type ToolModule = { tool?: Tool };
type StageModule = { stage?: Stage };

const toolModules = import.meta.glob('../tools/*.ts', { eager: true }) as Record<string, ToolModule>;
const stageModules = import.meta.glob('../stages/*.ts', { eager: true }) as Record<string, StageModule>;

/** Every `export const tool` under src/tools, in `order`. */
export function loadTools(): Tool[] {
  const tools: Tool[] = [];
  for (const mod of Object.values(toolModules)) {
    if (mod?.tool) tools.push(mod.tool);
  }
  tools.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return tools;
}

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

export function toolsFor(stageId: StageId, onWheel: boolean, tools: readonly Tool[] = loadTools()): Tool[] {
  return tools.filter((tool) => tool.allowedStages.includes(stageId) && (!tool.requiresWheel || onWheel));
}
