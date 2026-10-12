#!/usr/bin/env node
// Wipes skill.meta.yaml sidecars from skills/core and skills/product and
// regenerates them via scripts/seed-skill-metas.mjs.
import { readdirSync, statSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TARGETS = ["skills/core", "skills/product"];

let removed = 0;
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full);
    else if (e === "skill.meta.yaml") { unlinkSync(full); removed++; }
  }
}
for (const t of TARGETS) walk(join(ROOT, t));
console.log(`Removed ${removed} sidecar(s).`);
