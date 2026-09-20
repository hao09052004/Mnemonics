// ===== DATA =====
// (Sample/demo data was removed in task 19 — it confused users into thinking
// their items leaked across accounts.)
const SPACES_DATA = [
  {
    id: 'design-inspiration',
    icon: '🎨',
    name: 'CẢM HỨNG THIẾT KẾ',
    desc: 'Ảnh chụp màn hình, bảng màu và các mẫu UI được thu thập trong quá trình duyệt web.',
    count: 42,
    keywords: ['cảm hứng', 'thiết kế', 'design', 'inspiration', 'ui', 'ux', 'ảnh', 'image'],
    updatedAt: '2026-06-25T08:00:00.000Z'
  },
  {
    id: 'tech-notes',
    icon: '⚙️',
    name: 'GHI CHÚ CÔNG NGHỆ',
    desc: 'Các bài báo, đoạn mã và tin tức công nghệ từ quá trình duyệt web.',
    count: 128,
    keywords: ['công nghệ', 'tech', 'code', 'css', 'frontend', 'backend', 'spatial', 'hci'],
    updatedAt: '2026-06-24T10:00:00.000Z'
  },
  {
    id: 'japan-trip',
    icon: '✈️',
    name: 'CHUYẾN ĐI NHẬT BẢN 2024',
    desc: 'Lịch trình bay, đặt phòng khách sạn và các địa điểm dự kiến tham quan.',
    count: 15,
    keywords: ['nhật bản', 'japan', 'trip', 'travel', 'chuyến đi', 'khách sạn', 'lịch trình'],
    updatedAt: '2026-06-20T10:00:00.000Z'
  },
  {
    id: 'study-materials',
    icon: '📚',
    name: 'TÀI LIỆU HỌC TẬP',
    desc: 'Các bài báo nghiên cứu, nội dung nổi bật từ sách giáo khoa và ghi chú học tập.',
    count: 89,
    keywords: ['học tập', 'tài liệu', 'research', 'nghiên cứu', 'article', 'study', 'book'],
    updatedAt: '2026-06-22T10:00:00.000Z'
  },
];

let currentSpaceFilter = 'all';
let currentSpaceView = 'grid';
let currentSpaceId = null;
let favoriteSpaceIds = [];
let recentSpaceIds = [];


const DEFAULT_REMINDERS = [
  {
    id: 'sample-meeting-1',
    kind: 'meeting',
    title: 'Chuẩn bị họp: Kiến trúc hệ thống',
    tasks: [
      { text: 'Xem lại chiến lược bộ nhớ đệm cho chế độ ngoại tuyến', done: false },
      { text: 'Thảo luận về WebSockets so với SSE', done: true },
      { text: 'Kiểm tra giới hạn tần suất API trên các endpoint mới', done: false }
    ],
    date: 'Hôm qua',
    space: 'Công việc',
    createdAt: new Date().toISOString()
  },
  {
    id: 'sample-todo-1',
    kind: 'todo',
    title: 'Todo list hôm nay',
    tasks: [
      { text: 'Tổng hợp tài liệu đã lưu trong tuần', done: false },
      { text: 'Gắn tags cho các note quan trọng', done: false },
      { text: 'Xem lại 2 mục cần ôn tập', done: true }
    ],
    date: 'Hôm nay',
    space: 'Học tập',
    createdAt: new Date().toISOString()
  }
];

let reminders = [];
let reminderFilter = 'all';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ===== LOCAL DEMO AUTH =====
let currentUser = null;

function getStorageValue(key, fallback, cb) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(key, function(r) { cb(r[key] === undefined ? fallback : r[key]); });
  } else {
    try {
      const raw = localStorage.getItem(key);
      cb(raw ? JSON.parse(raw) : fallback);
    } catch(e) { cb(fallback); }
  }
}

function setStorageValues(values, cb) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set(values, function() { if (cb) cb(); });
  } else {
    Object.keys(values).forEach(function(key) {
      localStorage.setItem(key, JSON.stringify(values[key]));
    });
    if (cb) cb();
  }
}

// Per-user storage namespace. Falls back to the shared key when no user is
// logged in so first-time visitors still see the demo dashboard without
// crashing.
function userItemsKey() {
  const uid = currentUser && currentUser.id ? currentUser.id : 'guest';
  return 'mnemonics_items_' + uid;
}

function userRemindersKey() {
  const uid = currentUser && currentUser.id ? currentUser.id : 'guest';
  return 'mnemonics_reminders_' + uid;
}

function setAuthError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('show', Boolean(message));
}

function getInitials(nameOrEmail) {
  const value = String(nameOrEmail || 'User').trim();
  const words = value.includes('@') ? [value[0]] : value.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'M';
}

function updateAuthUI() {
  const loginBtn = document.getElementById('btn-login');
  const signupBtn = document.getElementById('btn-signup');
  const userPill = document.getElementById('auth-user-pill');
  const logoutBtn = document.getElementById('btn-logout');
  const userName = document.getElementById('auth-user-name');
  const userAvatar = document.getElementById('auth-user-avatar');
  const sidebarName = document.querySelector('.user-name');
  const sidebarAvatar = document.querySelector('.avatar');
  const isLoggedIn = Boolean(currentUser && currentUser.email);

  if (loginBtn) loginBtn.style.display = isLoggedIn ? 'none' : '';
  if (signupBtn) signupBtn.style.display = isLoggedIn ? 'none' : '';
  if (userPill) userPill.style.display = isLoggedIn ? 'inline-flex' : 'none';
  if (logoutBtn) logoutBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';

  const displayName = isLoggedIn ? (currentUser.name || currentUser.email) : 'Jane Doe';
  const initials = getInitials(displayName);
  if (userName) userName.textContent = displayName;
  if (userAvatar) userAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = displayName;
  if (sidebarAvatar) sidebarAvatar.textContent = initials;
}

function loadAuthState(cb) {
  getStorageValue('mnemonics_session', null, function(session) {
    currentUser = session && session.user && session.accessToken ? session.user : null;
    updateAuthUI();
    if (cb) cb();
  });
}

function saveSession(session, cb) {
  currentUser = session && session.user ? session.user : null;
  setStorageValues({ mnemonics_session: session || null }, function() {
    updateAuthUI();
    if (cb) cb();
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function authRequest(path, body) {
  const response = await fetch('http://localhost:4000/api/v1/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(function() { return {}; });
  if (!response.ok) {
    // If the API rejected our access token, force the session to clear.
    if (path === 'refresh' && response.status === 401) {
      saveSession(null);
    }
    throw new Error(payload.error && payload.error.message ? payload.error.message : 'Không thể xác thực.');
  }
  return payload.data;
}

async function handleSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const email = normalizeEmail(document.getElementById('signup-email').value);
  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  setAuthError('signup-error', '');

  if (!name || !email || !password || !confirm) {
    setAuthError('signup-error', 'Vui lòng nhập đầy đủ thông tin.');
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setAuthError('signup-error', 'Email chưa đúng định dạng.');
    return;
  }
  if (
    password.length < 10 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    setAuthError('signup-error', 'Mật khẩu cần tối thiểu 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');
    return;
  }
  if (password !== confirm) {
    setAuthError('signup-error', 'Mật khẩu nhập lại chưa khớp.');
    return;
  }

  try {
    const data = await authRequest('register', { name, email, password });
    if (!data.session) throw new Error('Tài khoản đã tạo. Hãy xác nhận email rồi đăng nhập.');
    saveSession({ ...data.session, user: data.user }, function() {
      showToast('Đã tạo tài khoản Mnemonics');
      loadFromExtension(function() { showPage('dashboard'); });
    });
  } catch (error) {
    setAuthError('signup-error', error.message);
  }
}

async function handleLogin() {
  const email = normalizeEmail(document.getElementById('login-email').value);
  const password = document.getElementById('login-password').value;
  setAuthError('login-error', '');

  if (!email || !password) {
    setAuthError('login-error', 'Vui lòng nhập email và mật khẩu.');
    return;
  }

  try {
    const data = await authRequest('login', { email, password });
    saveSession({ ...data.session, user: data.user }, function() {
      showToast('Đăng nhập thành công');
      loadFromExtension(function() { showPage('dashboard'); });
    });
  } catch (error) {
    setAuthError('login-error', error.message);
  }
}

function logoutUser() {
  // Best-effort backend revocation; ignore failures (idempotent on server).
  const token = (typeof currentUser === 'object' && currentUser) ? readAccessToken() : null;
  fetch('http://localhost:4000/api/v1/auth/logout', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: ''
  }).catch(() => undefined);
  saveSession(null, function() {
    showToast('Đã đăng xuất');
    showPage('landing');
  });
}

// Demo login helper used by the optional "auth-demo-login" button.
// In production we don't ship demo credentials — this is a no-op fallback so
// the listener at `DOMContentLoaded` doesn't throw `ReferenceError`.
async function loginDemoUser() {
  showToast('Tài khoản demo đã bị tắt — hãy đăng ký hoặc đăng nhập.');
  showPage('login');
}

function readAccessToken() {
  try {
    const raw = localStorage.getItem('mnemonics_session');
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.accessToken) return s.accessToken;
    }
  } catch (e) { /* ignore */ }
  if (typeof chrome !== 'undefined' && chrome.storage) {
    let captured;
    chrome.storage.local.get('mnemonics_session', function(r) {
      captured = r && r.mnemonics_session ? r.mnemonics_session.accessToken : null;
    });
    return captured;
  }
  return null;
}

async function silentRefresh(refreshToken) {
  try {
    const data = await authRequest('refresh', { refreshToken });
    if (data && data.session) {
      saveSession({ ...data.session, user: data.user || currentUser }, function() {
        showToast('Đã tự động gia hạn phiên');
      });
    }
  } catch (e) {
    // Refresh failed; drop the stale session silently so we don't reuse it.
    saveSession(null);
  }
}


let baseMemoryItems = [];
let items = [];

// ===== SORT / FILTER / TIME STATE =====
let currentSortBy = 'newest';
let currentFormatFilter = 'all';
let currentTimeFilter = 'all';

// Phân loại một item về nhóm định dạng chuẩn để lọc/sắp xếp
function getItemFormat(item) {
  // Visual captures (uploaded images + cropped screenshots) share the same
  // "Ảnh" tab — splitting them would force users to click two tabs to find
  // what they just saved, which feels broken.
  if (item.type === 'image' || item.type === 'screenshot') return 'image';
  if (item.type === 'file') return 'file';
  if (item.type === 'link') return 'link';
  if (item.type === 'quote') return 'quote';
  return 'text';
}

