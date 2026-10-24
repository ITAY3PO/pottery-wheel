import { describe, expect, it } from 'vitest';
import { createPiece } from '../src/core/piece';
import { loadStages, loadTools, toolsFor } from '../src/core/registry';
import {
  canAttachHandle,
  canThrow,
  canTransition,
  canTrim,
  nextStage,
  removeFromWheel,
  remountOnWheel,
  skipDrying,
  transition,
} from '../src/core/stateMachine';
import type { Attachment, AttachmentKind, PieceState } from '../src/core/types';
import { writeJoin } from '../src/handbuild/join';
import { buildJourney, journeyReason, journeyStatus } from '../src/ui/onboarding/journey';
import { isTutorialDone, markTutorialDone, ONBOARDING_STORAGE_KEY } from '../src/ui/onboarding/storage';
import { coachTip } from '../src/ui/onboarding/tips';
import { tutorialSteps } from '../src/ui/onboarding/tutorial';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function step(piece: PieceState | null, id: string) {
  const found = buildJourney(piece).steps.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
}

function evenOut(piece: PieceState): void {
  const grid = piece.grid;
  for (let ring = 0; ring < grid.rings; ring++) {
    let sum = 0;
    for (let segment = 0; segment < grid.segments; segment++) sum += grid.outer[ring * grid.segments + segment];
    const mean = sum / grid.segments;
    for (let segment = 0; segment < grid.segments; segment++) grid.outer[ring * grid.segments + segment] = mean;
  }
}

function drawn(kind: AttachmentKind, id: string): Attachment {
  return {
    id,
    kind,
    joinBlend: 0.14,
    tubularSegments: 8,
    radialSegments: 6,
    points: [
      { x: 0.04, y: 0.03, z: 0, radius: 0.005 },
      { x: 0.06, y: 0.06, z: 0, radius: 0.005 },
    ],
  };
}

function openWell(piece: PieceState): void {
  const grid = piece.grid;
  const start = Math.floor(grid.rings * 0.4);
  for (let ring = start; ring < grid.rings; ring++) {
    for (let segment = 0; segment < grid.segments; segment++) {
      grid.inner[ring * grid.segments + segment] = 0.02;
    }
  }
}

