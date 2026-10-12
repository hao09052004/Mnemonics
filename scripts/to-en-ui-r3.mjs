// Round 3: handle the latin-1 `Kh?a h?c` variant and remaining orphan ??s.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetPath = join(__dirname, '..', 'apps', 'extension', 'dashboard.js');

const replacements = [
  // `Kh?a h?c` (latin-1 mangled) -> 'Course'
  ["badge: 'Kh?a h?c', color: '#f59e0b', icon: '??'",
   "badge: 'Course', color: '#f59e0b', icon: '🎓'"],
  ["badge: 'Kh?a h?c', color: '#e0447a', icon: '??'",
   "badge: 'Course', color: '#e0447a', icon: '🎓'"],
  ["badge: 'Kh?a h?c', color: '#5B3FE4', icon: '??'",
   "badge: 'Course', color: '#5B3FE4', icon: '🎓'"],
  ["badge: 'Kh?a h?c', color: '#10b981', icon: '??'",
   "badge: 'Course', color: '#10b981', icon: '🎓'"],

  // Single replacement: any leftover top-level `icon: '??'` (book icon)
  ["badge: 'Book', color: '#f59e0b', icon: '??'", "badge: 'Book', color: '#f59e0b', icon: '📘'"],

  // If the file still contains literal `??` emoji bytes in BOOK_CATALOG
  // (without the surrounding literal), drop the icon as well to avoid
  // bizarre visible glyphs.
];

let src = await readFile(targetPath, 'utf8');
let applied = 0;
const failures = [];
for (const [bad, good] of replacements) {
  if (!src.includes(bad)) { failures.push(bad); continue; }
  src = src.split(bad).join(good);
  applied++;
}
await writeFile(targetPath, src, 'utf8');
console.log(`Round-3 applied: ${applied}`);
if (failures.length) {
  console.log(`Not matched (${failures.length}):`);
  for (const f of failures) console.log(' - ' + JSON.stringify(f.slice(0, 90)));
}