// Lấy mốc thời gian (ms) của item để lọc theo ngày/tháng/năm
function getItemTimestamp(item) {
  if (item.savedAt) {
    var t = new Date(item.savedAt).getTime();
    if (!isNaN(t)) return t;
  }
  if (typeof item.id === 'number' && item.id > 1000000000000) return item.id;
  return 0;
}

function passesTimeFilter(item) {
  if (currentTimeFilter === 'all') return true;
  var ts = getItemTimestamp(item);
  if (!ts) return false;
  var now = new Date();
  var d = new Date(ts);
  if (currentTimeFilter === 'today') return d.toDateString() === now.toDateString();
  if (currentTimeFilter === 'week') return (now.getTime() - ts) <= 7 * 24 * 60 * 60 * 1000;
  if (currentTimeFilter === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (currentTimeFilter === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}

function applySortFilter(list) {
  var out = list.filter(function(item) {
    if (currentFormatFilter !== 'all' && getItemFormat(item) !== currentFormatFilter) return false;
    if (!passesTimeFilter(item)) return false;
    return true;
  });
  out.sort(function(a, b) {
    if (currentSortBy === 'newest') return getItemTimestamp(b) - getItemTimestamp(a);
    if (currentSortBy === 'oldest') return getItemTimestamp(a) - getItemTimestamp(b);
    if (currentSortBy === 'title') return normalizeText(a.title || a.quote || '').localeCompare(normalizeText(b.title || b.quote || ''));
    if (currentSortBy === 'type') return getItemFormat(a).localeCompare(getItemFormat(b)) || (getItemTimestamp(b) - getItemTimestamp(a));
    return 0;
  });
  return out;
}

// Render cards có áp dụng sort/filter + ô tìm kiếm hiện tại
function renderDashboard() {
  var searchVal = '';
  var searchEl = document.getElementById('search-input');
  if (searchEl) searchVal = searchEl.value.toLowerCase().trim();
  var base = searchVal ? items.filter(function(i) { return getSearchText(i).includes(searchVal); }) : items;
  renderCards(applySortFilter(base));
}

// ===== BOOK / COURSE SUGGESTIONS (collab) =====
const TOPIC_OPTIONS = [
  { id: 'marketing', label: 'Marketing', keywords: ['marketing','mkt','brand','thương hiệu','quảng cáo','ads','seo','content','khách hàng','sản phẩm','product'] },
  { id: 'design', label: 'Thiết kế', keywords: ['design','thiết kế','ui','ux','inspiration','cảm hứng','màu','typography'] },
  { id: 'tech', label: 'Công nghệ', keywords: ['tech','công nghệ','code','css','frontend','backend','ai','spatial','hci'] },
  { id: 'business', label: 'Kinh doanh', keywords: ['business','kinh doanh','startup','khởi nghiệp','finance','tài chính','quản lý'] },
  { id: 'psychology', label: 'Tâm lý học', keywords: ['psychology','tâm lý','habit','thói quen','behavior','hành vi'] },
  { id: 'productivity', label: 'Năng suất', keywords: ['productivity','năng suất','habit','ghi chú','study','học tập','focus'] },
  { id: 'language', label: 'Ngoại ngữ', keywords: ['english','tiếng anh','language','ngoại ngữ','ielts','toeic'] },
  { id: 'writing', label: 'Viết lách', keywords: ['writing','viết','content','copywriting','storytelling'] }
];

const BOOK_CATALOG = {
  marketing: [
    { title: 'This Is Marketing', author: 'Seth Godin', badge: 'Sách', color: '#5B3FE4', icon: '📕' },
    { title: 'Contagious: Why Things Catch On', author: 'Jonah Berger', badge: 'Sách', color: '#e0447a', icon: '📗' },
    { title: 'Khóa học Digital Marketing 4.0', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#f59e0b', icon: '🎓' }
  ],
  design: [
    { title: 'The Design of Everyday Things', author: 'Don Norman', badge: 'Sách', color: '#0ea5e9', icon: '📘' },
    { title: 'Refactoring UI', author: 'Wathan & Schoger', badge: 'Sách', color: '#5B3FE4', icon: '📕' },
    { title: 'UI/UX Design Foundations', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#10b981', icon: '🎓' }
  ],
  tech: [
    { title: 'Clean Code', author: 'Robert C. Martin', badge: 'Sách', color: '#334155', icon: '📗' },
    { title: 'Pragmatic Programmer', author: 'Hunt & Thomas', badge: 'Sách', color: '#f59e0b', icon: '📙' },
    { title: 'Frontend Masters Path', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#5B3FE4', icon: '🎓' }
  ],
  business: [
    { title: 'The Lean Startup', author: 'Eric Ries', badge: 'Sách', color: '#0ea5e9', icon: '📘' },
    { title: 'Zero to One', author: 'Peter Thiel', badge: 'Sách', color: '#334155', icon: '📕' },
    { title: 'Khởi nghiệp tinh gọn', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#e0447a', icon: '🎓' }
  ],
  psychology: [
    { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', badge: 'Sách', color: '#5B3FE4', icon: '📕' },
    { title: 'Atomic Habits', author: 'James Clear', badge: 'Sách', color: '#10b981', icon: '📗' },
    { title: 'Tâm lý học hành vi', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#f59e0b', icon: '🎓' }
  ],
  productivity: [
    { title: 'Deep Work', author: 'Cal Newport', badge: 'Sách', color: '#334155', icon: '📘' },
    { title: 'Atomic Habits', author: 'James Clear', badge: 'Sách', color: '#10b981', icon: '📗' },
    { title: 'Làm chủ năng suất cá nhân', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#5B3FE4', icon: '🎓' }
  ],
  language: [
    { title: 'English Grammar in Use', author: 'Raymond Murphy', badge: 'Sách', color: '#0ea5e9', icon: '📘' },
    { title: 'Word Power Made Easy', author: 'Norman Lewis', badge: 'Sách', color: '#e0447a', icon: '📕' },
    { title: 'IELTS 7.0+ Roadmap', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#10b981', icon: '🎓' }
  ],
  writing: [
    { title: 'On Writing Well', author: 'William Zinsser', badge: 'Sách', color: '#f59e0b', icon: '📙' },
    { title: 'Everybody Writes', author: 'Ann Handley', badge: 'Sách', color: '#5B3FE4', icon: '📕' },
    { title: 'Content & Copywriting', author: 'Mnemonics Academy', badge: 'Khóa học', color: '#e0447a', icon: '🎓' }
  ]
};

let userTopics = [];

// Đoán lĩnh vực quan tâm từ dữ liệu đã lưu nếu user chưa chọn thủ công
function detectTopicFromItems() {
  var text = items.map(getSearchText).join(' ');
  var best = null, bestScore = 0;
  TOPIC_OPTIONS.forEach(function(topic) {
    var score = topic.keywords.reduce(function(s, kw) {
      return s + (text.split(normalizeText(kw)).length - 1);
    }, 0);
    if (score > bestScore) { bestScore = score; best = topic; }
  });
  return best;
}

function getActiveTopic() {
  if (userTopics.length > 0) {
    return TOPIC_OPTIONS.find(function(t) { return t.id === userTopics[0]; }) || TOPIC_OPTIONS[0];
  }
  return detectTopicFromItems() || TOPIC_OPTIONS[0];
}

function renderBookRail() {
  var rail = document.getElementById('book-rail');
  if (!rail) return;
  var topic = getActiveTopic();
  var books = BOOK_CATALOG[topic.id] || BOOK_CATALOG.marketing;

  var otherTopics = TOPIC_OPTIONS.filter(function(t) { return t.id !== topic.id; }).slice(0, 5);

  rail.innerHTML = `<div class="book-panel">
    <div class="book-panel-head">
      <div class="book-panel-eyebrow">✦ Gợi ý cho bạn</div>
      <div class="book-panel-title">Sách & khóa học nổi bật</div>
      <div class="book-panel-topic">Dựa trên lĩnh vực: <b>${escapeHtml(topic.label)}</b></div>
    </div>
    <div class="book-list">
      ${books.map(function(b) {
        return `<a class="book-card" data-book-open="${escapeHtml(b.title)}">
          <div class="book-cover" style="background:${b.color}">${b.icon}</div>
          <div class="book-info">
            <div class="book-title">${escapeHtml(b.title)}</div>
            <div class="book-author">${escapeHtml(b.author)}</div>
            <span class="book-badge">${escapeHtml(b.badge)}</span>
          </div>
        </a>`;
      }).join('')}
    </div>
    <div class="book-topic-pick">
      <label>Đổi lĩnh vực</label>
      <div class="format-chips">
        ${otherTopics.map(function(t) {
          return `<div class="format-chip" data-book-topic="${escapeHtml(t.id)}">${escapeHtml(t.label)}</div>`;
        }).join('')}
      </div>
    </div>
    <div class="book-panel-foot">Mnemonics hợp tác cùng các nhà bán sách & nền tảng khóa học.<br>Chọn lĩnh vực trong <b>Cài đặt</b> để cá nhân hóa.</div>
  </div>`;
}

function reminderToMemoryItem(reminder) {
  const tasks = Array.isArray(reminder.tasks) ? reminder.tasks : [];
  const doneCount = tasks.filter(function(t) { return t.done; }).length;
  const totalCount = tasks.length;
  const kindLabel = reminder.kind === 'meeting' ? 'Biên bản họp' : 'Todo list';
  return {
    id: 'reminder-' + String(reminder.id),
    sourceType: 'reminder',
    reminderId: reminder.id,
    type: 'note',
    title: reminder.title || kindLabel,
    note: tasks.map(function(t) { return t.text; }).join('\n'),
    excerpt: `${kindLabel} · ${doneCount}/${totalCount} hoàn thành`,
    checks: tasks.map(function(t) { return { text: t.text, done: Boolean(t.done) }; }),
    tags: ['nhắc nhở', reminder.kind === 'meeting' ? 'biên bản họp' : 'todo'],
    date: reminder.date || 'Hôm nay',
    space: reminder.space || 'Nhắc nhở',
    savedAt: reminder.createdAt || new Date().toISOString()
  };
}

function getSearchText(item) {
  return [
    item.title, item.excerpt, item.note, item.quote, item.url, item.space, item.type,
    (item.tags || []).join(' '),
    (item.checks || []).map(function(c) { return c.text; }).join(' ')
  ].map(function(value) { return String(value || '').toLowerCase(); }).join(' ');
}

function composeDashboardItems() {
  const reminderCards = reminders.map(reminderToMemoryItem);
  const reminderTitles = new Set(reminderCards.map(function(item) { return normalizeText(item.title); }));
  const cleanBaseItems = baseMemoryItems.filter(function(item) {
    return !(item.type === 'note' && item.checks && reminderTitles.has(normalizeText(item.title)));
  });
  return [...reminderCards, ...cleanBaseItems];
}

function refreshDashboardItems() {
  items = composeDashboardItems();
  renderDashboard();
  updateCount();
  renderBookRail();
  if (currentSpaceId) renderSpaces();
}

// ===== SYNC VỚI EXTENSION =====
function loadFromExtension(cb) {
  const itemsKey = userItemsKey();

  function finish(ext) {
    // Show only the user's own items. Demo data was removed in task 19
    // because it confused new users into thinking their items leaked.
    baseMemoryItems = ext || [];
    refreshDashboardItems();
    if (cb) cb();
  }

  // Dashboard chạy như extension tab → dùng chrome.storage trực tiếp
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(itemsKey, function(r) {
      finish(r[itemsKey] || []);
    });
  } else {
    // Fallback khi chạy ngoài extension (dev mode)
    const ext = JSON.parse(localStorage.getItem(itemsKey) || '[]');
    finish(ext);
  }
}

// Lắng nghe khi extension popup lưu item mới → reload ngay
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === 'RELOAD_ITEMS' || msg.type === 'ITEM_SAVED') {
      loadFromExtension();
    }
  });
}

// Fallback: poll mỗi 3 giây để chắc chắn sync
setInterval(loadFromExtension, 3000);

function updateCount() {
  const el = document.getElementById('item-count');
  if (el) el.textContent = items.length + ' ký ức đã được lưu trong tháng này.';
}

let searchTimeout = null;
let aiSearchTimeout = null;

// ===== PAGE NAVIGATION =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');

  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  if (page !== 'landing') {
    const el = document.getElementById('nav-' + page);
    if (el) el.classList.add('active');
  }

  document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));
  const sidebarItem = document.getElementById('sidebar-' + page);
  if (sidebarItem) sidebarItem.classList.add('active');

  if (page === "dashboard") renderDashboard();
  if (page === 'spaces') renderSpaces();
  if (page === 'reminders') renderReminders();
  if (page === 'settings') syncSettingsUI();
  window.scrollTo(0, 0);
}

// ===== RENDER CARDS =====
function renderCards(data) {
  const container = document.getElementById('cards-container');
  document.getElementById('item-count').textContent = `${data.length} ký ức đã được lưu trong tháng này.`;

  if (data.length === 0) {
    container.innerHTML = `<div class="empty-state" style="column-span:all">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="24" cy="24" r="20"/><path d="M16 20h16M16 28h10"/></svg>
      <h3>Không tìm thấy kết quả</h3>
      <p>Hãy thử từ khóa khác hoặc thêm ký ức mới</p>
    </div>`;
    return;
  }

  container.innerHTML = data.map(item => {
    const isNew = item.date === 'Vừa xong' || item.date === 'Hôm nay';
    const typeLabel = item.sourceType === 'reminder'
      ? (item.tags && item.tags.includes('biên bản họp') ? 'BIÊN BẢN HỌP' : 'TODO LIST')
      : {article:'BÀI VIẾT', image:'CẢM HỨNG', note:'GHI CHÚ NHANH', quote:'TRÍCH DẪN', code:'MÃ NGUỒN', link:'LINK', file:'TỆP', screenshot:'ẢNH CHỤP MH'}[item.type] || 'MỤC LƯU';
    const typeClass = item.type;

    let body = '';
    if (item.type === 'quote') {
      body = `<div class="card-quote">${item.quote || item.note || item.excerpt || ''}</div>`;
    } else if ((item.type === 'image' || item.type === 'screenshot') && item.imageUrl) {
      const imageTitle = escapeHtml(item.title || (item.type === 'screenshot' ? 'Ảnh chụp màn hình' : 'Ảnh đã lưu'));
      const imageSrc = escapeHtml(imageSrcForRender(item.imageUrl));
      const pageSrc = escapeHtml(item.sourceUrl || item.sourcePageUrl || item.pageUrl || item.url || '');
      // When an item failed to upload the user sees a "Đồng bộ lên database"
      // pill that re-runs the upload pipeline through the background.
      const pendingBadge = item.pendingUpload
        ? `<button type="button" class="resync-btn" data-resync-id="${escapeHtml(String(item.id))}" data-resync-image="${imageSrc}" data-resync-source="${pageSrc}" data-resync-title="${imageTitle}" data-resync-note="${escapeHtml(item.note || '')}" data-resync-captured="${escapeHtml(item.savedAt || '')}" title="Upload lên Supabase">
            <span class="resync-dot"></span>Đồng bộ lên database
          </button>`
        : '';
      body = `<div class="card-image-wrap image-clickable" data-image-preview="${imageSrc}" data-image-title="${imageTitle}" data-page-url="${pageSrc}" title="Bấm để xem ảnh">
        <img src="${imageSrc}" alt="${imageTitle}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;display:block;">
        <div class="image-click-badge">${item.type === 'screenshot' ? 'Xem ảnh chụp' : 'Xem ảnh'}</div>
        ${item.title ? `<div class="card-title" style="margin-top:8px">${imageTitle}</div>` : ''}
        ${pendingBadge}
      </div>`;
    } else if (item.type === 'link') {
      const linkUrl = escapeHtml(normalizeExternalUrl(item.sourceUrl || item.url || item.note || ''));
      const displayUrl = escapeHtml((item.url || item.note || '').replace(/^https?:\/\//, '').slice(0, 60));
      body = `<div class="card-body">
        <div class="card-title">${escapeHtml(item.title || 'Link đã lưu')}</div>
        ${item.excerpt ? `<p class="card-excerpt">${escapeHtml(item.excerpt)}</p>` : ''}
        ${linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener" data-open-link="${linkUrl}" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:4px">🔗 ${displayUrl || 'Mở link'} →</a>` : ''}
        ${item.tags ? `<div class="card-tags">${item.tags.map(t=>`<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`;
    } else if (item.type === 'file') {
      const fileName = escapeHtml(item.fileName || item.title || 'Tệp đính kèm');
      const fileSize = item.fileSize ? `<span style="color:var(--gray-mid);font-size:11px">${escapeHtml(item.fileSize)}</span>` : '';
      const dl = item.fileData ? `<a href="${escapeHtml(item.fileData)}" download="${fileName}" data-file-download="1" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:8px">⬇ Tải về</a>` : '';
      body = `<div class="card-body">
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid var(--gray-border);border-radius:10px;background:var(--gray-bg)">
          <div style="width:40px;height:40px;border-radius:8px;background:var(--purple-light);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📎</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fileName}</div>
            ${fileSize}
          </div>
        </div>
        ${item.excerpt ? `<p class="card-excerpt" style="margin-top:10px">${escapeHtml(item.excerpt)}</p>` : ''}
        ${dl}
        ${item.tags ? `<div class="card-tags">${item.tags.map(t=>`<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>`;
    } else if (item.type === 'note') {
      const noteText = item.note || item.excerpt || '';
      if (item.checks && item.checks.length > 0) {
        const doneCount = item.checks.filter(c => c.done).length;
        const totalCount = item.checks.length;
        const reminderBadge = item.sourceType === 'reminder'
          ? `<div class="card-reminder-meta">${typeLabel} · ${doneCount}/${totalCount} hoàn thành</div>`
          : '';
        const reminderId = item.sourceType === 'reminder' ? escapeHtml(item.reminderId) : '';
        body = `<div class="card-checklist ${item.sourceType === 'reminder' ? 'dashboard-reminder-card' : ''}">
          <div class="checklist-title">${escapeHtml(item.title)}</div>
          ${reminderBadge}
          ${item.checks.map(function(c, index) {
            const taskAttrs = item.sourceType === 'reminder'
              ? ` data-dashboard-reminder-id="${reminderId}" data-dashboard-task-index="${index}" title="Bấm để tick / bỏ tick"`
              : '';
            return `<div class="check-item ${c.done?'done':''} ${item.sourceType === 'reminder' ? 'reminder-clickable' : ''}"${taskAttrs}>
              <div class="check-box ${c.done?'checked':''}"></div><span>${escapeHtml(c.text)}</span>
            </div>`;
          }).join('')}
          ${item.sourceType === 'reminder' ? `<div class="dashboard-reminder-actions">
            <button class="dashboard-reminder-open" data-open-reminders="1">Mở Nhắc nhở</button>
            <button class="dashboard-reminder-delete" data-dashboard-reminder-delete="${reminderId}">Xóa</button>
          </div>` : ''}
        </div>`;
      } else {
        body = `<div class="card-body">${noteText}</div>`;
      }
    } else {
      body = `<div class="card-body">
        ${item.type === 'code' ? `<div class="code-date">${item.date}</div>` : ''}
        <div class="card-title">${item.title}</div>
        ${item.excerpt ? `<p class="card-excerpt">${item.excerpt}</p>` : ''}
        ${item.tags ? `<div class="card-tags">${item.tags.map(t=>`<span class="card-tag">${t}</span>`).join('')}</div>` : ''}
      </div>`;
    }

    return `<div class="memory-card">
      ${item.type !== 'note' ? `<div class="card-header">
        <span class="card-type ${typeClass}">${item.type==='code'?`<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="width:11px;height:11px"><path d="M4 4l-3 3 3 3M10 4l3 3-3 3M8 2l-2 10"/></svg> `:''}${typeLabel}</span>
        <div style="display:flex;gap:6px;align-items:center">${isNew ? '<span style="background:#22c55e;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:0.5px">MỚI</span>' : ''}
          <div class="card-menu-wrap">
            <span class="card-menu" data-menuid="${item.id}">···</span>
            <div class="card-dropdown" id="dropdown-${item.id}">
              <div class="card-dropdown-item danger" data-deleteid="${item.id}">🗑 Xóa</div>
            </div>
          </div>
        </div>
      </div>` : ''}
      ${body}
      ${item.type !== 'quote' ? `<div class="card-footer">
        <span class="card-date">${item.date || ''}</span>
        <span class="card-space">${item.space || ''}</span>
      </div>` : ''}
    </div>`;
  }).join('');
}

// ===== RENDER SPACES =====
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function getSpaceById(id) {
  return SPACES_DATA.find(function(space) { return space.id === id; });
}

function loadSpacePrefs(cb) {
  getStorageValue('mnemonics_favorite_spaces', [], function(favs) {
    favoriteSpaceIds = Array.isArray(favs) ? favs : [];
    getStorageValue('mnemonics_recent_spaces', [], function(recents) {
      recentSpaceIds = Array.isArray(recents) ? recents : [];
      renderSpaces();
      if (cb) cb();
    });
  });
}

function saveFavoriteSpaces(cb) {
  setStorageValues({ mnemonics_favorite_spaces: favoriteSpaceIds }, cb);
}

function saveRecentSpaces(cb) {
  setStorageValues({ mnemonics_recent_spaces: recentSpaceIds }, cb);
}

function getSpaceItems(space) {
  if (!space) return [];
  const spaceName = normalizeText(space.name);
  const keywords = (space.keywords || []).map(normalizeText);

  return items.filter(function(item) {
    const fields = [
      item.title, item.excerpt, item.note, item.quote, item.space, item.url, item.type,
      (item.tags || []).join(' '),
      (item.checks || []).map(function(c) { return c.text; }).join(' ')
    ].map(normalizeText).join(' ');

    if (normalizeText(item.space) && spaceName.includes(normalizeText(item.space))) return true;
    // "Cảm hứng" space shows both uploaded images AND cropped screenshots
    // so users see all visual captures together, not split across tabs.
    if (space.id === 'design-inspiration' && (item.type === 'image' || item.type === 'screenshot')) return true;
    if (space.id === 'tech-notes' && item.type === 'code') return true;
    return keywords.some(function(keyword) { return keyword && fields.includes(keyword); });
  });
}

function getSpaceCount(space) {
  const relatedCount = getSpaceItems(space).length;
  return Math.max(space.count || 0, relatedCount);
}

function getFilteredSpaces() {
  let data = [...SPACES_DATA];

  if (currentSpaceFilter === 'favorite') {
    data = data.filter(function(space) { return favoriteSpaceIds.includes(space.id); });
  }

  if (currentSpaceFilter === 'recent') {
    const recentRank = new Map(recentSpaceIds.map(function(id, index) { return [id, index]; }));
    data.sort(function(a, b) {
      const aRank = recentRank.has(a.id) ? recentRank.get(a.id) : 999;
      const bRank = recentRank.has(b.id) ? recentRank.get(b.id) : 999;
      if (aRank !== bRank) return aRank - bRank;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
  }

  return data;
}

function renderSpaces() {
  const grid = document.getElementById('spaces-grid');
  const detail = document.getElementById('space-detail');
  if (!grid) return;

  document.querySelectorAll('[data-space-filter]').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.spaceFilter === currentSpaceFilter);
  });
  document.querySelectorAll('[data-space-view]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.spaceView === currentSpaceView);
  });

  if (currentSpaceId) {
    grid.classList.add('hidden');
    renderSpaceDetail(currentSpaceId);
    return;
  }

  if (detail) detail.classList.remove('open');
  grid.classList.remove('hidden');
  grid.classList.toggle('list-view', currentSpaceView === 'list');

  const data = getFilteredSpaces();
  if (data.length === 0) {
    grid.innerHTML = `<div class="spaces-empty">
      <h3>Chưa có không gian yêu thích</h3>
      <p>Bấm biểu tượng ngôi sao trên một không gian để đưa vào mục Yêu thích.</p>
    </div>`;
    return;
  }

  grid.innerHTML = data.map(function(s) {
    const isFavorite = favoriteSpaceIds.includes(s.id);
    const relatedCount = getSpaceItems(s).length;
    return `<div class="space-card" data-space-id="${escapeHtml(s.id)}">
      <div class="space-card-top">
        <div class="space-icon">${s.icon}</div>
        <button class="space-star ${isFavorite ? 'active' : ''}" data-space-favorite="${escapeHtml(s.id)}" title="${isFavorite ? 'Bỏ yêu thích' : 'Thêm yêu thích'}">★</button>
      </div>
      <div class="space-name">${escapeHtml(s.name)}</div>
      <p class="space-desc">${escapeHtml(s.desc)}</p>
      <div class="space-count">
        <span>${getSpaceCount(s)} MỤC DỮ LIỆU · ${relatedCount} mục khớp</span>
        <span class="space-ai">AI</span>
      </div>
      <div class="space-open-hint">Mở không gian →</div>
    </div>`;
  }).join('');
}

function openSpace(spaceId) {
  const space = getSpaceById(spaceId);
  if (!space) return;
  currentSpaceId = spaceId;
  recentSpaceIds = [spaceId].concat(recentSpaceIds.filter(function(id) { return id !== spaceId; })).slice(0, 8);
  saveRecentSpaces();
  renderSpaces();
}

function closeSpaceDetail() {
  currentSpaceId = null;
  renderSpaces();
}

function toggleFavoriteSpace(spaceId) {
  if (!spaceId) return;
  if (favoriteSpaceIds.includes(spaceId)) {
    favoriteSpaceIds = favoriteSpaceIds.filter(function(id) { return id !== spaceId; });
    showToast('Đã bỏ khỏi Yêu thích');
  } else {
    favoriteSpaceIds.push(spaceId);
    showToast('★ Đã thêm vào Yêu thích');
  }
  saveFavoriteSpaces(renderSpaces);
}

function renderSpaceDetail(spaceId) {
  const detail = document.getElementById('space-detail');
  const grid = document.getElementById('spaces-grid');
  if (!detail || !grid) return;

  const space = getSpaceById(spaceId);
  if (!space) return;

  const isFavorite = favoriteSpaceIds.includes(space.id);
  detail.classList.add('open');
  grid.classList.add('hidden');

  detail.innerHTML = `<div class="space-detail-head">
    <button class="space-back-btn" id="space-detail-back">← Quay lại</button>
    <div class="space-detail-title-row">
      <div class="space-detail-icon">${space.icon}</div>
      <div>
        <div class="space-detail-name">${escapeHtml(space.name)}</div>
        <div class="space-detail-desc">${escapeHtml(space.desc)}</div>
      </div>
    </div>
    <div class="space-detail-actions">
      <button class="space-detail-btn ${isFavorite ? 'active' : ''}" id="space-detail-favorite" data-space-favorite="${escapeHtml(space.id)}">${isFavorite ? '★ Đã yêu thích' : '☆ Yêu thích'}</button>
      <button class="space-detail-btn" id="space-detail-open-dashboard">Xem trong lưu trữ</button>
    </div>
  </div>
  <div class="space-detail-meta">
    <span>${getSpaceCount(space)} mục dữ liệu</span>
    <span>${getSpaceItems(space).length} mục đang khớp với dữ liệu demo/lưu thật</span>
    <span>Cập nhật gần đây</span>
  </div>
  <div class="space-detail-search">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M12 12l3 3"/></svg>
    <input id="space-detail-search-input" type="text" placeholder="Tìm trong không gian này...">
  </div>
  <div class="space-items" id="space-items"></div>`;

  const input = document.getElementById('space-detail-search-input');
  if (input) input.addEventListener('input', function() { renderSpaceItems(space, this.value); });
  renderSpaceItems(space, '');
}

function renderSpaceItems(space, query) {
  const container = document.getElementById('space-items');
  if (!container) return;
  const q = normalizeText(query);
  let data = getSpaceItems(space);
  if (q) {
    data = data.filter(function(item) {
      const text = [item.title, item.excerpt, item.note, item.quote, item.url, item.space, (item.tags || []).join(' '), (item.checks || []).map(function(c) { return c.text; }).join(' ')].map(normalizeText).join(' ');
      return text.includes(q);
    });
  }

  if (data.length === 0) {
    container.innerHTML = `<div class="space-items-empty">
      <h3>Chưa có mục nào trong không gian này</h3>
      <p>Lưu thêm ảnh, bài viết hoặc ghi chú có tag liên quan để chúng tự hiện ở đây.</p>
    </div>`;
    return;
  }

  container.innerHTML = data.map(function(item) {
    const typeLabel = { article:'Bài viết', image:'Ảnh', note:'Ghi chú', quote:'Trích dẫn', code:'Mã nguồn' }[item.type] || 'Mục lưu';
    const title = item.title || item.quote || item.note || 'Ký ức đã lưu';
    const body = item.excerpt || item.note || item.quote || item.url || (item.checks || []).map(function(c) { return c.text; }).join(' · ') || '';
    const url = normalizeExternalUrl(item.sourceUrl || item.sourcePageUrl || item.pageUrl || item.url || '');
    const image = item.type === 'image' && item.imageUrl ? `<img class="space-item-thumb" src="${escapeHtml(imageSrcForRender(item.imageUrl))}" data-image-preview="${escapeHtml(imageSrcForRender(item.imageUrl))}" data-image-title="${escapeHtml(title)}" data-page-url="${escapeHtml(url)}" alt="${escapeHtml(title)}">` : `<div class="space-item-type-icon">${typeLabel.slice(0,1)}</div>`;
    return `<div class="space-item">
      ${image}
      <div class="space-item-body">
        <div class="space-item-top">
          <span class="space-item-type">${escapeHtml(typeLabel)}</span>
          <span class="space-item-date">${escapeHtml(item.date || '')}</span>
        </div>
        <div class="space-item-title">${escapeHtml(title)}</div>
        ${body ? `<div class="space-item-excerpt">${escapeHtml(body).slice(0, 180)}</div>` : ''}
        ${(item.tags || []).length ? `<div class="space-item-tags">${(item.tags || []).slice(0,4).map(function(t){ return `<span>#${escapeHtml(t)}</span>`; }).join('')}</div>` : ''}
      </div>
      ${url ? `<button class="space-item-open" data-space-open-url="${escapeHtml(url)}">Mở nguồn</button>` : ''}
    </div>`;
  }).join('');
}

// ===== REMINDERS / TODO / MEETING MINUTES =====
function loadReminders(cb) {
  const rKey = userRemindersKey();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(rKey, function(r) {
      if (Array.isArray(r[rKey])) {
        reminders = r[rKey];
        renderReminders();
        refreshDashboardItems();
        if (cb) cb();
      } else {
        reminders = DEFAULT_REMINDERS.map(cloneReminder);
        chrome.storage.local.set({ [rKey]: reminders }, function() {
          renderReminders();
          refreshDashboardItems();
          if (cb) cb();
        });
      }
    });
  } else {
    const raw = localStorage.getItem(rKey);
    if (raw) {
      try { reminders = JSON.parse(raw); } catch(e) { reminders = []; }
    } else {
      reminders = DEFAULT_REMINDERS.map(cloneReminder);
      localStorage.setItem(rKey, JSON.stringify(reminders));
    }
    renderReminders();
    refreshDashboardItems();
    if (cb) cb();
  }
}

function cloneReminder(item) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    tasks: item.tasks.map(t => ({ text: t.text, done: t.done })),
    date: item.date,
    space: item.space,
    createdAt: item.createdAt
  };
}

function saveReminders(cb) {
  const rKey = userRemindersKey();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [rKey]: reminders }, function() {
      refreshDashboardItems();
      if (cb) cb();
    });
  } else {
    localStorage.setItem(rKey, JSON.stringify(reminders));
    refreshDashboardItems();
    if (cb) cb();
  }
}

