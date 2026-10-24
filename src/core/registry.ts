import type { StageId, Tool } from './types';
import { loadTools } from './toolRegistry';
import { toolsFor as filterTools } from './toolsFor';

export { loadStages, stageById } from './stageRegistry';
export { loadTools } from './toolRegistry';

/** Test helper. Passes the eager catalog when a caller does not. */
export function toolsFor(stageId: StageId, onWheel: boolean, tools: readonly Tool[] = loadTools()): Tool[] {
  return filterTools(stageId, onWheel, tools);
}
