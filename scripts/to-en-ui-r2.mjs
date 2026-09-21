// Round 2 of English conversion for mojibake variants.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetPath = join(__dirname, '..', 'apps', 'extension', 'dashboard.js');

const replacements = [
  // Remaining icon emoji literals (dedupe)
  ["icon: '??',\n    name: 'TECH NOTES',",  "icon: '💻',\n    name: 'TECH NOTES',"],
  ["icon: '??',\n    name: 'JAPAN TRIP 2024',",  "icon: '🗾',\n    name: 'JAPAN TRIP 2024',"],
  ["icon: '??',\n    name: 'STUDY MATERIALS',",  "icon: '📚',\n    name: 'STUDY MATERIALS',"],
  // BOOKS still encoded
  ["'Kh?i nghi?p tinh g?n', author: 'Mnemonics Academy', badge: 'Kh?a h?c', color: '#e0447a', icon: '??'",
   "'Lean startup', author: 'Mnemonics Academy', badge: 'Course', color: '#e0447a', icon: '🎓'"],
  ["'T?m l? h?c h?nh vi', author: 'Mnemonics Academy', badge: 'Kh?a h?c', color: '#f59e0b', icon: '??'",
   "'Behavioral psychology', author: 'Mnemonics Academy', badge: 'Course', color: '#f59e0b', icon: '🎓'"],
  ["'L?m ch? n?ng su?t c? nh?n', author: 'Mnemonics Academy', badge: 'Kh?a h?c', color: '#5B3FE4', icon: '??'",
   "'Master personal productivity', author: 'Mnemonics Academy', badge: 'Course', color: '#5B3FE4', icon: '🎓'"],
  // Download link + other
  ["dl = item.fileData ? `<a href=\"${escapeHtml(item.fileData)}\" download=\"${fileName}\" data-file-download=\"1\" style=\"display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:8px\">? T?i v?</a>` : '';",
   "dl = item.fileData ? `<a href=\"${escapeHtml(item.fileData)}\" download=\"${fileName}\" data-file-download=\"1\" style=\"display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:8px\">↓ Download</a>` : '';"],
  // Spaces
  ["<span>${getSpaceCount(s)} m?c d? li?u ? ${relatedCount} m?c kh?p</span>",
   "<span>${getSpaceCount(s)} items · ${relatedCount} matches</span>"],
  ["showToast('?? th?m v?o Y?u th?ch');", "showToast('Added to Favorites');"],
  // Empty reminders
  ["'<h3>Ch?a c? nh?c nh? ph? h?p</h3><p>T?o checklist m?i ho?c ??i b? l?c kh?c.</p>'",
   "'<h3>No matching reminders</h3><p>Create a new checklist or change the filter.</p>'"],
  ['<button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">X?a</button>',
   '<button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">Delete</button>'],
  // date/space "Just now"/"Just saved"
  ["date: 'V?a xong', space: 'M?i l?u',",
   "date: 'Just now', space: 'Just saved',"],
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
console.log(`Round-2 applied: ${applied}`);
if (failures.length) {
  console.log(`Not matched (${failures.length}):`);
  for (const f of failures) console.log(' - ' + JSON.stringify(f.slice(0, 90)));
}
