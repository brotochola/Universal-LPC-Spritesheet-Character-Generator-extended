# Extended actions

The extended actions are new animations built **out of the standard LPC frames**:
the character is cut into pieces (legs, upper body, arms, head, back hair,
backpack...) and every frame of the new action lists which pieces to draw, where,
rotated and scaled how. Nothing is interpolated: every frame is explicit.

The first set is the **shotgun**: walk, run and shoot (pump, recoil, ejected
shell) in the 4 directions, for the `male` and `female` body types. The shotgun
art lives in [`spritesheets/extended/shotgun.png`](../../spritesheets/extended/shotgun.png).

## What the generator does

For male/female characters the spritesheet gets an extra region below the
standard sheet (and below any custom animation such as oversize weapons):

1. **Baked rows**: every extended action rendered into ordinary 64x64 frames,
   one row per direction (`up`, `left`, `down`, `right`), so engines that only
   read a grid can use them as is.
2. **Pieces atlas**: every piece the actions use, packed tightly. These are the
   "separations": legs without the arms that swing in front of them, upper
   bodies, whole arms, heads, back hair, backpacks, plus the shotgun props.

**Download → Extended JSON** (or **ZIP: PNG + extended JSON**) exports the
JSON that describes all of it. The animation preview lists the new actions as
`Shotgun walk (extended)` etc.

## How pieces are cut

The renderer draws the character a second time split by layer group
([`sources/extended/groups.ts`](../../sources/extended/groups.ts)):

| Group      | Items                                                        |
| ---------- | ------------------------------------------------------------ |
| `head`     | head, face, eyes, hair, hats, glasses, earrings...            |
| `headBack` | head layers drawn behind the body (long hair, ponytails)      |
| `gear`     | backpacks and capes (`gearBack` for their layers behind body) |
| `body`     | everything else (body, clothes, legs, shoes...)               |

Weapons and tools are left out: the actions bring their own props.

Arms are found with an **arm mask**: pixels of the bare base body that a
reference sleeveless shirt + pants + shoes leave uncovered
([`pixels.ts`](../../sources/extended/pixels.ts) `computeArmMask`). The mask is
computed in the browser from the base sprites, so it works with any outfit.
Piece kinds (`PieceRecipe.kind` in [`format.ts`](../../sources/extended/format.ts)):

- `lower`: body rows below `cut`; arm pixels are removed and, where an arm was in
  front of a leg, the hole is filled with the leg colour next to it.
- `upper`: body rows above `cut` plus the arms below it.
- `arms`: arm pixels only (limited to `rects`, plus everything inside `whole`
  for clothes wider than the arm, minus `erase`).
- `body`: the whole body group minus arm pixels in `erase` and everything in `whole`.
- `head`, `headback`, `gear`, `gearback`: the matching group as is.

A tiny clean-up (`despeckle`) removes blobs smaller than 6 pixels left by the cuts.

## The exported JSON (`format: "lpc-extended"`)

```jsonc
{
  "format": "lpc-extended",
  "version": 1,
  "meta": { "image": "character-spritesheet.png", "size": { "w": 832, "h": 4417 },
            "cell": 64, "bodyType": "male", "generator": "…" },

  // TexturePacker-style, same names as usual: walk_up_0 … plus the baked rows
  "frames": { "walk_up_0": { "frame": { "x": 0, "y": 512, "w": 64, "h": 64 } }, "…": {} },
  "animations": { "walk_up": ["walk_up_0", "…"], "shotgun_walk_up": ["…"] },

  // pieces inside the PNG
  "pieces": {
    "walk_right_3.lower": { "rect": [x, y, w, h], "at": [ax, ay], "pivot": [px, py] },
    "shotgun":            { "rect": [x, y, w, h], "at": [0, 0],   "pivot": [17, 3] }
  },

  "actions": {
    "shotgun_shoot": {
      "label": "Shotgun shoot", "loop": false,
      "baked": { "up": { "y": 4096, "frames": 10 }, "…": {} },
      "directions": {
        "right": [
          { "t": 60,                                   // duration (ms)
            "layers": [                                // draw order
              { "p": "shoot_right_4.body", "x": -2 },
              { "p": "shotgun", "x": 27, "y": 30, "r": -8 },
              { "p": "shoot_right_4.reararm", "sx": -1 }
            ],
            "points": { "muzzle": [52, 30] },          // for game logic
            "events": ["fire"] }                       // fired when the frame starts
        ]
      }
    }
  },
  "credits": [ … ]
}
```

**Layer semantics.** A piece rests at `at` (its top-left inside the 64x64 cell;
character pieces keep the position they had in the source frame, props rest at
`0,0`). A layer draws it with its top-left at `at + (x, y)`, rotated `r` degrees
(clockwise) and scaled `sx`, `sy` around `pivot` (relative to the piece). Negative
scale mirrors. `a` is alpha. Omitted values are `0` / `1`.

- Canvas: `translate(at + xy + pivot) rotate(r) scale(sx, sy) drawImage(piece, -pivot)`
- Pixi: `anchor = pivot / size`, `position = origin + at + xy + pivot`, `rotation = r·π/180`

Every piece is a rectangle of the same PNG, so a whole crowd can be drawn with a
single Pixi `ParticleContainer` (one `Particle` per layer).

## Reference reader (Pixi v8)

[`tools/extended-viewer/index.html`](../extended-viewer/index.html) loads the PNG
and the JSON (file pickers, drag and drop, or `?png=…&json=…`) and plays every
action with `ParticleContainer`, next to the baked frames, or as a crowd.

## Regenerating the shotgun definition

The definition ([`sources/extended/definitions/shotgun.json`](../../sources/extended/definitions/shotgun.json))
and the props PNG are generated by [`build_shotgun.py`](build_shotgun.py), which
holds the poses (which source frame each part comes from, where the hands and the
gun go) and writes every frame explicitly:

```bash
python3 tools/extended/build_shotgun.py
```

Requires Python 3 with Pillow and numpy. Edit the pose tables (`WALK`, `RUN`,
`SHOOT`) or the `SHOOT_SCRIPT` timing, regenerate, and check the result in the
app's preview. New actions can also be written by hand: any JSON with the same
shape added to `EXTENDED_DEFINITIONS` in
[`sources/extended/build.ts`](../../sources/extended/build.ts) shows up in the app.

## Known limits

- Only `male` and `female` are authored.
- Items without `run` sprites (several jackets and backpacks) are missing from
  LPC's own `run` row; the shotgun run takes the upper body from a `run` frame, so
  such jackets are missing there too. Backpacks/capes are taken from a walking frame.
- Pixel art rotated at arbitrary angles gets jagged; large angles use
  pre-rotated sprites (`shotgun_r20`, `shotgun_rn30`...) and runtime rotation is
  kept to small kicks and the spinning shell.

## Credits

The shotgun art (`spritesheets/extended/shotgun.png`) is credited in the
definition's `props.credits` (CC-BY-SA 3.0 / GPL 3.0, brotochola). The app adds it
to the credits list and downloads whenever the extended actions are rendered.
Everything else in the extended region is cut from the selected LPC items, whose
credits already apply.