function getFilteredReminders() {
  return reminders.filter(function(item) {
    const tasks = item.tasks || [];
    const doneCount = tasks.filter(t => t.done).length;
    const isDone = tasks.length > 0 && doneCount === tasks.length;
    if (reminderFilter === 'all') return true;
    if (reminderFilter === 'todo') return item.kind === 'todo';
    if (reminderFilter === 'meeting') return item.kind === 'meeting';
    if (reminderFilter === 'open') return !isDone;
    if (reminderFilter === 'done') return isDone;
    return true;
  });
}

function updateReminderStats() {
  const openCount = reminders.reduce(function(total, item) {
    return total + (item.tasks || []).filter(t => !t.done).length;
  }, 0);
  const openEl = document.getElementById('reminder-open-count');
  if (openEl) openEl.textContent = openCount;
  const listCount = document.getElementById('reminder-list-count');
  if (listCount) listCount.textContent = `${getFilteredReminders().length} mục nhắc nhở`;
}

function renderReminders() {
  const grid = document.getElementById('reminders-grid');
  if (!grid) return;
  const data = getFilteredReminders();
  updateReminderStats();

  if (data.length === 0) {
    grid.innerHTML = `<div class="reminder-empty"><h3>Chưa có nhắc nhở phù hợp</h3><p>Tạo checklist mới hoặc đổi bộ lọc khác.</p></div>`;
    return;
  }

  grid.innerHTML = data.map(function(item) {
    const tasks = item.tasks || [];
    const doneCount = tasks.filter(t => t.done).length;
    const totalCount = tasks.length;
    const kindLabel = item.kind === 'meeting' ? 'BIÊN BẢN HỌP' : 'TODO LIST';
    const kindClass = item.kind === 'meeting' ? 'meeting' : 'todo';
    const safeId = String(item.id);

    return `<div class="reminder-card">
      <div class="reminder-card-main">
        <div class="reminder-card-head">
          <div class="reminder-card-title">${escapeHtml(item.title)}</div>
          <span class="reminder-kind ${kindClass}">${kindLabel}</span>
        </div>
        <div class="reminder-progress">${doneCount}/${totalCount} hoàn thành</div>
        <div class="reminder-tasks">
          ${tasks.map(function(task, index) {
            return `<div class="reminder-task ${task.done ? 'done' : ''}" data-reminder-id="${escapeHtml(safeId)}" data-task-index="${index}">
              <span class="reminder-check ${task.done ? 'checked' : ''}"></span>
              <span>${escapeHtml(task.text)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="reminder-card-footer">
        <div>
          <span class="reminder-date">${escapeHtml(item.date || 'Hôm nay')}</span>
          <span style="color:#ddd;margin:0 6px">·</span>
          <span class="reminder-space">${escapeHtml(item.space || 'Công việc')}</span>
        </div>
        <div class="reminder-actions">
          <button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">Xóa</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function addReminder() {
  const kindEl = document.getElementById('reminder-kind-input');
  const titleEl = document.getElementById('reminder-title-input');
  const tasksEl = document.getElementById('reminder-tasks-input');
  const spaceEl = document.getElementById('reminder-space-input');
  if (!kindEl || !titleEl || !tasksEl) return;

  const kind = kindEl.value || 'todo';
  const title = titleEl.value.trim();
  const taskLines = tasksEl.value.split('\n').map(t => t.trim()).filter(Boolean);
  const space = spaceEl ? spaceEl.value.trim() : 'Công việc';

  if (!title || taskLines.length === 0) {
    showToast('Nhập tiêu đề và ít nhất 1 checklist nhé!');
    return;
  }

  const newReminder = {
    id: Date.now(),
    kind,
    title,
    tasks: taskLines.map(text => ({ text, done: false })),
    date: 'Vừa xong',
    space: space || 'Công việc',
    createdAt: new Date().toISOString()
  };

  reminders.unshift(newReminder);
  saveReminders(function() {
    titleEl.value = '';
    tasksEl.value = '';
    if (spaceEl) spaceEl.value = space || 'Công việc';
    reminderFilter = 'all';
    document.querySelectorAll('.reminder-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.reminderFilter === 'all'));
    renderReminders();
    showToast('✦ Đã lưu nhắc nhở');
  });
}

function toggleReminderTask(id, taskIndex) {
  const item = reminders.find(r => String(r.id) === String(id));
  if (!item || !item.tasks || !item.tasks[taskIndex]) return;
  item.tasks[taskIndex].done = !item.tasks[taskIndex].done;
  saveReminders(renderReminders);
}

function deleteReminder(id) {
  reminders = reminders.filter(r => String(r.id) !== String(id));
  saveReminders(function() {
    renderReminders();
    showToast('🗑 Đã xóa nhắc nhở');
  });
}

// ===== SEARCH =====
function handleSearch(val) {
  clearTimeout(searchTimeout);
  const q = val.toLowerCase().trim();
  if (!q) {
    renderDashboard();
    hideAIResult();
    return;
  }
  // Kết hợp search với sort/filter hiện tại
  renderDashboard();

  // AI search after delay
  clearTimeout(aiSearchTimeout);
  aiSearchTimeout = setTimeout(() => doAISearch(val), 800);
}

async function doAISearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  // Tìm kiếm thủ công, không cần AI
  const q = query.toLowerCase();
  const matched = items.filter(item => getSearchText(item).includes(q));
  if (matched.length > 0) {
    showAIResult(`Tìm thấy <b>${matched.length}</b> kết quả liên quan đến "<b>${query}</b>". Các mục liên quan nhất hiển thị bên dưới.`);
  } else {
    showAIResult(`Không tìm thấy kết quả nào cho "<b>${query}</b>". Thử từ khóa khác nhé!`);
  }
}

function showAIResult(html) {
  const el = document.getElementById('ai-result');
  document.getElementById('ai-result-text').innerHTML = html;
  el.style.display = 'block';
}
function hideAIResult() {
  document.getElementById('ai-result').style.display = 'none';
}

// ===== IMAGE PREVIEW =====
function normalizeExternalUrl(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (/^(https?:|data:|blob:|chrome-extension:)/i.test(url)) return url;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(url)) return 'https://' + url;
  return '';
}

// Render-time helper: when an item's imageUrl is a remote http(s) URL we
// can't display it directly because the browser blocks cross-origin
// <img> requests. Rewrite it through the API image proxy which sets
// Access-Control-Allow-Origin: *. Data URLs, blob:, and Supabase Storage
// signed URLs (which already include auth tokens and CORS headers) pass
// through untouched.
function imageSrcForRender(imageUrl) {
  if (!imageUrl) return '';
  if (/^(data:|blob:|chrome-extension:)/i.test(imageUrl)) return imageUrl;
  // Supabase Storage signed URLs (`?token=...`) already authorize the
  // browser — proxying them just strips the token and breaks the load.
  if (/^https?:\/\/[^/]*\.supabase\.co\/storage\//i.test(imageUrl)) return imageUrl;
  if (/^https?:\/\//i.test(imageUrl)) {
    var apiBase = (typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : (window.MNEMONICS_API_URL || 'http://localhost:4000'));
    return apiBase + '/api/v1/proxy/image?url=' + encodeURIComponent(imageUrl);
  }
  return imageUrl;
}

function openImagePreview(imageUrl, title, pageUrl) {
  var viewer = document.getElementById('image-viewer');
  var img = document.getElementById('image-viewer-img');
  var titleEl = document.getElementById('image-viewer-title');
  var openImageBtn = document.getElementById('image-viewer-open-image');
  var openPageBtn = document.getElementById('image-viewer-open-page');
  if (!viewer || !img) return;

  var safeImageUrl = normalizeExternalUrl(imageUrl);
  var safePageUrl = normalizeExternalUrl(pageUrl);
  img.src = safeImageUrl || imageUrl || '';
  titleEl.textContent = title || 'Ảnh đã lưu';
  openImageBtn.dataset.url = safeImageUrl || imageUrl || '';
  openPageBtn.dataset.url = safePageUrl;
  openPageBtn.style.display = safePageUrl ? 'inline-flex' : 'none';
  viewer.classList.add('open');
}

function closeImagePreview() {
  var viewer = document.getElementById('image-viewer');
  var img = document.getElementById('image-viewer-img');
  if (viewer) viewer.classList.remove('open');
  if (img) img.src = '';
}

function openUrlInNewTab(url) {
  url = normalizeExternalUrl(url);
  if (!url) return;
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create && /^https?:/i.test(url)) {
    chrome.tabs.create({ url: url });
  } else {
    window.open(url, '_blank');
  }
}

function openOriginalImage(imageUrl, title) {
  if (!imageUrl) return;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime && chrome.tabs) {
    var payload = { url: imageUrl, title: title || 'Ảnh gốc' };
    chrome.storage.local.set({ mnemonics_original_image: payload }, function() {
      if (chrome.runtime.lastError) {
        showToast('Không thể mở ảnh gốc');
        return;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('original-image.html') });
    });
    return;
  }

  window.open(imageUrl, '_blank', 'noopener');
}

