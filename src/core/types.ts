import type { Wheel } from './wheel';

/** Material lifecycle. `setup` is the app screen before a piece exists. */
export type StageId =
  | 'wet'
  | 'leather-hard'
  | 'bone-dry'
  | 'bisque'
  | 'glazed'
  | 'glaze-fired';

export type AppStageId = 'setup' | StageId;

export type ClayTypeId = 'stoneware' | 'porcelain' | 'earthenware';

export type AttachmentKind = 'handle' | 'coil' | 'sculpt';

export type FailureKind = 'torn' | 'slumped';

/**
 * Cylindrical clay grid. Rings run from the bat (0) to the rim.
 * Segment 0 faces local +Z and spins with the piece.
 * All modules share this through PieceState — do not keep a private copy.
 */
export interface ClayGrid {
  rings: number;
  segments: number;
  /** Absolute height of each ring, meters. Monotonic, y[0] is the bat. */
  y: Float32Array;
  /** Outer radius, meters. Index = ring * segments + segment. */
  outer: Float32Array;
  /** Inner radius, meters. 0 means solid at that sample. */
  inner: Float32Array;
  /** 0 (bone-dry) .. 1 (fresh). One value per ring. */
  moisture: Float32Array;
  /** 1 where the wall has torn. */
  torn: Uint8Array;
  /**
   * Normalized arc length along the outer profile, one value per ring.
   * Recomputed while throwing. Frozen when the piece leaves the wheel.
   */
  arcOuter: Float32Array | null;
  /** Normalized arc length along the inner profile. */
  arcInner: Float32Array | null;
  /** When true, arcOuter/arcInner are the glaze UV v coordinate. */
  uvFrozen: boolean;
  /** Seconds of wet tall-wall stress. Drives slump. */
  stress: number;
  failure: FailureKind | null;
  /** Bumped whenever the mesh should upload new positions. */
  revision: number;
}

export interface AttachmentPoint {
  x: number;
  y: number;
  z: number;
  /** Tube radius at this point, meters. */
  radius: number;
}

/**
 * A tube swept along a spline in piece-local space (Y up, origin on the bat center).
 * Ends flare by `joinBlend` so a handle can sit into the wall.
 * UVs: u around the tube, v along the spline.
 */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  points: AttachmentPoint[];
  /** Fraction of the spline, at each end, that flares into the body. 0..0.45. */
  joinBlend: number;
  tubularSegments: number;
  radialSegments: number;
}

/**
 * Per-mesh surface maps. On the body, u is angle and v is arc length along
 * the profile (frozen once the piece leaves the wheel).
 * Texels are row-major, y along v, x along u.
 */
export interface SurfaceMap {
  width: number;
  height: number;
  /** 0 = bare clay. Ids are assigned by the surface agent. */
  glazeId: Uint8Array;
  /** Glaze thickness in millimeters. */
  thickness: Float32Array;
  /** 1 = wax resist. */
  wax: Uint8Array;
  /** 0 = no underglaze. */
  underglazeId: Uint8Array;
}

export interface MeshSurface {
  /** 'body' or an Attachment id. */
  meshId: string;
  map: SurfaceMap;
}

export interface PieceState {
  version: 1;
  id: string;
  clayTypeId: ClayTypeId;
  /** Wet weight chosen on the setup screen. Does not change as the piece shrinks. */
  weightKg: number;
  stage: StageId;
  /** When true the piece is mounted and spins with the wheel. */
  onWheel: boolean;
  grid: ClayGrid;
  attachments: Attachment[];
  surfaces: MeshSurface[];
  /** Last speed knob value, 0..1. */
  speedSetting: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolPointer {
  /** Distance from the wheel axis, meters. */
  radius: number;
  /** Height above the bat, meters. */
  height: number;
  /** 0..1 from how far the finger has pushed past the surface. */
  pressure: number;
  /** +1 on the right of the axis, -1 on the left. */
  side: 1 | -1;
  /** Grid segment currently under the finger. */
  segment: number;
  /** Profile-plane coordinates, meters. */
  x: number;
  y: number;
}

export interface ToolContext {
  piece: PieceState;
  wheel: Wheel;
  pointer: ToolPointer;
  /** Previous sample this stroke, or null on the first frame. */
  previous: ToolPointer | null;
  dt: number;
}

export interface ToolHaptics {
  down?: number | number[];
  move?: number | number[];
  /** Minimum gap between move pulses. Default 90. */
  moveIntervalMs?: number;
}

/**
 * A shaping tool. Drop a file in src/tools that exports `tool` — the registry
 * picks it up. Do not edit a shared tool index.
 */
export interface Tool {
  id: string;
  name: string;
  label: string;
  order: number;
  allowedStages: readonly StageId[];
  requiresWheel: boolean;
  instruction: string;
  haptics?: ToolHaptics;
  onPointerDown(ctx: ToolContext): void;
  onPointerMove(ctx: ToolContext): void;
  onPointerUp(ctx: ToolContext): void;
}

export interface StageContext {
  piece: PieceState;
  wheel: Wheel;
}

export interface StageAction {
  id: string;
  label: string;
  enabled?: (ctx: StageContext) => boolean;
  run: (ctx: StageContext) => void;
}

/**
 * A lifecycle stage. Drop a file in src/stages that exports `stage`.
 * The shell renders `hint` and `actions`. Later agents fill in the stub
 * stages (leather-hard trimming, glaze, kiln) without editing the shell.
 */
export interface Stage {
  id: AppStageId;
  label: string;
  order: number;
  /** Piece can spin with the wheel head. */
  mountsOnWheel: boolean;
  /** Two-finger orbit (and right-drag on desktop). */
  allowOrbit: boolean;
  hint: (ctx: StageContext | null) => string;
  actions?: StageAction[];
}
