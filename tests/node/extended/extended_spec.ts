import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPiece,
  computeArmMask,
  cropRgba,
  despeckle,
  extractCell,
  extractMaskCell,
  makeRgba,
  opaqueBounds,
  type Rgba,
  type SourceCell,
} from "../../../sources/extended/pixels.ts";
import {
  bakedRowLayout,
  classicFrames,
  shelfPack,
} from "../../../sources/extended/layout.ts";
import { extendedGroupFor } from "../../../sources/extended/groups.ts";
import {
  EXTENDED_DIRECTIONS,
  type ExtendedDefinition,
} from "../../../sources/extended/format.ts";

function setPx(img: Rgba, x: number, y: number, rgba: number[]): void {
  img.data.set(rgba, (y * img.width + x) * 4);
}
function alpha(img: Rgba, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4 + 3];
}
function fillRect(
  img: Rgba,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: number[],
): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) setPx(img, x, y, rgba);
}
function emptyCell(): SourceCell {
  return {
    body: makeRgba(64, 64),
    head: makeRgba(64, 64),
    headBack: makeRgba(64, 64),
    gear: makeRgba(64, 64),
    gearBack: makeRgba(64, 64),
    arm: new Uint8Array(64 * 64),
  };
}

test("computeArmMask keeps bare body pixels inside the arm rows only", () => {
  const body = makeRgba(64, 64);
  fillRect(body, 20, 20, 44, 60, [200, 150, 120, 255]);
  const shirt = makeRgba(64, 64);
  fillRect(shirt, 24, 20, 40, 60, [0, 0, 255, 255]);
  const mask = computeArmMask(body, [shirt], [33, 54]);
  assert.equal(mask[40 * 64 + 21], 1, "uncovered pixel in arm rows");
  assert.equal(mask[40 * 64 + 30], 0, "covered by the shirt");
  assert.equal(mask[25 * 64 + 21], 0, "above the arm rows (neck)");
  assert.equal(mask[58 * 64 + 21], 0, "below the arm rows (ankles)");
});

test("extractCell / extractMaskCell copy one cell and pad out of range", () => {
  const sheet = makeRgba(128, 64);
  setPx(sheet, 70, 3, [1, 2, 3, 255]);
  const cell = extractCell(sheet, 64, 0);
  assert.equal(alpha(cell, 6, 3), 255);
  const edge = extractCell(sheet, 100, 0);
  assert.equal(alpha(edge, 40, 3), 0);
  const mask = new Uint8Array(128 * 64);
  mask[3 * 128 + 70] = 1;
  assert.equal(extractMaskCell(mask, 128, 64, 64, 0)[3 * 64 + 6], 1);
});

test("lower piece drops rows above the cut, removes loose arms, fills arms over legs", () => {
  const cell = emptyCell();
  // two legs from y=40 down, a hand overlapping the left leg and one hanging outside
  fillRect(cell.body, 20, 40, 30, 60, [10, 10, 10, 255]);
  fillRect(cell.body, 34, 40, 44, 60, [10, 10, 10, 255]);
  fillRect(cell.body, 24, 44, 27, 47, [250, 200, 160, 255]); // hand over the leg
  fillRect(cell.body, 46, 44, 50, 48, [250, 200, 160, 255]); // hand outside
  fillRect(cell.body, 20, 20, 44, 40, [99, 99, 99, 255]); // torso
  for (let y = 44; y < 47; y++)
    for (let x = 24; x < 27; x++) cell.arm[y * 64 + x] = 1;
  for (let y = 44; y < 48; y++)
    for (let x = 46; x < 50; x++) cell.arm[y * 64 + x] = 1;
  const out = buildPiece(
    { kind: "lower", anim: "walk", dir: "down", frame: 0, cut: 40 },
    cell,
  );
  assert.equal(alpha(out, 30, 30), 0, "torso above the cut is gone");
  assert.equal(alpha(out, 47, 45), 0, "loose hand is removed");
  const i = (45 * 64 + 25) * 4;
  assert.deepEqual(
    [...out.data.slice(i, i + 4)],
    [10, 10, 10, 255],
    "hole filled with the leg colour",
  );
});

test("upper / arms / body pieces respect cut, rects, erase and whole", () => {
  const cell = emptyCell();
  fillRect(cell.body, 20, 20, 44, 60, [50, 50, 50, 255]);
  fillRect(cell.body, 8, 30, 20, 38, [200, 160, 120, 255]); // arm sticking out
  for (let y = 30; y < 38; y++)
    for (let x = 8; x < 22; x++) cell.arm[y * 64 + x] = 1;
  const upper = buildPiece(
    { kind: "upper", anim: "thrust", dir: "right", frame: 1, cut: 40 },
    cell,
  );
  assert.equal(alpha(upper, 30, 50), 0);
  assert.equal(alpha(upper, 10, 33), 255);
  const arms = buildPiece(
    {
      kind: "arms",
      anim: "thrust",
      dir: "right",
      frame: 1,
      rects: [[0, 0, 15, 64]],
    },
    cell,
  );
  assert.equal(alpha(arms, 10, 33), 255);
  assert.equal(alpha(arms, 18, 33), 0, "outside rects");
  assert.equal(alpha(arms, 30, 30), 0, "not an arm pixel");
  const body = buildPiece(
    {
      kind: "body",
      anim: "shoot",
      dir: "right",
      frame: 4,
      erase: [[0, 0, 64, 64]],
      whole: [[40, 50, 44, 60]],
    },
    cell,
  );
  assert.equal(alpha(body, 10, 33), 0, "arm erased");
  assert.equal(alpha(body, 41, 55), 0, "whole area cleared");
  assert.equal(alpha(body, 30, 30), 255, "torso kept");
});

