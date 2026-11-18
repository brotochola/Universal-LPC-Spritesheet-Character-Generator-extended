#!/usr/bin/env python3
"""
Authoring tool for the extended "shotgun" actions.

Generates, from the LPC base sprites in `spritesheets/`:
  * spritesheets/extended/shotgun.png            – prop atlas (shotgun views, pre-rotated variants, pump, shell)
  * sources/extended/definitions/shotgun.json    – piece recipes + frame-by-frame actions for male/female

The JSON is the source of truth the app reads. Every frame is explicit (no tweens/keyframes):
each layer says which piece to draw and its x, y, r (degrees), sx, sy.

Layer semantics (same as the exported extended JSON and the Pixi reader):
  a piece has a rest position `at` inside the 64x64 cell (character pieces keep their original
  place; props rest at 0,0) and a `pivot` (relative to the piece). A layer draws the piece with its
  top-left at `at + (x, y)`, rotated by `r` and scaled by (`sx`, `sy`) around the pivot.
  Canvas: translate(at+xy+pivot) rotate(r) scale(sx,sy) drawImage(piece, -pivot).

Run from the repo root:  python3 tools/extended/build_shotgun.py
Requires: Python 3 + Pillow + numpy (and `npx prettier`, used to format the JSON).
Body types listed here must match `EXTENDED_DEFINITIONS` in sources/extended/build.ts.
"""
import json, math, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHEETS = os.path.join(ROOT, "spritesheets")
OUT_PNG = os.path.join(SHEETS, "extended", "shotgun.png")
OUT_JSON = os.path.join(ROOT, "sources", "extended", "definitions", "shotgun.json")
DIRS = ["up", "left", "down", "right"]
BODY_TYPES = ["male", "female"]

# ----------------------------------------------------------------------------- prop art
PAL = {
    "W": (156, 106, 60), "w": (123, 77, 42), "d": (90, 53, 25), "D": (66, 38, 18),
    "M": (118, 126, 136), "m": (74, 79, 86), "k": (43, 46, 50), "h": (170, 180, 190),
    "F": (58, 40, 28), "f": (92, 66, 48), "r": (38, 30, 24),
    "q": (52, 56, 62), "Q": (80, 86, 94),
    "R": (178, 40, 38), "y": (214, 170, 64), "Y": (240, 206, 110), "P": (120, 24, 24),
    "X": (20, 16, 14),
}
OUTLINE = (26, 20, 16)
SIDE = [  # muzzle to the right, inner pixels (outline added automatically)
    "dwwwwwwwkMMMhhhhhhhhhhhh",
    "wWWWWWWwkmmmmmmmmmmmmmmm",
    "wwwwwdd..kmkqqqqqqqqqQq.",
    "dddd.....kk.............",
    "DD......................",
]
FOREND = ["ffFfFff", "FFrFrFF"]           # pump, slides on the magazine tube
FOREND_AT_INNER = (13, 2)                   # where the forend sits on SIDE (inner coords)
GRIP_INNER = (16, 2)                        # support-hand grip (inner coords)
FRONT = [  # seen from the front, muzzle towards the viewer (stock up, muzzle ring down)
    "..ww..", ".wWWw.", ".dwwd.", "kMhMMk", "kmmmmk", ".fFFf.",
    ".FrrF.", ".FFFF.", "MhhhhM", "hXXXXh", "mXXXXm", ".mkkm.",
]
BACK = [  # seen from behind, muzzle away from the viewer (barrel up, butt plate down)
    ".hh.", ".mm.", ".mm.", ".mm.", "qmmq", "qmmq", "FffF", "FFrF",
    "FFFF", "kMMk", "kmmk", ".kk.", ".ww.", ".Ww.", "wWWw", "dDDd",
]
SHELL = ["RR", "PR", "yY"]
ROTATIONS = {"shotgun_r20": 20, "shotgun_rn15": -15, "shotgun_rn30": -30, "shotgun_rn45": -45}


def grid(rows):
    h = len(rows); w = max(len(r) for r in rows)
    a = np.zeros((h, w, 4), np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in PAL:
                a[y, x] = (*PAL[ch], 255)
    return a


def outline(a):
    h, w, _ = a.shape
    b = np.zeros((h + 2, w + 2, 4), np.uint8); b[1:-1, 1:-1] = a
    m = b[..., 3] > 0
    o = np.zeros_like(m)
    o[1:, :] |= m[:-1, :]; o[:-1, :] |= m[1:, :]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]
    o &= ~m
    b[o] = (*OUTLINE, 255)
    return b


