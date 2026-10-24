# Pottery wheel architecture

This is the core of a pottery wheel that other agents extend. The piece of clay is the only shared state. Tools, glaze, handles, and the kiln do not call each other. They read and write `PieceState`.

The app is Vite + TypeScript + Three.js, with a plain DOM overlay. There is no React. Published at `https://itay3po.github.io/pottery-wheel/` with Vite `base: '/pottery-wheel/'`.

## Folder ownership

| Folder | Owner | Rule |
| --- | --- | --- |
| `src/core` | core | State machine, `PieceState`, registries, save/load, attachment and surface-map contracts |
| `src/clay` | core | Grid, volume, shaping math, collapse |
| `src/render` | core | Scene, clay mesh, materials, attachment sweep, surface DataTextures, UV raycast |
| `src/ui/shell` | core | Bottom sheet. Later agents should not restyle the shell for a one-off tool; add a stage action or a tool instead |
| `src/tools` | tools agent | One file per tool. **Add a file. Do not edit a shared index.** |
| `src/stages` | whoever owns that step | One file per stage. Core ships the lifecycle; later agents fill the stub stages |
| `src/handbuild` | handbuild agent | Handles and coils. Stub: `handles.ts` |
| `src/surface` | surface agent | Glaze and wax. Stubs: `glaze.ts`, `wax.ts` |
| `src/firing` | firing agent | Kiln. Stub: `kiln.ts` |

Registries use `import.meta.glob` in `src/core/registry.ts`:

- `src/tools/*.ts` must `export const tool: Tool`
- `src/stages/*.ts` must `export const stage: Stage`

Files that do not export `tool` / `stage` are ignored. Do not add `src/tools/index.ts` that exports `tool`. Sort order is the `order` field.

## Lifecycle

```
setup → wet → leather-hard → bone-dry → bisque → glazed → glaze-fired
```

`setup` is the screen before a piece exists. A `PieceState.stage` is never `'setup'`.

| Rule | API |
| --- | --- |
| Throwing only while wet and mounted | `canThrow(piece)` |
| Drying skip: wet → leather-hard, leather-hard → bone-dry | `skipDrying(piece)` |
| Wire cut freezes profile UVs and creates the body surface map | `removeFromWheel(piece)` |
| Trimming only at leather-hard, back on the wheel | `canTrim(piece)`, `remountOnWheel(piece)` |
| Handles and coils only at leather-hard, off the wheel | `canAttachHandle(piece)` |
| Any single legal step, including the fires | `transition(piece, stageId)` |

`transition` applies that step's linear shrinkage and moisture, clears `onWheel`, and freezes UVs the first time the piece leaves the wet wheel. Illegal jumps return `false`. The kiln should call `transition(piece, 'bisque')` and `transition(piece, 'glaze-fired')` when a cycle finishes, not invent a parallel stage enum.

Clay bodies live in `src/clay/clays.ts`: wet / leather / bone / bisque / fired color, density, plasticity, total linear shrinkage, max temperature. Weight chosen on the setup screen is wet mass. Volume is `weightKg / density`. Shrinkage changes the mesh; `weightKg` stays the number the thrower picked.

## PieceState

`src/core/types.ts`. Serialize with `serializePiece` / `deserializePiece`. `localStorage` key `pottery-wheel:piece` via `savePiece` / `loadPiece`.

```ts
interface PieceState {
  version: 1;
  id: string;
  clayTypeId: 'stoneware' | 'porcelain' | 'earthenware';
  weightKg: number;
  stage: StageId;
  onWheel: boolean;
  grid: ClayGrid;
  attachments: Attachment[];
  surfaces: MeshSurface[];
  speedSetting: number;
  createdAt: number;
  updatedAt: number;
}
```

Typed arrays are base64 in JSON. Version mismatches and corrupt saves load as `null`.

## Clay grid

`src/clay/grid.ts`. A cylinder of samples, default **160 rings × 72 segments**.

- `y[ring]` — height above the bat, meters, monotonic. Ring 0 is the bat.
- `outer[ring * segments + segment]`, `inner[...]` — radii in meters. Inner `0` is solid.
- `moisture[ring]` — 0..1.
- `torn[ring * segments + segment]` — 1 where the wall has ripped.
- `arcOuter` / `arcInner` — normalized profile arc length. Live while throwing, frozen when `uvFrozen` is set.
- `stress` — wet tall-wall time, used by slump.
- `revision` — bump when the mesh should reupload. The renderer does not rebuild geometry.

Segment 0 faces local +Z. The mesh spins with `rotation.y`, so world angle = local angle + spin.