describe('journey stepper', () => {
  it('names the mug path in order and always has one current step', () => {
    const steps = buildJourney(null).steps;
    expect(steps.map((entry) => entry.label)).toEqual([
      'Throw',
      'Trim',
      'Handle',
      'Wax & glaze',
      'Fire',
      'Gallery',
    ]);
    expect(steps.filter((entry) => entry.place === 'current')).toHaveLength(1);
    expect(steps.every((entry) => entry.allowed === false)).toBe(true);
    expect(step(null, 'throw').place).toBe('current');
    expect(journeyStatus(step(null, 'throw'))).toBe('now');
  });

  it('follows canThrow, canTrim, and canAttachHandle', () => {
    const wet = createPiece('stoneware', 1);
    expect(step(wet, 'throw')).toMatchObject({ place: 'current', allowed: canThrow(wet) });
    expect(step(wet, 'trim').allowed).toBe(canTrim(wet));
    expect(step(wet, 'handle').allowed).toBe(canAttachHandle(wet));
    expect(canThrow(wet)).toBe(true);

    removeFromWheel(wet);
    expect(canThrow(wet)).toBe(false);
    expect(step(wet, 'throw')).toMatchObject({ place: 'current', allowed: false });
    expect(step(wet, 'trim').place).toBe('pending');

    skipDrying(wet);
    expect(wet.stage).toBe('leather-hard');
    expect(step(wet, 'throw').place).toBe('done');
    expect(step(wet, 'handle')).toMatchObject({ place: 'current', allowed: canAttachHandle(wet) });
    expect(step(wet, 'trim')).toMatchObject({ place: 'pending', allowed: false });
    expect(canTrim(wet)).toBe(false);

    expect(remountOnWheel(wet)).toBe(true);
    expect(step(wet, 'trim')).toMatchObject({ place: 'current', allowed: canTrim(wet) });
    expect(step(wet, 'handle')).toMatchObject({ place: 'pending', allowed: canAttachHandle(wet) });
    expect(step(wet, 'handle').reason).toMatch(/Take it off the wheel to draw a handle/);
    expect(journeyStatus(step(wet, 'trim'))).toBe('now, ready');
  });

  it('follows score and slip on the Handle step once the piece is off the wheel', () => {
    const piece = createPiece('stoneware', 1);
    skipDrying(piece);
    const shown = toolsFor(piece.stage, piece.onWheel, loadTools()).map((tool) => tool.id);
    expect(shown).toEqual(expect.arrayContaining(['handle', 'score', 'slip']));
    expect(toolsFor(piece.stage, true, loadTools()).some((tool) => tool.id === 'handle')).toBe(false);
    expect(step(piece, 'handle')).toMatchObject({ place: 'current', allowed: true });
    expect(step(piece, 'handle').reason).toMatch(/Draw a handle, then score and slip/);

    const handle = drawn('handle', 'handle-1');
    piece.attachments.push(handle);
    expect(step(piece, 'handle').reason).toMatch(/Score the join/);
    writeJoin(handle, true, false);
    expect(step(piece, 'handle').reason).toMatch(/Slip the scored join/);
    writeJoin(handle, true, true);
    expect(step(piece, 'handle').reason).toMatch(/scored and slipped/);
  });

  it('marks the bisque fire ready before wax, then the glaze fire, then the gallery', () => {
    const piece = createPiece('porcelain', 0.8);
    skipDrying(piece);
    skipDrying(piece);
    expect(piece.stage).toBe('bone-dry');
    expect(step(piece, 'wax')).toMatchObject({ place: 'current', allowed: false });
    expect(step(piece, 'fire')).toMatchObject({
      place: 'pending',
      allowed: canTransition(piece.stage, 'bisque'),
    });
    expect(step(piece, 'fire').reason).toMatch(/bisque kiln/i);
    expect(journeyStatus(step(piece, 'fire'))).toBe('ready');

    expect(transition(piece, 'bisque')).toBe(true);
    expect(step(piece, 'wax')).toMatchObject({ place: 'current', allowed: nextStage(piece.stage) === 'glazed' });
    expect(step(piece, 'fire').allowed).toBe(false);

    expect(transition(piece, 'glazed')).toBe(true);
    expect(step(piece, 'wax').place).toBe('done');
    expect(step(piece, 'fire')).toMatchObject({
      place: 'current',
      allowed: canTransition(piece.stage, 'glaze-fired'),
    });

    expect(transition(piece, 'glaze-fired')).toBe(true);
    expect(nextStage(piece.stage)).toBeNull();
    expect(step(piece, 'gallery')).toMatchObject({ place: 'current', allowed: true });
    expect(step(piece, 'fire')).toMatchObject({ place: 'done', allowed: false });
    expect(step(piece, 'throw').allowed).toBe(canThrow(piece));
  });

  it('prefixes the label from the stage registry', () => {
    const piece = createPiece('earthenware', 1);
    skipDrying(piece);
    const journey = buildJourney(piece, loadStages());
    expect(journey.stageLabel).toBe('Leather-hard');
    expect(journeyReason(journey.steps, journey.stageLabel)).toMatch(/^Leather-hard\. /);
  });
});

