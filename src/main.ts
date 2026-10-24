import './style.css';
import './core/listeners';
import { getClay } from './clay/clays';
import { centeredness, pieceHeight, profileExtent, segmentAtWorldAngle, silhouette } from './clay/grid';
import { evaluateIntegrity } from './clay/integrity';
import { events } from './core/events';
import { vibrate } from './core/haptics';
import { clampWeight, createPiece } from './core/piece';
import { loadStages, loadTools, stageById, toolsFor } from './core/registry';
import { clearPiece, hasSavedPiece, loadPiece, savePiece } from './core/storage';
import type { ClayTypeId, PieceState, Stage, SurfaceHit, Tool, ToolContext, ToolPointer } from './core/types';
import { Vector3 } from 'three';
import { Studio } from './render/studio';
import { stepTrimChips } from './tools/trim-chips';
import { Onboarding } from './ui/onboarding/onboarding';
import { Shell, type ShellModel } from './ui/shell/shell';
import { ViewBar } from './ui/views';
import { Wheel } from './core/wheel';
import { installAudio } from './audio';
import { bindFiringApp } from './firing/kiln';
import { refreshGlazeLook } from './firing/look';
import { bindSurfaceDirty } from './surface/dirty';
import { bindPainter } from './surface/session';

const app = document.querySelector('#app');
if (!(app instanceof HTMLElement)) throw new Error('Missing #app');

const canvas = document.createElement('canvas');
canvas.setAttribute('role', 'application');
canvas.setAttribute(
  'aria-label',
  'Pottery wheel. One finger shapes the clay. Two fingers orbit. Top, three-quarter, and side change how a press acts.',
);
app.append(canvas);

const studio = new Studio(canvas);
const wheel = new Wheel();
const tools = loadTools();
const stages = loadStages();

let piece: PieceState | null = null;
let clayId: ClayTypeId = 'stoneware';
let weightKg = 1;
let activeToolId: string | null = 'center';
let confirmDiscard = false;
let message = '';
let messageUntil = 0;
let saveTimer = 0;
let idleAngle = 0;
let last = performance.now();
const SIM_STEP = 1 / 60;
const MAX_FRAME = 0.25;
let toolDown = false;
let needsDown = false;
let strokeToolId: string | null = null;
let rightOrbit = false;
let orbiting = false;
let wireWarned = false;
let lastHaptic = 0;
let previous: ToolPointer | null = null;
let lastSample: StrokeSample | null = null;
let latest: { x: number; y: number } | null = null;

interface StrokeSample {
  pointer: ToolPointer;
  screen: { x: number; y: number };
  ndc: { x: number; y: number };
  clientX: number;
  clientY: number;
}
const pointers = new Map<number, { x: number; y: number }>();

const shell = new Shell(app, {
  onClay: (id) => {
    clayId = id;
    publish();
  },
  onWeight: (kg) => {
    weightKg = clampWeight(kg);
  },
  onBegin: () => begin(createPiece(clayId, weightKg)),
  onResume: () => {
    const saved = loadPiece();
    if (saved) begin(saved);
  },
  onStart: () => {
    wheel.running = true;
    publish();
  },
  onStop: () => {
    wheel.running = false;
    publish();
  },
  onSpeed: (value) => {
    wheel.speed = clamp01(value);
    if (piece) piece.speedSetting = wheel.speed;
  },
  onTool: (id) => {
    activeToolId = id;
    wireWarned = false;
    publish();
  },
  onAction: (id) => {
    if (!piece) return;
    const stage = currentStage();
    const action = stage?.actions?.find((entry) => entry.id === id);
    if (!action || action.enabled?.({ piece, wheel }) === false) return;
    action.run({ piece, wheel });
    wheel.running = false;
    afterChange();
  },
  onDiscard: () => {
    confirmDiscard = true;
    publish();
  },
  onConfirmDiscard: () => {
    clearPiece();
    piece = null;
    confirmDiscard = false;
    wheel.running = false;
    wheel.omega = 0;
    activeToolId = 'center';
    studio.syncPiece(null);
    publish();
    events.emit('piece-change', { piece: null });
    studio.rig.setPreset('side');
    views.setActive('side');
  },
  onHelp: () => onboarding.replay(),
});

