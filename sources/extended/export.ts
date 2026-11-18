// Downloads for the extended actions: the extended JSON alone, or a ZIP with the
// spritesheet PNG, the JSON and the credits.

import { downloadFile } from "../canvas/download.ts";
import { canvasToBlob } from "../canvas/canvas-utils.ts";
import { getCanvas } from "../canvas/renderer.ts";
import type { CatalogReader } from "../state/catalog.ts";
import type { State } from "../state/state.ts";
import { creditsToCsv, creditsToTxt, getAllCredits } from "../utils/credits.ts";
import {
  downloadZipBlob,
  guardZipExportEnvironment,
  zipExportTimestamp,
  type ZipFolder,
} from "../utils/zip-helpers.ts";
import { buildExtendedDocument } from "./document.ts";
import { extendedCredits, getExtendedRender } from "./state.ts";

export const EXTENDED_IMAGE_NAME = "character-spritesheet.png";
export const EXTENDED_JSON_NAME = "character-spritesheet.json";

export function isExtendedExportAvailable(bodyType: string): boolean {
  return getExtendedRender()?.region.bodyType === bodyType;
}

/** The extended JSON for the current render, or null when there is none. */
export function currentExtendedJson(): string | null {
  const render = getExtendedRender();
  if (!render) return null;
  return JSON.stringify(
    buildExtendedDocument(render, EXTENDED_IMAGE_NAME),
    null,
    1,
  );
}

export function downloadExtendedJson(): void {
  const json = currentExtendedJson();
  if (!json) return;
  downloadFile(json, EXTENDED_JSON_NAME, "application/json");
}

/** All credits for the current character, extended props included. */
export function creditsWithExtended(
  catalog: CatalogReader,
  state: State,
): ReturnType<typeof getAllCredits> {
  const itemCredits = getAllCredits(catalog, state.selections, state.bodyType);
  return itemCredits.length
    ? [...itemCredits, ...extendedCredits(state.bodyType)]
    : itemCredits;
}

export async function exportExtendedZip(
  catalog: CatalogReader,
  state: State,
): Promise<void> {
  const json = currentExtendedJson();
  const canvasResult = getCanvas();
  if (!json || canvasResult.isErr()) return;
  if (!guardZipExportEnvironment()) return;
  const JSZip = (window as Window & { JSZip?: new () => ZipFolder }).JSZip!;
  const zip = new JSZip();
  zip.file(EXTENDED_IMAGE_NAME, await canvasToBlob(canvasResult.value));
  zip.file(EXTENDED_JSON_NAME, json);
  const credits = creditsWithExtended(catalog, state);
  zip.file("credits.txt", creditsToTxt(credits));
  zip.file("credits.csv", creditsToCsv(credits));
  const blob = await zip.generateAsync({ type: "blob" });
  downloadZipBlob(
    blob,
    `lpc-extended_${state.bodyType}_${zipExportTimestamp()}.zip`,
  );
}
