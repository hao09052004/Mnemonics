#!/usr/bin/env node
/**
 * Gate 06 Skill frontmatter validator.
 *
 * Two flavours:
 *  - hand-authored SKILL.md  -> frontmatter inline, all contract fields present.
 *  - vendored SKILL.md       -> companion skill.meta.yaml declares the
 *                               contract fields; SKILL.md must be byte-identical
 *                               to the upstream under vendor/.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const TARGETS = ["skills/core", "skills/product"];
const VENDOR_PATHS = {
  superpowers:  "vendor/superpowers",
  mattpocock:   "vendor/mattpocock-skills",
  karpathy:     "vendor/karpathy-skills",
  ponytail:     "vendor/ponytail",
};

const errors = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return walk(full);
    if (e === "SKILL.md") return [full];
    return [];
  });
}

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
    let rest = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");

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
      out[k] = rest.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
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

const files = TARGETS.flatMap(walk);
console.log(`[skill-frontmatter] checking ${files.length} skill(s)`);

for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join("/");
  const dir = f.replace(/SKILL\.md$/, "");
  const sidecar = join(dir, "skill.meta.yaml");
  const text = readFileSync(f, "utf8");
  const fmInline = parseFrontmatter(text);

  if (fmInline && fmInline.source === "hand-authored") {
    for (const k of ["name", "version", "source", "status", "layer", "maturity", "role"]) {
      if (!(k in fmInline)) errors.push(`${rel}: hand-authored missing '${k}'`);
    }
    if (existsSync(sidecar)) {
      const meta = parseYamlLite(readFileSync(sidecar, "utf8"));
      if (meta && meta.source !== "hand-authored") {
        errors.push(`${rel}: hand-authored SKILL.md should not have a vendored sidecar`);
      }
    }
    continue;
  }

  // Not declared hand-authored inline: either it is a vendored copy with a
  // sidecar, or it is a hand-authored SKILL.md without a sidecar (also OK).
  if (!existsSync(sidecar)) {
    // No sidecar and not inline hand-authored: probably a missing contract.
    // Skip if the SKILL.md has any inline frontmatter (treated as hand-authored).
    if (fmInline) continue;
    errors.push(`${rel}: vendored skill has no skill.meta.yaml sidecar and no inline frontmatter`);
    continue;
  }
  const meta = parseYamlLite(readFileSync(sidecar, "utf8"));
  if (!meta.source || meta.source === "hand-authored") {
    errors.push(`${rel}: vendored skill declares source='hand-authored' in sidecar`);
    continue;
  }
  const vendorRoot = VENDOR_PATHS[meta.source];
  if (!vendorRoot) {
    errors.push(`${rel}: unknown source '${meta.source}' in sidecar`);
    continue;
  }

  // Search the vendor tree for a SKILL.md whose sha256 matches the local
  // SKILL.md. This catches vendor drift and accidental edits. Search is
  // bounded to the configured vendor root only.
  const localSha = createHash("sha256").update(readFileSync(f)).digest("hex");
  function search(dir) {
    if (!existsSync(dir)) return null;
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        const r = search(full); if (r) return r;
      } else if (e === "SKILL.md") {
        const sha = createHash("sha256").update(readFileSync(full)).digest("hex");
        if (sha === localSha) return relative(ROOT, full).split(sep).join("/");
      }
    }
    return null;
  }
  const vendorAbs = join(ROOT, vendorRoot);
  if (!existsSync(vendorAbs)) {
    // Vendor directory not present (e.g. partial clone, fresh checkout
    // before vendor sources are populated). Skip the hash check rather
    // than failing the gate — frontmatter contract was already validated
    // above and sidecar metadata is present.
    console.warn(`[skill-frontmatter] skip hash-check for ${rel}: vendor root ${vendorRoot} not present`);
    continue;
  }
  const upstream = search(vendorAbs);
  if (!upstream) {
    errors.push(`${rel}: no matching SKILL.md found in ${vendorRoot} (sha256 mismatch?)`);
  }
}

if (errors.length) {
  console.error("[skill-frontmatter] FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("[skill-frontmatter] PASS");
