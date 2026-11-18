// Canvas 2D drawing of one extended frame (used to bake rows and by the preview).

import type { ExtendedFrame, Point, RectXYWH } from "./format.ts";

export type PieceSource = {
  image: CanvasImageSource;
  /** Source rectangle inside `image`. */
  rect: RectXYWH;
  /** Rest position of the piece's top-left inside the cell. */
  at: Point;
  pivot: Point;
};

/**
 * Draw `frame` with the cell's top-left at (`originX`, `originY`).
 * Layers referencing unknown or empty pieces are skipped.
 */
export function drawExtendedFrame(
  ctx: CanvasRenderingContext2D,
  frame: ExtendedFrame,
  pieces: Readonly<Record<string, PieceSource | undefined>>,
  originX: number,
  originY: number,
): void {
  for (const layer of frame.layers) {
    const piece = pieces[layer.p];
    if (!piece) continue;
    const [sx, sy, w, h] = piece.rect;
    if (w <= 0 || h <= 0) continue;
    const [px, py] = piece.pivot;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = layer.a ?? 1;
    ctx.translate(
      originX + piece.at[0] + (layer.x ?? 0) + px,
      originY + piece.at[1] + (layer.y ?? 0) + py,
    );
    if (layer.r) ctx.rotate((layer.r * Math.PI) / 180);
    const scaleX = layer.sx ?? 1;
    const scaleY = layer.sy ?? 1;
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.drawImage(piece.image, sx, sy, w, h, -px, -py, w, h);
    ctx.restore();
  }
}
