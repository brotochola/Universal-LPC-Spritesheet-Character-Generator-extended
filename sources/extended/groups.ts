// Which layer group each catalog item belongs to when the extended actions cut
// the character into pieces.

export type ExtendedGroup = "head" | "headBack" | "body" | "gear" | "gearBack";

export const EXTENDED_GROUPS: readonly ExtendedGroup[] = [
  "head",
  "headBack",
  "body",
  "gear",
  "gearBack",
];

/** zPos of the base body: layers below it are drawn behind the body. */
const BODY_Z = 10;

const HEAD_WOUNDS = new Set([
  "wound_brain",
  "wound_eye_left",
  "wound_eye_right",
  "wound_mouth",
]);

/**
 * `head`: everything on the head (head, face, eyes, hair, hats, glasses...).
 * `headBack`: head layers drawn behind the body (long hair, ponytails).
 * `gear` / `gearBack`: things carried on the torso (backpacks, capes, quivers),
 *   kept apart so cutting the arms never takes a piece of them.
 * `body`: the rest. Weapons, tools and the wheelchair are left out (`null`):
 *   the extended actions bring their own props.
 */
export function extendedGroupFor(
  meta: { path?: readonly string[]; type_name?: string },
  zPos: number,
): ExtendedGroup | null {
  const [root, sub] = meta.path ?? [];
  if (root === "weapons" || root === "tools") return null;
  if (meta.type_name === "wheelchair") return null;
  const behind = zPos < BODY_Z;
  if (root === "torso" && (sub === "backpack" || sub === "cape")) {
    return behind ? "gearBack" : "gear";
  }
  const isHead =
    root === "head" ||
    root === "hair" ||
    (root === "headwear" && sub !== "neck") ||
    HEAD_WOUNDS.has(meta.type_name ?? "");
  if (!isHead) return "body";
  return behind ? "headBack" : "head";
}
