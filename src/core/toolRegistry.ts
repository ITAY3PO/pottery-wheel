import type { Tool } from './types';

type ToolModule = { tool?: Tool };

const toolModules = import.meta.glob('../tools/*.ts', { eager: true }) as Record<string, ToolModule>;

function byOrder(a: Tool, b: Tool): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

/** Every `export const tool` under src/tools, in `order`. Eager for unit tests. */
export function loadTools(): Tool[] {
  const tools: Tool[] = [];
  for (const mod of Object.values(toolModules)) {
    if (mod?.tool) tools.push(mod.tool);
  }
  tools.sort(byOrder);
  return tools;
}
