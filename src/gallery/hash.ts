/**
 * Opens a share hash on first load and again whenever the hash changes,
 * so a link pasted into an already-open tab reaches the shelf.
 */
export function bindShareHash(
  target: { addEventListener(type: 'hashchange', listener: () => void): void },
  readHash: () => string,
  open: (hash: string) => void,
): void {
  const sync = () => {
    const hash = readHash();
    if (hash.includes('p1.')) open(hash);
  };
  sync();
  target.addEventListener('hashchange', sync);
}
