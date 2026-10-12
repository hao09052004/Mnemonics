#!/usr/bin/env node
/**
 * Packager for the Mnemonics browser extension.
 *
 * Mnemonics ships ONE extension codebase that targets both the
 * Chrome Web Store and Microsoft Edge Add-ons (Manifest V3 is fully
 * cross-compatible on Chromium). The two outputs may be byte-identical
 * or differ only in store-specific metadata; the packager is the
 * single place that bakes the production API URL into the bundle.
 *
 * Usage:
 *   pnpm extension:package:chrome
 *   pnpm extension:package:edge
 *   pnpm extension:package
 *
 * Required env (else the dev default of http://localhost:4000 is used):
 *   MNEMONICS_API_URL    e.g. https://api.mnemonics.app
 *   MNEMONICS_WEB_URL    e.g. https://app.mnemonics.app   (optional)
 *
 * Outputs:
 *   dist/mnemonics-chrome-extension/         (directory + .zip)
 *   dist/mnemonics-edge-extension/           (directory + .zip)
 *
 * The packager does the following:
 *   1. Strips source-only files: tests/, *.test.js, *.test.ts
 *   2. Replaces __MNEMONICS_API_URL__ in manifest.json + JS files
 *   3. Optionally writes store-specific metadata (e.g. an Edge
 *      marketplace hints.json) — placeholder for future use.
 *   4. Zips the resulting directory.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import { join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const extensionSrc = join(repoRoot, 'apps', 'extension');
const distRoot = join(repoRoot, 'dist');

const STORE_CHROME = 'chrome';
const STORE_EDGE = 'edge';

/** Subset of source files we want to EXCLUDE from the packaged ZIP. */
const EXCLUDE_DIRS = new Set(['tests', 'node_modules', '.git', 'coverage']);
const EXCLUDE_FILES = new Set([
  'README.md',
  'vitest.config.ts',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml'
]);

/**
 * Files whose names match this glob are excluded. The Node test files
 * follow the convention `*.test.js` / `*.test.ts` so we filter by
 * extension suffix.
 */
const TEST_SUFFIX = /\.test\.(js|ts|mjs|cjs)$/;

function apiUrl() {
  return process.env.MNEMONICS_API_URL || 'http://localhost:4000';
}

function webUrl() {
  return process.env.MNEMONICS_WEB_URL || '';
}

/**
 * Build a single store bundle.
 *
 * @param {string} store 'chrome' | 'edge'
 * @param {string} outName e.g. 'mnemonics-chrome-extension'
 */
async function buildStoreBundle(store, outName) {
  const outDir = join(distRoot, outName);
  await rmrf(outDir);
  await mkdir(outDir, { recursive: true });

  // Walk the extension source tree.
  const files = await walk(extensionSrc);
  let baked = 0;
  for (const absPath of files) {
    const rel = relative(extensionSrc, absPath);
    if (shouldExclude(rel)) continue;
    const dest = join(outDir, rel);
    if (isBinary(rel)) {
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(absPath, dest);
    } else {
      const content = await readFile(absPath, 'utf8');
      const rewritten = bakePlaceholders(content, rel, store);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, rewritten, 'utf8');
      baked += 1;
    }
  }

  // Write a tiny manifest.json for the store metadata. We don't
  // currently differentiate the bundles, but the file's presence
  // gives reviewers a single place to look.
  const meta = {
    store,
    bakedAt: new Date().toISOString(),
    apiUrl: apiUrl(),
    webUrl: webUrl(),
    sourceTree: 'apps/extension'
  };
  await writeFile(
    join(outDir, '.package-manifest.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf8'
  );

  // Bundle the .zip in a separate step so the directory is still
  // useful for `Load unpacked` dev work.
  await zipDir(outDir, join(distRoot, `${outName}.zip`));

  console.log(
    `✓ packaged ${outName}: ${baked} baked files, zip=${join(distRoot, outName + '.zip')}`
  );
}

function bakePlaceholders(content, rel, store) {
  // The store tag is informational only — both stores consume the
  // exact same JS bundle.
  //
  // Two complementary replacement forms are supported:
  //
  //   1. Legacy `__MNEMONICS_*__` placeholder tokens (older source
  //      trees). Always replaced unconditionally.
  //   2. Concrete dev URLs that ship in the current source tree
  //      (e.g. `http://localhost:4000` for the API, empty string
  //      for the web URL). These are only replaced when the
  //      corresponding env var is set, so a `Load unpacked` build
  //      keeps working without env vars while a production bake
  //      overrides them.
  //
  // Source tree convention is documented in apps/extension/SOURCE-DEFAULTS.md.
  let out = content;
  const api = apiUrl();
  const web = webUrl();

  // Legacy token form: always replace.
  if (out.includes('__MNEMONICS_API_URL__')) {
    out = out.replaceAll('__MNEMONICS_API_URL__', api);
  }
  if (out.includes('__MNEMONICS_WEB_URL__')) {
    out = out.replaceAll('__MNEMONICS_WEB_URL__', web);
  }

  // Dev-default form: only override when env was explicitly set to
  // something OTHER than the dev default itself, so an absent env
  // is a no-op.
  const DEV_API = 'http://localhost:4000';
  if (api !== DEV_API && out.includes(DEV_API)) {
    out = out.replaceAll(DEV_API, api);
  }

  // Web URL: source ships `MNEMONICS_WEB_URL = ''` (empty) as the
  // dev default. If MNEMONICS_WEB_URL is set, rewrite to the prod
  // value. We do NOT touch the empty-string case because that's the
  // intended dev sentinel.
  if (web) {
    const safeWeb = web.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    out = out.replaceAll(
      "var MNEMONICS_WEB_URL = ''",
      `var MNEMONICS_WEB_URL = '${safeWeb}'`
    );
  }
  // Only prepend the JS-comment banner to .js files. Adding it to
  // .json or .html files would corrupt them.
  if (rel === 'background.js' || rel === 'api-client.js') {
    const banner = `/* packaged for ${store} at ${new Date().toISOString()} */\n`;
    out = banner + out;
  }
  return out;
}