let onboarding: Onboarding;
onboarding = new Onboarding({
  app,
  chrome: shell.chrome,
  stepperSlot: shell.stepperSlot,
  tipSlot: shell.tipSlot,
  tools,
  stages,
  onStep: (id) => {
    if (activeToolId === id) return;
    activeToolId = id;
    publish();
  },
  onLayout: () => resize(),
});

const views = new ViewBar(app, (preset) => {
  studio.rig.setPreset(preset);
  views.setActive(preset);
});
views.setActive(studio.rig.preset);

window.addEventListener('resize', () => resize());
new ResizeObserver(() => resize()).observe(app);
resize();
publish();
installAudio({
  wheel,
  getPiece: () => piece,
  getPointer: () => (toolDown && previous ? previous : null),
  getTool: () => activeToolId,
});
const mute = document.getElementById('pw-mute');
if (mute) shell.topbar.append(mute);
bindSurfaceDirty((meshId) => studio.markSurfaceDirty(meshId));
bindPainter({
  piece: () => piece,
  publish: () => afterChange(),
});
bindFiringApp({
  onChange: (message) => {
    if (message) toast(message);
    afterChange();
  },
});
requestAnimationFrame(frame);

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);
window.addEventListener('keydown', onKey);

function begin(next: PieceState): void {
  piece = next;
  wheel.speed = next.speedSetting;
  wheel.running = false;
  wheel.omega = 0;
  wheel.angle = 1.15;
  confirmDiscard = false;
  activeToolId = next.stage === 'wet' && next.onWheel ? 'center' : null;
  studio.syncPiece(next);
  publish();
  savePiece(next);
  events.emit('piece-change', { piece: next });
}

function frame(now: number): void {
  // A slow frame still advances the wheel. Pressure tools scale with dt, so
  // they run on each fixed step; a pull's drag is the pointer delta and only
  // lands on the step where the finger actually moved.
  const elapsed = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
  last = now;
  const chips = stepTrimChips(elapsed);
  if (!piece) {
    idleAngle += elapsed * 0.55;
    studio.idleSpin(idleAngle);
    studio.showTrimChips(chips);
    studio.render(elapsed);
    events.emit('frame', { dt: elapsed, piece: null });
    requestAnimationFrame(frame);
    return;
  }

  let remaining = elapsed;
  let steps = 0;
  const stroke = toolDown && latest ? measure(latest.x, latest.y) : null;
  const surfaceHit = stroke ? studio.hitTest() : null;
  while (remaining > 1e-5 && steps < 16) {
    const dt = Math.min(SIM_STEP, remaining);
    remaining -= dt;
    steps += 1;
    applyStroke(dt, now, stroke, surfaceHit);
    wheel.step(dt);
  }

  const clay = getClay(piece.clayTypeId);
  if (piece.stage === 'wet') {
    const integrity = evaluateIntegrity(piece.grid, clay, elapsed);
    if (integrity.tore) toast('The wall tore. Too thin for this clay.');
    if (integrity.slumped) toast('The clay slumped — too wet, and too tall.');
  }
  studio.syncPiece(piece);
  refreshGlazeLook(piece);
  studio.spin(wheel.angle, piece.onWheel, elapsed);
  updateCursor();
  studio.showTrimChips(chips);
  studio.render(elapsed);

  saveTimer += elapsed;
  if (saveTimer > 4) {
    saveTimer = 0;
    piece.speedSetting = wheel.speed;
    savePiece(piece);
  }
  if (message && now > messageUntil) {
    message = '';
    publish();
  } else if (piece.onWheel) {
    shell.render(model());
    onboarding.sync(piece);
  }
  events.emit('frame', { dt: elapsed, piece });
  requestAnimationFrame(frame);
}

function applyStroke(dt: number, now: number, sample: StrokeSample | null, surfaceHit: SurfaceHit | null): void {
  const tool = currentTool();
  if (!toolDown || !sample || !tool || !piece) return;
  const wasOnWheel = piece.onWheel;
  const ctx = contextFor(sample, dt, surfaceHit);
  if (!ctx) return;
  if (needsDown) {
    events.emit('stroke-start', { piece, toolId: tool.id });
    strokeToolId = tool.id;
    tool.onPointerDown(ctx);
    vibrate(tool.haptics?.down);
    lastHaptic = now;
    needsDown = false;
  } else {
    tool.onPointerMove(ctx);
    const interval = tool.haptics?.moveIntervalMs ?? 90;
    if (sample.pointer.pressure > 0.2 && tool.haptics?.move && now - lastHaptic > interval) {
      vibrate(tool.haptics.move);
      lastHaptic = now;
    }
  }
  previous = sample.pointer;
  lastSample = sample;
  if (wasOnWheel && !piece.onWheel) {
    wheel.running = false;
    publish();
  }
  if (tool.id === 'wire' && wheel.rpm > 28 && !wireWarned) {
    toast('Let the wheel stop, then draw the wire across the base.');
    wireWarned = true;
  }
}

