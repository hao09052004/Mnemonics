#!/usr/bin/env node
/**
 * Smoke test for scripts/package-extension.mjs.
 *
 * Validates that the packager:
 *   - Replaces __MNEMONICS_API_URL__ in manifest.json and JS files
 *   - Excludes tests/ and *.test.js from the output
 *   - Produces a valid ZIP with the PK\x03\x04 signature
 *   - Copies binary assets byte-for-byte
 *
 * Run with: node scripts/extension-packager.test.mjs
 *
 * No third-party deps — uses Node's built-in test runner.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const realPackager = join(repoRoot, 'scripts', 'package-extension.mjs');

test('extension packager handles dev-default source tree', async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), 'mnemonics-pkg-dev-'));
  try {
    const outDir = join(scratchDir, 'out');
    const extSrc = join(scratchDir, 'apps', 'extension');
    await mkdir(extSrc, { recursive: true });

    // Source mimics the real dev tree: concrete dev URL in CSP,
    // empty web URL in JS.
    await writeFile(
      join(extSrc, 'manifest.json'),
      JSON.stringify(
        {
          manifest_version: 3,
          name: 'Mnemonics Dev',
          version: '0.0.0',
          content_security_policy: {
            extension_pages:
              "script-src 'self'; connect-src 'self' http://localhost:4000 https://*.supabase.co;"
          }
        },
        null,
        2
      )
    );
    await writeFile(
      join(extSrc, 'extension.js'),
      `var MNEMONICS_WEB_URL = '';\n`
    );

    await mkdir(join(scratchDir, 'scripts'), { recursive: true });
    const real = await readFile(realPackager, 'utf8');
    const patched = real
      .replace(
        "const extensionSrc = join(repoRoot, 'apps', 'extension');",
        `const extensionSrc = ${JSON.stringify(extSrc)};`
      )
      .replace(
        "const distRoot = join(repoRoot, 'dist');",
        `const distRoot = ${JSON.stringify(outDir)};`
      );
    const packagerPath = join(scratchDir, 'scripts', 'package-extension.mjs');
    await writeFile(packagerPath, patched);

    // Dev build (no env) must keep dev URLs.
    await execFileP(process.execPath, [packagerPath, 'chrome']);
    const devManifest = JSON.parse(
      await readFile(
        join(outDir, 'mnemonics-chrome-extension', 'manifest.json'),
        'utf8'
      )
    );
    assert.ok(
      devManifest.content_security_policy.extension_pages.includes(
        'http://localhost:4000'
      ),
      'dev build must keep localhost API URL'
    );
    const devJs = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'extension.js'),
      'utf8'
    );
    assert.ok(
      devJs.includes("var MNEMONICS_WEB_URL = ''"),
      'dev build must keep empty web URL'
    );

    // Prod build (with env) must override dev defaults.
    await execFileP(process.execPath, [packagerPath, 'chrome'], {
      env: {
        ...process.env,
        MNEMONICS_API_URL: 'https://api.example.test',
        MNEMONICS_WEB_URL: 'https://app.example.test'
      }
    });
    const prodManifest = JSON.parse(
      await readFile(
        join(outDir, 'mnemonics-chrome-extension', 'manifest.json'),
        'utf8'
      )
    );
    assert.ok(
      prodManifest.content_security_policy.extension_pages.includes(
        'https://api.example.test'
      ),
      'prod build must inject prod API URL'
    );
    assert.ok(
      !prodManifest.content_security_policy.extension_pages.includes(
        'http://localhost:4000'
      ),
      'prod build must drop dev default from CSP'
    );
    const prodJs = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'extension.js'),
      'utf8'
    );
    assert.ok(
      prodJs.includes("var MNEMONICS_WEB_URL = 'https://app.example.test'"),
      'prod build must inject prod web URL'
    );
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

test('extension packager produces a clean, store-ready bundle', async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), 'mnemonics-pkg-'));
  try {
    const outDir = join(scratchDir, 'out');
    const extSrc = join(scratchDir, 'apps', 'extension');
    await mkdir(join(extSrc, 'tests'), { recursive: true });
    await mkdir(join(extSrc, 'sub'), { recursive: true });

    await writeFile(
      join(extSrc, 'manifest.json'),
      JSON.stringify(
        {
          manifest_version: 3,
          name: 'Mnemonics Test',
          version: '0.0.0',
          content_security_policy: {
            extension_pages:
              "script-src 'self'; connect-src 'self' __MNEMONICS_API_URL__;"
          }
        },
        null,
        2
      )
    );
    await writeFile(
      join(extSrc, 'background.js'),
      `const URL = '__MNEMONICS_API_URL__';\nconsole.log(URL);\n`
    );
    await writeFile(
      join(extSrc, 'sub', 'api.js'),
      `var MNEMONICS_API_URL = '__MNEMONICS_API_URL__';\n`
    );
    await writeFile(join(extSrc, 'tests', 'foo.test.js'), 'should be excluded');
    await writeFile(join(extSrc, 'background.test.js'), 'should be excluded');
    await writeFile(join(extSrc, 'README.md'), 'should be excluded');
    await writeFile(join(extSrc, 'icon16.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // Patch a copy of the packager so it points at the scratch tree.
    await mkdir(join(scratchDir, 'scripts'), { recursive: true });
    const real = await readFile(realPackager, 'utf8');
    const patched = real
      .replace(
        "const extensionSrc = join(repoRoot, 'apps', 'extension');",
        `const extensionSrc = ${JSON.stringify(extSrc)};`
      )
      .replace(
        "const distRoot = join(repoRoot, 'dist');",
        `const distRoot = ${JSON.stringify(outDir)};`
      );
    const packagerPath = join(scratchDir, 'scripts', 'package-extension.mjs');
    await writeFile(packagerPath, patched);

    await execFileP(process.execPath, [packagerPath, 'chrome'], {
      env: { ...process.env, MNEMONICS_API_URL: 'https://api.example.test' }
    });

    // 1. Manifest JSON must be valid + contain replaced URL
    const manifestPath = join(outDir, 'mnemonics-chrome-extension', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(
      manifest.content_security_policy.extension_pages.includes(
        'https://api.example.test'
      ),
      true,
      'CSP must contain the baked API URL'
    );
    assert.equal(
      manifest.content_security_policy.extension_pages.includes('__MNEMONICS_'),
      false,
      'CSP must not contain any __MNEMONICS_ placeholder'
    );

    // 2. JS files: placeholders gone
    const bg = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'background.js'),
      'utf8'
    );
    assert.equal(
      bg.includes('__MNEMONICS_'),
      false,
      'background.js must not contain placeholders'
    );
    assert.equal(
      bg.includes('https://api.example.test'),
      true,
      'background.js must contain the baked URL'
    );

    const api = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'sub', 'api.js'),
      'utf8'
    );
    assert.equal(
      api.includes('https://api.example.test'),
      true,
      'sub/api.js must contain the baked URL'
    );

    // 3. Excluded files
    const out = await readdir(join(outDir, 'mnemonics-chrome-extension'), {
      withFileTypes: true
    });
    const names = out.map((e) => e.name);
    assert.equal(names.includes('tests'), false, 'tests/ must be excluded');
    assert.equal(names.includes('README.md'), false, 'README.md must be excluded');
    assert.equal(
      names.includes('background.test.js'),
      false,
      '*.test.js must be excluded'
    );

    // 4. ZIP signature
    const zipPath = join(outDir, 'mnemonics-chrome-extension.zip');
    const s = await stat(zipPath);
    assert.ok(s.size > 100, 'zip must be non-empty');
    const buf = await readFile(zipPath);
    assert.equal(buf[0], 0x50, 'zip PK[0]');
    assert.equal(buf[1], 0x4b, 'zip PK[1]');
    assert.equal(buf[2], 0x03, 'zip PK[2]');
    assert.equal(buf[3], 0x04, 'zip PK[3]');

    // 5. Binary copy
    const png = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'icon16.png')
    );
    assert.equal(png.length, 4);
    assert.equal(png[0], 0x89, 'PNG magic byte 1');

    // 6. Re-packaging a tree that has already been baked must be
    // idempotent for content (banner timestamp changes are fine).
    // Strip banner then compare. This mirrors the real workflow
    // where the dev source already has dev URLs and the packager
    // is invoked again for prod: the URL must appear exactly once.
    const stripBanner = (s) => s.replace(/^\/\* packaged[^\n]*\n/, '');
    const reBaked = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'background.js'),
      'utf8'
    );
    await execFileP(
      process.execPath,
      [packagerPath, 'chrome', '--re-bake-test-mode'],
      { env: { ...process.env, MNEMONICS_API_URL: 'https://api.example.test' } }
    );
    const reBaked2 = await readFile(
      join(outDir, 'mnemonics-chrome-extension', 'background.js'),
      'utf8'
    );
    assert.equal(
      stripBanner(reBaked2),
      stripBanner(reBaked),
      're-baking must not change already-baked content (no double substitution)'
    );
    // And the URL must still appear exactly once.
    const occurrences = (
      reBaked2.match(/https:\/\/api\.example\.test/g) || []
    ).length;
    assert.equal(
      occurrences,
      1,
      `URL must appear exactly once after re-bake, got ${occurrences}`
    );
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});
