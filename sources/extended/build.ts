// Builds the extended region of the spritesheet: pre-rendered ("baked") rows for
// every extended action, followed by an atlas with every piece the actions use.
//
// Inputs are the character rendered three times by layer group (head, head
// layers behind the body, body), all with the standard universal-sheet layout.

import { loadImage } from "../canvas/load-image.ts";
import { drawExtendedFrame, type PieceSource } from "./draw.ts";
import {
  EXTENDED_DIRECTIONS,
  type CreditEntry,
  type ExportedPiece,
  type ExtendedAction,
  type ExtendedDefinition,
  type ExtendedDirection,
  type MaskReference,
  type Point,
  type RectXYWH,
} from "./format.ts";
import { EXTENDED_GROUPS, type ExtendedGroup } from "./groups.ts";
import { actionFrameCount, bakedRowLayout, shelfPack } from "./layout.ts";
import {
  CELL,
  buildPiece,
  computeArmMask,
  cropRgba,
  extractCell,
  extractMaskCell,
  opaqueBounds,
  type Rgba,
} from "./pixels.ts";

type DefinitionEntry = {
  id: string;
  /** Body types authored in the definition (checked when it loads). */
  bodyTypes: readonly string[];
  /** Standard animations the pieces are cut from. */
  sourceAnimations: readonly string[];
  load: () => Promise<ExtendedDefinition>;
};

/**
 * Extended action definitions. They are loaded lazily (they are large) the
 * first time a character with a supported body type is rendered.
 */
export const EXTENDED_DEFINITIONS: readonly DefinitionEntry[] = [
  {
    id: "shotgun",
    bodyTypes: ["male", "female"],
    sourceAnimations: ["thrust", "walk", "shoot", "run"],
    load: async () =>
      (await import("./definitions/shotgun.json"))
        .default as unknown as ExtendedDefinition,
  },
];

const loadedDefinitions = new Map<string, Promise<ExtendedDefinition>>();

function loadDefinition(entry: DefinitionEntry): Promise<ExtendedDefinition> {
  let p = loadedDefinitions.get(entry.id);
  if (!p) {
    p = entry.load();
    loadedDefinitions.set(entry.id, p);
    p.catch(() => loadedDefinitions.delete(entry.id));
  }
  return p;
}

/** Body types the extended actions are authored for. */
export function extendedBodyTypes(): string[] {
  return [...new Set(EXTENDED_DEFINITIONS.flatMap((d) => d.bodyTypes))];
}

export function supportsExtended(bodyType: string): boolean {
  return EXTENDED_DEFINITIONS.some((d) => d.bodyTypes.includes(bodyType));
}

export type ExtendedBaked = Record<
  ExtendedDirection,
  { y: number; frames: number }
>;

/** Result of {@link buildExtendedRegion}. Every `y` is relative to the region top. */
export type ExtendedRegion = {
  bodyType: string;
  canvas: HTMLCanvasElement;
  /** Action ids in display order. */
  order: string[];
  actions: Record<string, ExtendedAction>;
  baked: Record<string, ExtendedBaked>;
  pieces: Record<string, ExportedPiece>;
  credits: CreditEntry[];
};

/**
 * The character drawn once per layer group. Only the source animations are kept,
 * one band of 4 directions each, stacked in `animations` order.
 */
export type GroupSheets = {
  canvases: Record<ExtendedGroup, HTMLCanvasElement>;
  animations: readonly string[];
};

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("extended: 2D context unavailable");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

const BAND = 4 * CELL;

export function createGroupSheets(
  bodyType: string,
  width: number,
): GroupSheets {
  const animations = [
    ...new Set(
      EXTENDED_DEFINITIONS.filter((d) =>
        d.bodyTypes.includes(bodyType),
      ).flatMap((d) => d.sourceAnimations),
    ),
  ];
  const height = Math.max(1, animations.length * BAND);
  const canvases = {} as Record<ExtendedGroup, HTMLCanvasElement>;
  for (const g of EXTENDED_GROUPS) canvases[g] = newCanvas(width, height);
  return { canvases, animations };
}

/** Y of an animation band inside the group sheets, or null if it is not kept. */
export function groupBandY(
  sheets: GroupSheets,
  animation: string,
): number | null {
  const i = sheets.animations.indexOf(animation);
  return i < 0 ? null : i * BAND;
}