function updateCursor(): void {
  const toolId = currentTool()?.id ?? '';
  if (!piece || !toolDown || !latest || !toolId) {
    studio.showContact(false, 0, 0, 0);
    studio.showWire(false, 0, 0);
    return;
  }
  if (toolId === 'glaze-brush') {
    studio.showContact(false, 0, 0, 0);
    studio.showWire(false, 0, 0);
    return;
  }
  const sample = previous;
  if (!sample) return;
  if (toolId === 'wire') {
    const edge = silhouette(piece.grid, sample.height, studio.clayPivot.rotation.y, 1);
    studio.showContact(false, 0, 0, 0);
    studio.showWire(true, sample.height, Math.max(0.08, edge * 2.1));
    return;
  }
  const az = studio.rig.azimuthAngle;
  const edge = profileExtent(piece.grid, sample.height, studio.clayPivot.rotation.y, az, sample.side);
  const signed = sample.side * Math.min(sample.radius, Math.max(edge, 0.01));
  const nudge = toolId === 'water' ? 0.018 : 0.014;
  const x = signed * Math.cos(az) + Math.sin(az) * nudge;
  const z = -signed * Math.sin(az) + Math.cos(az) * nudge;
  studio.showContact(true, x, sample.height + studio.clayPivot.position.y, sample.pressure, toolId, z, sample.side);
  studio.showWire(false, 0, 0);
}

function canOrbit(): boolean {
  return Boolean(currentStage()?.allowOrbit);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button === 2) {
    if (canOrbit()) rightOrbit = true;
    return;
  }
  if (event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);
  if (pointers.size >= 2 && canOrbit()) {
    endStroke();
    orbiting = true;
    return;
  }
  if (orbiting || !piece || !currentTool()) return;
  latest = { x: event.clientX, y: event.clientY };
  toolDown = true;
  needsDown = true;
  previous = null;
  lastSample = null;
}

function onPointerMove(event: PointerEvent): void {
  const previousPoint = pointers.get(event.pointerId);
  if (!previousPoint && !rightOrbit) return;
  if (rightOrbit && canOrbit()) {
    studio.rig.orbitBy(event.movementX, event.movementY);
    views.setActive(studio.rig.preset);
    return;
  }
  if (!previousPoint) return;
  const dx = event.clientX - previousPoint.x;
  const dy = event.clientY - previousPoint.y;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (orbiting && pointers.size >= 2) {
    studio.rig.orbitBy(dx, dy);
    views.setActive(studio.rig.preset);
    return;
  }
  if (toolDown && !orbiting) latest = { x: event.clientX, y: event.clientY };
}

function onPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  if (event.button === 2) rightOrbit = false;
  if (pointers.size < 2) orbiting = false;
  if (pointers.size === 0) endStroke();
}

function endStroke(): void {
  const tool = currentTool();
  if (toolDown && piece && tool) {
    let sample = lastSample;
    if (!sample && latest) sample = measure(latest.x, latest.y);
    else if (sample) studio.rig.aimPointer(sample.clientX, sample.clientY, canvas);
    if (sample) {
      const ctx = contextFor(sample, 0.016, studio.hitTest());
      if (ctx) tool.onPointerUp(ctx);
    }
    if (strokeToolId) events.emit('stroke-end', { piece, toolId: strokeToolId });
    piece.speedSetting = wheel.speed;
    savePiece(piece);
    publish();
  }
  strokeToolId = null;
  toolDown = false;
  needsDown = false;
  latest = null;
  previous = null;
  lastSample = null;
  studio.showContact(false, 0, 0, 0);
  studio.showWire(false, 0, 0);
}