test("despeckle removes small blobs only", () => {
  const img = makeRgba(16, 16);
  setPx(img, 1, 1, [1, 1, 1, 255]);
  fillRect(img, 5, 5, 10, 10, [1, 1, 1, 255]);
  despeckle(img, 6);
  assert.equal(alpha(img, 1, 1), 0);
  assert.equal(alpha(img, 7, 7), 255);
});

test("opaqueBounds and cropRgba", () => {
  const img = makeRgba(16, 16);
  fillRect(img, 3, 4, 6, 9, [1, 1, 1, 255]);
  const b = opaqueBounds(img);
  assert.deepEqual(b, [3, 4, 3, 5]);
  assert.equal(opaqueBounds(makeRgba(4, 4)), null);
  const c = cropRgba(img, b!);
  assert.equal(c.width, 3);
  assert.equal(alpha(c, 0, 0), 255);
});

test("shelfPack wraps rows and reports the height", () => {
  const { rects, height } = shelfPack(
    [
      { name: "a", w: 30, h: 10 },
      { name: "b", w: 30, h: 20 },
      { name: "c", w: 30, h: 5 },
    ],
    64,
  );
  assert.deepEqual(rects.a, [1, 1, 30, 10]);
  assert.deepEqual(rects.b, [32, 1, 30, 20]);
  assert.deepEqual(rects.c, [1, 22, 30, 5]);
  assert.equal(height, 28);
});

test("baked rows and classic frame names", () => {
  const rows = bakedRowLayout(["a", "b"]);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[5], { id: "b", dir: "left", row: 5 });
  const { frames, animations } = classicFrames(64, [
    { name: "a_up", y: 4000, frames: 2 },
  ]);
  assert.deepEqual(frames.walk_up_0.frame, { x: 0, y: 512, w: 64, h: 64 });
  assert.equal(animations.shoot_right.length, 13);
  assert.deepEqual(animations.hurt, [
    "hurt_0",
    "hurt_1",
    "hurt_2",
    "hurt_3",
    "hurt_4",
    "hurt_5",
  ]);
  assert.deepEqual(frames.a_up_1.frame, { x: 64, y: 4000, w: 64, h: 64 });
});

test("extendedGroupFor splits head, back hair, gear and body", () => {
  assert.equal(
    extendedGroupFor({ path: ["hair", "long", "x"], type_name: "hair" }, 120),
    "head",
  );
  assert.equal(
    extendedGroupFor({ path: ["hair", "long", "x"], type_name: "hair" }, 9),
    "headBack",
  );
  assert.equal(
    extendedGroupFor(
      { path: ["headwear", "hats", "x"], type_name: "hat" },
      130,
    ),
    "head",
  );
  assert.equal(
    extendedGroupFor(
      { path: ["headwear", "neck", "x"], type_name: "neck" },
      60,
    ),
    "body",
  );
  assert.equal(
    extendedGroupFor(
      { path: ["torso", "backpack", "x"], type_name: "backpack" },
      110,
    ),
    "gear",
  );
  assert.equal(
    extendedGroupFor({ path: ["torso", "cape", "x"], type_name: "cape" }, 5),
    "gearBack",
  );
  assert.equal(
    extendedGroupFor(
      { path: ["weapons", "sword", "x"], type_name: "weapon" },
      140,
    ),
    null,
  );
  assert.equal(
    extendedGroupFor({ path: ["legs", "pants", "x"], type_name: "legs" }, 20),
    "body",
  );
});

test("shotgun definition is consistent", () => {
  const file = fileURLToPath(
    new URL(
      "../../../sources/extended/definitions/shotgun.json",
      import.meta.url,
    ),
  );
  const def = JSON.parse(fs.readFileSync(file, "utf8")) as ExtendedDefinition;
  const propsPng = fileURLToPath(
    new URL(`../../../spritesheets/${def.props.image}`, import.meta.url),
  );
  assert.ok(fs.existsSync(propsPng), "props image exists");
  assert.ok(def.props.credits.length > 0, "props have credits");
  assert.deepEqual(Object.keys(def.bodyTypes).sort(), ["female", "male"]);
  for (const [bt, btDef] of Object.entries(def.bodyTypes)) {
    assert.ok(def.maskReference[bt], `mask reference for ${bt}`);
    for (const { id } of def.actions) {
      const action = btDef.actions[id];
      assert.ok(action, `${bt} ${id}`);
      for (const dir of EXTENDED_DIRECTIONS) {
        const frames = action.directions[dir];
        assert.ok(
          frames.length > 0 && frames.length <= 13,
          `${bt} ${id} ${dir} fits a row`,
        );
        for (const frame of frames) {
          assert.ok(frame.t > 0);
          for (const layer of frame.layers) {
            assert.ok(
              btDef.pieces[layer.p] || def.props.pieces[layer.p],
              `${bt} ${id} ${dir}: unknown piece ${layer.p}`,
            );
          }
        }
      }
    }
  }
});
