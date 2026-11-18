import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  URBAN_EXCEPTIONS,
  URBAN_HIDDEN_PATHS,
  isUrbanPath,
} from "../../../sources/state/urban.ts";

const DEFS = fileURLToPath(
  new URL("../../../sheet_definitions/", import.meta.url),
);

/** Item paths as the catalog builds them: folders relative to sheet_definitions + item id. */
function itemPaths(dir: string, acc: string[][] = []): string[][] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) itemPaths(full, acc);
    else if (entry.name.endsWith(".json") && !entry.name.startsWith("meta_")) {
      const rel = path.relative(DEFS, dir).split(path.sep).filter(Boolean);
      acc.push([...rel, entry.name.replace(/\.json$/, "")]);
    }
  }
  return acc;
}

const all = itemPaths(DEFS);

test("every hidden path and exception names real items (no typos)", () => {
  for (const prefix of [...URBAN_HIDDEN_PATHS, ...URBAN_EXCEPTIONS]) {
    assert.ok(
      all.some((p) => {
        const joined = p.join("/");
        return joined === prefix || joined.startsWith(`${prefix}/`);
      }),
      `no item under ${prefix}`,
    );
  }
});

test("urban mode keeps everyday items and hides fantasy ones", () => {
  assert.ok(isUrbanPath(["head", "heads", "human", "heads_human_male"]));
  assert.ok(isUrbanPath(["torso", "jacket", "torso_jacket_collared"]));
  assert.ok(isUrbanPath(["hair", "long", "hair_long"]));
  assert.ok(isUrbanPath(["weapons"]), "ancestor of the cane exception");
  assert.ok(isUrbanPath(["weapons", "polearm", "weapon_polearm_cane"]));
  assert.ok(!isUrbanPath(["weapons", "polearm", "weapon_polearm_spear"]));
  assert.ok(!isUrbanPath(["weapons", "sword"]));
  assert.ok(!isUrbanPath(["head", "heads", "fantasy", "heads_orc_male"]));
  assert.ok(!isUrbanPath(["body", "wings"]));
  const kept = all.filter((p) => isUrbanPath(p)).length;
  assert.ok(kept > all.length / 2, `${kept} of ${all.length} items kept`);
});