function contextFor(sample: StrokeSample, dt: number, surfaceHit: SurfaceHit | null): ToolContext | null {
  if (!piece) return null;
  return {
    piece,
    wheel,
    pointer: sample.pointer,
    previous,
    dt,
    screen: sample.screen,
    ndc: sample.ndc,
    raycaster: studio.rig.pointerRaycaster,
    surfaceHit,
    markSurfaceDirty: (meshId) => studio.markSurfaceDirty(meshId),
    events,
  };
}

function measure(clientX: number, clientY: number): StrokeSample | null {
  if (!piece) return null;
  const aim = studio.rig.aimPointer(clientX, clientY, canvas);
  if (!aim) return null;
  const screen = { x: aim.x, y: aim.y };
  const ndc = { x: aim.ndcX, y: aim.ndcY };
  const point = studio.rig.profilePoint(clientX, clientY, canvas);
  if (!point) {
    if (piece.onWheel) return null;
    return {
      pointer: { radius: 0, height: 0, pressure: 0, side: 1, segment: 0, x: 0, y: 0 },
      screen,
      ndc,
      clientX,
      clientY,
    };
  }
  const side: 1 | -1 = point.x >= 0 ? 1 : -1;
  const radius = Math.abs(point.x);
  const height = point.y - studio.clayPivot.position.y;
  const rotation = studio.clayPivot.rotation.y;
  const azimuth = studio.rig.azimuthAngle;
  const edge = Math.max(0.008, profileExtent(piece.grid, height, rotation, azimuth, side));
  const tool = currentTool();
  let pressure: number;
  if (tool?.id === 'open') {
    const top = piece.grid.y[piece.grid.rings - 1] ?? pieceHeight(piece.grid);
    const depth = top - height;
    pressure = depth > -0.004 && radius < edge * 0.88 ? clamp01(0.3 + Math.max(0, depth) / 0.022) : clamp01((edge * 0.3 - radius) / 0.02);
  } else if (tool?.id === 'wire') {
    pressure = height < 0.025 ? 0.8 : 0.2;
  } else {
    const penetration = edge - radius;
    pressure = penetration >= 0 ? clamp01(penetration / 0.016) : clamp01(1 + penetration / 0.012) * 0.35;
  }
  const worldAngle = azimuth + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
  return {
    pointer: {
      radius,
      height,
      pressure,
      side,
      segment: segmentAtWorldAngle(rotation, worldAngle, piece.grid.segments),
      x: point.x,
      y: height,
    },
    screen,
    ndc,
    clientX,
    clientY,
  };
}

function model(): ShellModel {
  if (!piece) {
    return {
      phase: 'setup',
      clayId,
      weightKg,
      hasSave: hasSavedPiece(),
      saveLabel: saveLabel(loadPiece()),
      title: 'Choose the clay',
      subtitle: 'A wheel, a lump of clay',
      hint: '',
      message: '',
      tools: [],
      activeToolId: null,
      running: false,
      rpm: 0,
      speed: wheel.speed,
      showWheel: false,
      centered: null,
      actions: [],
      confirmDiscard: false,
    };
  }
  const stage = currentStage();
  const available = toolsFor(piece.stage, piece.onWheel, tools);
  const clay = getClay(piece.clayTypeId);
  const centered = piece.stage === 'wet' && piece.onWheel ? centeredness(piece.grid) : null;
  const trueEnough = centered != null && centered > 0.72 && wheel.rpm > 40;
  return {
    phase: 'piece',
    clayId: piece.clayTypeId,
    weightKg: piece.weightKg,
    hasSave: true,
    saveLabel: '',
    title: `${stage?.label ?? piece.stage} · ${piece.weightKg.toFixed(1)} kg`,
    subtitle: trueEnough ? `${clay.name} · running true` : `${clay.name}`,
    hint: stage?.hint({ piece, wheel }) ?? '',
    message,
    tools: available.map((tool) => ({ id: tool.id, label: tool.label })),
    activeToolId: available.some((tool) => tool.id === activeToolId) ? activeToolId : (available[0]?.id ?? null),
    running: wheel.running,
    rpm: wheel.rpm,
    speed: wheel.speed,
    showWheel: piece.onWheel,
    centered,
    actions: (stage?.actions ?? []).map((action) => ({
      id: action.id,
      label: action.label,
      enabled: action.enabled ? action.enabled({ piece: piece as PieceState, wheel }) : true,
    })),
    confirmDiscard,
  };
}