// ===== ADD ITEM =====
let modalFileData = null;    // base64 của file/ảnh đã chọn hoặc dán
let modalFileName = '';
let modalFileSize = '';

function openAddModal() {
  document.getElementById('add-modal').classList.add('open');
  document.getElementById('new-title').value = '';
  document.getElementById('new-content').value = '';
  var urlEl = document.getElementById('new-url'); if (urlEl) urlEl.value = '';
  var fileEl = document.getElementById('new-file'); if (fileEl) fileEl.value = '';
  var prev = document.getElementById('modal-file-preview'); if (prev) prev.innerHTML = '';
  modalFileData = null; modalFileName = ''; modalFileSize = '';
  document.getElementById('ai-tags-preview').innerHTML = '<span style="font-size:13px;color:var(--gray-text)">Nhập nội dung để AI tạo tags...</span>';
  updateModalTypeFields(document.getElementById('new-type').value);
}
function closeModal() {
  document.getElementById('add-modal').classList.remove('open');
}

// Hiện/ẩn ô URL và ô file tùy theo loại đã chọn
function updateModalTypeFields(type) {
  var urlField = document.getElementById('modal-url-field');
  var fileField = document.getElementById('modal-file-field');
  var fileLabel = document.getElementById('modal-file-label');
  var fileInput = document.getElementById('new-file');
  var showUrl = (type === 'link');
  var showFile = (type === 'file' || type === 'image' || type === 'screenshot');
  if (urlField) urlField.style.display = showUrl ? 'block' : 'none';
  if (fileField) fileField.style.display = showFile ? 'block' : 'none';
  if (fileInput) fileInput.accept = (type === 'file') ? '' : 'image/*';
  if (fileLabel) {
    if (type === 'screenshot') fileLabel.textContent = 'Dán ảnh chụp màn hình (Ctrl/Cmd+V) vào đây, hoặc chọn tệp ảnh';
    else if (type === 'image') fileLabel.textContent = 'Chọn ảnh từ máy';
    else fileLabel.textContent = 'Chọn tệp đính kèm';
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleModalFile(file) {
  if (!file) return;
  // Giới hạn ~4MB để vừa quota storage
  if (file.size > 4 * 1024 * 1024) {
    showToast('Tệp quá lớn (tối đa 4MB cho bản lưu offline)');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    modalFileData = e.target.result;
    modalFileName = file.name || 'tệp-đính-kèm';
    modalFileSize = formatFileSize(file.size);
    var titleEl = document.getElementById('new-title');
    if (titleEl && !titleEl.value.trim()) titleEl.value = modalFileName.slice(0, 80);
    var prev = document.getElementById('modal-file-preview');
    if (prev) {
      if (/^data:image\//.test(modalFileData)) {
        prev.innerHTML = '<img src="' + modalFileData + '" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--gray-border)">';
      } else {
        prev.innerHTML = '<div style="font-size:12px;color:var(--gray-text)">📎 ' + escapeHtml(modalFileName) + ' · ' + modalFileSize + '</div>';
      }
    }
  };
  reader.readAsDataURL(file);
}

// Cho phép dán ảnh chụp màn hình trực tiếp vào modal
document.addEventListener('paste', function(e) {
  var modal = document.getElementById('add-modal');
  if (!modal || !modal.classList.contains('open')) return;
  var itemsList = (e.clipboardData || window.clipboardData).items;
  if (!itemsList) return;
  for (var i = 0; i < itemsList.length; i++) {
    if (itemsList[i].type && itemsList[i].type.indexOf('image') === 0) {
      var blob = itemsList[i].getAsFile();
      if (blob) {
        var typeSel = document.getElementById('new-type');
        if (typeSel && typeSel.value !== 'image') { typeSel.value = 'screenshot'; updateModalTypeFields('screenshot'); }
        handleModalFile(blob);
        showToast('📸 Đã dán ảnh chụp màn hình');
        e.preventDefault();
      }
      break;
    }
  }
});

// Auto-generate tags when content is typed
let tagTimeout = null;


async function generateTags(content) {
  if (!content || content.length < 10) return;
  const preview = document.getElementById('ai-tags-preview');
  const words = content.toLowerCase().replace(/[^a-zA-Z0-9\sàáảãạăắặẳẵằâấậẩẫầèéẻẽẹêếệểễềìíỉĩịòóỏõọôốộổỗồơớợởỡờùúủũụưứựửữừỳýỷỹỵđ]/g, '').split(/\s+/);
  const stopwords = ['the','a','an','of','in','on','for','to','and','or','is','are','có','của','và','với','từ','này','đó','cho','một','các','được','không','thì'];
  const freq = {};
  words.filter(w => w.length > 3 && !stopwords.includes(w)).forEach(w => freq[w] = (freq[w]||0)+1);
  const tags = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
  const finalTags = tags.length > 0 ? tags : ['ghi chú'];
  preview.innerHTML = finalTags.map(t => `<span class="ai-tag">${t}</span>`).join('');
  preview.dataset.tags = JSON.stringify(finalTags);
}

function saveItem() {
  try {
    const title = document.getElementById('new-title').value.trim();
    const contentVal = document.getElementById('new-content').value.trim();
    const type = document.getElementById('new-type').value;
    const urlEl = document.getElementById('new-url');
    const urlVal = urlEl ? urlEl.value.trim() : '';

    // Kiểm tra dữ liệu tối thiểu theo từng loại
    if (type === 'link' && !urlVal && !contentVal) { showToast('Nhập đường dẫn (URL) nhé!'); return; }
    if ((type === 'file' || type === 'image' || type === 'screenshot') && !modalFileData && !urlVal) {
      showToast('Hãy chọn/dán tệp hoặc ảnh nhé!'); return;
    }
    if (type !== 'link' && type !== 'file' && type !== 'image' && type !== 'screenshot' && !title && !contentVal) {
      showToast('Vui lòng nhập nội dung!'); return;
    }

    const tagsEl = document.getElementById('ai-tags-preview');
    let tags = [];
    try { tags = JSON.parse(tagsEl.dataset.tags || '[]'); } catch(e){}
    if (tags.length === 0) {
      const text = (title + ' ' + contentVal).toLowerCase();
      const stopwords = ['the','a','an','of','in','on','for','to','and','or','is','are','có','của','và','với','từ','này','đó','cho','một','các','được','không'];
      const words = text.replace(/[^a-zA-Z0-9\sàáảãạăắặẳẵằâấậẩẫầèéẻẽẹêếệểễềìíỉĩịòóỏõọôốộổỗồơớợởỡờùúủũụưứựửữừỳýỷỹỵđ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopwords.includes(w));
      const freq = {};
      words.forEach(w => freq[w] = (freq[w]||0)+1);
      tags = Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,3);
    }

    const newItem = {
      id: Date.now(), type,
      tags: tags.length ? tags : ['ghi chú'],
      date: 'Vừa xong', space: 'Mới lưu',
      savedAt: new Date().toISOString()
    };

    if (type === 'link') {
      const link = normalizeExternalUrl(urlVal || contentVal);
      newItem.title = title || (link.replace(/^https?:\/\//, '').slice(0, 60)) || 'Link đã lưu';
      newItem.url = link;
      newItem.sourceUrl = link;
      newItem.excerpt = contentVal || '';
      if ((!tags || tags.length === 0)) newItem.tags = ['link'];
    } else if (type === 'image' || type === 'screenshot') {
      newItem.title = title || (type === 'screenshot' ? 'Ảnh chụp màn hình' : 'Ảnh đã lưu');
      newItem.imageUrl = modalFileData || normalizeExternalUrl(urlVal);
      newItem.sourceUrl = normalizeExternalUrl(urlVal) || '';
      newItem.note = contentVal;
      if (!newItem.tags || newItem.tags.length === 0) newItem.tags = type === 'screenshot' ? ['ảnh chụp'] : ['ảnh'];
    } else if (type === 'file') {
      newItem.title = title || modalFileName || 'Tệp đính kèm';
      newItem.fileName = modalFileName;
      newItem.fileData = modalFileData;
      newItem.fileSize = modalFileSize;
      newItem.excerpt = contentVal || '';
      if (!newItem.tags || newItem.tags.length === 0) newItem.tags = ['tệp'];
    } else {
      newItem.title = title || contentVal.slice(0, 60);
      newItem.note = contentVal;
      newItem.excerpt = contentVal.slice(0, 120);
      if (type === 'quote') newItem.quote = contentVal || title;
    }

    baseMemoryItems.unshift(newItem);
    items = composeDashboardItems();
    const toStore = baseMemoryItems.filter(i => i.savedAt).slice(0, 80);

    const done = function() {
      closeModal();
      renderDashboard();
      renderBookRail();
      showToast('✦ Đã lưu ký ức thành công!');
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [userItemsKey()]: toStore }, done);
    } else {
      localStorage.setItem(userItemsKey(), JSON.stringify(toStore));
      done();
    }

    // Fire-and-forget: also persist to the server so items survive across
    // devices. For images we use the multipart upload endpoint.
    const accessToken = readAccessToken();
    if (accessToken) {
      if (newItem.type === 'image' || newItem.type === 'screenshot') {
        if (newItem.imageUrl) {
          uploadImageCapture(newItem.imageUrl, {
            title: newItem.title,
            note: newItem.note,
            sourceUrl: newItem.sourceUrl,
            capturedAt: newItem.savedAt
          }, accessToken).catch(function(err) {
            console.warn('[mnemonics] image upload failed', err);
          });
        }
      } else {
        sendCaptureToApi(newItem, accessToken).catch(function(err) {
          console.warn('[mnemonics] capture upload failed', err);
        });
      }
    }
  } catch(err) {
    showToast('Lỗi khi lưu: ' + err.message);
  }
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ===== SETTINGS =====
const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 'md',
  topics: [],
  notifSave: true,
  notifRemind: true,
  notifRediscover: true
};
let appSettings = Object.assign({}, DEFAULT_SETTINGS);

function loadSettings(cb) {
  getStorageValue('mnemonics_settings', DEFAULT_SETTINGS, function(s) {
    appSettings = Object.assign({}, DEFAULT_SETTINGS, s || {});
    userTopics = Array.isArray(appSettings.topics) ? appSettings.topics : [];
    applyTheme();
    applyFontSize();
    if (cb) cb();
  });
}

function saveSettings(cb) {
  appSettings.topics = userTopics;
  setStorageValues({ mnemonics_settings: appSettings }, function() { if (cb) cb(); });
}

function applyTheme() {
  var theme = appSettings.theme;
  var isDark = theme === 'dark' ||
    (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark', isDark);
}

// Tự đổi theo hệ thống khi đang ở chế độ 'system'
if (window.matchMedia) {
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
      if (appSettings.theme === 'system') applyTheme();
    });
  } catch (e) {}
}

