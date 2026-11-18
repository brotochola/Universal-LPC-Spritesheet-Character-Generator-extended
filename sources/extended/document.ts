// Builds the extended JSON that ships next to the spritesheet PNG.

import {
  EXTENDED_DIRECTIONS,
  EXTENDED_FORMAT,
  EXTENDED_FORMAT_VERSION,
  type ExportedAction,
  type ExportedPiece,
  type ExtendedDocument,
} from "./format.ts";
import { classicFrames } from "./layout.ts";
import type { ExtendedRenderState } from "./state.ts";

export const EXTENDED_GENERATOR =
  "Universal-LPC-Spritesheet-Character-Generator-extended";

export function buildExtendedDocument(
  render: ExtendedRenderState,
  imageName: string,
): ExtendedDocument {
  const { region, offsetY } = render;
  const cell = 64;

  const baked: { name: string; y: number; frames: number }[] = [];
  const actions: Record<string, ExportedAction> = {};
  for (const id of region.order) {
    const action = region.actions[id];
    const positions = region.baked[id];
    const shifted = {} as ExportedAction["baked"];
    for (const dir of EXTENDED_DIRECTIONS) {
      shifted[dir] = {
        y: positions[dir].y + offsetY,
        frames: positions[dir].frames,
      };
      baked.push({
        name: `${id}_${dir}`,
        y: shifted[dir].y,
        frames: positions[dir].frames,
      });
    }
    actions[id] = { ...action, baked: shifted };
  }

  const pieces: Record<string, ExportedPiece> = {};
  for (const [name, p] of Object.entries(region.pieces)) {
    pieces[name] = {
      rect: [p.rect[0], p.rect[1] + offsetY, p.rect[2], p.rect[3]],
      at: p.at,
      pivot: p.pivot,
    };
  }

  const { frames, animations } = classicFrames(cell, baked);
  return {
    format: EXTENDED_FORMAT,
    version: EXTENDED_FORMAT_VERSION,
    meta: {
      image: imageName,
      size: { w: render.sheetWidth, h: render.sheetHeight },
      cell,
      bodyType: region.bodyType,
      generator: EXTENDED_GENERATOR,
    },
    frames,
    animations,
    pieces,
    actions,
    credits: region.credits,
  };
}