describe('coach tips', () => {
  it('tells a new thrower to center, then open, then pull', () => {
    const piece = createPiece('stoneware', 1);
    expect(coachTip(piece)?.id).toBe('center');

    evenOut(piece);
    expect(coachTip(piece)?.id).toBe('open');

    openWell(piece);
    expect(coachTip(piece)?.text).toMatch(/Pull up the wall/);

    for (let ring = 0; ring < piece.grid.rings; ring++) piece.grid.y[ring] *= 2;
    expect(coachTip(piece)?.id).toBe('wire');
  });

  it('says too wet when the wall slumps, the piece is still wet off the wheel, or stress is high', () => {
    const slumped = createPiece('stoneware', 1);
    slumped.grid.failure = 'slumped';
    expect(coachTip(slumped)?.text).toMatch(/Too wet, let it dry/);

    const torn = createPiece('porcelain', 1);
    torn.grid.failure = 'torn';
    expect(coachTip(torn)?.id).toBe('torn');

    const drying = createPiece('stoneware', 1);
    removeFromWheel(drying);
    expect(coachTip(drying)?.text).toMatch(/Too wet, let it dry/);

    const stressed = createPiece('earthenware', 1.2);
    stressed.grid.stress = 2;
    expect(coachTip(stressed)?.text).toMatch(/Too wet, let it dry/);
  });

  it('names the real handle, score, and slip tools, then the join flags', () => {
    const piece = createPiece('stoneware', 1);
    skipDrying(piece);
    expect(canAttachHandle(piece)).toBe(true);
    const tools = loadTools();
    const tip = coachTip(piece, tools);
    expect(tip?.id).toBe('draw-handle');
    expect(tip?.text).toContain(tools.find((tool) => tool.id === 'handle')?.label);
    expect(tip?.text).toContain(tools.find((tool) => tool.id === 'score')?.label);
    expect(tip?.text).toContain(tools.find((tool) => tool.id === 'slip')?.label);

    const renamed = [
      { id: 'handle', label: 'Lug' },
      { id: 'score', label: 'Hatch' },
      { id: 'slip', label: 'Slurry' },
      { id: 'sprig', label: 'Knob' },
    ];
    expect(coachTip(piece, renamed)?.text).toBe('Draw a Lug, then Hatch and Slurry the join.');

    piece.grid.moisture.fill(0.95);
    expect(coachTip(piece)?.text).toMatch(/Too wet, let it dry/);
    piece.grid.moisture.fill(0.42);

    const handle = drawn('handle', 'handle-1');
    piece.attachments.push(handle);
    expect(coachTip(piece)?.id).toBe('score-join');
    expect(coachTip(piece)?.tone).toBe('caution');
    expect(coachTip(piece, renamed)?.text).toMatch(/Hatch/);
    expect(coachTip(piece, renamed)?.text).toMatch(/Lug/);

    writeJoin(handle, true, false);
    expect(coachTip(piece, renamed)?.id).toBe('slip-join');
    expect(coachTip(piece, renamed)?.text).toMatch(/Slurry/);

    const sprig = drawn('sculpt', 'sprig-1');
    piece.attachments.push(sprig);
    expect(coachTip(piece, renamed)?.text).toMatch(/Knob/);

    writeJoin(handle, true, true);
    writeJoin(sprig, true, true);
    expect(coachTip(piece)?.id).toBe('handle-on');
    expect(coachTip(piece)?.text).toMatch(/scored and slipped/);
  });

  it('walks wax, glaze, and the finished pot from the surface map and the stage', () => {
    const piece = createPiece('stoneware', 1);
    skipDrying(piece);
    remountOnWheel(piece);
    expect(coachTip(piece)?.id).toBe('trim');

    skipDrying(piece);
    expect(piece.stage).toBe('bone-dry');
    expect(coachTip(piece)?.id).toBe('bisque-fire');

    transition(piece, 'bisque');
    expect(coachTip(piece)?.id).toBe('wax-foot');
    const body = piece.surfaces.find((surface) => surface.meshId === 'body');
    expect(body).toBeTruthy();
    body!.map.wax[0] = 1;
    expect(coachTip(piece)?.id).toBe('glaze');
    body!.map.glazeId[4] = 2;
    expect(coachTip(piece)?.id).toBe('glaze-even');

    transition(piece, 'glazed');
    expect(coachTip(piece)?.id).toBe('glaze-fire');
    transition(piece, 'glaze-fired');
    expect(coachTip(piece)?.text).toMatch(/gallery/);
  });

  it('has a setup tip before a piece exists', () => {
    expect(coachTip(null)?.id).toBe('setup');
  });
});

describe('throwing tutorial', () => {
  it('reads center, open, and pull copy from the tool registry', () => {
    const tools = loadTools();
    const steps = tutorialSteps(tools);
    expect(steps.map((entry) => entry.id)).toEqual(['center', 'open', 'pull']);
    for (const step of steps) {
      const tool = tools.find((entry) => entry.id === step.id);
      expect(tool).toBeTruthy();
      expect(step.title).toBe(tool?.label);
      expect(step.body).toBe(tool?.instruction);
      expect(step.gesture.length).toBeGreaterThan(0);
    }
  });

  it('falls back when a tool is not registered yet', () => {
    const steps = tutorialSteps([{ id: 'center', label: 'True it', instruction: 'Press the side.' }]);
    expect(steps[0]).toMatchObject({ title: 'True it', body: 'Press the side.' });
    expect(steps[1].id).toBe('open');
    expect(steps[2].title).toBe('Pull');
  });

  it('remembers completion apart from the saved piece', () => {
    const storage = memoryStorage();
    expect(isTutorialDone(storage)).toBe(false);
    markTutorialDone(storage);
    expect(isTutorialDone(storage)).toBe(true);
    expect(storage.getItem(ONBOARDING_STORAGE_KEY)).toBe('done');
    expect(storage.getItem('pottery-wheel:piece')).toBeNull();
  });
});