Volume is the sum of conical frustums per segment. Shaping operations restore it:

- Pressing and centering push the lost volume **up** (gaps above the hand grow).
- Opening preserves cross-sectional area by moving the outer wall out as the well appears.
- Pulling adds height and thins the wall around its midline.
- Compressing shortens the upper gaps and thickens them back to the same volume.

A still finger (`|omega| < 2.2 rad/s`) only touches a thumb-sized arc, so dents stay put. A spinning hand is treated as axisymmetric: every segment of the band moves. `evaluateIntegrity` (`src/clay/integrity.ts`) tears walls thinner than `minWallThickness(clay)` and slumps forms that are too wet and too tall for too long. Porcelain's minimum wall is thicker than earthenware's; plasticity is what makes that difference.

Shaping entry points, all pure and unit-tested: `centerClay`, `pressIn`, `openCenter`, `pullUp`, `compressClay`.

## Rendering

`ClayMesh` (`src/render/clayMesh.ts`) allocates a `BufferGeometry` once:

- Columns = `segments + 1` so the UV seam has an `u = 0` vertex and an `u = 1` vertex in the same place.
- Surfaces = outer + inner.
- Vertex count = `rings * (segments + 1) * 2`.
- Indices are static (outer wall, inner wall, top annulus, bottom disc).
- Positions, normals, UVs, and vertex colors are rewritten in place. Do not construct a `LatheGeometry` for the clay per frame.

`v` is arc length along the mean profile. `u` is angle. Interior vertices are slightly darker; torn samples are marked in the vertex color.

The studio is one warm directional light plus a `RoomEnvironment` PMREM. No shadow maps. `devicePixelRatio` is capped at 2. Wet clay is a `MeshPhysicalMaterial` (low roughness, high clearcoat, a little sheen).

### Material hooks (firing)

Do not replace the clay material. Append a shader hook:

```ts
addClayShaderHook(material, (shader) => {
  shader.uniforms.uGlaze = { value: mesh.userData.surfaceTextures.glazeId };
  // edit shader.fragmentShader / vertexShader
}, 'glaze-fire');
```

`onBeforeCompile` runs every hook already registered. `customProgramCacheKey` changes when hooks are added. `applyClayFinish(material, clay, stage)` sets color, roughness, and clearcoat from the lifecycle stage; a glaze shader should multiply on top of that, not fight it.

Glaze textures for a mesh are stashed on `mesh.userData.surfaceTextures` and `mesh.userData.meshId`.

## Tools

```ts
interface Tool {
  id: string;
  name: string;
  label: string;          // bottom-sheet chip
  order: number;
  allowedStages: readonly StageId[];
  requiresWheel: boolean;
  instruction: string;
  haptics?: { down?: number | number[]; move?: number | number[]; moveIntervalMs?: number };
  onPointerDown(ctx: ToolContext): void;
  onPointerMove(ctx: ToolContext): void;
  onPointerUp(ctx: ToolContext): void;
}
```

`ToolContext` is `{ piece, wheel, pointer, previous, dt }`. The shell calls `onPointerDown` once per stroke and `onPointerMove` once per frame after that, then `onPointerUp`. Read `piece.grid` and call the clay functions. Call `ctx.wheel.addDrag(pressure)` so a firm hand slows the wheel. Haptics are fired by the shell from `tool.haptics` via `navigator.vibrate`; tools don't have to call it themselves.

`ToolPointer`:

- `radius`, `height` — meters, profile plane through the wheel axis (side view).
- `pressure` — 0..1 from how far the finger has pushed past the silhouette (open uses depth below the rim).
- `side` — `+1` right of the axis, `-1` left.
- `segment` — the sample facing that side at the current spin.
- `x`, `y` — the same profile point, `y` already relative to the bat.

Reference tools (this core): `center`, `open`, `pull`, `press`, `compress`, `wire`. They are the pattern to copy. Wire refuses to cut above ~28 rpm; the sheet's "Wire off" action is the same cut with a button.

On the wheel the camera is a fixed side view: pointer x is radius, pointer y is height. Off the wheel, two-finger drag (and right-drag on desktop) orbits. One finger is always the tool.

## Stages

```ts
interface Stage {
  id: AppStageId;          // 'setup' | StageId
  label: string;
  order: number;
  mountsOnWheel: boolean;
  allowOrbit: boolean;     // honored only while the piece is off the wheel
  hint: (ctx: StageContext | null) => string;
  actions?: StageAction[]; // { id, label, enabled?, run }
}
```