function publish(): void {
  const view = model();
  if (view.phase === 'piece' && view.activeToolId !== activeToolId) activeToolId = view.activeToolId;
  app?.setAttribute('data-stage', piece ? piece.stage : 'setup');
  app?.setAttribute('data-on-wheel', piece?.onWheel ? 'true' : 'false');
  shell.render(view);
  onboarding.sync(piece);
  resize();
}

function currentStage(): Stage | undefined {
  if (!piece) return stageById('setup', stages);
  return stageById(piece.stage, stages);
}

function currentTool(): Tool | undefined {
  if (!piece || !activeToolId) return undefined;
  return toolsFor(piece.stage, piece.onWheel, tools).find((tool) => tool.id === activeToolId);
}

function afterChange(): void {
  if (!piece) return;
  const available = toolsFor(piece.stage, piece.onWheel, tools);
  if (!available.some((tool) => tool.id === activeToolId)) activeToolId = available[0]?.id ?? null;
  confirmDiscard = false;
  studio.syncPiece(piece);
  refreshGlazeLook(piece);
  savePiece(piece);
  publish();
}

function toast(text: string): void {
  if (message === text) return;
  message = text;
  messageUntil = performance.now() + 3600;
  publish();
}

function resize(): void {
  const width = app?.clientWidth ?? window.innerWidth;
  const height = app?.clientHeight ?? window.innerHeight;
  const rect = shell.chrome.getBoundingClientRect();
  if (app instanceof HTMLElement) app.style.setProperty('--chrome-block', `${Math.round(rect.height)}px`);
  // Portrait: the chrome covers the bottom, so the canvas is only the part
  // above it. A centered desktop chrome leaves the sides open and the camera
  // shifts the clay up. Phone landscape docks the chrome on the right; the
  // canvas keeps the strip to its left so the clay stays in reach.
  const sideDock = window.matchMedia('(orientation: landscape) and (max-height: 540px) and (max-width: 980px)').matches;
  if (sideDock) {
    studio.setSize(Math.max(160, Math.round(width - rect.width)), height, 0);
    return;
  }
  const covers = rect.width > width * 0.92;
  const viewH = covers ? Math.max(160, Math.round(height - rect.height)) : height;
  studio.setSize(width, viewH, covers ? 0 : rect.height);
}

function onKey(event: KeyboardEvent): void {
  if (!piece) return;
  if (event.code === 'Space') {
    event.preventDefault();
    wheel.running = !wheel.running;
    publish();
  } else if (event.key === 'Escape') {
    wheel.running = false;
    publish();
  } else if (/^[1-6]$/.test(event.key)) {
    const available = toolsFor(piece.stage, piece.onWheel, tools);
    const tool = available[Number(event.key) - 1];
    if (tool) {
      activeToolId = tool.id;
      publish();
    }
  }
}

function saveLabel(saved: PieceState | null): string {
  if (!saved) return '';
  const clay = getClay(saved.clayTypeId);
  return `${clay.name}, ${saved.weightKg.toFixed(1)} kg`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const projected = new Vector3();

if (import.meta.env.DEV) {
  Object.assign(window, {
    __pottery: {
      centeredness: () => (piece ? centeredness(piece.grid) : 0),
      height: () => (piece ? pieceHeight(piece.grid) : 0),
      innerAt: (t: number) => {
        if (!piece) return 0;
        const ring = Math.min(piece.grid.rings - 1, Math.max(0, Math.round(t * (piece.grid.rings - 1))));
        let sum = 0;
        for (let s = 0; s < piece.grid.segments; s++) sum += piece.grid.inner[ring * piece.grid.segments + s];
        return sum / piece.grid.segments;
      },
      rpm: () => wheel.rpm,
      stage: () => piece?.stage ?? 'setup',
      onWheel: () => Boolean(piece?.onWheel),
      edge: (height: number, side: number) =>
        piece ? silhouette(piece.grid, height, studio.clayPivot.rotation.y, side >= 0 ? 1 : -1) : 0,
      project(x: number, y: number) {
        projected.set(x, y, 0);
        projected.project(studio.rig.camera);
        const rect = canvas.getBoundingClientRect();
        return {
          x: (projected.x * 0.5 + 0.5) * rect.width + rect.left,
          y: (-projected.y * 0.5 + 0.5) * rect.height + rect.top,
        };
      },
    },
  });
}
