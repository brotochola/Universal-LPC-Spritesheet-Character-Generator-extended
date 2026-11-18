// Types for the extended actions format.
//
// Two documents share the same frame/layer vocabulary:
//
// * `ExtendedDefinition` — what lives in the repo (`definitions/*.json`). Character
//   pieces are *recipes* (cut this part out of that source frame); props come from
//   a small atlas PNG.
// * `ExtendedDocument` — what the app exports next to the spritesheet PNG. Every
//   piece is a rectangle inside the exported PNG.
//
// Frames are explicit: no tweens and no keyframes. A frame lists layers in draw
// order; each layer draws one piece with its own position, rotation and scale.

export const EXTENDED_FORMAT = "lpc-extended";
export const EXTENDED_FORMAT_VERSION = 1;

export const EXTENDED_DIRECTIONS = ["up", "left", "down", "right"] as const;
export type ExtendedDirection = (typeof EXTENDED_DIRECTIONS)[number];

/** `[x, y]` in pixels. */
export type Point = [number, number];
/** `[x, y, width, height]` in pixels. */
export type RectXYWH = [number, number, number, number];
/** `[x0, y0, x1, y1]` (x1/y1 exclusive), in 64x64 cell coordinates. */
export type RectBounds = [number, number, number, number];

/**
 * One layer of a frame.
 *
 * The piece rests at `at` (its top-left inside the 64x64 cell). The layer draws it
 * with its top-left at `at + (x, y)`, rotated by `r` degrees (clockwise, screen
 * space) and scaled by `sx`/`sy` around the piece `pivot`. Negative scale mirrors.
 *
 * Canvas: `translate(at + xy + pivot) rotate(r) scale(sx, sy) drawImage(piece, -pivot)`.
 * Pixi: `anchor = pivot / size`, `position = origin + at + xy + pivot`.
 */
export type ExtendedLayer = {
  p: string;
  x?: number;
  y?: number;
  r?: number;
  sx?: number;
  sy?: number;
  /** Alpha 0..1 (default 1). */
  a?: number;
};

export type ExtendedFrame = {
  /** Duration in milliseconds. */
  t: number;
  layers: ExtendedLayer[];
  /** Named points in cell coordinates (e.g. `muzzle`), for game logic. */
  points?: Record<string, Point>;
  /** Named events fired when the frame starts (e.g. `fire`). */
  events?: string[];
};

export type ExtendedAction = {
  label: string;
  loop: boolean;
  directions: Record<ExtendedDirection, ExtendedFrame[]>;
};

// ---------------------------------------------------------------------------
// Definition (repo side)
// ---------------------------------------------------------------------------

export type PieceKind =
  | "lower"
  | "upper"
  | "arms"
  | "head"
  | "headback"
  | "body"
  | "gear"
  | "gearback";

/**
 * How to cut a character piece out of the composited character.
 *
 * * `head`: the head group (head, face, hair, hats, glasses...) of the source frame.
 * * `headback`: head-group layers drawn behind the body (long hair, ponytails).
 * * `gear` / `gearback`: backpacks, capes and quivers (in front of / behind the body).
 * * `body`: the body group of the source frame, minus arm pixels inside `erase`
 *   and every pixel inside `whole`.
 * * `lower`: body group rows `>= cut`, with the swinging arms removed and the
 *   holes they leave in the legs filled from the neighbouring pixels.
 * * `upper`: body group rows `< cut` plus the arms below it, minus arm pixels in `erase`.
 * * `arms`: only the arm pixels (whole arms), optionally limited to `rects`, plus
 *   every pixel inside `whole`, minus everything inside `erase`.
 */
export type PieceRecipe = {
  kind: PieceKind;
  anim: string;
  dir: ExtendedDirection;
  frame: number;
  cut?: number;
  erase?: RectBounds[];
  rects?: RectBounds[] | "all";
  /**
   * Areas taken (or removed) as a whole, not only the arm pixels: clothes such
   * as coat sleeves are wider than the bare arm the mask comes from.
   */
  whole?: RectBounds[];
  /** Pivot in cell coordinates (default: centre of the cell). */
  pivot?: Point;
};

export type PropPiece = { rect: RectXYWH; pivot: Point };

export type CreditEntry = {
  file: string;
  notes: string;
  authors: string[];
  licenses: string[];
  urls: string[];
};

export type MaskReference = {
  /** Base body folder (unrecoloured), e.g. `body/bodies/male/`. */
  body: string;
  /** Reference clothes that cover the torso, legs and feet but leave forearms bare. */
  clothes: string[];
  /** Rows of each cell where arm pixels can appear: `[from, to)`. */
  rows: [number, number];
};

export type ExtendedBodyTypeDefinition = {
  pieces: Record<string, PieceRecipe>;
  actions: Record<string, ExtendedAction>;
};

export type ExtendedDefinition = {
  id: string;
  generatedBy?: string;
  props: {
    image: string;
    pieces: Record<string, PropPiece>;
    credits: CreditEntry[];
  };
  maskReference: Record<string, MaskReference>;
  actions: { id: string; label: string }[];
  bodyTypes: Record<string, ExtendedBodyTypeDefinition>;
};

// ---------------------------------------------------------------------------
// Exported document (game side)
// ---------------------------------------------------------------------------

/** A piece inside the exported PNG. */
export type ExportedPiece = {
  rect: RectXYWH;
  /** Rest position of the piece's top-left inside the 64x64 cell. */
  at: Point;
  pivot: Point;
};

export type ExportedAction = ExtendedAction & {
  /** Where the pre-rendered ("baked") frames live in the PNG, one row per direction. */
  baked: Record<ExtendedDirection, { y: number; frames: number }>;
};

export type ClassicFrame = {
  frame: { x: number; y: number; w: number; h: number };
};

export type ExtendedDocument = {
  format: typeof EXTENDED_FORMAT;
  version: typeof EXTENDED_FORMAT_VERSION;
  meta: {
    image: string;
    size: { w: number; h: number };
    cell: number;
    bodyType: string;
    generator: string;
  };
  /** TexturePacker-style frames: every standard and baked cell, by name. */
  frames: Record<string, ClassicFrame>;
  /** TexturePacker-style animations: lists of frame names. */
  animations: Record<string, string[]>;
  /** Pieces for the extended actions. */
  pieces: Record<string, ExportedPiece>;
  /** Extended actions, frame by frame. */
  actions: Record<string, ExportedAction>;
  credits: CreditEntry[];
};
