import { CLAY_TYPES } from '../clay/clays';
import type { ClayTypeId, PieceState, StageId } from '../core/types';
import { decodeShare, encodeShare, withShareHash, type EncodedShare } from './codec';
import { copyShareText, shareImageFile, sharePageLink } from './share';
import {
  deleteGalleryPiece,
  listGallery,
  loadGalleryPiece,
  saveGalleryPiece,
  type GalleryEntry,
  type GallerySaveResult,
} from './store';
import { createTurntable, type Turntable } from './view';

const STAGE_LABEL: Record<StageId, string> = {
  wet: 'Wet',
  'leather-hard': 'Leather-hard',
  'bone-dry': 'Bone-dry',
  bisque: 'Bisque',
  glazed: 'Glazed',
  'glaze-fired': 'Glaze-fired',
};

type Mode =
  | { kind: 'browse' }
  | { kind: 'share'; piece: PieceState }
  | { kind: 'shared'; piece: PieceState };

export interface GalleryPanel {
  save(piece: PieceState): void;
  share(piece: PieceState): void;
  openShared(hash: string): Promise<void>;
}

export function mountGallery(options: { root: HTMLElement; currentPiece: () => PieceState | null }): GalleryPanel {
  const bar = document.createElement('div');
  bar.className = 'gal-top';
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'gal-fab';
  fab.textContent = 'Gallery';
  bar.append(fab);

  const layer = document.createElement('div');
  layer.className = 'gal-layer';
  layer.hidden = true;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-labelledby', 'gal-title');

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('p');
  caption.className = 'gal-caption';
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  const body = document.createElement('div');
  sheet.append(body);
  layer.append(canvas, caption, sheet);
  options.root.append(bar, layer);
  adoptMuteButton(bar);

  let mode: Mode = { kind: 'browse' };
  let selectedId: string | null = null;
  let status = '';
  let linkUrl = '';
  let linkNote = '';
  let armDeleteId: string | null = null;
  let busy = false;
  let fromHash = false;
  let returnToBrowse = false;
  let turntable: Turntable | null = null;

  const observer = new ResizeObserver(() => turntable?.resize());
  observer.observe(layer);

  fab.addEventListener('click', () => openBrowse());
  window.addEventListener(
    'keydown',
    (event) => {
      if (layer.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  refreshFab();

  function openBrowse(): void {
    mode = { kind: 'browse' };
    returnToBrowse = false;
    linkUrl = '';
    linkNote = '';
    if (!selectedId) selectedId = listGallery()[0]?.id ?? null;
    reveal();
  }

  function save(piece: PieceState): void {
    const result = saveGalleryPiece(piece);
    mode = { kind: 'browse' };
    if (result.ok) selectedId = result.id;
    status = saveMessage(result);
    returnToBrowse = false;
    linkUrl = '';
    linkNote = '';
    armDeleteId = null;
    reveal();
    refreshFab();
  }

  function share(piece: PieceState): void {
    returnToBrowse = mode.kind === 'browse';
    mode = { kind: 'share', piece };
    status = '';
    linkUrl = '';
    linkNote = '';
    reveal();
  }

  async function openShared(hash: string): Promise<void> {
    if (!hash.includes('p1.')) return;
    const piece = await decodeShare(hash);
    fromHash = true;
    if (!piece) {
      mode = { kind: 'browse' };
      status = 'That share link is incomplete. The shelf is here.';
      selectedId = listGallery()[0]?.id ?? null;
    } else {
      mode = { kind: 'shared', piece };
      status = 'A shared pot. Spin it, save it, or send it on.';
    }
    reveal();
  }

  function reveal(): void {
    const opening = layer.hidden;
    layer.hidden = false;
    fab.hidden = true;
    setBackgroundHidden(true);
    if (!turntable) turntable = createTurntable(canvas);
    render();
    present();
    if (opening) {
      const target = body.querySelector('button');
      if (target instanceof HTMLElement) target.focus();
    }
  }

  function close(): void {
    if (returnToBrowse && mode.kind === 'share') {
      openBrowse();
      return;
    }
    if (fromHash) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      fromHash = false;
    }
    layer.hidden = true;
    fab.hidden = false;
    setBackgroundHidden(false);
    turntable?.dispose();
    turntable = null;
    refreshFab();
  }

  function present(): void {
    const piece = activePiece();
    caption.textContent = piece ? `${clayName(piece.clayTypeId)} · ${piece.weightKg.toFixed(1)} kg` : 'Gallery';
    if (selectedId && !piece && mode.kind === 'browse') {
      setStatus('This saved pot is damaged. You can delete it.');
    }
    if (!turntable) return;
    if (piece) turntable.show(piece, () => sheet.offsetHeight);
    else turntable.idle();
  }

  function activePiece(): PieceState | null {
    if (mode.kind === 'share' || mode.kind === 'shared') return mode.piece;
    if (!selectedId) return null;
    return loadGalleryPiece(selectedId);
  }

  function render(): void {
    body.replaceChildren();
    const title = document.createElement('h2');
    title.id = 'gal-title';
    title.textContent = mode.kind === 'browse' ? 'Gallery' : mode.kind === 'shared' ? 'Shared pot' : 'Share this pot';
    body.append(title);

    if (mode.kind === 'browse') renderBrowse();
    else renderOffer();

    const note = document.createElement('p');
    note.className = 'hint';
    note.dataset.status = 'true';
    note.setAttribute('aria-live', 'polite');
    note.textContent = status;
    body.append(note);

    const closeLabel = mode.kind === 'shared' ? 'Back to the wheel' : returnToBrowse && mode.kind === 'share' ? 'Back' : 'Close';
    body.append(textButton(closeLabel, 'linkish', close));
  }

  function renderBrowse(): void {
    const entries = listGallery();
    if (!entries.some((entry) => entry.id === selectedId)) selectedId = entries[0]?.id ?? null;
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lede';
      empty.textContent = 'The shelf is empty. Save a pot and it will wait here.';
      body.append(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'gal-list';
      for (const entry of entries) list.append(row(entry));
      body.append(list);
    }
    const selected = selectedId ? loadGalleryPiece(selectedId) : null;
    const current = options.currentPiece();
    const stack = document.createElement('div');
    stack.className = 'stack';
    if (selected) stack.append(textButton('Share', 'primary', () => share(selected)));
    if (current) stack.append(textButton('Save the pot on the wheel', 'ghost', () => save(current)));
    if (stack.childElementCount) body.append(stack);
  }

  function row(entry: GalleryEntry): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'gal-row';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'gal-pick';
    pick.setAttribute('aria-pressed', entry.id === selectedId ? 'true' : 'false');
    const name = document.createElement('strong');
    name.textContent = `${clayName(entry.clayTypeId)} · ${entry.weightKg.toFixed(1)} kg`;
    const meta = document.createElement('span');
    const when = formatWhen(entry.savedAt);
    meta.textContent = when ? `${stageLabel(entry.stage)} · ${when}` : stageLabel(entry.stage);
    pick.append(name, meta);
    pick.addEventListener('click', () => {
      selectedId = entry.id;
      armDeleteId = null;
      status = '';
      render();
      present();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'gal-delete';
    const armed = armDeleteId === entry.id;
    remove.textContent = armed ? 'Delete?' : 'Delete';
    remove.setAttribute('aria-pressed', armed ? 'true' : 'false');
    remove.setAttribute('aria-label', armed ? `Delete ${name.textContent}` : `Delete ${name.textContent}`);
    remove.addEventListener('click', () => {
      if (armDeleteId !== entry.id) {
        armDeleteId = entry.id;
        render();
        return;
      }
      deleteGalleryPiece(entry.id);
      armDeleteId = null;
      if (selectedId === entry.id) selectedId = listGallery()[0]?.id ?? null;
      status = 'Removed from the gallery.';
      refreshFab();
      render();
      present();
    });
    wrap.append(pick, remove);
    return wrap;
  }

  function renderOffer(): void {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const image = textButton('Share image', 'primary', () => void onShareImage());
    if (!turntable) image.disabled = true;
    actions.append(image, textButton('Share link', 'primary', () => void onShareLink()));
    const stack = document.createElement('div');
    stack.className = 'stack';
    stack.append(actions);
    if (linkUrl) {
      const field = document.createElement('label');
      field.className = 'gal-link';
      const label = document.createElement('span');
      label.textContent = 'Link';
      const input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.value = linkUrl;
      input.setAttribute('aria-label', 'Share link');
      field.append(label, input);
      stack.append(field, textButton('Copy link', 'ghost', () => void copyLink(input)));
    }
    if (linkNote) {
      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent = linkNote;
      stack.append(note);
    }
    if (mode.kind === 'share' || mode.kind === 'shared') {
      const piece = mode.piece;
      stack.append(textButton(mode.kind === 'shared' ? 'Save to my gallery' : 'Save to gallery', 'ghost', () => save(piece)));
    }
    body.append(stack);
  }

  async function onShareImage(): Promise<void> {
    if (!turntable || busy) return;
    busy = true;
    const blob = turntable.snapshotBlob();
    if (!blob) {
      busy = false;
      setStatus('The preview has no image yet. The link still works.');
      return;
    }
    const piece = activePiece();
    const filename = `${clayName(piece?.clayTypeId ?? 'stoneware').toLowerCase().replace(/\s+/g, '-')}-pot.jpg`;
    const outcome = await shareImageFile(blob, filename);
    busy = false;
    if (outcome === 'shared') setStatus('Image sent.');
    else if (outcome === 'downloaded') setStatus('Image downloaded.');
    else if (outcome === 'cancelled') setStatus('');
    else setStatus('The image stayed on this page. The link still works.');
  }

  async function onShareLink(): Promise<void> {
    const piece = activePiece();
    if (!piece || busy) return;
    busy = true;
    setStatus('Making a link…');
    let encoded: EncodedShare | null = null;
    try {
      encoded = await encodeShare(piece);
    } catch {
      encoded = null;
    }
    busy = false;
    if (!encoded) {
      setStatus('A link needs a current browser. The image still works.');
      return;
    }
    linkUrl = withShareHash(window.location.href, encoded.hash);
    linkNote = encoded.oversize
      ? 'This link is long. Some chat apps will drop the end of it.'
      : encoded.degraded
        ? 'The link uses a simpler grid so it stays short enough to send.'
        : '';
    render();
    const outcome = await sharePageLink(linkUrl);
    if (outcome === 'shared') setStatus(joinStatus('Link sent.', linkNote));
    else if (outcome === 'copied') setStatus(joinStatus('Link copied.', linkNote));
    else if (outcome === 'cancelled') setStatus(linkNote);
    else setStatus(joinStatus('Select the link and copy it.', linkNote));
  }

  async function copyLink(input: HTMLInputElement): Promise<void> {
    input.focus();
    input.select();
    const copied = await copyShareText(input.value);
    setStatus(copied ? joinStatus('Link copied.', linkNote) : 'The link is selected.');
  }

  function setStatus(text: string): void {
    status = text;
    const node = body.querySelector('[data-status]');
    if (node) node.textContent = text;
  }

  function setBackgroundHidden(hidden: boolean): void {
    for (const child of options.root.children) {
      if (child === layer || child === bar) continue;
      if (hidden) child.setAttribute('aria-hidden', 'true');
      else child.removeAttribute('aria-hidden');
    }
  }

  function refreshFab(): void {
    const count = listGallery().length;
    fab.setAttribute('aria-label', count === 1 ? 'Open gallery, 1 pot' : `Open gallery, ${count} pots`);
  }

  return { save, share, openShared };
}

/** Keep #pw-mute in the same top-right row as Gallery. Audio may mount it before or after. */
function adoptMuteButton(bar: HTMLElement): void {
  const place = () => {
    const mute = document.querySelector<HTMLButtonElement>('#pw-mute');
    if (mute && mute.parentElement !== bar) bar.append(mute);
  };
  place();
  const root = bar.parentElement;
  if (!root) return;
  const observer = new MutationObserver(place);
  observer.observe(root, { childList: true });
}

function textButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function saveMessage(result: GallerySaveResult): string {
  if (!result.ok && result.reason === 'quota') {
    return 'This browser is out of space for another pot. Delete an older one and save again.';
  }
  if (!result.ok) return 'This browser can’t store a gallery right now.';
  if (result.pruned > 0) return 'Saved. An older pot was removed to make room.';
  if (result.replaced) return 'Updated the saved pot.';
  return 'Saved to your gallery.';
}

function joinStatus(lead: string, note: string): string {
  return note ? `${lead} ${note}` : lead;
}

function clayName(id: string): string {
  return CLAY_TYPES.find((clay) => clay.id === (id as ClayTypeId))?.name ?? 'Clay';
}

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage as StageId] ?? stage;
}

function formatWhen(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ms);
  } catch {
    return '';
  }
}