function canvasToRgba(canvas: HTMLCanvasElement): Rgba {
  const data = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

function imageToRgba(img: HTMLImageElement): Rgba {
  const c = newCanvas(
    img.naturalWidth || img.width,
    img.naturalHeight || img.height,
  );
  context(c).drawImage(img, 0, 0);
  return canvasToRgba(c);
}

type ArmSheet = { mask: Uint8Array; width: number; height: number };
const armSheetCache = new Map<string, Promise<ArmSheet>>();

/** Arm mask of one animation sheet (4 directions), cached per body type and animation. */
function armSheet(ref: MaskReference, anim: string): Promise<ArmSheet> {
  const key = `${ref.body}|${ref.clothes.join(",")}|${anim}`;
  let cached = armSheetCache.get(key);
  if (!cached) {
    cached = (async () => {
      const body = imageToRgba(
        await loadImage(`spritesheets/${ref.body}${anim}.png`),
      );
      const clothes = await Promise.all(
        ref.clothes.map(async (c) => {
          try {
            return imageToRgba(await loadImage(`spritesheets/${c}${anim}.png`));
          } catch {
            return null;
          }
        }),
      );
      const mask = computeArmMask(
        body,
        clothes.filter((c): c is Rgba => c !== null),
        ref.rows,
      );
      return { mask, width: body.width, height: body.height };
    })();
    armSheetCache.set(key, cached);
    cached.catch(() => armSheetCache.delete(key));
  }
  return cached;
}

/** @internal Test helper */
export function resetExtendedCachesForTests(): void {
  armSheetCache.clear();
}

type BuiltPiece = {
  rgba: Rgba | null;
  image: CanvasImageSource | null;
  src: RectXYWH;
  at: Point;
  pivot: Point;
};

function rowOf(
  sheets: GroupSheets,
  anim: string,
  dir: ExtendedDirection,
): number {
  const band = groupBandY(sheets, anim);
  if (band === null)
    throw new Error(`extended: source animation ${anim} not kept`);
  return band + EXTENDED_DIRECTIONS.indexOf(dir) * CELL;
}

/** Remove layers whose piece came out empty (nothing to draw for this character). */
function pruneAction(
  action: ExtendedAction,
  known: ReadonlySet<string>,
): ExtendedAction {
  const directions = {} as Record<
    ExtendedDirection,
    ExtendedAction["directions"][ExtendedDirection]
  >;
  for (const d of EXTENDED_DIRECTIONS) {
    directions[d] = action.directions[d].map((f) => ({
      ...f,
      layers: f.layers.filter((l) => known.has(l.p)),
    }));
  }
  return { ...action, directions };
}

/**
 * Cut the pieces, pack them, and bake every action row.
 * Returns null when no extended action is authored for `bodyType`.
 */
export async function buildExtendedRegion(
  bodyType: string,
  groups: GroupSheets,
  width: number,
): Promise<ExtendedRegion | null> {
  const defs = (
    await Promise.all(
      EXTENDED_DEFINITIONS.filter((d) => d.bodyTypes.includes(bodyType)).map(
        loadDefinition,
      ),
    )
  ).filter((d) => d.bodyTypes[bodyType]);
  if (defs.length === 0) return null;

  const sheets = {} as Record<ExtendedGroup, Rgba>;
  for (const g of EXTENDED_GROUPS) sheets[g] = canvasToRgba(groups.canvases[g]);

  const built = new Map<string, BuiltPiece>();
  const order: string[] = [];
  const actions: Record<string, ExtendedAction> = {};
  const credits: CreditEntry[] = [];

  for (const def of defs) {
    const bt = def.bodyTypes[bodyType];
    const ref = def.maskReference[bodyType];
    const anims = [...new Set(Object.values(bt.pieces).map((r) => r.anim))];
    const masks = new Map<string, ArmSheet>();
    await Promise.all(
      anims.map(async (a) => {
        masks.set(a, await armSheet(ref, a));
      }),
    );

    for (const [name, recipe] of Object.entries(bt.pieces)) {
      const y = rowOf(groups, recipe.anim, recipe.dir);
      const x = recipe.frame * CELL;
      const m = masks.get(recipe.anim)!;
      const piece = buildPiece(recipe, {
        body: extractCell(sheets.body, x, y),
        head: extractCell(sheets.head, x, y),
        headBack: extractCell(sheets.headBack, x, y),
        gear: extractCell(sheets.gear, x, y),
        gearBack: extractCell(sheets.gearBack, x, y),
        arm: extractMaskCell(
          m.mask,
          m.width,
          m.height,
          x,
          EXTENDED_DIRECTIONS.indexOf(recipe.dir) * CELL,
        ),
      });
      const bounds = opaqueBounds(piece);
      if (!bounds) continue;
      const pivotCell = recipe.pivot ?? [CELL / 2, CELL / 2];
      built.set(name, {
        rgba: cropRgba(piece, bounds),
        image: null,
        src: [0, 0, bounds[2], bounds[3]],
        at: [bounds[0], bounds[1]],
        pivot: [pivotCell[0] - bounds[0], pivotCell[1] - bounds[1]],
      });
    }

    const propsImage = await loadImage(`spritesheets/${def.props.image}`);
    for (const [name, prop] of Object.entries(def.props.pieces)) {
      built.set(name, {
        rgba: null,
        image: propsImage,
        src: prop.rect,
        at: [0, 0],
        pivot: prop.pivot,
      });
    }

    const known = new Set(built.keys());
    for (const { id } of def.actions) {
      const action = bt.actions[id];
      if (!action) continue;
      order.push(id);
      actions[id] = pruneAction(action, known);
    }
    credits.push(...def.props.credits);
  }

  // ---- pack the atlas ------------------------------------------------------
  const packed = shelfPack(
    [...built.entries()].map(([name, p]) => ({
      name,
      w: p.src[2],
      h: p.src[3],
    })),
    width,
  );
  const atlas = newCanvas(width, Math.max(1, packed.height));
  const atlasCtx = context(atlas);
  for (const [name, p] of built) {
    const [dx, dy] = packed.rects[name];
    if (p.rgba) {
      const data = new ImageData(
        new Uint8ClampedArray(p.rgba.data),
        p.rgba.width,
        p.rgba.height,
      );
      atlasCtx.putImageData(data, dx, dy);
    } else if (p.image) {
      const [sx, sy, w, h] = p.src;
      atlasCtx.drawImage(p.image, sx, sy, w, h, dx, dy, w, h);
    }
  }

  // ---- bake rows -----------------------------------------------------------
  const rows = bakedRowLayout(order);
  const bakedHeight = rows.length * CELL;
  const region = newCanvas(width, bakedHeight + packed.height);
  const ctx = context(region);
  ctx.drawImage(atlas, 0, bakedHeight);

  const sources: Record<string, PieceSource> = {};
  const pieces: Record<string, ExportedPiece> = {};
  for (const [name, p] of built) {
    const rect = packed.rects[name];
    sources[name] = { image: atlas, rect, at: p.at, pivot: p.pivot };
    pieces[name] = {
      rect: [rect[0], rect[1] + bakedHeight, rect[2], rect[3]],
      at: p.at,
      pivot: p.pivot,
    };
  }

  const baked: Record<string, ExtendedBaked> = {};
  for (const { id, dir, row } of rows) {
    const frames = actions[id].directions[dir];
    baked[id] ??= {} as ExtendedBaked;
    baked[id][dir] = { y: row * CELL, frames: frames.length };
    frames.forEach((frame, i) => {
      if ((i + 1) * CELL > width) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * CELL, row * CELL, CELL, CELL);
      ctx.clip();
      drawExtendedFrame(ctx, frame, sources, i * CELL, row * CELL);
      ctx.restore();
    });
  }

  return { bodyType, canvas: region, order, actions, baked, pieces, credits };
}

/** Frame durations of an action (all directions share the same timing). */
export function actionDurations(action: ExtendedAction): number[] {
  const longest = EXTENDED_DIRECTIONS.reduce<ExtendedDirection>(
    (best, d) =>
      action.directions[d].length > action.directions[best].length ? d : best,
    "down",
  );
  return action.directions[longest].map((f) => f.t);
}

export { actionFrameCount };