function applyFontSize() {
  document.body.classList.remove('font-sm', 'font-md', 'font-lg');
  document.body.classList.add('font-' + (appSettings.fontSize || 'md'));
}

// Đồng bộ giao diện trang Cài đặt với state
function syncSettingsUI() {
  document.querySelectorAll('#theme-toggle button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.theme === appSettings.theme);
  });
  document.querySelectorAll('#fontsize-toggle button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.fontsize === appSettings.fontSize);
  });
  var ns = document.getElementById('setting-notif-save');
  var nr = document.getElementById('setting-notif-remind');
  var nrd = document.getElementById('setting-notif-rediscover');
  if (ns) ns.checked = !!appSettings.notifSave;
  if (nr) nr.checked = !!appSettings.notifRemind;
  if (nrd) nrd.checked = !!appSettings.notifRediscover;
  renderTopicTags();
  syncAccountSettings();
}

function renderTopicTags() {
  var container = document.getElementById('topic-tags');
  if (!container) return;
  container.innerHTML = TOPIC_OPTIONS.map(function(t) {
    var active = userTopics.includes(t.id);
    return `<div class="topic-tag ${active ? 'active' : ''}" data-topic="${escapeHtml(t.id)}">${escapeHtml(t.label)}</div>`;
  }).join('');
}

