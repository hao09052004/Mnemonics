// Continuation of encoding fix-up.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetPath = join(__dirname, '..', 'apps', 'extension', 'dashboard.js');

// Round 2: fix remaining literals.
const replacements = [
  // BOOK_CATALOG badges/icon variations that didn't match round 1
  ["badge: 'Sch', color: '#5B3FE4', icon: '??'",
   "badge: 'Sách', color: '#5B3FE4', icon: '📘'"],
  ["badge: 'Sch', color: '#e0447a', icon: '??'",
   "badge: 'Sách', color: '#e0447a', icon: '📕'"],
  ["badge: 'Kha h?c Digital Marketing 4.0'",
   "badge: 'Khóa học Digital Marketing 4.0'"],
  ["badge: 'Kha h?c', color: '#f59e0b', icon: '??'",
   "badge: 'Khóa học', color: '#f59e0b', icon: '🎓'"],
  ["badge: 'Kha h?c', color: '#10b981', icon: '??'",
   "badge: 'Khóa học', color: '#10b981', icon: '🎓'"],
  ["badge: 'Kha h?c', color: '#5B3FE4', icon: '??'",
   "badge: 'Khóa học', color: '#5B3FE4', icon: '🎓'"],
  ["badge: 'Kha h?c', color: '#e0447a', icon: '??'",
   "badge: 'Khóa học', color: '#e0447a', icon: '🎓'"],
  ["badge: 'Sch', color: '#0ea5e9', icon: '??'",
   "badge: 'Sách', color: '#0ea5e9', icon: '📘'"],
  ["badge: 'Sch', color: '#10b981', icon: '??'",
   "badge: 'Sách', color: '#10b981', icon: '📕'"],
  ["badge: 'Sch', color: '#334155', icon: '??'",
   "badge: 'Sách', color: '#334155', icon: '📘'"],
  ["badge: 'Sch', color: '#f59e0b', icon: '??'",
   "badge: 'Sách', color: '#f59e0b', icon: '📕'"],

  // Various remaining titles with display as `Kha h?c` etc (mojibake)
  ["title: 'Kha h?c Digital Marketing 4.0'",
   "title: 'Khóa học Digital Marketing 4.0'"],
  ["title: 'Kh?i nghi?p tinh g?n'", "title: 'Khởi nghiệp tinh gọn'"],
  ["title: 'T?m l? h?c h?nh vi'", "title: 'Tâm lý học hành vi'"],
  ["title: 'L?m ch? n?ng su?t c? nh?n'",
   "title: 'Làm chủ năng suất cá nhân'"],

  // 3-dot menu / delete button (still mangled)
  ['>???</span>', '>⋮</span>'],
  ['>?? X?a</div>', '>✕ Xóa</div>'],

  // File download arrow
  ['T?i v?', 'Tải về'],
  ['T?p ??nh k?m', 'Tệp đính kèm'],

  // Đính kèm file card icon
  ["justify-content:center;font-size:20px;flex-shrink:0\">??</div>",
   "justify-content:center;font-size:20px;flex-shrink:0\">📎</div>"],

  // Xóa button in reminders
  ['<button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">X?a</button>',
   '<button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">Xóa</button>'],

  // deleteToast
  ["showToast('?? ?? x?a nh?c nh?');", "showToast('Đã xóa nhắc nhở');"],

  // Show in dashboard
  ['<button class="dashboard-reminder-open" data-open-reminders="1">M? Nh?c nh?</button>',
   '<button class="dashboard-reminder-open" data-open-reminders="1">Mở Nhắc nhở</button>'],
  ['<button class="dashboard-reminder-delete" data-dashboard-reminder-delete="${reminderId}">X?a</button>',
   '<button class="dashboard-reminder-delete" data-dashboard-reminder-delete="${reminderId}">Xóa</button>'],

  // Spaces/empty/saved/show-toast
  ['<h3>Ch?a c? nh?c nh? ph? h?p</h3>',
   '<h3>Chưa có nhắc nhở phù hợp</h3>'],
  ['<p>T?o checklist m?i ho?c ??i b? l?c kh?c.</p>',
   '<p>Tạo checklist mới hoặc đổi bộ lọc khác.</p>'],
  ['<p>L?u th?m ?nh, b?i vi?t ho?c ghi ch? c? tag li?n quan ?? ch?ng t? hi?n ? ??y.</p>',
   '<p>Lưu thêm ảnh, bài viết hoặc ghi chú có tag liên quan để chúng tôi hiển thị ở đây.</p>'],
];

let src = await readFile(targetPath, 'utf8');
let applied = 0;
const failures = [];
for (const [bad, good] of replacements) {
  const idx = src.indexOf(bad);
  if (idx === -1) { failures.push(bad); continue; }
  src = src.split(bad).join(good);
  applied++;
}
await writeFile(targetPath, src, 'utf8');
console.log(`Round-2 applied: ${applied}`);
if (failures.length) {
  console.log('Not found:');
  for (const f of failures) console.log(' - ' + JSON.stringify(f));
}
