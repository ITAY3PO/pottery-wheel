export type ShareOutcome = 'shared' | 'downloaded' | 'copied' | 'cancelled' | 'failed';

export async function shareImageFile(blob: Blob, filename: string): Promise<ShareOutcome> {
  const type = blob.type || 'image/jpeg';
  const file = new File([blob], filename, { type });
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: 'A pot from the wheel', text: 'Thrown on The Wheel.' });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
    }
  }
  return downloadBlob(blob, filename) ? 'downloaded' : 'failed';
}

export async function sharePageLink(url: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'A pot from the wheel', text: 'Look at this pot.', url });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    // Fall through to a manual copy field in the sheet.
  }
  return 'failed';
}

export async function copyShareText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch {
    return false;
  }
}

function canShareFiles(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}