The shell renders `hint` and `actions`. Wheel start/stop and the speed knob appear whenever `piece.onWheel`. To add a button, add an action on the stage. To add a hand, add a tool.

Stub stages, left for later agents to fill in:

| File | What to build |
| --- | --- |
| `src/stages/leatherHard.ts` | Trimming tools (`allowedStages: ['leather-hard']`, and the piece must be remounted). Handle UI belongs with `src/handbuild`. |
| `src/stages/boneDry.ts` | Hand off to the bisque kiln. |
| `src/stages/bisque.ts` | Glaze and wax painting. |
| `src/stages/glazed.ts` | Hand off to the glaze kiln. |
| `src/stages/glazeFired.ts` | Finished pot. Nothing transitions past here. |

`src/stages/setup.ts` and `src/stages/wet.ts` are implemented.

## Attachments

Piece-local meters, Y up, origin at the center of the bat.

```ts
interface Attachment {
  id: string;
  kind: 'handle' | 'coil' | 'sculpt';
  points: { x: number; y: number; z: number; radius: number }[];
  joinBlend: number;       // 0..0.45, fraction of each end that flares
  tubularSegments: number;
  radialSegments: number;
}
```

`createAttachment` fills defaults. `buildAttachmentGeometry` sweeps a tube along a Catmull-Rom spline with parallel-transport frames. Ends flare (radius × up to 1.55) and flatten slightly so the join can sit in the wall. UVs: **u around the tube, v along the spline**, including the join. The mesh is a child of the clay pivot, so it spins and lifts with the pot. Rebuild only when the point list changes — not per frame.

`src/handbuild/handles.ts` exports `attachHandle(piece, attachment)`, which checks `canAttachHandle` and calls `ensureAttachmentSurface`. Replace that stub with the real handle/coil interaction; keep the `Attachment` fields.

## Surface maps

Per mesh (`meshId` `'body'` or an attachment id):

```ts
interface SurfaceMap {
  width: number;   // 128
  height: number;  // 128
  glazeId: Uint8Array;       // 0 = bare
  thickness: Float32Array;   // millimeters
  wax: Uint8Array;           // 1 = resist
  underglazeId: Uint8Array;  // 0 = none
}
```

Texels are row-major, x along u, y along v. On the **body**, u is angle (wraps) and v is arc length along the profile (clamps). v is frozen when the piece leaves the wheel (`grid.uvFrozen`, set by `removeFromWheel` and by `transition` off wet). Attachment meshes use the tube UVs above.

Helpers:

- `createSurfaceMap`, `ensureBodySurface`, `ensureAttachmentSurface`
- `bodyUV(grid, ring, segment)`, `uvToTexel`, `sampleGlaze`
- `createSurfaceTextures(map)` → `{ glazeId, thickness, wax, underglaze }` `DataTexture`s (`RedFormat`, byte or float). Call `markSurfaceTexturesDirty` after painting.
- `raycastToUV(raycaster, meshes)` → `{ meshId, u, v }` using the mesh's uv attribute. `Studio.bodyObjects()` is the current list.

`src/surface/glaze.ts` and `src/surface/wax.ts` are stubs. Paint the arrays, then `transition(piece, 'glazed')` when the coat is done.

## Wheel

`Wheel` in `src/core/wheel.ts`: `omega` (rad/s), `angle`, `running`, `speed` (0..1 knob, up to ~248 rpm). Motor torque is limited; viscous and coulomb friction coast it down; `addDrag(pressure)` is opposing torque consumed on the next `step`. The head mesh uses `angle`. The clay uses `angle` only while `piece.onWheel`; after the wire it keeps the release angle and eases up off the bat.

## Mobile

- `touch-action: none` on the canvas. The sheet may pan vertically.
- One finger: the active tool. Side view on the wheel.
- Two fingers: orbit, only off the wheel.
- Targets are at least 44px. The sheet sits at the bottom, in thumb reach, and centers on wide screens.
- Portrait first (Pixel 10a is 412×924 CSS px, DPR 2.625, capped here at 2). Desktop uses the same sheet with a mouse.
- On a full-width sheet the canvas is only the area above it, so the clay stays in reach and the covered pixels are not drawn. On a wide screen the sheet is centered and the side camera shifts the clay up by about half the sheet's share of the view.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173/pottery-wheel/
npm run typecheck
npm test
npm run build        # tsc + vite build, output in dist/
```

CI (`.github/workflows/ci.yml`) typechecks and tests on every pull request. `.github/workflows/pages.yml` builds and deploys to GitHub Pages with `actions/upload-pages-artifact` and `actions/deploy-pages` on push to `main`. The repository Pages source is GitHub Actions.
