import type { StageId, Tool } from './types';

export function toolsFor(stageId: StageId, onWheel: boolean, tools: readonly Tool[]): Tool[] {
  return tools.filter((tool) => {
    if (!tool.allowedStages.includes(stageId)) return false;
    if (tool.requiresWheel && !onWheel) return false;
    // Hand-building sets this so its chips stay off the wheel, where trimming lives.
    if (onWheel && (tool as Tool & { offWheel?: boolean }).offWheel) return false;
    return true;
  });
}
