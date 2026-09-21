// One-off restoration script — undoes the `?`-mangled Vietnamese
// strings inside `apps/extension/dashboard.js`. Each line maps the
// mangled literal that already exists in the file to the correct
// Vietnamese literal. Run with `node scripts/fix-dashboard-encoding.mjs`.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetPath = join(__dirname, '..', 'apps', 'extension', 'dashboard.js');

const replacements = [
  // ===== TOP-LEVEL DATA / SPACES =====
  ["icon: '??',\n    name: 'C?M H?NG THI?T K?',", "icon: '🎨',\n    name: 'CẢM HỨNG THIẾT KẾ',"],
  ["desc: '?nh ch?p m?n h?nh, b?ng m?u v? c?c m?u UI ???c thu th?p trong qu? tr?nh duy?t web.',",
   "desc: 'Ảnh chụp màn hình, bảng màu và các mẫu UI được thu thập trong quá trình duyệt web.',"],
  ["keywords: ['c?m h?ng', 'thi?t k?', 'design', 'inspiration', 'ui', 'ux', '?nh', 'image'],",
   "keywords: ['cảm hứng', 'thiết kế', 'design', 'inspiration', 'ui', 'ux', 'ảnh', 'image'],"],
  ["icon: '??',\n    name: 'GHI CH? C?NG NGH?',", "icon: '💻',\n    name: 'GHI CHÚ CÔNG NGHỆ',"],
  ["desc: 'C?c b?i b?o, ?o?n m? v? tin t?c c?ng ngh? t? qu? tr?nh duy?t web.',",
   "desc: 'Các bài báo, đoạn mã và tin tức công nghệ từ quá trình duyệt web.',"],
  ["keywords: ['c?ng ngh?', 'tech', 'code', 'css', 'frontend', 'backend', 'spatial', 'hci'],",
   "keywords: ['công nghệ', 'tech', 'code', 'css', 'frontend', 'backend', 'spatial', 'hci'],"],
  ["icon: '??',\n    name: 'CHUY?N ?I NH?T B?N 2024',", "icon: '🗾',\n    name: 'CHUYẾN ĐI NHẬT BẢN 2024',"],
  ["desc: 'L?ch tr?nh bay, ??t ph?ng kh?ch s?n v? c?c ??a ?i?m d? ki?n tham quan.',",
   "desc: 'Lịch trình bay, đặt phòng khách sạn và các địa điểm dự kiến tham quan.',"],
  ["keywords: ['nh?t b?n', 'japan', 'trip', 'travel', 'chuy?n ?i', 'kh?ch s?n', 'l?ch tr?nh'],",
   "keywords: ['nhật bản', 'japan', 'trip', 'travel', 'chuyến đi', 'khách sạn', 'lịch trình'],"],
  ["icon: '??',\n    name: 'T?I LI?U H?C T?P',", "icon: '📚',\n    name: 'TÀI LIỆU HỌC TẬP',"],
  ["desc: 'C?c b?i b?o nghi?n c?u, n?i dung n?i b?t t? s?ch gi?o khoa v? ghi ch? h?c t?p.',",
   "desc: 'Các bài báo nghiên cứu, nội dung nổi bật từ sách giáo khoa và ghi chú học tập.',"],
  ["keywords: ['h?c t?p', 't?i li?u', 'research', 'nghi?n c?u', 'article', 'study', 'book'],",
   "keywords: ['học tập', 'tài liệu', 'research', 'nghiên cứu', 'article', 'study', 'book'],"],

  // ===== DEFAULT REMINDERS =====
  ["title: 'Chu?n b? h?p: Ki?n tr?c h? th?ng',",
   "title: 'Chuẩn bị họp: Kiến trúc hệ thống',"],
  ["{ text: 'Xem l?i chi?n l??c b? nh? ??m cho ch? ?? ngo?i tuy?n', done: false },",
   "{ text: 'Xem lại chiến lược bộ nhớ đệm cho chế độ ngoại tuyến', done: false },"],
  ["{ text: 'Th?o lu?n v? WebSockets so v?i SSE', done: true },",
   "{ text: 'Thảo luận về WebSockets so với SSE', done: true },"],
  ["{ text: 'Ki?m tra gi?i h?n t?n su?t API tr?n c?c endpoint m?i', done: false }",
   "{ text: 'Kiểm tra giới hạn tần suất API trên các endpoint mới', done: false }"],
  ["date: 'H?m qua',", "date: 'Hôm qua',"],
  ["space: 'C?ng vi?c',", "space: 'Công việc',"],
  ["title: 'Todo list h?m nay',", "title: 'Todo list hôm nay',"],
  ["{ text: 'T?ng h?p t?i li?u ?? l?u trong tu?n', done: false },",
   "{ text: 'Tổng hợp tài liệu đã lưu trong tuần', done: false },"],
  ["{ text: 'G?n tags cho c?c note quan tr?ng', done: false },",
   "{ text: 'Gắn tags cho các note quan trọng', done: false },"],
  ["{ text: 'Xem l?i 2 m?c c?n ?n t?p', done: true }",
   "{ text: 'Xem lại 2 mục cần ôn tập', done: true }"],
  ["date: 'H?m nay',", "date: 'Hôm nay',"],
  ["space: 'H?c t?p',", "space: 'Học tập',"],

  // ===== Auth messages =====
  ["payload.error && payload.error.message ? payload.error.message : 'Kh?ng th? x?c th?c.'",
   "payload.error && payload.error.message ? payload.error.message : 'Không thể xác thực.'"],
  ["setAuthError('signup-error', 'Vui l?ng nh?p ??y ?? th?ng tin.');",
   "setAuthError('signup-error', 'Vui lòng nhập đầy đủ thông tin.');"],
  ["setAuthError('signup-error', 'Email ch?a ??ng ??nh d?ng.');",
   "setAuthError('signup-error', 'Email chưa đúng định dạng.');"],
  ["setAuthError('signup-error', 'M?t kh?u c?n t?i thi?u 10 k? t?, g?m ch? hoa, ch? th??ng, s? v? k? t? ??c bi?t.');",
   "setAuthError('signup-error', 'Mật khẩu cần tối thiểu 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');"],
  ["setAuthError('signup-error', 'M?t kh?u nh?p l?i ch?a kh?p.');",
   "setAuthError('signup-error', 'Mật khẩu nhập lại chưa khớp.');"],
  ["throw new Error('T?i kho?n ?? t?o. H?y x?c nh?n email r?i ??ng nh?p.');",
   "throw new Error('Tài khoản đã tạo. Hãy xác nhận email rồi đăng nhập.');"],
  ["showToast('?? t?o t?i kho?n Mnemonics');",
   "showToast('Đã tạo tài khoản Mnemonics');"],
  ["setAuthError('login-error', 'Vui l?ng nh?p email v? m?t kh?u.');",
   "setAuthError('login-error', 'Vui lòng nhập email và mật khẩu.');"],
  ["showToast('??ng nh?p th?nh c?ng');", "showToast('Đăng nhập thành công');"],
  ["showToast('?? ??ng xu?t');", "showToast('Đã đăng xuất');"],
  ["showToast('T?i kho?n demo ?? b? t?t ? h?y ??ng k? ho?c ??ng nh?p.');",
   "showToast('Tài khoản demo đã bị tắt — hãy đăng ký hoặc đăng nhập.');"],
  ["showToast('?? t? ??ng gia h?n phi?n');",
   "showToast('Đã tự động gia hạn phiên');"],
  ['"B?t ??u mi?n ph?" while the avatar', '"Bắt đầu miễn phí" while the avatar'],

  // ===== Sort/filter comments (lines 326-378) =====
  ["// Ph?n lo?i m?t item v? nh?m ??nh d?ng chu?n ?? l?c/s?p x?p",
   "// Phân loại một item về nhóm định dạng chuẩn để lọc/sắp xếp"],
  ['// "?nh" tab ? splitting them would force users to click two tabs to find',
   '// "Ảnh" tab — splitting them would force users to click two tabs to find'],
  ["// L?y m?c th?i gian (ms) c?a item ?? l?c theo ng?y/th?ng/n?m",
   "// Lấy mốc thời gian (ms) của item để lọc theo ngày/tháng/năm"],
  ["// Render cards c? ?p d?ng sort/filter + ? t?m ki?m hi?n t?i",
   "// Render cards đã áp dụng sort/filter + ô tìm kiếm hiện tại"],

  // ===== TOPIC_OPTIONS / BOOK_CATALOG (some may remain in some state) =====
  ["{ id: 'marketing', label: 'Marketing', keywords: ['marketing','mkt','brand','th??ng hi?u','qu?ng c?o','ads','seo','content','kh?ch h?ng','s?n ph?m','product'] },",
   "{ id: 'marketing', label: 'Marketing', keywords: ['marketing','mkt','brand','thương hiệu','quảng cáo','ads','seo','content','khách hàng','sản phẩm','product'] },"],
  ["{ id: 'design', label: 'Thi?t k?', keywords: ['design','thi?t k?','ui','ux','inspiration','c?m h?ng','m?u','typography'] },",
   "{ id: 'design', label: 'Thiết kế', keywords: ['design','thiết kế','ui','ux','inspiration','cảm hứng','mẫu','typography'] },"],
  ["{ id: 'tech', label: 'C?ng ngh?', keywords: ['tech','c?ng ngh?','code','css','frontend','backend','ai','spatial','hci'] },",
   "{ id: 'tech', label: 'Công nghệ', keywords: ['tech','công nghệ','code','css','frontend','backend','ai','spatial','hci'] },"],
  ["{ id: 'business', label: 'Kinh doanh', keywords: ['business','kinh doanh','startup','kh?i nghi?p','finance','t?i ch?nh','qu?n l?'] },",
   "{ id: 'business', label: 'Kinh doanh', keywords: ['business','kinh doanh','startup','khởi nghiệp','finance','tài chính','quản lý'] },"],
  ["{ id: 'psychology', label: 'T?m l? h?c', keywords: ['psychology','t?m l?','habit','th?i quen','behavior','h?nh vi'] },",
   "{ id: 'psychology', label: 'Tâm lý học', keywords: ['psychology','tâm lý','habit','thói quen','behavior','hành vi'] },"],
  ["{ id: 'productivity', label: 'N?ng su?t', keywords: ['productivity','n?ng su?t','habit','ghi ch?','study','h?c t?p','focus'] },",
   "{ id: 'productivity', label: 'Năng suất', keywords: ['productivity','năng suất','habit','ghi chú','study','học tập','focus'] },"],
  ["{ id: 'language', label: 'Ngo?i ng?', keywords: ['english','ti?ng anh','language','ngo?i ng?','ielts','toeic'] },",
   "{ id: 'language', label: 'Ngoại ngữ', keywords: ['english','tiếng anh','language','ngoại ngữ','ielts','toeic'] },"],
  ["{ id: 'writing', label: 'Vi?t l?ch', keywords: ['writing','vi?t','content','copywriting','storytelling'] }",
   "{ id: 'writing', label: 'Viết lách', keywords: ['writing','viết','content','copywriting','storytelling'] }"],

  // ===== BOOK_CATALOG entries (badge + emoji icons) =====
  ["badge: 'S?ch', color: '#5B3FE4', icon: '??'", "badge: 'Sách', color: '#5B3FE4', icon: '📘'"],
  ["badge: 'S?ch', color: '#e0447a', icon: '??'", "badge: 'Sách', color: '#e0447a', icon: '📕'"],
  ["badge: 'Kh?a h?c', color: '#f59e0b', icon: '??'", "badge: 'Khóa học', color: '#f59e0b', icon: '🎓'"],
  ["badge: 'S?ch', color: '#0ea5e9', icon: '??'", "badge: 'Sách', color: '#0ea5e9', icon: '📘'"],
  ["badge: 'S?ch', color: '#10b981', icon: '??'", "badge: 'Sách', color: '#10b981', icon: '📕'"],
  ["badge: 'Kh?a h?c', color: '#10b981', icon: '??'", "badge: 'Khóa học', color: '#10b981', icon: '🎓'"],
  ["badge: 'S?ch', color: '#334155', icon: '??'", "badge: 'Sách', color: '#334155', icon: '📘'"],
  ["badge: 'S?ch', color: '#f59e0b', icon: '??'", "badge: 'Sách', color: '#f59e0b', icon: '📕'"],
  ["badge: 'Kh?a h?c', color: '#5B3FE4', icon: '??'", "badge: 'Khóa học', color: '#5B3FE4', icon: '🎓'"],
  ["badge: 'Kh?a h?c', color: '#e0447a', icon: '??'", "badge: 'Khóa học', color: '#e0447a', icon: '🎓'"],
  ["badge: 'Kh?a h?c', color: '#f59e0b', icon: '??'", "badge: 'Khóa học', color: '#f59e0b', icon: '🎓'"],

  // Specific titles
  ["title: 'Kh?a h?c Digital Marketing 4.0'", "title: 'Khóa học Digital Marketing 4.0'"],
  ["title: 'Kh?i nghi?p tinh g?n'", "title: 'Khởi nghiệp tinh gọn'"],
  ["title: 'T?m l? h?c h?nh vi'", "title: 'Tâm lý học hành vi'"],
  ["title: 'L?m ch? n?ng su?t c? nh?n'", "title: 'Làm chủ năng suất cá nhân'"],

  // ===== Book panel UI =====
  ["<div class=\"book-panel-eyebrow\">? G?i ? cho b?n</div>",
   "<div class=\"book-panel-eyebrow\">✦ Gợi ý cho bạn</div>"],
  ["<div class=\"book-panel-title\">S?ch & kh?a h?c n?i b?t</div>",
   "<div class=\"book-panel-title\">Sách & khóa học nổi bật</div>"],
  ['<div class="book-panel-topic">D?a tr?n l?nh v?c: <b>',
   '<div class="book-panel-topic">Dựa trên lĩnh vực: <b>'],
  ["<label>??i l?nh v?c</label>", "<label>Đổi lĩnh vực</label>"],
  ['<div class="book-panel-foot">Mnemonics h?p t?c c?ng c?c nh? b?n s?ch & n?n t?ng kh?a h?c.<br>Ch?n l?nh v?c trong <b>C?i ??t</b> ?? c? nh?n h?a.</div>',
   '<div class="book-panel-foot">Mnemonics hợp tác cùng các nhà bán sách & nền tảng khóa học.<br>Chọn lĩnh vực trong <b>Cài đặt</b> để cá nhân hóa.</div>'],

  // ===== detectTopicFromItems comment + reminder item =====
  ["// ?o?n l?nh v?c quan t?m t? d? li?u ?? l?u n?u user ch?a ch?n th? c?ng",
   "// Đoán lĩnh vực quan tâm từ dữ liệu đã lưu nếu user chưa chọn thủ công"],
  ["const kindLabel = reminder.kind === 'meeting' ? 'Bi?n b?n h?p' : 'Todo list';",
   "const kindLabel = reminder.kind === 'meeting' ? 'Biên bản họp' : 'Todo list';"],
  ["excerpt: `${kindLabel} ? ${doneCount}/${totalCount} ho?n th?nh`,",
   "excerpt: `${kindLabel} · ${doneCount}/${totalCount} hoàn thành`,"],
  ["tags: ['nh?c nh?', reminder.kind === 'meeting' ? 'bi?n b?n h?p' : 'todo'],",
   "tags: ['nhắc nhở', reminder.kind === 'meeting' ? 'biên bản họp' : 'todo'],"],
  ["date: reminder.date || 'H?m nay',", "date: reminder.date || 'Hôm nay',"],
  ["space: reminder.space || 'Nh?c nh?',", "space: reminder.space || 'Nhắc nhở',"],

  // ===== apiItemToLocalShape =====
  ["const title = item.title || (kind === 'link' ? 'Link ?? l?u' : 'M?c ?? l?u');",
   "const title = item.title || (kind === 'link' ? 'Link đã lưu' : 'Mục đã lưu');"],

  // ===== resync "Đồng bộ" =====
  ['until the user clicks "??ng b? l?n database" or the resync succeeds.',
   'until the user clicks "Đồng bộ lên database" or the resync succeeds.'],

  // ===== Polling + item count comments =====
  ["// L?ng nghe khi extension popup l?u item m?i ? reload ngay",
   "// Lắng nghe khi extension popup lưu item mới → reload ngay"],
  ["// Fallback: poll m?i 3 gi?y ?? ch?c ch?n sync",
   "// Fallback: poll mỗi 3 giây để chắc chắn sync"],
  ["if (el) el.textContent = items.length + ' k? ?c ?? ???c l?u trong th?ng n?y.';",
   "if (el) el.textContent = items.length + ' ký ức đã được lưu trong tháng này.';"],

  // ===== renderCards header =====
  ["document.getElementById('item-count').textContent = `${data.length} k? ?c ?? ???c l?u trong th?ng n?y.`;",
   "document.getElementById('item-count').textContent = `${data.length} ký ức đã được lưu trong tháng này.`;"],
  ['// Build the "??ng b? l?n database" pill used by image/link/quote cards',
   '// Build the "Đồng bộ lên database" pill used by image/link/quote cards'],
  ['title="Upload l?n Supabase">', 'title="Upload lên Supabase">'],
  ['<span class="resync-dot"></span>??ng b? l?n database',
   '<span class="resync-dot"></span>Đồng bộ lên database'],
  ['<h3>Kh?ng t?m th?y k?t qu?</h3>', '<h3>Không tìm thấy kết quả</h3>'],
  ['<p>H?y th? t? kh?a kh?c ho?c th?m k? ?c m?i</p>',
   '<p>Hãy thử từ khóa khác hoặc thêm ký ức mới</p>'],
  ["(item.tags && item.tags.includes('bi?n b?n h?p') ? 'BI?N B?N H?P' : 'TODO LIST')",
   "(item.tags && item.tags.includes('biên bản họp') ? 'BIÊN BẢN HỌP' : 'TODO LIST')"],
  ["imageTitle = escapeHtml(item.title || (item.type === 'screenshot' ? '?nh ch?p m?n h?nh' : '?nh ?? l?u'));",
   "imageTitle = escapeHtml(item.title || (item.type === 'screenshot' ? 'Ảnh chụp màn hình' : 'Ảnh đã lưu'));"],
  ['title="B?m ?? xem ?nh"', 'title="Bấm để xem ảnh"'],
  ["item.type === 'screenshot' ? 'Xem ?nh ch?p' : 'Xem ?nh'",
   "item.type === 'screenshot' ? 'Xem ảnh chụp' : 'Xem ảnh'"],
  ["${escapeHtml(item.title || 'Link ?? l?u')}",
   "${escapeHtml(item.title || 'Link đã lưu')}"],
  ["${displayUrl || 'M? link'} ?</a>` : ''}",
   "${displayUrl || 'Mở link'} ↗</a>` : ''}"],
  ["const fileName = escapeHtml(item.fileName || item.title || 'T?p ??nh k?m');",
   "const fileName = escapeHtml(item.fileName || item.title || 'Tệp đính kèm');"],
  [`'><a href="\${escapeHtml(item.fileData)}" download="\${fileName}" data-file-download="1" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:8px">? T?i v?</a>'`,
   `'><a href="${'$'}{escapeHtml(item.fileData)}" download="${'$'}{fileName}" data-file-download="1" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:8px">↓ Tải về</a>'`],
  [`"><div style="width:40px;height:40px;border-radius:8px;background:var(--purple-light);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">??</div>`,
   `"><div style="width:40px;height:40px;border-radius:8px;background:var(--purple-light);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📎</div>`],
  [`\${typeLabel} ? \${doneCount}/\${totalCount} ho?n th?nh`,
   `${'$'}{typeLabel} · ${'$'}{doneCount}/${'$'}{totalCount} hoàn thành`],
  ['title="B?m ?? tick / b? tick"', 'title="Bấm để tick / bỏ tick"'],
  ['>M? Nh?c nh?</button>', '>Mở Nhắc nhở</button>'],
  ['>X?a</button>', '>Xóa</button>'],
  ['???</span>', '⋮</span>'],
  ['>?? X?a</div>', '>✕ Xóa</div>'],

  // ===== Spaces page =====
  ['// "C?m h?ng" space shows both uploaded images AND cropped screenshots',
   '// "Cảm hứng" space shows both uploaded images AND cropped screenshots'],
  ['<h3>Ch?a c? kh?ng gian y?u th?ch</h3>', '<h3>Chưa có không gian yêu thích</h3>'],
  ['<p>B?m bi?u t??ng ng?i sao tr?n m?t kh?ng gian ?? ??a v?o m?c Y?u th?ch.</p>',
   '<p>Bấm biểu tượng ngôi sao trên một không gian để đưa vào mục Yêu thích.</p>'],
  ["title=\"${isFavorite ? 'B? y?u th?ch' : 'Th?m y?u th?ch'}\">?",
   "title=\"${isFavorite ? 'Bỏ yêu thích' : 'Thêm yêu thích'}\">★"],
  ['<span>${getSpaceCount(s)} m?c d? li?u ? ${relatedCount} m?c kh?p</span>',
   '<span>${getSpaceCount(s)} mục dữ liệu · ${relatedCount} mục khớp</span>'],
  ['<div class="space-open-hint">M? kh?ng gian ?</div>',
   '<div class="space-open-hint">Mở không gian ›</div>'],
  ["showToast('?? b? kh?i Y?u th?ch');", "showToast('Đã bỏ khỏi Yêu thích');"],
  ["showToast('?? th?m v?o Y?u th?ch');", "showToast('Đã thêm vào Yêu thích');"],

  // ===== Space detail =====
  ['<button class="space-back-btn" id="space-detail-back">? Quay l?i</button>',
   '<button class="space-back-btn" id="space-detail-back">← Quay lại</button>'],
  ["${isFavorite ? '? ?? y?u th?ch' : '? Y?u th?ch'}",
   "${isFavorite ? '★ Đã yêu thích' : '☆ Yêu thích'}"],
  ['<button class="space-detail-btn" id="space-detail-open-dashboard">Xem trong l?u tr?</button>',
   '<button class="space-detail-btn" id="space-detail-open-dashboard">Xem trong lưu trữ</button>'],
  ['<span>${getSpaceCount(space)} m?c d? li?u</span>',
   '<span>${getSpaceCount(space)} mục dữ liệu</span>'],
  ['<span>${getSpaceItems(space).length} m?c ?ang kh?p v?i d? li?u demo/l?u th?t</span>',
   '<span>${getSpaceItems(space).length} mục đang khớp với dữ liệu demo/lưu thật</span>'],
  ['<span>C?p nh?t g?n ??y</span>', '<span>Cập nhật gần đây</span>'],
  ['placeholder="T?m trong kh?ng gian n?y..."',
   'placeholder="Tìm trong không gian này..."'],
  ['<h3>Ch?a c? m?c n?o trong kh?ng gian n?y</h3>',
   '<h3>Chưa có mục nào trong không gian này</h3>'],
  ['<p>L?u th?m ?nh, b?i vi?t ho?c ghi ch? c? tag li?n quan ?? ch?ng t? hi?n ? ??y.</p>',
   '<p>Lưu thêm ảnh, bài viết hoặc ghi chú có tag liên quan để chúng tôi hiển thị ở đây.</p>'],
  ["{ article:'B?i vi?t', image:'?nh', note:'Ghi ch?', quote:'Tr?ch d?n', code:'M? ngu?n' }",
   "{ article:'Bài viết', image:'Ảnh', note:'Ghi chú', quote:'Trích dẫn', code:'Mã nguồn' }"],
  ["const title = item.title || item.quote || item.note || 'K? ?c ?? l?u';",
   "const title = item.title || item.quote || item.note || 'Ký ức đã lưu';"],
  ["(item.checks || []).map(function(c) { return c.text; }).join(' ? ')",
   "(item.checks || []).map(function(c) { return c.text; }).join(' · ')"],
  ['<button class="space-item-open" data-space-open-url="${escapeHtml(url)}">M? ngu?n</button>',
   '<button class="space-item-open" data-space-open-url="${escapeHtml(url)}">Mở nguồn</button>'],

  // ===== Reminders panel =====
  ["${getFilteredReminders().length} m?c nh?c nh?",
   "${getFilteredReminders().length} mục nhắc nhở"],
  ["'<h3>Ch?a c? nh?c nh? ph? h?p</h3><p>T?o checklist m?i ho?c ??i b? l?c kh?c.</p>'",
   "'<h3>Chưa có nhắc nhở phù hợp</h3><p>Tạo checklist mới hoặc đổi bộ lọc khác.</p>'"],
  ["item.kind === 'meeting' ? 'BI?N B?N H?P' : 'TODO LIST'",
   "item.kind === 'meeting' ? 'BIÊN BẢN HỌP' : 'TODO LIST'"],
  ["${doneCount}/${totalCount} ho?n th?nh",
   "${doneCount}/${totalCount} hoàn thành"],
  ["${escapeHtml(item.date || 'H?m nay')}",
   "${escapeHtml(item.date || 'Hôm nay')}"],
  ['<span style="color:#ddd;margin:0 6px">?</span>', '<span style="color:#ddd;margin:0 6px">·</span>'],
  ["${escapeHtml(item.space || 'C?ng vi?c')}",
   "${escapeHtml(item.space || 'Công việc')}"],
  ['<button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">X?a</button>',
   '<button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">Xóa</button>'],
  ["? ?* \\}\\)[a-z]+\\) ? spaceEl.value.trim\\(\\) : 'C?ng vi?c';",
   "?"],
  // Actually simpler: literal replace inside code
  ["const space = spaceEl ? spaceEl.value.trim() : 'C?ng vi?c';",
   "const space = spaceEl ? spaceEl.value.trim() : 'Công việc';"],
  ["showToast('Nh?p ti?u ?? v? ?t nh?t 1 checklist nh?!');",
   "showToast('Nhập tiêu đề và ít nhất 1 checklist nhé!');"],
  ["date: 'V?a xong',", "date: 'Vừa xong',"],
  ["space: space || 'C?ng vi?c',", "space: space || 'Công việc',"],
  ["if (spaceEl) spaceEl.value = space || 'C?ng vi?c';",
   "if (spaceEl) spaceEl.value = space || 'Công việc';"],
  ["showToast('? ?? l?u nh?c nh?');", "showToast('✓ Đã lưu nhắc nhở');"],
  ["showToast('?? ?? x?a nh?c nh?');", "showToast('Đã xóa nhắc nhở');"],

  // ===== Search =====
  ['// K?t h?p search v?i sort/filter hi?n t?i', '// Kết hợp search với sort/filter hiện tại'],
  ['// T?m ki?m th? c?ng, kh?ng c?n AI', '// Tìm kiếm thủ công, không cần AI'],
  ["`T?m th?y <b>${matched.length}</b> k?t qu? li?n quan ??n \"<b>${query}</b>\". C?c m?c li?n quan nh?t hi?n th? b?n d??i.`",
   "`Tìm thấy <b>${matched.length}</b> kết quả liên quan đến \"<b>${query}</b>\". Các mục liên quan nhất hiển thị bên dưới.`"],
  ["`Kh?ng t?m th?y k?t qu? n?o cho \"<b>${query}</b>\". Th? t? kh?a kh?c nh?!`",
   "`Không tìm thấy kết quả nào cho \"<b>${query}</b>\". Thử từ khóa khác nhé!`"],
  ['// Supabase Storage signed URLs (`?token=...`) already authorize the',
   '// Supabase Storage signed URLs (`?token=...`) already authorize the'],
  ["+ '/api/v1/proxy/image?url=' + encodeURIComponent(imageUrl);",
   "+ '/api/v1/proxy/image?url=' + encodeURIComponent(imageUrl);"],
  ["title || '?nh ?? l?u'", "title || 'Ảnh đã lưu'"],
  ["title || '?nh g?c'", "title || 'Ảnh gốc'"],
  ["showToast('Kh?ng th? m? ?nh g?c');", "showToast('Không thể mở ảnh gốc');"],
];

let src = await readFile(targetPath, 'utf8');
let applied = 0;
const failures = [];
for (const [bad, good] of replacements) {
  // Important: use literal replacement (not regex)
  const before = src.length;
  const idx = src.indexOf(bad);
  if (idx === -1) {
    failures.push(bad.slice(0, 60));
    continue;
  }
  // Replace all occurrences
  src = src.split(bad).join(good);
  applied += (before - src.length === 0 ? 1 : (before - src.length) / Math.max(bad.length - good.length, 1));
}
await writeFile(targetPath, src, 'utf8');
console.log(`Applied: ${applied}`);
if (failures.length) {
  console.log('Not found (mangled literal mismatch):');
  for (const f of failures) console.log(' - ' + f);
}
