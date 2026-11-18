// Pure RGBA pixel operations used to cut the character into pieces.
// No DOM: everything works on `{ width, height, data }` buffers so it can be unit
// tested in Node and fed from `CanvasRenderingContext2D.getImageData`.

import type { PieceRecipe, RectBounds, RectXYWH } from "./format.ts";

export const CELL = 64;

export type Rgba = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export function makeRgba(width: number, height: number): Rgba {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function alphaAt(img: Rgba, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3];
}

function copyPixel(
  src: Rgba,
  sx: number,
  sy: number,
  dst: Rgba,
  dx: number,
  dy: number,
): void {
  const s = (sy * src.width + sx) * 4;
  const d = (dy * dst.width + dx) * 4;
  dst.data[d] = src.data[s];
  dst.data[d + 1] = src.data[s + 1];
  dst.data[d + 2] = src.data[s + 2];
  dst.data[d + 3] = src.data[s + 3];
}

function clearPixel(img: Rgba, x: number, y: number): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 0;
}

/**
 * Arm mask of a whole animation sheet: pixels of the bare base body that the
 * reference clothes (t-shirt, pants, shoes) leave uncovered — forearms and hands.
 * Only rows `[rows[0], rows[1])` of every cell are considered (skips the neck
 * above and stray ankle pixels below).
 */
export function computeArmMask(
  body: Rgba,
  clothes: readonly Rgba[],
  rows: readonly [number, number],
): Uint8Array {
  const { width, height } = body;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const cy = y % CELL;
    if (cy < rows[0] || cy >= rows[1]) continue;
    for (let x = 0; x < width; x++) {
      if (alphaAt(body, x, y) === 0) continue;
      let covered = false;
      for (const c of clothes) {
        if (x < c.width && y < c.height && alphaAt(c, x, y) > 0) {
          covered = true;
          break;
        }
      }
      if (!covered) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/** Copy a `size`x`size` cell starting at (x, y). Out-of-range pixels stay transparent. */
export function extractCell(
  src: Rgba,
  x: number,
  y: number,
  size: number = CELL,
): Rgba {
  const out = makeRgba(size, size);
  for (let j = 0; j < size; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= src.height) continue;
    for (let i = 0; i < size; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= src.width) continue;
      copyPixel(src, sx, sy, out, i, j);
    }
  }
  return out;
}

export function extractMaskCell(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  x: number,
  y: number,
  size: number = CELL,
): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= maskHeight) continue;
    for (let i = 0; i < size; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= maskWidth) continue;
      out[j * size + i] = mask[sy * maskWidth + sx];
    }
  }
  return out;
}

function cloneRgba(img: Rgba): Rgba {
  return {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
}

function inRects(x: number, y: number, rects: readonly RectBounds[]): boolean {
  for (const [x0, y0, x1, y1] of rects) {
    if (x >= x0 && x < x1 && y >= y0 && y < y1) return true;
  }
  return false;
}

/**
 * Legs without the arms that swing in front of them. Arm pixels with leg pixels
 * on both sides of the same row are holes in the leg: they get the colour of the
 * nearest leg pixel in that row. Other arm pixels are removed.
 */
function lowerPiece(body: Rgba, arm: Uint8Array, cut: number): Rgba {
  const size = body.width;
  const img = cloneRgba(body);
  const armCut = new Uint8Array(arm);
  for (let y = 0; y < Math.min(cut, size); y++) {
    for (let x = 0; x < size; x++) {
      clearPixel(img, x, y);
      armCut[y * size + x] = 0;
    }
  }
  const legAt = (x: number, y: number): boolean =>
    alphaAt(img, x, y) > 0 && armCut[y * size + x] === 0;
  const holes = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!armCut[y * size + x]) continue;
      let left = false;
      let right = false;
      for (let xx = Math.max(0, x - 6); xx < x && !left; xx++)
        left = legAt(xx, y);
      for (let xx = x + 1; xx < Math.min(size, x + 7) && !right; xx++)
        right = legAt(xx, y);
      if (left && right) holes[y * size + x] = 1;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (armCut[y * size + x] && !holes[y * size + x]) clearPixel(img, x, y);
    }
  }
  // Fill holes reading from `img` (not from the output) so fills do not cascade.
  const out = cloneRgba(img);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!holes[y * size + x]) continue;
      let found = false;
      for (let dx = 1; dx < 8 && !found; dx++) {
        for (const sx of [x - dx, x + dx]) {
          if (
            sx >= 0 &&
            sx < size &&
            !holes[y * size + sx] &&
            alphaAt(img, sx, y) > 0
          ) {
            copyPixel(img, sx, y, out, x, y);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        if (y + 1 < size && alphaAt(img, x, y + 1) > 0)
          copyPixel(img, x, y + 1, out, x, y);
        else clearPixel(out, x, y);
      }
    }
  }
  return out;
}