function toggleTopic(id) {
  if (userTopics.includes(id)) {
    userTopics = userTopics.filter(function(t) { return t !== id; });
  } else {
    userTopics.unshift(id);
  }
  saveSettings(function() {
    renderTopicTags();
    renderBookRail();
  });
}

function syncAccountSettings() {
  var nameEl = document.getElementById('settings-account-name');
  var emailEl = document.getElementById('settings-account-email');
  var btnEl = document.getElementById('settings-account-btn');
  var planEl = document.getElementById('settings-plan-name');
  var loggedIn = Boolean(currentUser && currentUser.email);
  if (nameEl) nameEl.textContent = loggedIn ? (currentUser.name || currentUser.email) : 'Khách';
  if (emailEl) emailEl.textContent = loggedIn ? currentUser.email : 'Chưa đăng nhập';
  if (btnEl) btnEl.textContent = loggedIn ? 'Đăng xuất' : 'Đăng nhập';
  if (planEl) planEl.textContent = loggedIn ? ((currentUser.plan || 'Memory') + ' (miễn phí)') : 'Memory (miễn phí)';
}

// ---- Data export / import / clear ----
function exportData() {
  getStorageValue(userItemsKey(), [], function(savedItems) {
    getStorageValue(userRemindersKey(), [], function(rem) {
      var payload = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        items: savedItems || [],
        reminders: rem || [],
        settings: appSettings
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mnemonics-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
      showToast('⬇ Đã xuất dữ liệu thành công');
    });
  });
}

