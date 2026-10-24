export function vibrate(pattern: number | number[] | undefined): void {
  if (pattern == null || typeof navigator === 'undefined') return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw when vibration is blocked.
  }
}
