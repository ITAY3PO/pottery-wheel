import { getClay, volumeForWeight } from '../clay/clays';
import { createClayGrid } from '../clay/grid';
import { decodeFloat32, decodeUint8, encodeFloat32, encodeUint8 } from './binary';
import type {
  Attachment,
  ClayGrid,
  ClayTypeId,
  MeshSurface,
  PieceState,
  StageId,
  SurfaceMap,
} from './types';

export function createPiece(clayTypeId: ClayTypeId, weightKg: number): PieceState {
  const clay = getClay(clayTypeId);
  const now = Date.now();
  const weight = clampWeight(weightKg);
  return {
    version: 1,
    id: newId(),
    clayTypeId,
    weightKg: weight,
    stage: 'wet',
    onWheel: true,
    grid: createClayGrid(volumeForWeight(weight, clay)),
    attachments: [],
    surfaces: [],
    speedSetting: 0.62,
    createdAt: now,
    updatedAt: now,
  };
}

export function clampWeight(weightKg: number): number {
  if (!Number.isFinite(weightKg)) return 1;
  return Math.round(Math.max(0.5, Math.min(3, weightKg)) * 10) / 10;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `piece-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

interface GridDTO {
  rings: number;
  segments: number;
  y: string;
  outer: string;
  inner: string;
  moisture: string;
  torn: string;
  arcOuter: string | null;
  arcInner: string | null;
  uvFrozen: boolean;
  stress: number;
  failure: ClayGrid['failure'];
}

interface SurfaceDTO {
  meshId: string;
  width: number;
  height: number;
  glazeId: string;
  thickness: string;
  wax: string;
  underglazeId: string;
}

interface PieceDTO {
  version: 1;
  id: string;
  clayTypeId: ClayTypeId;
  weightKg: number;
  stage: StageId;
  onWheel: boolean;
  grid: GridDTO;
  attachments: Attachment[];
  surfaces: SurfaceDTO[];
  speedSetting: number;
  createdAt: number;
  updatedAt: number;
}

export function serializePiece(piece: PieceState): string {
  const dto: PieceDTO = {
    version: 1,
    id: piece.id,
    clayTypeId: piece.clayTypeId,
    weightKg: piece.weightKg,
    stage: piece.stage,
    onWheel: piece.onWheel,
    grid: {
      rings: piece.grid.rings,
      segments: piece.grid.segments,
      y: encodeFloat32(piece.grid.y),
      outer: encodeFloat32(piece.grid.outer),
      inner: encodeFloat32(piece.grid.inner),
      moisture: encodeFloat32(piece.grid.moisture),
      torn: encodeUint8(piece.grid.torn),
      arcOuter: piece.grid.arcOuter ? encodeFloat32(piece.grid.arcOuter) : null,
      arcInner: piece.grid.arcInner ? encodeFloat32(piece.grid.arcInner) : null,
      uvFrozen: piece.grid.uvFrozen,
      stress: piece.grid.stress,
      failure: piece.grid.failure,
    },
    attachments: piece.attachments,
    surfaces: piece.surfaces.map(serializeSurface),
    speedSetting: piece.speedSetting,
    createdAt: piece.createdAt,
    updatedAt: piece.updatedAt,
  };
  return JSON.stringify(dto);
}

export function deserializePiece(raw: string): PieceState {
  const dto = JSON.parse(raw) as PieceDTO;
  if (!dto || dto.version !== 1 || !dto.grid) throw new Error('Unrecognized piece');
  const grid = decodeGrid(dto.grid);
  return {
    version: 1,
    id: String(dto.id),
    clayTypeId: dto.clayTypeId,
    weightKg: clampWeight(dto.weightKg),
    stage: dto.stage,
    onWheel: Boolean(dto.onWheel),
    grid,
    attachments: Array.isArray(dto.attachments) ? dto.attachments : [],
    surfaces: Array.isArray(dto.surfaces) ? dto.surfaces.map(decodeSurface) : [],
    speedSetting: Number.isFinite(dto.speedSetting) ? dto.speedSetting : 0.62,
    createdAt: dto.createdAt || Date.now(),
    updatedAt: dto.updatedAt || Date.now(),
  };
}

function decodeGrid(dto: GridDTO): ClayGrid {
  const y = decodeFloat32(dto.y);
  const outer = decodeFloat32(dto.outer);
  const inner = decodeFloat32(dto.inner);
  const moisture = decodeFloat32(dto.moisture);
  const torn = decodeUint8(dto.torn);
  if (y.length !== dto.rings) throw new Error('Grid height mismatch');
  if (outer.length !== dto.rings * dto.segments) throw new Error('Grid radius mismatch');
  return {
    rings: dto.rings,
    segments: dto.segments,
    y,
    outer,
    inner,
    moisture,
    torn,
    arcOuter: dto.arcOuter ? decodeFloat32(dto.arcOuter) : null,
    arcInner: dto.arcInner ? decodeFloat32(dto.arcInner) : null,
    uvFrozen: Boolean(dto.uvFrozen),
    stress: dto.stress || 0,
    failure: dto.failure ?? null,
    revision: 1,
  };
}

function serializeSurface(surface: MeshSurface): SurfaceDTO {
  return {
    meshId: surface.meshId,
    width: surface.map.width,
    height: surface.map.height,
    glazeId: encodeUint8(surface.map.glazeId),
    thickness: encodeFloat32(surface.map.thickness),
    wax: encodeUint8(surface.map.wax),
    underglazeId: encodeUint8(surface.map.underglazeId),
  };
}

function decodeSurface(dto: SurfaceDTO): MeshSurface {
  const map: SurfaceMap = {
    width: dto.width,
    height: dto.height,
    glazeId: decodeUint8(dto.glazeId),
    thickness: decodeFloat32(dto.thickness),
    wax: decodeUint8(dto.wax),
    underglazeId: decodeUint8(dto.underglazeId),
  };
  const n = dto.width * dto.height;
  if (map.glazeId.length !== n || map.thickness.length !== n) {
    throw new Error('Surface map size mismatch');
  }
  return { meshId: dto.meshId, map };
}
