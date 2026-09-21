// Round 4: final English conversion for leftover mangled literals.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetPath = join(__dirname, '..', 'apps', 'extension', 'dashboard.js');

const replacements = [
  // SYNC comment
  ["// ===== SYNC V?I EXTENSION =====", '// ===== SYNC WITH EXTENSION ====='],
  // isNew
  ["const isNew = item.date === 'V?a xong' || item.date === 'H?m nay';",
   "const isNew = item.date === 'Just now' || item.date === 'Today';"],
  // typeLabel (uppercase variant) for cards
  ["{article:'B?I VI?T', image:'C?M H?NG', note:'GHI CH? NHANH', quote:'TR?CH D?N', code:'M? NGU?N', link:'LINK', file:'T?P', screenshot:'?NH CH?P MH'}",
   "{article:'ARTICLE', image:'INSPIRATION', note:'QUICK NOTE', quote:'QUOTE', code:'CODE', link:'LINK', file:'FILE', screenshot:'SCREENSHOT'}"],
  // M?I badge
  ["'>M?I</span>'", "'>NEW</span>'"],
  // typeLabel fallback capitalized
  ["|| 'M?c l?u';", "|| 'Saved item';"],
  // 'Just now' but 'M?i l?u' for space
  ["date: 'Just now', space: 'M?i l?u',",
   "date: 'Just now', space: 'Just saved',"],
  // comments still mangled
  ["// Fallback: event delegation cho to?n modal",
   "// Fallback: event delegation across the entire modal"],
  // Upload th?t b?i
  ["response.error : 'Upload th?t b?i'",
   "response.error : 'Upload failed'"],
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
console.log(`Round-4 applied: ${applied}`);
if (failures.length) {
  console.log(`Not matched (${failures.length}):`);
  for (const f of failures) console.log(' - ' + JSON.stringify(f.slice(0, 90)));
}
