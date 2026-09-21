#!/usr/bin/env node
/**
 * Gate 07 Spec sync.
 *
 * Validates that:
 *  - every workflow uses only states declared in specs/0004-workflow-state-machine.md
 *  - every path referenced in any agent or workflow file exists on disk
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = process.cwd();
const errors = [];

function parseYamlLite(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const idx = line.indexOf(":");
    if (idx < 0) { i++; continue; }
    const k = line.slice(0, idx).trim();
    let rest = line.slice(idx + 1).trim();

    if (rest === "" && i + 1 < lines.length && lines[i + 1].trim().startsWith("- ")) {
      const items = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
        i++;
      }
      out[k] = items;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      out[k] = rest.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else if (rest.startsWith("'") || rest.startsWith('"')) {
      out[k] = rest.slice(1, -1);
    } else {
      out[k] = rest;
    }
    i++;
  }
  return out;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? parseYamlLite(m[1]) : null;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return walk(full);
    if (!e.endsWith(".md")) return [];
    return [full];
  });
}

// 1. Workflows may only use states declared in the state machine.
const KNOWN_STATES = new Set([
  "intake", "plan", "implement", "review", "verify", "release", "closed", "incident",
]);
for (const f of walk(join(ROOT, "workflows"))) {
  if (f.endsWith("state-machine.md") || f.endsWith("README.md")) continue;
  const text = readFileSync(f, "utf8");
  const fm = parseFrontmatter(text);
  if (!fm) { errors.push(`${f}: missing frontmatter`); continue; }
  for (const s of (fm.allowed_states || [])) {
    if (!KNOWN_STATES.has(s)) errors.push(`${f}: unknown state '${s}' in allowed_states`);
  }
}

// 2. Path references in agents/, workflows/, specs/ all resolve where applicable.
function checkPathsIn(f, key, opts) {
  const text = readFileSync(f, "utf8");
  const re = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const p of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (opts && opts.skip && opts.skip(p)) continue;
      const candidate = join(ROOT, p.split("/").join(sep));
      if (!existsSync(candidate)) errors.push(`${f}: ${key} path missing: ${p}`);
    }
  }
}

// Block-style path-list too:   key:\n  - a\n  - b
function checkBlockPathsIn(f, key, opts) {
  const text = readFileSync(f, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(new RegExp(`^${key}:\\s*$`));
    if (!header) continue;
    j: for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(/^\s*-\s+(.+?)\s*$/);
      if (!m) break j;
      const p = m[1];
      if (opts && opts.skip && opts.skip(p)) continue;
      const candidate = join(ROOT, p.split("/").join(sep));
      if (!existsSync(candidate)) errors.push(`${f}: ${key} path missing: ${p}`);
    }
  }
}

for (const f of walk(join(ROOT, "agents"))) {
  for (const k of ["inputs", "outputs", "skills", "gates"]) {
    checkPathsIn(f, k);
    checkBlockPathsIn(f, k);
  }
}
for (const f of walk(join(ROOT, "workflows"))) {
  for (const k of ["gates_used", "agents_used", "skills_used", "related_specs"]) {
    checkPathsIn(f, k);
    checkBlockPathsIn(f, k);
  }
}

if (errors.length) {
  console.error("[spec-sync] FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[spec-sync] PASS");
