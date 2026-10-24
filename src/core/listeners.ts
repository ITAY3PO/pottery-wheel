import { events } from './events';

/**
 * Audio, gallery, and onboarding subscribe from their own files.
 * This module is imported after `events` is initialized, so those files can
 * `import { events }` at the top level without editing `main.ts`.
 */
void events;

export const listenerModules: Record<string, unknown> = import.meta.glob(
  ['../gallery/**/*.ts', '!../gallery/view.ts', '../onboarding/**/*.ts'],
  { eager: true },
);