function importData(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      var newItems = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : null);
      if (!newItems) { showToast('Tệp không hợp lệ!'); return; }
      var values = {};
      values[userItemsKey()] = newItems.slice(0, 200);
      if (Array.isArray(data.reminders)) values[userRemindersKey()] = data.reminders;
      if (data.settings) values.mnemonics_settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      setStorageValues(values, function() {
        loadSettings(function() {
          loadReminders(function() {
            loadFromExtension(function() {
              syncSettingsUI();
              showToast('⬆ Đã nhập ' + newItems.length + ' mục thành công');
            });
          });
        });
      });
    } catch (err) {
      showToast('Lỗi đọc tệp: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  var ok = window.confirm('Xóa TOÀN BỘ ký ức và nhắc nhở? Hành động này không thể hoàn tác.\n\nGợi ý: hãy Xuất dữ liệu trước để sao lưu.');
  if (!ok) return;
  var values = {};
  values[userItemsKey()] = [];
  values[userRemindersKey()] = [];
  setStorageValues(values, function() {
    baseMemoryItems = [];
    reminders = [];
    items = composeDashboardItems();
    renderDashboard();
    renderReminders();
    renderBookRail();
    updateReminderStats();
    showToast('🗑 Đã xóa toàn bộ dữ liệu');
  });
}

// ===== BIND ALL EVENT LISTENERS (no inline onclick) =====
document.addEventListener('DOMContentLoaded', function() {
  try {
  // Nav
  var navLogo = document.getElementById('nav-logo');
  if (navLogo) navLogo.addEventListener('click', function() { showPage('landing'); });

  var navDashboard = document.getElementById('nav-dashboard');
  if (navDashboard) navDashboard.addEventListener('click', function() { showPage('dashboard'); });

  var navSpaces = document.getElementById('nav-spaces');
  if (navSpaces) navSpaces.addEventListener('click', function() { showPage('spaces'); });

  var navReminders = document.getElementById('nav-reminders');
  if (navReminders) navReminders.addEventListener('click', function() { showPage('reminders'); });

  var navPricing = document.getElementById('nav-pricing');
  if (navPricing) navPricing.addEventListener('click', function() { showPage('pricing'); });

  var btnLogin = document.getElementById('btn-login');
  if (btnLogin) btnLogin.addEventListener('click', function() { showPage('login'); });

  var btnSignup = document.getElementById('btn-signup');
  if (btnSignup) btnSignup.addEventListener('click', function() { showPage('signup'); });


  var authUserPill = document.getElementById('auth-user-pill');
  if (authUserPill) authUserPill.addEventListener('click', function() { showPage('dashboard'); });

  var btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', logoutUser);

  var authGoSignup = document.getElementById('auth-go-signup');
  if (authGoSignup) authGoSignup.addEventListener('click', function() { showPage('signup'); });

  var authGoLogin = document.getElementById('auth-go-login');
  if (authGoLogin) authGoLogin.addEventListener('click', function() { showPage('login'); });

  var authDemoLogin = document.getElementById('auth-demo-login');
  if (authDemoLogin) authDemoLogin.addEventListener('click', loginDemoUser);

  var btnAuthLogin = document.getElementById('btn-auth-login');
  if (btnAuthLogin) btnAuthLogin.addEventListener('click', function(e) {
    e.preventDefault();
    handleLogin();
  });

  var btnAuthSignup = document.getElementById('btn-auth-signup');
  if (btnAuthSignup) btnAuthSignup.addEventListener('click', function(e) {
    e.preventDefault();
    handleSignup();
  });

  ['login-email','login-password'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleLogin(); });
  });

  ['signup-name','signup-email','signup-password','signup-confirm'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleSignup(); });
  });

  var btnHero = document.getElementById('btn-hero');
  if (btnHero) btnHero.addEventListener('click', function() { showPage('signup'); });

  var sidebarDashboard = document.getElementById('sidebar-dashboard');
  if (sidebarDashboard) sidebarDashboard.addEventListener('click', function() { showPage('dashboard'); });

  var sidebarSpaces = document.getElementById('sidebar-spaces');
  if (sidebarSpaces) sidebarSpaces.addEventListener('click', function() { showPage('spaces'); });

  var sidebarReminders = document.getElementById('sidebar-reminders');
  if (sidebarReminders) sidebarReminders.addEventListener('click', function() { showPage('reminders'); });

  var sidebarSettings = document.getElementById('sidebar-settings');
  if (sidebarSettings) sidebarSettings.addEventListener('click', function() { showPage('settings'); });

  // ---- Sort / filter controls ----
  var sortSelect = document.getElementById('sort-select');
  if (sortSelect) sortSelect.addEventListener('change', function() { currentSortBy = this.value; renderDashboard(); });

  var timeSelect = document.getElementById('time-select');
  if (timeSelect) timeSelect.addEventListener('change', function() { currentTimeFilter = this.value; renderDashboard(); });

  var formatChips = document.getElementById('format-chips');
  if (formatChips) formatChips.addEventListener('click', function(e) {
    var chip = e.target.closest('[data-format]');
    if (!chip) return;
    currentFormatFilter = chip.dataset.format;
    this.querySelectorAll('.format-chip').forEach(function(c) { c.classList.toggle('active', c === chip); });
    renderDashboard();
  });

  // ---- Book rail interactions ----
  var bookRail = document.getElementById('book-rail');
  if (bookRail) bookRail.addEventListener('click', function(e) {
    var topicBtn = e.target.closest('[data-book-topic]');
    if (topicBtn) {
      userTopics = [topicBtn.dataset.bookTopic];
      saveSettings(function() { renderBookRail(); renderTopicTags(); });
      return;
    }
    var bookCard = e.target.closest('[data-book-open]');
    if (bookCard) {
      showToast('📚 ' + bookCard.dataset.bookOpen + ' — mở trang đối tác (demo)');
    }
  });

  // ---- Settings: theme ----
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) themeToggle.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-theme]');
    if (!btn) return;
    appSettings.theme = btn.dataset.theme;
    applyTheme();
    saveSettings(syncSettingsUI);
  });

  // ---- Settings: font size ----
  var fontToggle = document.getElementById('fontsize-toggle');
  if (fontToggle) fontToggle.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-fontsize]');
    if (!btn) return;
    appSettings.fontSize = btn.dataset.fontsize;
    applyFontSize();
    saveSettings(syncSettingsUI);
  });

  // ---- Settings: topics ----
  var topicTags = document.getElementById('topic-tags');
  if (topicTags) topicTags.addEventListener('click', function(e) {
    var tag = e.target.closest('[data-topic]');
    if (tag) toggleTopic(tag.dataset.topic);
  });

  // ---- Settings: notifications ----
  [['setting-notif-save','notifSave'],['setting-notif-remind','notifRemind'],['setting-notif-rediscover','notifRediscover']].forEach(function(pair) {
    var el = document.getElementById(pair[0]);
    if (el) el.addEventListener('change', function() { appSettings[pair[1]] = this.checked; saveSettings(); });
  });

  // ---- Settings: data ----
  var btnExport = document.getElementById('btn-export-data');
  if (btnExport) btnExport.addEventListener('click', exportData);

  var btnImport = document.getElementById('btn-import-data');
  var importInput = document.getElementById('import-file-input');
  if (btnImport && importInput) {
    btnImport.addEventListener('click', function() { importInput.click(); });
    importInput.addEventListener('change', function() { if (this.files[0]) importData(this.files[0]); this.value = ''; });
  }

  var btnClear = document.getElementById('btn-clear-data');
  if (btnClear) btnClear.addEventListener('click', clearAllData);

  // ---- Settings: account ----
  var accountBtn = document.getElementById('settings-account-btn');
  if (accountBtn) accountBtn.addEventListener('click', function() {
    if (currentUser && currentUser.email) { logoutUser(); syncAccountSettings(); }
    else showPage('login');
  });
  var upgradeBtn = document.getElementById('settings-upgrade-btn');
  if (upgradeBtn) upgradeBtn.addEventListener('click', function() { showPage('pricing'); });

  // ---- Modal: đổi loại → hiện ô URL / file ----
  var newType = document.getElementById('new-type');
  if (newType) newType.addEventListener('change', function() { updateModalTypeFields(this.value); });

  var newFile = document.getElementById('new-file');
  if (newFile) newFile.addEventListener('change', function() { handleModalFile(this.files[0]); });

  var btnBanner = document.getElementById('btn-banner');
  if (btnBanner) btnBanner.addEventListener('click', function() { showPage('spaces'); });

  var searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function() { handleSearch(this.value); });
    searchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doAISearch(); });
  }

  var btnFab = document.getElementById('btn-fab');
  if (btnFab) btnFab.addEventListener('click', openAddModal);

  var btnCurrentPlan = document.getElementById('btn-current-plan');
  if (btnCurrentPlan) btnCurrentPlan.addEventListener('click', function() { showPage('dashboard'); });

  var btnUpgrade = document.getElementById('btn-upgrade');
  if (btnUpgrade) btnUpgrade.addEventListener('click', function() { showToast('🎉 Chuyển hướng đến thanh toán...'); });

  var btnModalCancel = document.getElementById('btn-modal-cancel');
  if (btnModalCancel) btnModalCancel.addEventListener('click', closeModal);

  var btnModalSave = document.getElementById('btn-modal-save');
  if (btnModalSave) btnModalSave.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    saveItem();
  });

  // Fallback: event delegation cho toàn modal
  var addModal = document.getElementById('add-modal');
  if (addModal) {
    addModal.addEventListener('click', function(e) {
      if (e.target === this) { closeModal(); return; }
      if (e.target.id === 'btn-modal-save' || e.target.closest('#btn-modal-save')) {
        e.preventDefault();
        saveItem();
      }
      if (e.target.id === 'btn-modal-cancel' || e.target.closest('#btn-modal-cancel')) {
        closeModal();
      }
    });
  }

  // Tag generation on content input
  var newContent = document.getElementById('new-content');
  if (newContent) newContent.addEventListener('input', function() {
    clearTimeout(tagTimeout);
    tagTimeout = setTimeout(function() { generateTags(newContent.value); }, 1000);
  });


  var btnReminderAdd = document.getElementById('btn-reminder-add');
  if (btnReminderAdd) btnReminderAdd.addEventListener('click', function(e) {
    e.preventDefault();
    addReminder();
  });

  var imageViewer = document.getElementById('image-viewer');
  var imageViewerClose = document.getElementById('image-viewer-close');
  var imageViewerOpenImage = document.getElementById('image-viewer-open-image');
  var imageViewerOpenPage = document.getElementById('image-viewer-open-page');
  if (imageViewerClose) imageViewerClose.addEventListener('click', closeImagePreview);
  if (imageViewer) imageViewer.addEventListener('click', function(e) {
    if (e.target === imageViewer) closeImagePreview();
  });
  if (imageViewerOpenImage) imageViewerOpenImage.addEventListener('click', function() {
    openOriginalImage(this.dataset.url, document.getElementById('image-viewer-title')?.textContent);
  });
  if (imageViewerOpenPage) imageViewerOpenPage.addEventListener('click', function() {
    openUrlInNewTab(this.dataset.url);
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeImagePreview();
  });

  document.addEventListener('click', function(e) {
    var spaceFilter = e.target.closest('[data-space-filter]');
    if (spaceFilter) {
      currentSpaceFilter = spaceFilter.dataset.spaceFilter || 'all';
      currentSpaceId = null;
      renderSpaces();
      return;
    }

    var spaceView = e.target.closest('[data-space-view]');
    if (spaceView) {
      currentSpaceView = spaceView.dataset.spaceView || 'grid';
      renderSpaces();
      return;
    }

    var spaceBack = e.target.closest('#space-detail-back');
    if (spaceBack) {
      closeSpaceDetail();
      return;
    }

    var spaceFavorite = e.target.closest('[data-space-favorite]');
    if (spaceFavorite) {
      e.stopPropagation();
      toggleFavoriteSpace(spaceFavorite.dataset.spaceFavorite);
      return;
    }

    var spaceOpenDashboard = e.target.closest('#space-detail-open-dashboard');
    if (spaceOpenDashboard) {
      showPage('dashboard');
      return;
    }

    var spaceOpenUrl = e.target.closest('[data-space-open-url]');
    if (spaceOpenUrl) {
      e.stopPropagation();
      openUrlInNewTab(spaceOpenUrl.dataset.spaceOpenUrl);
      return;
    }

    var spaceCard = e.target.closest('[data-space-id]');
    if (spaceCard) {
      openSpace(spaceCard.dataset.spaceId);
      return;
    }

    var imageTarget = e.target.closest('[data-image-preview]');
    if (imageTarget) {
      openImagePreview(imageTarget.dataset.imagePreview, imageTarget.dataset.imageTitle, imageTarget.dataset.pageUrl);
      return;
    }

    // "Đồng bộ lên database" — re-run the upload pipeline for an item that
    // failed the first attempt (token expired, network down, …). We block
    // the click so it doesn't bubble up to the surrounding image-preview
    // handler.
    var resyncBtn = e.target.closest('[data-resync-id]');
    if (resyncBtn) {
      e.preventDefault();
      e.stopPropagation();
      resyncItem(resyncBtn);
      return;
    }

    var dashboardReminderTask = e.target.closest('[data-dashboard-reminder-id][data-dashboard-task-index]');
    if (dashboardReminderTask) {
      e.preventDefault();
      e.stopPropagation();
      toggleReminderTask(dashboardReminderTask.dataset.dashboardReminderId, Number(dashboardReminderTask.dataset.dashboardTaskIndex));
      return;
    }

    var dashboardReminderDelete = e.target.closest('[data-dashboard-reminder-delete]');
    if (dashboardReminderDelete) {
      e.preventDefault();
      e.stopPropagation();
      deleteReminder(dashboardReminderDelete.dataset.dashboardReminderDelete);
      return;
    }

    var dashboardOpenReminders = e.target.closest('[data-open-reminders]');
    if (dashboardOpenReminders) {
      e.preventDefault();
      e.stopPropagation();
      showPage('reminders');
      return;
    }

    var reminderTab = e.target.closest('[data-reminder-filter]');
    if (reminderTab) {
      reminderFilter = reminderTab.dataset.reminderFilter || 'all';
      document.querySelectorAll('.reminder-tab').forEach(function(tab) { tab.classList.remove('active'); });
      reminderTab.classList.add('active');
      renderReminders();
      return;
    }

    var reminderTask = e.target.closest('[data-reminder-id][data-task-index]');
    if (reminderTask) {
      toggleReminderTask(reminderTask.dataset.reminderId, Number(reminderTask.dataset.taskIndex));
      return;
    }

    var reminderDelete = e.target.closest('[data-reminder-delete]');
    if (reminderDelete) {
      deleteReminder(reminderDelete.dataset.reminderDelete);
    }
  });


  // Load data
  loadAuthState(function() {
    syncAccountSettings();
    loadFromExtension();
  });
  // Schedule silent refresh after the user logs in (no-op until session exists).
  setTimeout(function() {
    try {
      const raw = (typeof chrome !== 'undefined' && chrome.storage)
        ? null
        : localStorage.getItem('mnemonics_session');
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session && session.accessToken && session.expiresAt) {
        const remaining = session.expiresAt * 1000 - Date.now();
        if (remaining < 5 * 60_000 && session.refreshToken) {
          silentRefresh(session.refreshToken);
        }
      }
    } catch (e) { /* ignore */ }
  }, 1500);
  loadSettings(function() { syncSettingsUI(); });
  loadFromExtension();
  loadSpacePrefs();
  loadReminders();
  renderDashboard();
  renderSpaces();
  renderReminders();
  renderBookRail();
  } catch (err) {
    console.error('[mnemonics] bind error', err);
  }
});

