// "Urban only" filter: hides fantasy and monster items from the item tree so the
// generator shows everyday city characters. Nothing is removed from the catalog:
// hashes that use hidden items still load, and the filter can be turned off.

/** Sheet-definition paths (folders, then item id) hidden in urban mode. */
export const URBAN_HIDDEN_PATHS: readonly string[] = [
  // bodies and body parts
  "body/lizard",
  "body/wings",
  "body/tails",
  "body/special",
  "body/prostheses",
  // non-human heads and appendages
  "head/heads/reptile",
  "head/heads/undead",
  "head/heads/fantasy",
  "head/heads/beast",
  "head/heads/farm",
  "head/furry_ears",
  "head/appendages",
  "head/eyes",
  "head/ears/head_ears_elven",
  "head/ears/head_ears_dragon",
  "head/ears/head_ears_long",
  // armour and medieval / fantasy headwear
  "headwear/helmets",
  "headwear/hats/magic",
  "headwear/hats/tricorne",
  "headwear/hats/athwart",
  "headwear/hats/foreaft",
  "headwear/hats/formal/hat_formal_crown",
  "headwear/hats/formal/hat_formal_tiara",
  "headwear/hats/caps/hat_cap_cavalier",
  "headwear/hats/caps/hat_cap_cavalier_feather",
  "headwear/hats/caps/hat_cap_leather_feather",
  "headwear/hats/caps/hat_cap_bonnie_feather",
  "headwear/hats/holiday/hat_holiday_elf",
  "headwear/coverings/bandana/hat_bandana_pirate",
  "headwear/coverings/bandana/hat_bandana_pirate_skull",
  "headwear/coverings/headbands/hat_headband_hairtie_rune",
  "headwear/coverings/headbands/hat_headband_thick_rune",
  "headwear/neck/neck_capeclip",
  "headwear/neck/neck_capetie",
  "headwear/neck/neck_jabot",
  "headwear/neck/charms/neck_amulet_spider",
  // torso
  "torso/armour",
  "torso/torso_chainmail",
  "torso/cape",
  "torso/backpack/quiver",
  "torso/backpack/backpack_jetpack",
  "torso/backpack/backpack_jetpack_fins",
  "torso/shirts/torso_clothes_robe",
  "torso/jacket/torso_jacket_tabard",
  "torso/waist/belt_mage",
  // arms, legs, feet
  "arms/arms_armour",
  "arms/bauldron",
  "arms/shoulders/shoulders_legion",
  "arms/shoulders/shoulders_pauldrons",
  "arms/shoulders/shoulders_mantal",
  "arms/wrists/arms_bracers",
  "legs/legs_armour",
  "legs/skirts/legs_skirts_legion",
  "feet/feet_hoofs",
  "feet/feet_armour",
  "feet/accessory",
  // weapons (see URBAN_EXCEPTIONS) and fantasy tools
  "weapons",
  "tools/tool_whip",
];

/** Paths kept even though a hidden prefix covers them. */
export const URBAN_EXCEPTIONS: readonly string[] = [
  "weapons/polearm/weapon_polearm_cane",
];

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Whether a tree path (category folders, optionally ending in an item id) is
 * shown in urban mode. Ancestors of an exception stay visible so it can be reached.
 */
export function isUrbanPath(segments: readonly string[] | undefined): boolean {
  if (!segments) return true;
  const path = segments.join("/");
  if (URBAN_EXCEPTIONS.some((e) => isUnder(path, e) || isUnder(e, path))) {
    return true;
  }
  return !URBAN_HIDDEN_PATHS.some((h) => isUnder(path, h));
}