function shouldExclude(rel) {
  const parts = rel.split(sep);
  for (const part of parts) if (EXCLUDE_DIRS.has(part)) return true;
  const base = parts[parts.length - 1];
  if (EXCLUDE_FILES.has(base)) return true;
  if (TEST_SUFFIX.test(base)) return true;
  // Strip dev map files.
  if (base.endsWith('.map')) return true;
  return false;
}

function isBinary(rel) {
  return /\.(png|jpg|jpeg|gif|webp|ico|svg|woff2?|ttf|eot)$/i.test(rel);
}

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function rmrf(p) {
  if (!existsSync(p)) return;
  const { rm } = await import('node:fs/promises');
  await rm(p, { recursive: true, force: true });
}

/**
 * Pure-Node zip (no external deps). Writes a minimal STORE-only
 * (no compression) zip. Both Chrome and Edge accept STORE-only zips
 * for store submission, and STORE keeps the file small enough for
 * manual `Load unpacked` workflows.
 */
async function zipDir(srcDir, outPath) {
  const { createWriteStream } = await import('node:fs');
  const { open } = await import('node:fs/promises');
  // We don't want a runtime dep on a zip lib; this is intentionally
  // a single-file archive when there's exactly one entry, and a
  // STORE-only multi-file archive otherwise. The complexity of
  // CRC-32 is small enough to inline.
  const files = await collectForZip(srcDir, '');
  const fh = await open(outPath, 'w');
  const stream = fh.createWriteStream();
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = await readFile(f.absPath);
    const crc = crc32(data);
    const nameBuf = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = store
    local.writeUInt16LE(0, 10); // mtime
    local.writeUInt16LE(0, 12); // mdate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // comp size
    local.writeUInt32LE(data.length, 22); // uncomp size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra
    stream.write(local);
    stream.write(nameBuf);
    stream.write(data);
    central.push({ name: nameBuf, crc, size: data.length, offset });
    offset += local.length + nameBuf.length + data.length;
  }
  // central directory
  const cdStart = offset;
  for (const c of central) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(0, 10); // method
    cd.writeUInt16LE(0, 12); // mtime
    cd.writeUInt16LE(0, 14); // mdate
    cd.writeUInt32LE(c.crc, 16);
    cd.writeUInt32LE(c.size, 20);
    cd.writeUInt32LE(c.size, 24);
    cd.writeUInt16LE(c.name.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(c.offset, 42);
    stream.write(cd);
    stream.write(c.name);
    offset += cd.length + c.name.length;
  }
  const cdSize = offset - cdStart;
  // end of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20); // comment
  stream.write(eocd);
  await new Promise((res) => stream.end(res));
  await fh.close();
}

async function collectForZip(dir, prefix) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(dir, e.name);
    const name = posix.join(prefix, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectForZip(abs, name)));
    } else if (e.isFile()) {
      out.push({ name, absPath: abs });
    }
  }
  return out;
}

/** Minimal CRC-32 (IEEE 802.3 polynomial). Sufficient for STORE zip. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function main() {
  // Default to packaging both stores when the script is invoked
  // without a `package:chrome` / `package:edge` selector.
  const target = process.argv[2] || 'all';
  if (!existsSync(extensionSrc)) {
    console.error(`Extension source not found: ${extensionSrc}`);
    process.exit(1);
  }
  const built = [];
  if (target === STORE_CHROME || target === 'all') {
    await buildStoreBundle(STORE_CHROME, 'mnemonics-chrome-extension');
    built.push('mnemonics-chrome-extension');
  }
  if (target === STORE_EDGE || target === 'all') {
    await buildStoreBundle(STORE_EDGE, 'mnemonics-edge-extension');
    built.push('mnemonics-edge-extension');
  }
  // Print a short summary.
  console.log('\nDone. Artifacts:');
  for (const name of built) {
    console.log(`  - ${join(distRoot, name)}/`);
    console.log(`  - ${join(distRoot, name)}.zip`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
