import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha-globals";
import {
  buildExtendedRegion,
  createGroupSheets,
  groupBandY,
  supportsExtended,
  actionDurations,
} from "../../sources/extended/build.ts";
import { drawExtendedFrame } from "../../sources/extended/draw.ts";
import { buildExtendedDocument } from "../../sources/extended/document.ts";
import {
  extendedCredits,
  getExtendedRender,
  isExtendedActionsEnabled,
  setExtendedActionsEnabled,
  setExtendedRender,
} from "../../sources/extended/state.ts";
import { loadImage } from "../../sources/canvas/load-image.ts";

/** Draw the real base body/head sheets into the group bands, like the renderer does. */
async function drawBase(
  sheets: ReturnType<typeof createGroupSheets>,
): Promise<void> {
  for (const anim of sheets.animations) {
    const y = groupBandY(sheets, anim)!;
    const body = await loadImage(`spritesheets/body/bodies/male/${anim}.png`);
    const head = await loadImage(
      `spritesheets/head/heads/human/male/${anim}.png`,
    );
    sheets.canvases.body.getContext("2d")!.drawImage(body, 0, y);
    sheets.canvases.head.getContext("2d")!.drawImage(head, 0, y);
  }
}

describe("extended actions", () => {
  beforeEach(() => setExtendedActionsEnabled(true));
  afterEach(() => setExtendedActionsEnabled(false));

  it("is enabled only through the bootstrap switch and for male/female", () => {
    expect(isExtendedActionsEnabled()).to.equal(true);
    expect(supportsExtended("male")).to.equal(true);
    expect(supportsExtended("female")).to.equal(true);
    expect(supportsExtended("child")).to.equal(false);
    setExtendedActionsEnabled(false);
    expect(isExtendedActionsEnabled()).to.equal(false);
  });

  it("keeps one band per source animation", () => {
    const sheets = createGroupSheets("male", 832);
    for (const a of ["walk", "run", "thrust", "shoot"]) {
      expect(sheets.animations.includes(a)).to.equal(true);
    }
    expect(sheets.canvases.body.height).to.equal(
      sheets.animations.length * 256,
    );
    expect(groupBandY(sheets, "walk")).to.be.a("number");
    expect(groupBandY(sheets, "slash")).to.equal(null);
  });

  it("returns null for a body type without extended actions", async () => {
    const sheets = createGroupSheets("child", 832);
    expect(await buildExtendedRegion("child", sheets, 832)).to.equal(null);
  });

  it("bakes every action row and packs the pieces below them", async () => {
    const sheets = createGroupSheets("male", 832);
    await drawBase(sheets);
    const region = await buildExtendedRegion("male", sheets, 832);
    expect(region).to.not.equal(null);
    const r = region!;
    expect(r.order).to.deep.equal([
      "shotgun_walk",
      "shotgun_run",
      "shotgun_shoot",
    ]);
    expect(r.baked.shotgun_walk.up.y).to.equal(0);
    expect(r.baked.shotgun_shoot.right.y).to.equal(11 * 64);
    expect(r.canvas.height).to.be.greaterThan(12 * 64);
    expect(r.pieces.shotgun.rect[1]).to.be.at.least(12 * 64);
    expect(r.pieces["walk_down_1.lower"]).to.not.equal(undefined);
    expect(r.credits.length).to.be.greaterThan(0);
    // something opaque was baked in the first walk frame
    const px = r.canvas.getContext("2d")!.getImageData(0, 0, 64, 64).data;
    let opaque = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) opaque++;
    expect(opaque).to.be.greaterThan(100);
    expect(actionDurations(r.actions.shotgun_shoot).length).to.equal(
      r.actions.shotgun_shoot.directions.right.length,
    );

    setExtendedRender({
      region: r,
      offsetY: 3456,
      sheetWidth: 832,
      sheetHeight: 3456 + r.canvas.height,
    });
    expect(getExtendedRender()?.region).to.equal(r);
    expect(extendedCredits("male")[0].fileName).to.match(/\.png$/);
    expect(extendedCredits("female")).to.deep.equal([]);
    const doc = buildExtendedDocument(getExtendedRender()!, "sheet.png");
    expect(doc.format).to.equal("lpc-extended");
    expect(doc.meta.image).to.equal("sheet.png");
    expect(doc.frames.walk_up_0.frame.y).to.equal(512);
    expect(doc.frames.shotgun_walk_up_0.frame.y).to.equal(3456);
    expect(doc.pieces.shotgun.rect[1]).to.equal(
      r.pieces.shotgun.rect[1] + 3456,
    );
    expect(doc.actions.shotgun_run.baked.down.y).to.equal(3456 + 6 * 64);
  });

  it("draws layers with position, rotation, scale and alpha", () => {
    const src = document.createElement("canvas");
    src.width = src.height = 4;
    const sctx = src.getContext("2d")!;
    sctx.fillStyle = "#ff0000";
    sctx.fillRect(0, 0, 4, 4);
    const dest = document.createElement("canvas");
    dest.width = dest.height = 64;
    const ctx = dest.getContext("2d")!;
    drawExtendedFrame(
      ctx,
      {
        t: 100,
        layers: [
          { p: "sq", x: 10, y: 20 },
          { p: "sq", x: 30, y: 30, r: 90, sx: -1, sy: 2, a: 0.5 },
          { p: "missing" },
        ],
      },
      { sq: { image: src, rect: [0, 0, 4, 4], at: [0, 0], pivot: [2, 2] } },
      0,
      0,
    );
    const at = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data;
    expect(at(11, 21)[0]).to.equal(255);
    expect(at(5, 5)[3]).to.equal(0);
    const a = at(32, 32)[3]; // half alpha
    expect(a > 120 && a < 135).to.equal(true);
  });
});
