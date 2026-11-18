// Pure layout helpers for the extended region of the spritesheet:
// piece packing, baked rows and the TexturePacker-style frame names.

import {
  EXTENDED_DIRECTIONS,
  type ClassicFrame,
  type ExtendedAction,
  type ExtendedDirection,
  type RectXYWH,
} from "./format.ts";

export type PackInput = { name: string; w: number; h: number };

/**
 * Shelf packing in input order (so related pieces stay together and the PNG is
 * easy to read). Every piece gets `padding` transparent pixels around it.
 */
export function shelfPack(
  items: readonly PackInput[],
  width: number,
  padding: number = 1,
): { rects: Record<string, RectXYWH>; height: number } {
  const rects: Record<string, RectXYWH> = {};
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  for (const item of items) {
    if (x + item.w + padding > width && x > padding) {
      x = padding;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    rects[item.name] = [x, y, item.w, item.h];
    x += item.w + padding;
    rowHeight = Math.max(rowHeight, item.h);
  }
  return { rects, height: items.length ? y + rowHeight + padding : 0 };
}

/** Row index (0-based, in baked rows) of every action/direction, in definition order. */
export function bakedRowLayout(
  actionIds: readonly string[],
): { id: string; dir: ExtendedDirection; row: number }[] {
  const rows: { id: string; dir: ExtendedDirection; row: number }[] = [];
  for (const id of actionIds) {
    for (const dir of EXTENDED_DIRECTIONS)
      rows.push({ id, dir, row: rows.length });
  }
  return rows;
}

/** Longest frame list of an action (baked rows are that wide). */
export function actionFrameCount(action: ExtendedAction): number {
  return Math.max(
    ...EXTENDED_DIRECTIONS.map((d) => action.directions[d].length),
  );
}

/**
 * Standard LPC rows as TexturePacker frames, using the same names as the
 * universal-sheet JSONs in the wild (`walk_up_0`, `hurt_3`, `1h_slash_left_12`...).
 */
export const CLASSIC_ROWS: readonly {
  name: string;
  row: number;
  frames: number;
  directional: boolean;
}[] = [
  { name: "spellcast", row: 0, frames: 7, directional: true },
  { name: "thrust", row: 4, frames: 8, directional: true },
  { name: "walk", row: 8, frames: 9, directional: true },
  { name: "slash", row: 12, frames: 6, directional: true },
  { name: "shoot", row: 16, frames: 13, directional: true },
  { name: "hurt", row: 20, frames: 6, directional: false },
  { name: "climb", row: 21, frames: 6, directional: false },
  { name: "idle", row: 22, frames: 2, directional: true },
  { name: "jump", row: 26, frames: 5, directional: true },
  { name: "sit", row: 30, frames: 3, directional: true },
  { name: "emote", row: 34, frames: 3, directional: true },
  { name: "run", row: 38, frames: 8, directional: true },
  { name: "combat", row: 42, frames: 2, directional: true },
  { name: "1h_slash", row: 46, frames: 13, directional: true },
  { name: "1h_halfslash", row: 50, frames: 6, directional: true },
];

export function classicFrames(
  cell: number,
  baked: readonly { name: string; y: number; frames: number }[],
): {
  frames: Record<string, ClassicFrame>;
  animations: Record<string, string[]>;
} {
  const frames: Record<string, ClassicFrame> = {};
  const animations: Record<string, string[]> = {};
  const addRow = (anim: string, y: number, count: number): void => {
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const name = `${anim}_${i}`;
      frames[name] = { frame: { x: i * cell, y, w: cell, h: cell } };
      names.push(name);
    }
    animations[anim] = names;
  };
  for (const r of CLASSIC_ROWS) {
    if (!r.directional) {
      addRow(r.name, r.row * cell, r.frames);
      continue;
    }
    EXTENDED_DIRECTIONS.forEach((dir, i) => {
      addRow(`${r.name}_${dir}`, (r.row + i) * cell, r.frames);
    });
  }
  for (const b of baked) addRow(b.name, b.y, b.frames);
  return { frames, animations };
}