function keepWhere(img: Rgba, keep: (x: number, y: number) => boolean): Rgba {
  const out = makeRgba(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (keep(x, y)) copyPixel(img, x, y, out, x, y);
    }
  }
  return out;
}

/**
 * Remove connected blobs (8-connectivity) smaller than `minSize` pixels:
 * leftovers of the arm cut, never real parts of the character.
 */
export function despeckle(img: Rgba, minSize: number = 6): Rgba {
  const { width, height } = img;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const blob: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || img.data[start * 4 + 3] === 0) continue;
    seen[start] = 1;
    stack.push(start);
    blob.length = 0;
    while (stack.length) {
      const p = stack.pop()!;
      blob.push(p);
      const px = p % width;
      const py = (p - px) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (!seen[n] && img.data[n * 4 + 3] > 0) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (blob.length < minSize) {
      for (const p of blob) clearPixel(img, p % width, Math.floor(p / width));
    }
  }
  return img;
}

/** The 64x64 cells of one source frame, split by layer group, plus its arm mask. */
export type SourceCell = {
  body: Rgba;
  head: Rgba;
  headBack: Rgba;
  gear: Rgba;
  gearBack: Rgba;
  arm: Uint8Array;
};

/** Cut one piece out of a source frame. */
export function buildPiece(recipe: PieceRecipe, cell: SourceCell): Rgba {
  const { body, head, headBack, gear, gearBack, arm } = cell;
  const size = body.width;
  const isArm = (x: number, y: number): boolean => arm[y * size + x] === 1;
  let out: Rgba;
  switch (recipe.kind) {
    case "head":
      out = cloneRgba(head);
      break;
    case "headback":
      out = cloneRgba(headBack);
      break;
    case "gear":
      out = cloneRgba(gear);
      break;
    case "gearback":
      out = cloneRgba(gearBack);
      break;
    case "lower":
      out = lowerPiece(body, arm, recipe.cut ?? 0);
      break;
    case "upper": {
      const cut = recipe.cut ?? size;
      const erase = recipe.erase ?? [];
      out = keepWhere(
        body,
        (x, y) =>
          (y < cut || isArm(x, y)) && !(isArm(x, y) && inRects(x, y, erase)),
      );
      break;
    }
    case "arms": {
      const rects = recipe.rects ?? "all";
      const erase = recipe.erase ?? [];
      const whole = recipe.whole ?? [];
      out = keepWhere(
        body,
        (x, y) =>
          ((isArm(x, y) && (rects === "all" || inRects(x, y, rects))) ||
            inRects(x, y, whole)) &&
          !inRects(x, y, erase),
      );
      break;
    }
    case "body": {
      const erase = recipe.erase ?? [];
      const whole = recipe.whole ?? [];
      out = keepWhere(
        body,
        (x, y) =>
          !(isArm(x, y) && inRects(x, y, erase)) && !inRects(x, y, whole),
      );
      break;
    }
  }
  return despeckle(out);
}

/** Tight bounding box of the opaque pixels, or null when the image is empty. */
export function opaqueBounds(img: Rgba): RectXYWH | null {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (alphaAt(img, x, y) === 0) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export function cropRgba(img: Rgba, [x, y, w, h]: RectXYWH): Rgba {
  const out = makeRgba(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) copyPixel(img, x + i, y + j, out, i, j);
  }
  return out;
}
