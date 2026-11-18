// The extended region of the last main-canvas render: where it sits in the
// spritesheet and what it contains. Read by the preview and the exporters.

import type { ExtendedRegion } from "./build.ts";
import type { CreditEntry } from "./format.ts";

export type ExtendedRenderState = {
  region: ExtendedRegion;
  /** Y of the region's top inside the full spritesheet. */
  offsetY: number;
  sheetWidth: number;
  sheetHeight: number;
};

let current: ExtendedRenderState | null = null;

/**
 * Off until the app bootstrap (`main.ts`) turns it on, so specs that render
 * the standard sheet are not affected by the extended region.
 */
let enabled = false;

export function setExtendedActionsEnabled(value: boolean): void {
  enabled = value;
  if (!value) current = null;
}

export function isExtendedActionsEnabled(): boolean {
  return enabled;
}

export function setExtendedRender(state: ExtendedRenderState | null): void {
  current = state;
}

export function getExtendedRender(): ExtendedRenderState | null {
  return current;
}

/** Credits for the extended props, shaped like `getAllCredits` entries. */
export function extendedCredits(
  bodyType: string,
): (CreditEntry & { fileName: string })[] {
  if (!current || current.region.bodyType !== bodyType) return [];
  return current.region.credits.map((c) => ({
    ...c,
    fileName: `${c.file}.png`,
  }));
}
