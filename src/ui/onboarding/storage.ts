/** Remembers that the throwing tutorial was finished or skipped. */
export const ONBOARDING_STORAGE_KEY = 'pottery-wheel:onboarding';

export function isTutorialDone(storage: Storage): boolean {
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markTutorialDone(storage: Storage): void {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, 'done');
  } catch {
    /* private mode and blocked storage still let the tutorial close */
  }
}
