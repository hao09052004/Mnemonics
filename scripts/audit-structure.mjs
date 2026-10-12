import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredPaths = [
  'apps/extension/manifest.json',
  'apps/extension/mnemonics-extension.html',
  'apps/extension/mnemonics-dashboard.html',
  'apps/extension/background.js',
  'apps/api',
  'apps/web',
  'packages/database',
  'packages/shared',
  'packages/ai',
  'packages/ui',
  'docs/project-status.md'
];

const missing = requiredPaths.filter((path) => !existsSync(join(root, path)));
if (missing.length > 0) {
  console.error(`Missing required paths:\n${missing.join('\n')}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(root, 'apps/extension/manifest.json'), 'utf8'));
const extensionRoot = join(root, 'apps/extension');
const references = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...Object.values(manifest.icons || {}),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
].filter(Boolean);
const missingReferences = [...new Set(references)].filter((path) => !existsSync(join(extensionRoot, path)));

if (missingReferences.length > 0) {
  console.error(`Missing extension references:\n${missingReferences.join('\n')}`);
  process.exit(1);
}

console.log(`Structure audit passed: ${requiredPaths.length} required paths and ${new Set(references).size} extension references verified.`);