def full_side_inner():
    a = grid(SIDE).copy(); f = grid(FOREND)
    for y in range(f.shape[0]):
        for x in range(f.shape[1]):
            if f[y, x, 3]:
                a[FOREND_AT_INNER[1] + y, FOREND_AT_INNER[0] + x] = f[y, x]
    return a


def rotate_ss(inner, angle, pivot, k=8, thresh=0.42):
    """Supersampled (k*k) majority rotation of inner pixel art around the centre of pixel `pivot`.
    Gives clean pixel art for large angles; outline is added after rotating.
    Returns (outlined image, pivot pixel in the outlined image)."""
    h, w = inner.shape[:2]
    th = math.radians(angle); c, s = math.cos(th), math.sin(th)
    pcx, pcy = pivot[0] + 0.5, pivot[1] + 0.5
    R = int(math.ceil(math.hypot(w, h))) + 2
    res = np.zeros((2 * R, 2 * R, 4), np.uint8)
    sub = (np.arange(k) + 0.5) / k
    for oy in range(2 * R):
        for ox in range(2 * R):
            du = np.broadcast_to((ox - R) + sub[None, :] - 0.5, (k, k))
            dv = np.broadcast_to((oy - R) + sub[:, None] - 0.5, (k, k))
            lx = c * du + s * dv + pcx; ly = -s * du + c * dv + pcy
            ix = np.floor(lx).astype(int).ravel(); iy = np.floor(ly).astype(int).ravel()
            ok = (ix >= 0) & (ix < w) & (iy >= 0) & (iy < h)
            if not ok.any():
                continue
            smp = inner[iy[ok], ix[ok]]
            op = smp[smp[:, 3] > 0]
            if len(op) >= thresh * k * k:
                cols, cnt = np.unique(op, axis=0, return_counts=True)
                res[oy, ox] = cols[cnt.argmax()]
    ys, xs = np.where(res[..., 3] > 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return outline(res[y0:y1, x0:x1]), (int(R - x0 + 1), int(R - y0 + 1))


def build_props():
    """Returns {name: (rgba, pivot)} and the packed atlas + rects."""
    props = {}
    side = outline(grid(SIDE))
    grip = (GRIP_INNER[0] + 1, GRIP_INNER[1] + 1)
    props["shotgun"] = (side, grip)
    fore = outline(grid(FOREND))
    props["shotgun_forend"] = (fore, (grip[0] - FOREND_AT_INNER[0], grip[1] - FOREND_AT_INNER[1]))
    inner = full_side_inner()
    for name, ang in ROTATIONS.items():
        props[name] = rotate_ss(inner, ang, GRIP_INNER)
    front = outline(grid(FRONT)); props["shotgun_front"] = (front, (front.shape[1] // 2, front.shape[0] // 2))
    # muzzle ring alone: drawn over the hands, it is the part closest to the camera
    muzzle = front[-5:].copy(); props["shotgun_front_muzzle"] = (muzzle, (muzzle.shape[1] // 2, 2))
    back = outline(grid(BACK)); props["shotgun_back"] = (back, (back.shape[1] // 2, back.shape[0] // 2))
    shell = grid(SHELL); props["shell"] = (shell, (1, 1))
    # simple shelf packing, 2px gap
    W = 128; x = y = rowh = 0; rects = {}
    for name, (img, _) in props.items():
        h, w = img.shape[:2]
        if x + w > W:
            x = 0; y += rowh + 2; rowh = 0
        rects[name] = (x, y, w, h); x += w + 2; rowh = max(rowh, h)
    H = y + rowh
    atlas = np.zeros((H, W, 4), np.uint8)
    for name, (img, _) in props.items():
        rx, ry, w, h = rects[name]; atlas[ry:ry + h, rx:rx + w] = img
    return props, rects, atlas


# ----------------------------------------------------------------------------- base sprite data
ROW_OFFSET = {"thrust": 4, "walk": 8, "shoot": 16, "run": 38, "combat_idle": 42}


def back_edge(bt, anim, d, f):
    """x of the torso's back edge (side views), from the base body around the belt."""
    img = np.array(Image.open(os.path.join(SHEETS, "body", "bodies", bt, anim + ".png")).convert("RGBA"))
    r = DIRS.index(d)
    cell = img[r * 64:(r + 1) * 64, f * 64:(f + 1) * 64, 3] > 0
    xs = [(np.where(cell[y])[0].min() if d == "right" else np.where(cell[y])[0].max()) for y in range(42, 46)]
    return int(round(float(np.median(xs))))


def head_anchor(bt, anim, d, f):
    """Top-left of the base human head in a cell; used to keep cut pieces glued together."""
    img = np.array(Image.open(os.path.join(SHEETS, "head", "heads", "human", bt, anim + ".png")).convert("RGBA"))
    r = DIRS.index(d)
    cell = img[r * 64:(r + 1) * 64, f * 64:(f + 1) * 64, 3] > 0
    ys = np.where(cell.any(1))[0]; xs = np.where(cell.any(0))[0]
    return int(xs.min()), int(ys.min())


# ----------------------------------------------------------------------------- authoring helpers
def L(p, x=0, y=0, r=0, sx=1, sy=1):
    layer = {"p": p}
    if x: layer["x"] = int(x)
    if y: layer["y"] = int(y)
    if r: layer["r"] = r
    if sx != 1: layer["sx"] = sx
    if sy != 1: layer["sy"] = sy
    return layer


def pname(anim, d, f, kind):
    return f"{anim}_{d}_{f}.{kind}"


def mirror_rect(rc):
    x0, y0, x1, y1 = rc
    return [64 - x1, y0, 64 - x0, y1]


class Author:
    def __init__(self, bt, props):
        self.bt = bt; self.props = props; self.pieces = {}

    def piece(self, kind, anim, d, f, **kw):
        name = pname(anim, d, f, kind)
        rec = {"kind": kind, "anim": anim, "dir": d, "frame": f}
        rec.update(kw)
        self.pieces[name] = rec
        return name

    def gun_layer(self, prop, G, sx, extra_rot=0, rot_about=None):
        """Place a prop so that its pivot pixel lands on world pixel G."""
        img, pv = self.props[prop]
        x = G[0] - pv[0] + (1 if sx < 0 else 0); y = G[1] - pv[1]
        return L(prop, x, y, extra_rot, sx)

    # ------------------------------------------------------------- walk / run (legs + upper body mix)
    def combo(self, action, anim, frames, cfgs, ms):
        out = {}
        for d in DIRS:
            cfg = cfgs[d] if d != "left" else mirror_combo(cfgs["right"])
            S = cfg["S"]; S = (S[0], d if S[1] == "*" else S[1], S[2])
            hxS, hyS = head_anchor(self.bt, *S)
            upper = self.piece("upper", *S, cut=hyS + 30, erase=cfg.get("erase", []))
            # backpacks/capes move with the upper body. Many LPC backpacks/capes have no
            # `run` sprites: when the pose comes from `run`, take them from a walking frame.
            gdx = gdy = 0
            if S[0] == "run":
                W = ("walk", d, 0)
                gdx = back_edge(self.bt, *S) - back_edge(self.bt, *W)
                gdy = head_anchor(self.bt, *S)[1] - head_anchor(self.bt, *W)[1]
                gear = self.piece("gear", *W); gearback = self.piece("gearback", *W)
            else:
                gear = self.piece("gear", *S); gearback = self.piece("gearback", *S)
            arms = cfg.get("arms", "all")
            arms_p = None if arms is None else self.piece("arms", *S, rects=arms)
            seq = []
            for f in frames:
                T = (anim, d, f)
                hxT, hyT = head_anchor(self.bt, *T)
                dx, dy = hxT - hxS, hyT - hyS
                lower = self.piece("lower", *T, cut=hyT + 28)
                head = self.piece("head", *T)
                headback = self.piece("headback", *T)
                G = (cfg["fist"][0] + dx, cfg["fist"][1] + dy)
                if "at" in cfg:      # prop placed by its top-left corner (back view)
                    gx, gy = cfg["at"][0] + dx, cfg["at"][1] + dy
                    gun = L(cfg["gun"], gx, gy)
                    muzzle = [gx + 3, gy]
                else:
                    gun = self.gun_layer(cfg["gun"], G, cfg["sx"])
                    muzzle = muzzle_point(cfg["gun"], G, cfg["sx"])
                layers = [L(headback), L(gearback, dx + gdx, dy + gdy), L(lower), L(upper, dx, dy),
                          L(gear, dx + gdx, dy + gdy), gun]
                if arms_p: layers.append(L(arms_p, dx, dy))
                layers.append(L(head))
                seq.append({"t": ms, "layers": layers, "points": {"muzzle": muzzle}})
            out[d] = seq
        return {"label": action[1], "loop": True, "directions": out}

    # ------------------------------------------------------------- shoot standing
    def shoot(self, cfg):
        out = {}
        for d in DIRS:
            if d in ("left", "right"):
                out[d] = self.shoot_side(cfg["right"], mirror=(d == "left"))
            else:
                out[d] = self.shoot_vertical(cfg[d], d)
        return {"label": "Shotgun shoot", "loop": False, "directions": out}

    def shoot_side(self, c, mirror):
        d = "left" if mirror else "right"
        S = (c["S"][0], d, c["S"][2]); sx = -1 if mirror else 1
        G = (63 - c["fist"][0], c["fist"][1]) if mirror else c["fist"]
        mr = (lambda rs: [mirror_rect(r) for r in rs]) if mirror else (lambda rs: [list(r) for r in rs])
        rear = mr(c["reararm"]); front = mr(c["frontarm"]); fistr = mr(c["fistrect"])
        rearw = mr(c["rearwhole"]); frontw = mr(c["frontwhole"])
        rpx = 64 - c["rearpivot"][0] if mirror else c["rearpivot"][0]
        # parts of the arms outside the torso are cut as a whole (coat sleeves are wider than arms)
        body = self.piece("body", *S, erase=rear + front, whole=rearw + frontw)
        forearm = pname(*S, "frontarm")
        self.pieces[forearm] = {"kind": "arms", "anim": S[0], "dir": S[1], "frame": S[2],
                                "rects": front, "whole": frontw, "erase": fistr}
        fist = self.piece("arms", *S, rects=fistr, whole=fistr)
        # the far arm is drawn pulling a bow string backwards: cut it and mirror it around
        # the shoulder so it ends on the stock wrist
        self.pieces[pname(*S, "reararm")] = {"kind": "arms", "anim": S[0], "dir": S[1], "frame": S[2],
                                              "rects": rear, "whole": rearw,
                                              "pivot": [rpx, c["rearpivot"][1]]}
        reararm = pname(*S, "reararm")
        head = self.piece("head", *S)
        # LPC layers have the arms that cover them cut out (backpacks, ponytails...).
        # This pose moves the far arm, so those layers come from a walking frame:
        # the hair glued to the head, the backpack/cape glued to the back.
        W = ("walk", d, 0)
        hxS, hyS = head_anchor(self.bt, *S); hxW, hyW = head_anchor(self.bt, *W)
        hdx, hdy = hxS - hxW, hyS - hyW
        gdx, gdy = back_edge(self.bt, *S) - back_edge(self.bt, *W), hyS - hyW
        headback = self.piece("headback", *W)
        gear = self.piece("gear", *W); gearback = self.piece("gearback", *W)
        _, gpv = self.props["shotgun"]; _, fpv = self.props["shotgun_forend"]
        port = (12 - gpv[0], 1 - gpv[1])        # ejection port relative to the grip
        seq = []
        for i, s in enumerate(SHOOT_SCRIPT):
            k = s["kick"] * sx; r = s["rot"] * sx
            # rotate around the shoulder (butt) instead of the grip: compensate the translation
            th = math.radians(r); bx = -16 * sx
            cx = round(bx - math.cos(th) * bx); cy = round(-math.sin(th) * bx)
            m1 = 1 if mirror else 0
            layers = [L(headback, k + hdx, hdy), L(gearback, k + gdx, gdy), L(body, k), L(reararm, k, 0, 0, -1),
                      L(gear, k + gdx, gdy)]
            layers.append(L("shotgun", G[0] - gpv[0] + k + cx + m1, G[1] - gpv[1] + cy, r, sx))
            p = s["pump"] * sx
            layers.append(L("shotgun_forend", G[0] - fpv[0] + k + cx + p + m1, G[1] - fpv[1] + cy, r, sx))
            layers.append(L(forearm, k))
            layers.append(L(fist, k + p))
            if s["shell"]:
                ex = G[0] + port[0] * sx; ey = G[1] + port[1]
                sdx, sdy, srot = s["shell"]
                layers.append(L("shell", ex + sdx * sx - 1, ey + sdy - 1, srot))
            layers.append(L(head, k))
            frame = {"t": s["t"], "layers": layers,
                     "points": {"muzzle": [G[0] + k + 8 * sx, G[1] - 2]}}
            if s.get("events"): frame["events"] = s["events"]
            seq.append(frame)
        return seq

    def shoot_vertical(self, c, d):
        S = c["S"]
        body = self.piece("body", *S, erase=[])
        head = self.piece("head", *S)
        headback = self.piece("headback", *S)
        gear = self.piece("gear", *S); gearback = self.piece("gearback", *S)
        arms = self.piece("arms", *S, rects=c["arms"]) if c.get("arms") else None
        prop = "shotgun_front" if d == "down" else "shotgun_back"
        img, pv = self.props[prop]
        gx, gy = c["gun"]
        sgn = -1 if d == "down" else 1           # recoil pushes towards the shooter's back
        seq = []
        for s in SHOOT_SCRIPT:
            ky = sgn if s["kick"] else 0
            layers = []
            layers += [L(headback, 0, ky), L(gearback, 0, ky), L(body, 0, ky), L(gear, 0, ky),
                       L(prop, gx, gy + 2 * ky)]
            if arms: layers.append(L(arms, 0, ky))
            if d == "down":
                mimg, _ = self.props["shotgun_front_muzzle"]
                layers.append(L("shotgun_front_muzzle", gx, gy + 2 * ky + img.shape[0] - mimg.shape[0]))
            if s["shell"]:
                ex, ey = c["port"]; sdx, sdy, srot = s["shell"]
                layers.append(L("shell", ex - sdx - 1, ey + sdy - 1, srot))
            layers.append(L(head, 0, ky))
            muzzle = [gx + img.shape[1] // 2, gy + (img.shape[0] - 1 if d == "down" else 0) + 2 * ky]
            frame = {"t": s["t"], "layers": layers, "points": {"muzzle": muzzle}}
            if s.get("events"): frame["events"] = s["events"]
            seq.append(frame)
        return seq


SHOOT_SCRIPT = [
    dict(t=150, kick=0, rot=0, pump=0, shell=None),
    dict(t=60, kick=-2, rot=-8, pump=0, shell=None, events=["fire"]),
    dict(t=70, kick=-1, rot=-4, pump=0, shell=None),
    dict(t=110, kick=0, rot=0, pump=0, shell=None),
    dict(t=90, kick=0, rot=0, pump=-3, shell=(0, -2, 0), events=["pump", "eject"]),
    dict(t=70, kick=0, rot=0, pump=-3, shell=(-3, -7, 90)),
    dict(t=70, kick=0, rot=0, pump=0, shell=(-6, -9, 180)),
    dict(t=70, kick=0, rot=0, pump=0, shell=(-9, -7, 270)),
    dict(t=70, kick=0, rot=0, pump=0, shell=(-11, -2, 0)),
    dict(t=200, kick=0, rot=0, pump=0, shell=None),
]

PROPS = None
MUZZLE_SIDE = (8, -1)   # muzzle tip relative to the grip on the unrotated side view


def muzzle_point(prop, G, sx):
    ang = {"shotgun": 0, **ROTATIONS}.get(prop, 0)
    th = math.radians(ang)
    mx = MUZZLE_SIDE[0] * math.cos(th) - MUZZLE_SIDE[1] * math.sin(th)
    my = MUZZLE_SIDE[0] * math.sin(th) + MUZZLE_SIDE[1] * math.cos(th)
    return [int(round(G[0] + mx * sx)), int(round(G[1] + my))]


def mirror_combo(c):
    m = dict(c)
    m["S"] = (c["S"][0], "left", c["S"][2])
    m["fist"] = (63 - c["fist"][0], c["fist"][1])
    m["sx"] = -c["sx"]
    if "erase" in c: m["erase"] = [mirror_rect(r) for r in c["erase"]]
    if isinstance(c.get("arms"), list): m["arms"] = [mirror_rect(r) for r in c["arms"]]
    return m


# Pose tables (right-facing; left is mirrored). S = source pose for the upper body.
WALK = {
    "right": dict(S=("thrust", "right", 1), fist=(41, 45), gun="shotgun_r20", sx=1),
    "down": dict(S=("thrust", "down", 2), fist=(24, 44), gun="shotgun_rn15", sx=-1,
                 arms=[[20, 39, 28, 48], [31, 42, 39, 49]]),
    "up": dict(S=("thrust", "up", 2), fist=(0, 0), gun="shotgun_back", sx=1, at=(42, 30),
               arms=[[34, 34, 50, 54]]),
}
RUN = {
    "right": dict(S=("run", "right", 3), fist=(35, 39), gun="shotgun_rn30", sx=1),
    "down": dict(S=("thrust", "down", 3), fist=(19, 37), gun="shotgun_rn30", sx=-1,
                 arms=[[14, 32, 24, 42], [31, 40, 40, 49]]),
    "up": dict(S=("thrust", "up", 2), fist=(0, 0), gun="shotgun_back", sx=1, at=(42, 30),
               arms=[[34, 34, 50, 54]]),
}
SHOOT = {
    "right": dict(S=("shoot", "right", 4), fist=(46, 32), reararm=[[10, 28, 29, 44]], rearpivot=(29, 36),
                  rearwhole=[[6, 26, 25, 46]], frontarm=[[29, 28, 56, 44]], frontwhole=[[41, 26, 58, 46]],
                  fistrect=[[44, 26, 58, 46]]),
    "down": dict(S=("thrust", "down", 4), gun=(28, 33), port=(36, 40), arms="all"),
    "up": dict(S=("shoot", "up", 6), gun=(43, 18), port=(46, 26), arms=[[32, 24, 52, 48]]),
}


def main():
    props, rects, atlas = build_props()
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    Image.fromarray(atlas).save(OUT_PNG)
    doc = {
        "id": "shotgun",
        "generatedBy": "tools/extended/build_shotgun.py",
        "props": {
            "image": "extended/shotgun.png",
            "pieces": {n: {"rect": list(rects[n]), "pivot": list(props[n][1])} for n in props},
            "credits": [{
                "file": "extended/shotgun",
                "notes": "Pump shotgun, pre-rotated variants, pump and shell drawn for the extended actions.",
                "authors": ["brotochola"],
                "licenses": ["CC-BY-SA 3.0", "GPL 3.0"],
                "urls": ["https://github.com/brotochola/Universal-LPC-Spritesheet-Character-Generator-extended"],
            }],
        },
        "maskReference": {
            bt: {
                "body": f"body/bodies/{bt}/",
                "clothes": [
                    f"torso/clothes/sleeveless/sleeveless2/{bt}/",
                    "legs/pants/%s/" % ("thin" if bt == "female" else "male"),
                    "feet/shoes/basic/%s/" % ("thin" if bt == "female" else "male"),
                ],
                "rows": [33, 54],
            } for bt in BODY_TYPES
        },
        "actions": [
            {"id": "shotgun_walk", "label": "Shotgun walk"},
            {"id": "shotgun_run", "label": "Shotgun run"},
            {"id": "shotgun_shoot", "label": "Shotgun shoot"},
        ],
        "bodyTypes": {},
    }
    for bt in BODY_TYPES:
        a = Author(bt, props)
        actions = {
            "shotgun_walk": a.combo(("shotgun_walk", "Shotgun walk"), "walk", range(1, 9), WALK, 100),
            "shotgun_run": a.combo(("shotgun_run", "Shotgun run"), "run", range(0, 8), RUN, 80),
            "shotgun_shoot": a.shoot(SHOOT),
        }
        doc["bodyTypes"][bt] = {"pieces": a.pieces, "actions": actions}
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    try:  # keep the JSON in the repo's prettier style
        import subprocess
        subprocess.run(["npx", "prettier", "--write", OUT_JSON], cwd=ROOT, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass
    n = sum(len(v["pieces"]) for v in doc["bodyTypes"].values())
    print(f"wrote {OUT_PNG} ({atlas.shape[1]}x{atlas.shape[0]}) and {OUT_JSON} ({n} piece recipes)")


if __name__ == "__main__":
    main()
