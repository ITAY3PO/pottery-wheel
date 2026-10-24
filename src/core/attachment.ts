import type { Attachment, AttachmentKind, AttachmentPoint } from './types';

/**
 * Build an Attachment record. Geometry is created separately by
 * `buildAttachmentGeometry` in src/render/attachmentMesh.ts so this module
 * stays free of Three.js. The handbuild agent should go through this helper
 * (or match the fields) and push onto `piece.attachments`.
 * Ids are `att-` plus a UUID so a resumed piece does not collide with `att-1`.
 */
export function createAttachment(input: {
  id?: string;
  kind: AttachmentKind;
  points: AttachmentPoint[];
  joinBlend?: number;
  tubularSegments?: number;
  radialSegments?: number;
}): Attachment {
  return {
    id: input.id ?? newAttachmentId(),
    kind: input.kind,
    points: input.points.map((point) => ({ ...point })),
    joinBlend: clampJoin(input.joinBlend ?? 0.14),
    tubularSegments: input.tubularSegments ?? 48,
    radialSegments: input.radialSegments ?? 12,
  };
}

function newAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `att-${crypto.randomUUID()}`;
  }
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampJoin(value: number): number {
  return Math.max(0, Math.min(0.45, value));
}

export function attachmentLength(attachment: Attachment): number {
  let length = 0;
  for (let i = 1; i < attachment.points.length; i++) {
    const a = attachment.points[i - 1];
    const b = attachment.points[i];
    length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return length;
}