// ===== DROPDOWN MENU - event delegation, no inline onclick =====
function toggleDropdown(e, id) {
  e.stopPropagation();
  document.querySelectorAll('.card-dropdown.open').forEach(d => {
    if (d.id !== 'dropdown-' + id) d.classList.remove('open');
  });
  var dropdown = document.getElementById('dropdown-' + id);
  if (dropdown) dropdown.classList.toggle('open');
}

// Click ra ngoài → đóng dropdown
document.addEventListener('click', function() {
  document.querySelectorAll('.card-dropdown.open').forEach(d => d.classList.remove('open'));
});

// Event delegation cho toàn bộ cards container
document.addEventListener('click', function(e) {
  // Bấm vào ···
  var menuBtn = e.target.closest('[data-menuid]');
  if (menuBtn) {
    e.stopPropagation();
    var id = menuBtn.dataset.menuid;
    document.querySelectorAll('.card-dropdown.open').forEach(d => {
      if (d.id !== 'dropdown-' + id) d.classList.remove('open');
    });
    var dropdown = document.getElementById('dropdown-' + id);
    if (dropdown) dropdown.classList.toggle('open');
    return;
  }

  // Bấm vào Xóa
  var deleteBtn = e.target.closest('[data-deleteid]');
  if (deleteBtn) {
    e.stopPropagation();
    deleteItem(deleteBtn.dataset.deleteid);
    return;
  }

  // Bấm mở link
  var linkBtn = e.target.closest('[data-open-link]');
  if (linkBtn) {
    e.preventDefault();
    e.stopPropagation();
    openUrlInNewTab(linkBtn.dataset.openLink);
    return;
  }
});

// ===== DELETE ITEM =====
function deleteItem(id) {
  const target = items.find(function(i) { return String(i.id) === String(id); });
  if (target && target.sourceType === 'reminder') {
    deleteReminder(target.reminderId);
    return;
  }

  baseMemoryItems = baseMemoryItems.filter(function(i) { return String(i.id) !== String(id); });
  items = composeDashboardItems();
  var toStore = baseMemoryItems.filter(function(i) { return i.savedAt; });
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [userItemsKey()]: toStore }, function() {
      renderDashboard();
      showToast('🗑 Đã xóa ký ức');
    });
  } else {
    localStorage.setItem(userItemsKey(), JSON.stringify(toStore));
    renderDashboard();
    showToast('🗑 Đã xóa ký ức');
  }
}

// Re-upload a single image item that the initial save couldn't push to
// Supabase (token expired, network down, CORS, …). The pending pill
// disappears as soon as the upload returns 201; otherwise we keep the
// pill visible and surface the error so the user knows what to fix.
function resyncItem(btn) {
  var id = btn.dataset.resyncId;
  var item = items.find(function(i) { return String(i.id) === String(id); });
  if (!item) {
    showToast('Không tìm thấy ảnh trong dashboard để đồng bộ.');
    return;
  }
  var originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="resync-dot"></span>Đang upload...';

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
    showToast('Trang này cần chạy trong extension context để đồng bộ.');
    return;
  }

  chrome.runtime.sendMessage({
    type: 'RESYNC_ITEM',
    imageUrl: item.imageUrl || '',
    sourceUrl: item.sourceUrl || '',
    title: item.title || '',
    note: item.note || '',
    capturedAt: item.savedAt || ''
  }, function(response) {
    btn.disabled = false;
    if (chrome.runtime && chrome.runtime.lastError) {
      btn.innerHTML = originalLabel;
      showToast('Không đồng bộ được: ' + chrome.runtime.lastError.message);
      return;
    }
    if (response && response.ok) {
      // Mark the item as uploaded in-place. We don't have the new
      // storageKey from this view; the next reloadItems will reconcile
      // anyway, but clearing the flag here hides the pill immediately.
      item.pendingUpload = false;
      renderDashboard();
      showToast('✅ Đã upload lên Supabase');
    } else {
      btn.innerHTML = originalLabel;
      var msg = (response && response.error) ? response.error : 'Upload thất bại';
      showToast('Không đồng bộ được: ' + msg);
    }
  });
}
