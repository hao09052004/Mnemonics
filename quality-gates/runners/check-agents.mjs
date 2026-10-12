#!/usr/bin/env node
/**
 * Gate 05 Agent contract validator.
 *
 * Walks every markdown file under agents/ and parses YAML frontmatter,
 * verifying:
 *   - required fields per specs/0002-agent-contract.md
 *   - name matches filename (sans .md)
 *   - referenced paths (inputs/outputs/skills/gates) exist on disk
 *
 * Exit 0 on PASS, 1 on FAIL.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, sep, relative } from "node:path";

const ROOT = process.cwd();
const AGENT_DIRS = ["agents/core", "agents/product", "agents/curated"];
const REQUIRED = ["name", "version", "source", "status", "layer", "maturity", "role"];
const VALID_SOURCE = ["hand-authored", "agency-agents", "superpowers", "karpathy", "ponytail"];
const VALID_STATUS = ["draft", "stable", "deprecated"];
const VALID_MATURITY = ["experimental", "production"];
const VALID_ROLE = ["core", "product", "curated"];

/**
 * Tiny block-style-YAML parser that handles:
 *   key: value
 *   key: [a, b, c]
 *   key:
 *     - a
 *     - b
 * Anything fancier (anchors, types) is rejected with a clear error.
 */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const idx = line.indexOf(":");
    if (idx < 0) { i++; continue; }
    const key = line.slice(0, idx).trim();
    let rest = line.slice(idx + 1).trim();

    if (rest === "" && i + 1 < lines.length && lines[i + 1].trim().startsWith("- ")) {
      // block list
      const items = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
        i++;
      }
      out[key] = items;
      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      out[key] = rest.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else if (rest.startsWith("'") || rest.startsWith('"')) {
      out[key] = rest.slice(1, -1);
    } else {
      out[key] = rest;
    }
    i++;
  }
  return out;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    if (!entry.endsWith(".md")) return [];
    if (entry.toLowerCase() === "readme.md") return [];
    return [full];
  });
}

const files = AGENT_DIRS.flatMap(walk);
console.log(`[agent-contract] checking ${files.length} file(s)`);

const errors = [];

for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join("/");
  const text = readFileSync(f, "utf8");
  const fm = parseFrontmatter(text);
  if (!fm) { errors.push(`${rel}: missing frontmatter`); continue; }
  for (const k of REQUIRED) if (!(k in fm)) errors.push(`${rel}: missing required field '${k}'`);
  const expectedName = rel.split("/").pop().replace(/\.md$/, "");
  if (fm.name !== expectedName) errors.push(`${rel}: name '${fm.name}' !== filename '${expectedName}'`);
  if (!VALID_SOURCE.includes(fm.source)) errors.push(`${rel}: bad source '${fm.source}'`);
  if (!VALID_STATUS.includes(fm.status)) errors.push(`${rel}: bad status '${fm.status}'`);
  if (!VALID_MATURITY.includes(fm.maturity)) errors.push(`${rel}: bad maturity '${fm.maturity}'`);
  if (!VALID_ROLE.includes(fm.role)) errors.push(`${rel}: bad role '${fm.role}'`);
  if (fm.layer !== "agents") errors.push(`${rel}: bad layer '${fm.layer}'`);
  for (const k of ["inputs", "outputs", "skills", "gates"]) {
    const arr = fm[k] ?? [];
    for (const p of arr) {
      // Convert forward-slash paths in frontmatter to native OS separators
      // before joining with ROOT, so the check works on both Windows and Linux.
      const nativePath = String(p).split("/").join(sep);
      const candidate = join(ROOT, nativePath);
      if (!existsSync(candidate)) errors.push(`${rel}: ${k} path does not exist: ${p}`);
    }
  }
  if (fm.source && fm.source !== "hand-authored" && !/vendored_from:/i.test(text)) {
    errors.push(`${rel}: source='${fm.source}' but body has no 'vendored_from:' line`);
  }
}

if (errors.length) {
  console.error("[agent-contract] FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[agent-contract] PASS");
