// ===== LIMITS & PRO HELPERS =====
var MNEMONICS_FREE_MONTHLY_LIMIT = typeof MNEMONICS_FREE_MONTHLY_LIMIT !== 'undefined' ? MNEMONICS_FREE_MONTHLY_LIMIT : 50;
var MNEMONICS_QUOTA_MESSAGE = typeof MNEMONICS_QUOTA_MESSAGE !== 'undefined' ? MNEMONICS_QUOTA_MESSAGE : 'Gói miễn phí lưu tối đa ' + MNEMONICS_FREE_MONTHLY_LIMIT + ' ký ức mỗi tháng.';
if (typeof mnemonicsIsPro !== 'function') {
  var mnemonicsIsPro = function(user) {
    return Boolean(user && user.email && (user.plan === 'Mastery' || (user.proUntil && Date.now() < Date.parse(user.proUntil))));
  };
}
if (typeof mnemonicsSavedThisMonth !== 'function') {
  var mnemonicsSavedThisMonth = function(items) {
    var now = new Date();
    return (items || []).filter(function(item) {
      var d = new Date(item.savedAt || 0);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  };
}

// ===== DATA =====
// Người dùng mới bắt đầu với kho trống
const SAMPLE_ITEMS = [];

const SPACES_DATA = [
  {
    id: 'design-inspiration',
    icon: '🎨',
    name: 'CẢM HỨNG THIẾT KẾ',
    desc: 'Ảnh chụp màn hình, bảng màu và các mẫu UI được thu thập trong quá trình duyệt web.',
    keywords: ['cảm hứng', 'thiết kế', 'design', 'inspiration', 'ui', 'ux', 'ảnh', 'image'],
    updatedAt: '2026-06-25T08:00:00.000Z'
  },
  {
    id: 'tech-notes',
    icon: '⚙️',
    name: 'GHI CHÚ CÔNG NGHỆ',
    desc: 'Các bài báo, đoạn mã và tin tức công nghệ từ quá trình duyệt web.',
    keywords: ['công nghệ', 'tech', 'code', 'css', 'frontend', 'backend', 'spatial', 'hci'],
    updatedAt: '2026-06-24T10:00:00.000Z'
  },
  {
    id: 'japan-trip',
    icon: '✈️',
    name: 'DU LỊCH',
    desc: 'Lịch trình bay, đặt phòng khách sạn và các địa điểm dự kiến tham quan.',
    keywords: ['du lịch', 'trip', 'travel', 'chuyến đi', 'khách sạn', 'lịch trình', 'vé máy bay'],
    updatedAt: '2026-06-20T10:00:00.000Z'
  },
  {
    id: 'study-materials',
    icon: '📚',
    name: 'TÀI LIỆU HỌC TẬP',
    desc: 'Các bài báo nghiên cứu, nội dung nổi bật từ sách giáo khoa và ghi chú học tập.',
    keywords: ['học tập', 'tài liệu', 'research', 'nghiên cứu', 'article', 'study', 'book'],
    updatedAt: '2026-06-22T10:00:00.000Z'
  },
];

let currentSpaceFilter = 'all';
let currentSpaceView = 'grid';
let currentSpaceId = null;
let favoriteSpaceIds = [];
let recentSpaceIds = [];


const DEFAULT_REMINDERS = [];

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

function getAccounts(cb) {
  getStorageValue('mnemonics_accounts', [], function(accounts) {
    cb(Array.isArray(accounts) ? accounts : []);
  });
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

  const displayName = isLoggedIn ? (currentUser.name || currentUser.email) : 'Khách';
  const initials = getInitials(displayName);
  if (userName) userName.textContent = displayName;
  if (sidebarName) sidebarName.textContent = displayName;
  const photo = isLoggedIn ? currentUser.avatar : null;
  [userAvatar, sidebarAvatar, document.getElementById('settings-avatar-preview')].forEach(function(el) {
    paintAvatar(el, photo, initials);
  });
  updatePlanUI();
}

// Hiện ảnh đại diện nếu có, không thì hiện chữ cái đầu của tên
function paintAvatar(el, photo, initials) {
  if (!el) return;
  el.textContent = photo ? '' : initials;
  el.style.backgroundImage = photo ? 'url("' + photo + '")' : '';
  el.style.backgroundSize = photo ? 'cover' : '';
  el.style.backgroundPosition = photo ? 'center' : '';
}

// Thu ảnh về 128x128 (cắt vuông ở giữa) để lưu gọn trong bộ nhớ trình duyệt
function resizeAvatar(file, cb) {
  const reader = new FileReader();
  reader.onload = function() {
    const img = new Image();
    img.onload = function() {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      canvas.getContext('2d').drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
      cb(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function() { cb(null); };
    img.src = reader.result;
  };
  reader.onerror = function() { cb(null); };
  reader.readAsDataURL(file);
}

function saveAvatar(photo) {
  if (!currentUser || !currentUser.email) return;
  getAccounts(function(accounts) {
    const account = accounts.find(acc => normalizeEmail(acc.email) === normalizeEmail(currentUser.email));
    if (account) account.avatar = photo;
    setStorageValues({ mnemonics_accounts: accounts }, function() {
      saveCurrentUser(Object.assign({}, currentUser, { avatar: photo }), function() {
        syncAccountSettings();
        showToast(photo ? '✦ Đã cập nhật ảnh đại diện' : 'Đã xóa ảnh đại diện');
      });
    });
  });
}

function handleAvatarFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('Hãy chọn một tệp ảnh'); return; }
  if (file.size > 8 * 1024 * 1024) { showToast('Ảnh quá lớn (tối đa 8MB)'); return; }
  resizeAvatar(file, function(photo) {
    if (!photo) { showToast('Không đọc được ảnh này'); return; }
    saveAvatar(photo);
  });
}

function loadAuthState(cb) {
  getStorageValue('mnemonics_session', null, function(session) {
    if (session && session.user && session.user.email) {
      currentUser = session.user;
    } else {
      getStorageValue('mnemonics_current_user', null, function(user) {
        currentUser = user && user.email ? user : null;
      });
    }
    updateAuthUI();
    if (cb) cb();
  });
}

function saveCurrentUser(user, cb) {
  currentUser = user && user.email ? user : null;
  setStorageValues({ mnemonics_current_user: currentUser }, function() {
    updateAuthUI();
    if (cb) cb();
  });
}

// ===== GÓI MASTERY & MÃ KÍCH HOẠT =====
// Mã do công cụ quản trị ký bằng khóa riêng (không nằm trong extension); ở đây chỉ
// có khóa công khai để kiểm tra, nên không ai tự tạo được mã hợp lệ.
// Nội dung một mã:  v1|số ngày Mastery|email được dùng hoặc *|id mã|hạn nhập YYYYMMDD
const LICENSE_PUBLIC_JWK = {"kty": "EC", "crv": "P-256", "x": "yvZypc4xxKqfXijYdiDT-3pOrNCZKv3fOcZBFoOuJSU", "y": "gxKXvE26pKNqNgK5FrKxPYaICp2KttBV4ZQVhJz5qIM"};
const PAYMENT_CONTACT = 'quynhle23122005@gmail.com';
const PLAN_OPTIONS = {
  month: { label: '1 tháng', amount: '29.000đ' },
  year: { label: '1 năm', amount: '249.000đ' }
};
let payPlan = 'month';

function isPro() {
  return mnemonicsIsPro(currentUser);
}

function storageGet(key, fallback) {
  return new Promise(function(resolve) { getStorageValue(key, fallback, resolve); });
}

function b64urlToBytes(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, function(c) { return c.charCodeAt(0); });
}

// Trả về { days, email, id, redeemBy } hoặc ném lỗi kèm lý do để hiện cho người dùng
async function readActivationCode(rawCode) {
  const parts = String(rawCode || '').replace(/\s+/g, '').replace(/^MNE-/i, '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Mã không đúng định dạng.');
  let payload, signature;
  try { payload = b64urlToBytes(parts[0]); signature = b64urlToBytes(parts[1]); }
  catch (e) { throw new Error('Mã không đúng định dạng.'); }
  const key = await crypto.subtle.importKey('jwk', LICENSE_PUBLIC_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const genuine = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, payload);
  if (!genuine) throw new Error('Mã không hợp lệ.');
  const f = new TextDecoder().decode(payload).split('|');
  if (f.length !== 5 || f[0] !== 'v1' || !(parseInt(f[1], 10) > 0)) throw new Error('Mã không hợp lệ.');
  return { days: parseInt(f[1], 10), email: f[2], id: f[3], redeemBy: f[4] };
}

async function redeemActivationCode(rawCode) {
  if (!currentUser || !currentUser.email) throw new Error('Hãy đăng nhập trước khi nhập mã.');
  const code = await readActivationCode(rawCode);
  const today = new Date();
  const todayStamp = String(today.getFullYear()) + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
  if (todayStamp > code.redeemBy) throw new Error('Mã đã quá hạn nhập.');
  if (code.email !== '*' && normalizeEmail(code.email) !== normalizeEmail(currentUser.email)) {
    throw new Error('Mã này được cấp cho một email khác.');
  }
  const used = await storageGet('mnemonics_used_codes', []);
  if ((used || []).includes(code.id)) throw new Error('Mã này đã được dùng trên máy này.');

  // còn hạn thì cộng dồn, hết hạn thì tính từ hôm nay
  const base = Math.max(Date.now(), Date.parse(currentUser.proUntil || 0) || 0);
  const proUntil = new Date(base + code.days * 86400000).toISOString();
  const accounts = await new Promise(getAccounts);
  const account = accounts.find(acc => normalizeEmail(acc.email) === normalizeEmail(currentUser.email));
  if (account) { account.proUntil = proUntil; account.plan = 'Mastery'; }
  await new Promise(function(resolve) {
    setStorageValues({ mnemonics_accounts: accounts, mnemonics_used_codes: (used || []).concat(code.id) }, resolve);
  });
  await new Promise(function(resolve) {
    saveCurrentUser(Object.assign({}, currentUser, { proUntil: proUntil, plan: 'Mastery' }), resolve);
  });
  return { days: code.days, proUntil: proUntil };
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('vi-VN');
}

// Mọi chỗ trên giao diện nói về gói hiện tại
function updatePlanUI() {
  const pro = isPro();
  const planEl = document.getElementById('settings-plan-name');
  if (planEl) {
    planEl.textContent = pro
      ? 'Mastery · còn hạn đến ' + formatDate(currentUser.proUntil)
      : 'Memory (miễn phí) · tháng này đã lưu ' + mnemonicsSavedThisMonth(baseMemoryItems) + '/' + MNEMONICS_FREE_MONTHLY_LIMIT;
  }
  const settingsUpgrade = document.getElementById('settings-upgrade-btn');
  if (settingsUpgrade) settingsUpgrade.textContent = pro ? 'Gia hạn' : 'Nâng cấp';
  const freeBtn = document.getElementById('btn-current-plan');
  if (freeBtn) freeBtn.textContent = pro ? 'GÓI MIỄN PHÍ' : 'GÓI HIỆN TẠI';
  const upgradeLabel = document.getElementById('btn-upgrade-label');
  if (upgradeLabel) upgradeLabel.textContent = pro ? 'ĐANG DÙNG ĐẾN ' + formatDate(currentUser.proUntil) + ' · GIA HẠN' : 'NÂNG CẤP LÊN MASTERY';
  const aiToggle = document.getElementById('setting-ai-search');
  if (aiToggle) { aiToggle.disabled = !pro; if (!pro) aiToggle.checked = false; }
  const aiLock = document.getElementById('setting-ai-lock');
  if (aiLock) aiLock.style.display = pro ? 'none' : '';
}

function openPayModal() {
  const loggedIn = Boolean(currentUser && currentUser.email);
  document.getElementById('pay-login-note').style.display = loggedIn ? 'none' : '';
  document.getElementById('pay-memo').textContent = loggedIn ? 'MNE ' + currentUser.email : 'MNE + email tài khoản của bạn';
  document.getElementById('pay-contact').textContent = PAYMENT_CONTACT;
  document.getElementById('pay-code-input').value = '';
  setPayMessage('', false);
  selectPayPlan(payPlan);
  document.getElementById('pay-modal').classList.add('open');
}

function closePayModal() {
  document.getElementById('pay-modal').classList.remove('open');
}

function selectPayPlan(plan) {
  payPlan = plan;
  document.querySelectorAll('#pay-plan-toggle button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.plan === plan);
  });
  document.getElementById('pay-amount').textContent = PLAN_OPTIONS[plan].amount + ' / ' + PLAN_OPTIONS[plan].label;
}

function setPayMessage(text, ok) {
  const el = document.getElementById('pay-message');
  el.textContent = text;
  el.className = 'pay-message' + (text ? (ok ? ' ok' : ' error') : '');
}

async function submitActivationCode() {
  const btn = document.getElementById('btn-pay-activate');
  btn.disabled = true;
  try {
    const result = await redeemActivationCode(document.getElementById('pay-code-input').value);
    setPayMessage('Đã kích hoạt Mastery thêm ' + result.days + ' ngày, dùng được đến ' + formatDate(result.proUntil) + '.', true);
    document.getElementById('pay-code-input').value = '';
    syncAccountSettings();
    renderDashboard();
    showToast('✦ Đã kích hoạt Mastery');
  } catch (err) {
    setPayMessage(err.message || 'Không kích hoạt được mã này.', false);
  }
  btn.disabled = false;
}

// ===== KHO RIÊNG CHO TỪNG TÀI KHOẢN =====
// Popup, menu chuột phải và dashboard đều đọc/ghi các khóa "đang dùng"
// (mnemonics_items, mnemonics_reminders, mnemonics_client_key). Khi đổi tài khoản,
// kho đang dùng được cất vào ngăn của tài khoản cũ và ngăn của tài khoản mới được
// lấy ra thay vào, nên mỗi tài khoản chỉ thấy ký ức của mình.
function profileId(user) {
  return user && user.email ? String(user.id) : 'guest';
}

function switchProfileData(fromId, toId, cb) {
  getStorageValue('mnemonics_items', [], function(activeItems) {
    getStorageValue('mnemonics_reminders', [], function(activeReminders) {
      getStorageValue('mnemonics_client_key', null, function(activeKey) {
        getStorageValue('mnemonics_vault', {}, function(vault) {
          vault = vault && typeof vault === 'object' ? vault : {};
          vault[fromId] = { items: activeItems || [], reminders: activeReminders || [], clientKey: activeKey || null };
          const next = vault[toId] || { items: [], reminders: [], clientKey: null };
          delete vault[toId];
          setStorageValues({
            mnemonics_vault: vault,
            mnemonics_items: next.items || [],
            mnemonics_reminders: next.reminders || [],
            mnemonics_client_key: next.clientKey || null
          }, cb);
        });
      });
    });
  });
}

// Đổi sang tài khoản khác (hoặc null = khách). keepCurrentData: tài khoản vừa tạo
// từ chế độ khách giữ luôn những gì khách đã lưu.
function activateUser(user, keepCurrentData, cb) {
  const fromId = profileId(currentUser);
  const toId = profileId(user);
  const finish = function() {
    saveCurrentUser(user, function() {
      // kho và chỉ mục tìm kiếm AI giờ thuộc về tài khoản khác
      semanticClientKey = null;
      semanticSyncedSignature = null;
      semanticState = { query: '', scores: null };
      loadReminders(function() { loadFromExtension(cb); });
    });
  };
  if (fromId === toId || (keepCurrentData && fromId === 'guest')) { finish(); return; }
  switchProfileData(fromId, toId, finish);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Tài khoản chỉ nằm trên máy này. Mật khẩu lưu dạng băm có salt, không lưu chữ thường.
async function hashPassword(password, salt) {
  const bytes = new TextEncoder().encode(salt + ':' + password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function passwordMatches(account, password) {
  if (account.passwordHash) return account.passwordHash === await hashPassword(password, account.salt);
  return typeof account.password === 'string' && account.password === password;   // tài khoản tạo từ bản cũ
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
  if (password.length < 6) {
    setAuthError('signup-error', 'Mật khẩu cần tối thiểu 6 ký tự.');
    return;
  }
  if (password !== confirm) {
    setAuthError('signup-error', 'Mật khẩu nhập lại chưa khớp.');
    return;
  }

  const btn = document.getElementById('btn-auth-signup');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(MNEMONICS_API + '/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body.error && body.error.message) || 'Không thể tạo tài khoản lúc này.');
    }
    const data = body.data || {};
    if (data.session && data.session.accessToken) {
      const user = data.user || {};
      const session = data.session;
      const storedSession = {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          name: name || user.name || user.email,
          avatar: null,
          plan: 'Mastery'
        }
      };
      await new Promise(resolve => setStorageValues({
        mnemonics_session: storedSession,
        mnemonics_current_user: storedSession.user
      }, resolve));
      currentUser = storedSession.user;
      updateAuthUI();
      showToast('✦ Đã tạo tài khoản Mnemonics và đồng bộ Database!');
      showPage('dashboard');
      loadFromExtension();
    } else {
      showPage('login');
      document.getElementById('login-email').value = email;
      setAuthError('login-error', 'Đăng ký thành công! Hãy đăng nhập.');
    }
  } catch (err) {
    setAuthError('signup-error', err.message || 'Không thể tạo tài khoản.');
  } finally {
    if (btn) btn.disabled = false;
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

  const btn = document.getElementById('btn-auth-login');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch(MNEMONICS_API + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body.error && body.error.message) || 'Email hoặc mật khẩu chưa đúng.');
    }
    const data = body.data || {};
    const user = data.user || {};
    const session = data.session || {};
    const storedSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        avatar: user.avatar || null,
        plan: user.plan || 'Mastery',
        proUntil: user.proUntil || null
      }
    };
    await new Promise(resolve => setStorageValues({
      mnemonics_session: storedSession,
      mnemonics_current_user: storedSession.user
    }, resolve));
    currentUser = storedSession.user;
    updateAuthUI();
    showToast('✦ Đăng nhập thành công! Đang đồng bộ Database...');
    showPage('dashboard');
    loadFromExtension();
  } catch (err) {
    setAuthError('login-error', err.message || 'Không thể đăng nhập lúc này.');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loginDemoUser() {
  try {
    const res = await fetch(MNEMONICS_API + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@mnemonics.local', password: 'DemoPass123!' })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body.error && body.error.message) || 'Demo login failed');
    }
    const data = body.data || {};
    const user = data.user || {};
    const session = data.session || {};
    const storedSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || 'Demo User',
        avatar: null,
        plan: 'Mastery',
        proUntil: '2099-01-01T00:00:00.000Z'
      }
    };
    await new Promise(resolve => setStorageValues({
      mnemonics_session: storedSession,
      mnemonics_current_user: storedSession.user
    }, resolve));
    currentUser = storedSession.user;
    updateAuthUI();
    showToast('✦ Đã đăng nhập bằng tài khoản Demo');
    showPage('dashboard');
    loadFromExtension();
  } catch (err) {
    setAuthError('login-error', err.message || 'Không kết nối được server demo.');
  }
}

function logoutUser() {
  setStorageValues({ mnemonics_session: null, mnemonics_current_user: null }, function() {
    currentUser = null;
    baseMemoryItems = [];
    items = [];
    updateAuthUI();
    renderDashboard();
    showToast('Đã đăng xuất');
    showPage('landing');
  });
}


let baseMemoryItems = [...SAMPLE_ITEMS];
let items = [...SAMPLE_ITEMS];

// ===== SORT / FILTER / TIME STATE =====
let currentSortBy = 'newest';
let currentFormatFilter = 'all';
let currentTimeFilter = 'all';
let topicClusterSelection = { query: '', selectedId: 'all' };

// Phân loại một item về nhóm định dạng chuẩn để lọc/sắp xếp
function getItemFormat(item) {
  if (item.type === 'image') return 'image';
  if (item.type === 'screenshot') return 'screenshot';
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
  // Mục đã ghim luôn nằm trên cùng, giữ nguyên thứ tự bên trong mỗi nhóm
  return out.filter(function(i) { return i.pinned; }).concat(out.filter(function(i) { return !i.pinned; }));
}

// Render cards có áp dụng sort/filter + ô tìm kiếm hiện tại
function renderDashboard() {
  var searchVal = '';
  var searchEl = document.getElementById('search-input');
  if (searchEl) searchVal = searchEl.value.toLowerCase().trim();
  if (topicClusterSelection.query !== searchVal) {
    topicClusterSelection = { query: searchVal, selectedId: 'all' };
  }
  // Kết quả AI chỉ dùng khi nó thuộc đúng từ khóa đang gõ
  var sem = (searchVal && semanticState.scores && semanticState.query === searchVal) ? semanticState.scores : null;
  var base = !searchVal ? items : items.filter(function(i) {
    return keywordMatch(i, searchVal) || (sem && sem[String(i.id)] !== undefined);
  });
  var out = applySortFilter(base);
  if (sem) {
    // Xếp theo độ liên quan: khớp chữ đứng trước, rồi tới khớp theo ý nghĩa
    var rank = function(i) {
      return (keywordMatch(i, searchVal) ? 1 : 0) + (sem[String(i.id)] || 0);
    };
    out.sort(function(a, b) { return rank(b) - rank(a); });
  }
  renderCards(out, searchVal);
}

// Nhóm các kết quả tìm kiếm theo độ gần nhau của từ khóa TF-IDF.
// Thẻ người dùng và thẻ AI được tăng trọng số để giúp các nội dung cùng chủ đề
// nhưng diễn đạt khác nhau vẫn có thể nằm trong một cụm.
const CLUSTER_STOPWORDS = new Set((
  'a an the and or but if then else of in on at to for from by with about as into through during before after above below '
  + 'is are was were be been being do does did have has had this that these those it its i you your we they them their '
  + 'cua va voi la mot cac nhung nhung nay do nay thi da dang se duoc khong trong tren duoi khi den tu ve tai cho '
  + 'va hoac neu thi vi nhu rat cung hon nhat mot cac da dang bi bo duoc can co '
).split(/\s+/));
let topicClusterCacheSignature = '';
let topicClusterCache = [];

function addClusterTerms(map, value, weight, includeBigrams) {
  const words = normalizeText(value).match(/[a-z0-9]+/g) || [];
  const useful = words.filter(function(word) { return word.length > 1 && !CLUSTER_STOPWORDS.has(word); });
  const seen = new Set();
  useful.forEach(function(word) { seen.add(word); });
  if (includeBigrams) {
    for (let i = 0; i < useful.length - 1; i++) {
      if (useful[i] !== useful[i + 1]) seen.add('b:' + useful[i] + ' ' + useful[i + 1]);
    }
  }
  seen.forEach(function(term) { map.set(term, (map.get(term) || 0) + weight); });
}

function getClusterVector(item) {
  const terms = new Map();
  addClusterTerms(terms, item.title, 1.7, true);
  addClusterTerms(terms, [item.excerpt, item.note, item.quote, (item.checks || []).map(function(c) { return c.text; }).join(' ')].join(' '), 1, true);
  (item.tags || []).forEach(function(tag) {
    addClusterTerms(terms, tag, 2.4, true);
    const exact = normalizeText(tag).trim();
    if (exact.length > 1) terms.set('tag:' + exact, (terms.get('tag:' + exact) || 0) + 3.2);
  });
  (item.aiTags || []).forEach(function(tag) {
    addClusterTerms(terms, tag, 3, true);
    const exact = normalizeText(tag).trim();
    if (exact.length > 1) terms.set('ai:' + exact, (terms.get('ai:' + exact) || 0) + 4);
  });
  return terms;
}

function labelTopicCluster(clusterItems, vectors) {
  const labels = new Map();
  clusterItems.forEach(function(item) {
    const itemLabels = new Map();
    (item.aiTags || []).forEach(function(tag) {
      const label = String(tag || '').trim();
      const key = normalizeText(label);
      if (key && !itemLabels.has(key)) itemLabels.set(key, { label: label, weight: 2 });
    });
    (item.tags || []).forEach(function(tag) {
      const label = String(tag || '').trim();
      const key = normalizeText(label);
      if (key && !itemLabels.has(key)) itemLabels.set(key, { label: label, weight: 1 });
    });
    itemLabels.forEach(function(itemEntry, key) {
      const entry = labels.get(key) || { label: itemEntry.label, count: 0, weight: itemEntry.weight };
      entry.count++;
      entry.weight = Math.max(entry.weight, itemEntry.weight);
      labels.set(key, entry);
    });
  });
  const sharedLabel = Array.from(labels.values()).filter(function(entry) { return entry.count >= 2; })
    .sort(function(a, b) { return (b.count * b.weight) - (a.count * a.weight) || a.label.length - b.label.length; })[0];
  if (sharedLabel) return sharedLabel.label;

  const terms = new Map();
  clusterItems.forEach(function(item) {
    const vector = vectors.get(item);
    if (!vector) return;
    vector.forEach(function(weight, term) {
      if (term.indexOf('tag:') === 0 || term.indexOf('ai:') === 0) return;
      const entry = terms.get(term) || { count: 0, score: 0 };
      entry.count++;
      entry.score += weight;
      terms.set(term, entry);
    });
  });
  const common = Array.from(terms.entries()).filter(function(pair) { return pair[1].count >= 2; })
    .sort(function(a, b) {
      const aScore = a[1].score * (a[0].indexOf('b:') === 0 ? 1.3 : 1);
      const bScore = b[1].score * (b[0].indexOf('b:') === 0 ? 1.3 : 1);
      return bScore - aScore;
    });
  if (common.length) return common[0][0].replace(/^b:/, '');
  return 'Chủ đề liên quan';
}

function getTopicClusterId(clusterItems) {
  const ids = clusterItems.map(function(item) { return String(item.id); }).sort();
  const signature = ids.join('\u001f');
  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'topic-group-' + (hash >>> 0).toString(36);
}

function cosineToClusterCenter(vector, cluster) {
  if (!cluster.normSquared) return 0;
  let dot = 0;
  const small = vector.size <= cluster.sum.size ? vector : cluster.sum;
  const large = small === vector ? cluster.sum : vector;
  small.forEach(function(weight, term) { dot += weight * (large.get(term) || 0); });
  return dot / Math.sqrt(cluster.normSquared);
}

function addToClusterCenter(cluster, vector) {
  vector.forEach(function(weight, term) {
    const previous = cluster.sum.get(term) || 0;
    const next = previous + weight;
    cluster.sum.set(term, next);
    cluster.normSquared += next * next - previous * previous;
  });
}

function clusterSearchResults(data) {
  const signature = JSON.stringify(data.map(function(item) {
    return [String(item.id), item.savedAt || '', getSearchText(item)];
  }));
  if (signature === topicClusterCacheSignature) return topicClusterCache;
  const remember = function(clusters) {
    topicClusterCacheSignature = signature;
    topicClusterCache = clusters;
    return clusters;
  };
  const count = data.length;
  if (count < 6) return remember([]);

  const vectors = new Map();
  const documentFrequency = new Map();
  data.forEach(function(item) {
    const vector = getClusterVector(item);
    vectors.set(item, vector);
    vector.forEach(function(_, term) { documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1); });
  });

  data.forEach(function(item) {
    const vector = vectors.get(item);
    let norm = 0;
    vector.forEach(function(weight, term) {
      const idf = Math.log(1 + count / (1 + documentFrequency.get(term))) + 1;
      const tfidf = weight * idf;
      vector.set(term, tfidf);
      norm += tfidf * tfidf;
    });
    norm = Math.sqrt(norm) || 1;
    vector.forEach(function(weight, term) { vector.set(term, weight / norm); });
  });

  // Process in stable ID order so changing the dashboard sort does not
  // change cluster membership. Ignore very common terms when finding
  // candidate clusters: they add little topical signal and can turn a
  // large result set into one giant group.
  const maxTopicFrequency = Math.min(12, Math.max(3, Math.ceil(count * 0.10)));
  const maxTagFrequency = Math.min(30, Math.max(4, Math.ceil(count * 0.20)));
  function isUsefulClusterTerm(term) {
    const frequency = documentFrequency.get(term) || 0;
    if (frequency <= maxTopicFrequency) return true;
    return (term.indexOf('tag:') === 0 || term.indexOf('ai:') === 0) && frequency <= maxTagFrequency;
  }
  const clustersByTerm = new Map();
  const groups = [];
  const stableItems = data.slice().sort(function(a, b) {
    return String(a.id).localeCompare(String(b.id));
  });
  const threshold = 0.20;

  stableItems.forEach(function(item) {
    const vector = vectors.get(item);
    const candidateIndexes = new Set();
    vector.forEach(function(_, term) {
      if (!isUsefulClusterTerm(term)) return;
      const indexes = clustersByTerm.get(term);
      if (indexes) indexes.forEach(function(index) { candidateIndexes.add(index); });
    });

    let bestIndex = -1;
    let bestScore = threshold;
    candidateIndexes.forEach(function(index) {
      const cluster = groups[index];
      const centerScore = cosineToClusterCenter(vector, cluster);
      // Keep each member reasonably close to the cluster's first stable
      // member as well as its center, preventing single-link chain drift.
      const anchorScore = cosineToClusterCenter(vector, {
        sum: cluster.anchor,
        normSquared: 1
      });
      if (centerScore >= threshold && anchorScore >= threshold * 0.65 && centerScore > bestScore) {
        bestIndex = index;
        bestScore = centerScore;
      }
    });

    if (bestIndex < 0) {
      bestIndex = groups.length;
      groups.push({ items: [], sum: new Map(), normSquared: 0, anchor: vector });
    }
    const cluster = groups[bestIndex];
    cluster.items.push(item);
    addToClusterCenter(cluster, vector);
    vector.forEach(function(_, term) {
      if (!isUsefulClusterTerm(term)) return;
      if (!clustersByTerm.has(term)) clustersByTerm.set(term, new Set());
      clustersByTerm.get(term).add(bestIndex);
    });
  });

  const mainGroups = [];
  const otherItems = [];
  groups.forEach(function(group) {
    if (group.items.length > 1) mainGroups.push(group.items);
    else otherItems.push(group.items[0]);
  });
  if (mainGroups.length === 0) return remember([]);
  const originalPosition = new Map(data.map(function(item, index) { return [item, index]; }));
  mainGroups.forEach(function(group) {
    group.sort(function(a, b) { return originalPosition.get(a) - originalPosition.get(b); });
  });
  otherItems.sort(function(a, b) { return originalPosition.get(a) - originalPosition.get(b); });
  mainGroups.sort(function(a, b) {
    return b.length - a.length || labelTopicCluster(a, vectors).localeCompare(labelTopicCluster(b, vectors));
  });
  const clusters = mainGroups.map(function(group) {
    return { id: getTopicClusterId(group), label: labelTopicCluster(group, vectors), items: group };
  });
  if (otherItems.length) clusters.push({ id: 'topic-other', label: 'Chủ đề khác', items: otherItems });
  return remember(clusters.length > 1 ? clusters : []);
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
    (item.aiTags || []).join(' '),
    (item.checks || []).map(function(c) { return c.text; }).join(' ')
  ].map(function(value) { return String(value || '').toLowerCase(); }).join(' ');
}

// Viết tắt hay gặp và dạng đầy đủ, để gõ "mkt" vẫn ra "marketing" và ngược lại
const SEARCH_ABBREVIATIONS = {
  mkt: 'marketing', nckh: 'nghiên cứu khoa học', cntt: 'công nghệ thông tin',
  tmdt: 'thương mại điện tử', ttnt: 'trí tuệ nhân tạo', ktct: 'kinh tế chính trị',
  qtkd: 'quản trị kinh doanh', ptdl: 'phân tích dữ liệu', csdl: 'cơ sở dữ liệu',
  kd: 'kinh doanh', qc: 'quảng cáo', dn: 'doanh nghiệp', bđs: 'bất động sản'
};

function searchVariants(query) {
  const q = normalizeText(query).trim();
  const variants = [q];
  Object.keys(SEARCH_ABBREVIATIONS).forEach(function(short) {
    const shortN = normalizeText(short);
    const fullN = normalizeText(SEARCH_ABBREVIATIONS[short]);
    const asWord = new RegExp('(^|\\s)' + shortN + '(\\s|$)');
    if (asWord.test(q)) variants.push(q.replace(asWord, '$1' + fullN + '$2'));
    if (q.includes(fullN)) variants.push(q.replace(fullN, shortN));
  });
  return variants;
}

// Mở rộng viết tắt trước khi tạo embedding; embedding trực tiếp các chữ như
// "mkt" có thể gần nội dung không liên quan hơn từ đầy đủ "marketing".
function expandSearchAbbreviations(query) {
  let expanded = String(query || '').trim();
  Object.keys(SEARCH_ABBREVIATIONS).forEach(function(short) {
    const full = SEARCH_ABBREVIATIONS[short];
    const boundaryPattern = '(^|[^\\p{L}\\p{N}])' + short + '(?=$|[^\\p{L}\\p{N}])';
    expanded = expanded.replace(new RegExp(boundaryPattern, 'giu'), function(match, prefix) {
      return prefix + full;
    });
  });
  return expanded;
}

// Khớp không phân biệt dấu ("mo hinh" ra "mô hình"), có mở rộng viết tắt
function keywordMatch(item, query) {
  const text = normalizeText(getSearchText(item));
  return searchVariants(query).some(function(v) { return v && text.includes(v); });
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
  scheduleSemanticSync();
}

// ===== SEMANTIC SEARCH (backend) =====
var MNEMONICS_API = 'https://mnemonics-api.onrender.com';
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get('mnemonics_api_url', function(r) {
    if (r && r.mnemonics_api_url) MNEMONICS_API = r.mnemonics_api_url;
  });
}

let semanticState = { query: '', scores: null };   // scores: { itemId: điểm liên quan }
let semanticClientKey = null;
let semanticSyncedSignature = null;
let semanticSyncTimeout = null;
let semanticRetryAt = 0;

// Mỗi bản cài tự sinh một khóa ngẫu nhiên để server tách dữ liệu từng người
function getClientKey(cb) {
  if (semanticClientKey) { cb(semanticClientKey); return; }
  getStorageValue('mnemonics_client_key', null, function(key) {
    if (!key) {
      key = crypto.randomUUID() + crypto.randomUUID();
      setStorageValues({ mnemonics_client_key: key });
    }
    semanticClientKey = key;
    cb(key);
  });
}

function semanticApi(method, path, body) {
  return new Promise(function(resolve, reject) {
    getClientKey(function(key) {
      fetch(MNEMONICS_API + path, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'X-Client-Key': key },
        body: JSON.stringify(body)
      }).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(resolve, reject);
    });
  });
}

// Phần chữ có nghĩa của một ký ức (bỏ url, loại) để đem đi embed
function getEmbedText(item) {
  var body = item.note || (item.checks || []).map(function(c) { return c.text; }).join('. ');
  return [
    item.title, item.sourceType === 'reminder' ? '' : item.excerpt, body, item.quote,
    (item.tags || []).join(', '), (item.aiTags || []).join(', '), item.space
  ].map(function(value) { return String(value || '').trim(); }).filter(Boolean).join('. ');
}

function getSemanticPayload() {
  return items.map(function(item) {
    return { id: String(item.id).slice(0, 100), text: getEmbedText(item).slice(0, 2000) };
  }).filter(function(entry) { return entry.text; }).slice(0, 500);
}

// Gửi danh sách ký ức lên server khi có thay đổi; server tự bỏ qua mục không đổi
function syncSemanticIndex() {
  var payload = getSemanticPayload();
  var signature = JSON.stringify(payload);
  if (signature === semanticSyncedSignature) return Promise.resolve();
  return semanticApi('PUT', '/v1/items', { items: payload }).then(function() {
    semanticSyncedSignature = signature;
  }, function(err) {
    semanticRetryAt = Date.now() + 30000;   // server đang tắt: đừng gọi lại mỗi 3 giây
    throw err;
  });
}

// Bật/tắt tìm kiếm AI. Tắt thì xóa luôn dữ liệu đã gửi lên server.
function setAiSearch(on) {
  if (on && !isPro()) {
    showToast('Tìm kiếm AI là tính năng của gói Mastery');
    syncSettingsUI();
    showPage('pricing');
    return;
  }
  var wasOn = appSettings.aiSearch === true;
  appSettings.aiSearch = on;
  saveSettings();
  syncSettingsUI();
  if (on) {
    showToast('✦ Đã bật tìm kiếm AI');
    if (document.getElementById('search-input').value.trim()) doAISearch();
    else { hideAIResult(); scheduleSemanticSync(); }
    return;
  }
  semanticState = { query: '', scores: null };
  semanticSyncedSignature = null;
  if (wasOn) semanticApi('PUT', '/v1/items', { items: [] }).catch(function() {});
  hideAIResult();
  renderDashboard();
  showToast('Đã tắt tìm kiếm AI');
}

// ===== THẺ ẨN =====
// Mỗi ký ức được AI gắn thêm vài từ khóa chủ đề không hiện trên thẻ (aiTags). Nhờ
// đó "Mô hình AIDA" tìm được bằng "marketing", "Lionel Messi" tìm được bằng "bóng đá".
let hiddenTagsBusy = false;
let hiddenTagsRetryAt = 0;

function textFingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h);
}

function fetchHiddenTags() {
  if (hiddenTagsBusy || Date.now() < hiddenTagsRetryAt) return;
  if (!isPro() || appSettings.aiSearch !== true) return;
  // những mục chưa có thẻ ẩn, hoặc nội dung đã đổi từ lần gắn trước
  const pending = baseMemoryItems.filter(function(i) {
    const text = getEmbedText(i);
    return i.savedAt && text && i.aiTagsFor !== textFingerprint(text);
  }).slice(0, 20);
  if (pending.length === 0) return;

  hiddenTagsBusy = true;
  const request = pending.map(function(i) { return { id: String(i.id), text: getEmbedText(i).slice(0, 600) }; });
  semanticApi('POST', '/v1/tags', { items: request }).then(function(data) {
    const tags = (data && data.tags) || {};
    // ghi vào bản mới nhất trong bộ nhớ, phòng khi popup vừa lưu thêm trong lúc chờ
    getStorageValue('mnemonics_items', [], function(stored) {
      (stored || []).forEach(function(item) {
        const asked = request.find(function(r) { return r.id === String(item.id); });
        if (!asked) return;
        item.aiTags = tags[asked.id] || [];
        item.aiTagsFor = textFingerprint(getEmbedText(item));
      });
      setStorageValues({ mnemonics_items: stored || [] }, function() {
        hiddenTagsBusy = false;
        loadFromExtension(fetchHiddenTags);     // còn mục chờ thì làm đợt kế
      });
    });
  }, function() {
    hiddenTagsBusy = false;
    hiddenTagsRetryAt = Date.now() + 60000;     // AI đang bận: thử lại sau một phút
  });
}

function scheduleSemanticSync() {
  if (!isPro() || appSettings.aiSearch !== true) return;
  if (Date.now() < semanticRetryAt) return;
  clearTimeout(semanticSyncTimeout);
  semanticSyncTimeout = setTimeout(function() { syncSemanticIndex().then(fetchHiddenTags).catch(function() {}); }, 1000);
}

// ===== SYNC VỚI EXTENSION VÀ CLOUD DATABASE =====
var isLoadingFromDb = false;

function areItemsIdentical(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (String(a[i].id) !== String(b[i].id)) return false;
    if (Boolean(a[i].pinned || a[i].isFavorite) !== Boolean(b[i].pinned || b[i].isFavorite)) return false;
    if (a[i].type !== b[i].type) return false;
    if (a[i].title !== b[i].title) return false;
    if (a[i].imageUrl !== b[i].imageUrl) return false;
    if (a[i].note !== b[i].note) return false;
    if (a[i].quote !== b[i].quote) return false;
    if (a[i].savedAt !== b[i].savedAt) return false;
    if (a[i].date !== b[i].date) return false;
  }
  return true;
}

function formatItemRelativeDate(isoStr) {
  if (!isoStr) return 'Vừa xong';
  var d = new Date(isoStr);
  if (isNaN(d.getTime())) return 'Vừa xong';
  var now = new Date();
  var diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) diffMs = 0;
  var diffMins = Math.floor(diffMs / 60000);
  var diffHours = Math.floor(diffMins / 60);
  var diffDays = Math.floor(diffHours / 24);

  if (diffMins < 120) return 'Vừa xong';
  if (d.toDateString() === now.toDateString()) return 'Hôm nay';
  if (diffDays === 1 || (diffHours < 36 && d.getDate() === now.getDate() - 1)) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN');
}

function inferItemType(row) {
  var kind = String(row.kind || row.type || '').toLowerCase();
  var tags = (row.tags || []).map(function(t) { return String(t).toLowerCase(); });
  var title = String(row.title || '').toLowerCase();
  var text = String(row.raw_text || row.ocr_text || row.note || '').trim();
  var hasImage = Boolean(row.image_url || row.imageUrl);
  var hasUrl = Boolean(row.source_url || row.sourceUrl);

  // 1. Explicit screenshot or image with screenshot keywords
  if (kind === 'screenshot' || tags.includes('ảnh chụp') || tags.includes('screenshot') || title.includes('vùng cắt') || title.includes('ảnh chụp')) {
    if (hasImage) return 'screenshot';
  }

  // 2. Explicit image or any row with an image url
  if (kind === 'image' || tags.includes('cảm hứng') || tags.includes('hình ảnh') || tags.includes('image') || tags.includes('ảnh') || hasImage) {
    return 'image';
  }

  // 3. Explicit file / document
  if (kind === 'file' || kind === 'document' || tags.includes('tệp') || tags.includes('file')) {
    return 'file';
  }

  // 4. Code snippet
  if (kind === 'code' || tags.includes('code') || tags.includes('mã nguồn')) {
    return 'code';
  }

  // 5. Link: explicit link kind, or url present with no raw text (or text is just url)
  if (kind === 'link' || tags.includes('link') || tags.includes('liên kết')) {
    return 'link';
  }
  if (hasUrl && (!text || text === row.source_url || text === row.title)) {
    return 'link';
  }

  // 6. Quote (Trích dẫn):
  // - explicitly tagged as 'trích dẫn' / 'quote'
  // - or title indicates quote ('đoạn trích', 'trích dẫn')
  // - or saved with a sourceUrl and text length <= 1500 chars (standard web selection capture!)
  if (tags.includes('trích dẫn') || tags.includes('quote') || tags.includes('trich dan') || /trích dẫn|đoạn trích/i.test(title)) {
    return 'quote';
  }
  if (hasUrl && text.length > 0 && text.length <= 1500) {
    return 'quote';
  }

  // 7. Article (Bài viết): longer text saved from web
  if (hasUrl && text.length > 1500) {
    return 'article';
  }

  // 8. If text has checklist or explicitly tagged as note / no sourceUrl
  if (tags.includes('ghi chú') || tags.includes('note') || !hasUrl) {
    return 'note';
  }

  return 'quote';
}

function loadFromExtension(cb) {
  getStorageValue('mnemonics_session', null, async function(session) {
    var token = session && session.accessToken;
    if (token) {
      if (isLoadingFromDb) return;
      isLoadingFromDb = true;
      try {
        var res = await fetch(MNEMONICS_API + '/api/v1/items?limit=100', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (res.status === 401 && session.refreshToken) {
          var refRes = await fetch(MNEMONICS_API + '/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: session.refreshToken })
          });
          if (refRes.ok) {
            var refData = await refRes.json();
            if (refData && refData.data && refData.data.session) {
              session.accessToken = refData.data.session.accessToken;
              token = session.accessToken;
              setStorageValues({ mnemonics_session: session });
              res = await fetch(MNEMONICS_API + '/api/v1/items?limit=100', {
                headers: { Authorization: 'Bearer ' + token }
              });
            }
          }
        }

        if (res.ok) {
          var body = await res.json();
          var rows = (body.data && body.data.items) || [];
          var mapped = rows.map(function(row) {
            var type = inferItemType(row);
            var note = row.raw_text || row.ocr_text || '';
            var dateStr = formatItemRelativeDate(row.created_at || row.captured_at);
            return {
              id: row.id,
              title: row.title || (type === 'quote' ? 'Trích dẫn' : 'Không có tiêu đề'),
              note: note,
              quote: type === 'quote' ? (note || row.title || '') : undefined,
              excerpt: note.slice(0, 200),
              type: type,
              sourceUrl: row.source_url || '',
              url: (row.source_url || '').replace(/^https?:\/\//, '').slice(0, 80),
              tags: row.tags || (type === 'link' ? ['link'] : (type === 'quote' ? ['trích dẫn'] : [])),
              imageUrl: row.image_url || '',
              isFavorite: Boolean(row.is_favorite),
              pinned: Boolean(row.is_favorite),
              savedAt: row.created_at || row.captured_at || new Date().toISOString(),
              date: dateStr,
              space: (row.space && row.space !== 'Tất cả') ? row.space : (type === 'quote' ? 'Trích dẫn' : (type === 'link' ? 'Liên kết' : (type === 'screenshot' || type === 'image' ? 'Mới lưu' : 'Tất cả')))
            };
          });

          if (!areItemsIdentical(mapped, baseMemoryItems)) {
            baseMemoryItems = mapped;
            refreshDashboardItems();
          }
          isLoadingFromDb = false;
          if (cb) cb();
          return;
        }
      } catch (e) {
        console.warn('[Mnemonics] Error loading from DB API:', e);
      }
      isLoadingFromDb = false;
    }

    // Fallback: local storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('mnemonics_items', function(r) {
        const ext = r.mnemonics_items || [];
        if (!areItemsIdentical(ext, baseMemoryItems)) {
          baseMemoryItems = ext.length > 0 ? [...ext] : [];
          refreshDashboardItems();
        }
        if (cb) cb();
      });
    } else {
      const ext = JSON.parse(localStorage.getItem('mnemonics_items') || '[]');
      if (!areItemsIdentical(ext, baseMemoryItems)) {
        baseMemoryItems = ext.length > 0 ? [...ext] : [];
        refreshDashboardItems();
      }
      if (cb) cb();
    }
  });
}

// Lắng nghe khi extension popup lưu item mới → reload ngay
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === 'ACCOUNT_CHANGED') {
      loadAuthState(function() {
        loadReminders(function() { loadFromExtension(); });
      });
      return;
    }
    if (msg.type === 'RELOAD_ITEMS' || msg.type === 'ITEM_SAVED') {
      loadFromExtension();
    }
  });
}

// Fallback: poll mỗi 60 giây (1 phút) kiểm tra sync ngầm, chỉ re-render khi có thay đổi thực sự
setInterval(loadFromExtension, 60000);

// Gói miễn phí thấy thêm mình đã dùng bao nhiêu trong hạn mức tháng
function countText(shown) {
  var text = shown + ' ký ức đã lưu.';
  if (!isPro()) text += ' Tháng này: ' + mnemonicsSavedThisMonth(baseMemoryItems) + '/' + MNEMONICS_FREE_MONTHLY_LIMIT + ' (gói miễn phí).';
  return text;
}

function updateCount() {
  const el = document.getElementById('item-count');
  if (el) el.textContent = countText(items.length);
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
function renderCards(data, query) {
  const container = document.getElementById('cards-container');
  const clusterBar = document.getElementById('topic-cluster-bar');
  document.getElementById('item-count').textContent = countText(data.length);

  if (data.length === 0) {
    container.classList.remove('topic-clustered');
    container.classList.add('masonry');
    if (clusterBar) { clusterBar.hidden = true; clusterBar.innerHTML = ''; }
    container.innerHTML = `<div class="empty-state" style="column-span:all">
      <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="24" cy="24" r="20"/><path d="M16 20h16M16 28h10"/></svg>
      <h3>${items.length === 0 ? 'Chưa có ký ức nào' : 'Không tìm thấy kết quả'}</h3>
      <p>${items.length === 0 ? 'Bấm biểu tượng Mnemonics trên thanh công cụ khi đang xem một trang web, hoặc bấm nút + để thêm ký ức đầu tiên.' : 'Hãy thử từ khóa khác hoặc thêm ký ức mới'}</p>
    </div>`;
    return;
  }

  const clusters = query ? clusterSearchResults(data) : [];
  if (!clusters.length) {
    container.classList.remove('topic-clustered');
    container.classList.add('masonry');
    if (clusterBar) { clusterBar.hidden = true; clusterBar.innerHTML = ''; }
    container.innerHTML = data.map(cardHtml).join('');
    return;
  }

  if (topicClusterSelection.selectedId !== 'all' && !clusters.some(function(cluster) { return cluster.id === topicClusterSelection.selectedId; })) {
    topicClusterSelection.selectedId = 'all';
  }
  if (clusterBar) {
    clusterBar.hidden = false;
    clusterBar.innerHTML = `<div class="topic-cluster-heading"><b>${clusters.length} chủ đề</b><span>Nhóm tự động từ nội dung và thẻ của kết quả</span></div>
      <div class="topic-cluster-options">
        <button type="button" class="topic-cluster-chip ${topicClusterSelection.selectedId === 'all' ? 'active' : ''}" aria-pressed="${topicClusterSelection.selectedId === 'all'}" data-topic-cluster-id="all">Tất cả <span>${data.length}</span></button>
        ${clusters.map(function(cluster) {
          return `<button type="button" class="topic-cluster-chip ${topicClusterSelection.selectedId === cluster.id ? 'active' : ''}" aria-pressed="${topicClusterSelection.selectedId === cluster.id}" data-topic-cluster-id="${cluster.id}">${escapeHtml(cluster.label)} <span>${cluster.items.length}</span></button>`;
        }).join('')}
      </div>`;
  }

  container.classList.remove('masonry');
  container.classList.add('topic-clustered');
  const visibleClusters = topicClusterSelection.selectedId === 'all'
    ? clusters
    : clusters.filter(function(cluster) { return cluster.id === topicClusterSelection.selectedId; });
  const visibleCount = visibleClusters.reduce(function(total, cluster) { return total + cluster.items.length; }, 0);
  document.getElementById('item-count').textContent = countText(visibleCount);
  container.innerHTML = visibleClusters.map(function(cluster) {
    return `<section class="topic-cluster-section" aria-label="Chủ đề ${escapeHtml(cluster.label)}">
      <div class="topic-cluster-section-head"><h3>${escapeHtml(cluster.label)}</h3><span>${cluster.items.length} ký ức</span></div>
      <div class="masonry topic-cluster-cards">${cluster.items.map(cardHtml).join('')}</div>
    </section>`;
  }).join('');
}

function cardHtml(item) {
    const isNew = item.date === 'Vừa xong' || item.date === 'Hôm nay';
    const typeLabel = item.sourceType === 'reminder'
      ? (item.tags && item.tags.includes('biên bản họp') ? 'BIÊN BẢN HỌP' : 'TODO LIST')
      : {article:'BÀI VIẾT', image:'HÌNH ẢNH', note:'GHI CHÚ NHANH', quote:'TRÍCH DẪN', code:'MÃ NGUỒN', link:'LINK', file:'TỆP', screenshot:'ẢNH CHỤP MH'}[item.type] || 'MỤC LƯU';
    const typeClass = item.type;

    let body = '';
    if (item.type === 'quote') {
      body = `<div class="card-quote">${escapeHtml(item.quote || item.note || item.excerpt || '')}</div>`;
    } else if ((item.type === 'image' || item.type === 'screenshot') && item.imageUrl) {
      const imageTitle = escapeHtml(item.title || (item.type === 'screenshot' ? 'Ảnh chụp màn hình' : 'Ảnh đã lưu'));
      const imageSrc = escapeHtml(item.imageUrl);
      const pageSrc = escapeHtml(item.sourceUrl || item.sourcePageUrl || item.pageUrl || item.url || '');
      body = `<div class="card-image-wrap image-clickable" data-image-preview="${imageSrc}" data-image-title="${imageTitle}" data-page-url="${pageSrc}" title="Bấm để xem ảnh">
        <img src="${imageSrc}" alt="${imageTitle}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;display:block;">
        <div class="image-click-badge">${item.type === 'screenshot' ? 'Xem ảnh chụp' : 'Xem ảnh'}</div>
        ${item.title ? `<div class="card-title" style="margin-top:8px">${imageTitle}</div>` : ''}
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
      <div class="card-header">
        <span class="card-type ${typeClass}">${item.type==='code'?`<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="width:11px;height:11px"><path d="M4 4l-3 3 3 3M10 4l3 3-3 3M8 2l-2 10"/></svg> `:''}${typeLabel}</span>
        <div style="display:flex;gap:6px;align-items:center">${item.pinned ? '<span title="Đã ghim" style="font-size:12px">📌</span>' : ''}${isNew ? '<span style="background:#22c55e;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:0.5px">MỚI</span>' : ''}
          <div class="card-menu-wrap">
            <span class="card-menu" data-menuid="${item.id}">···</span>
            <div class="card-dropdown" id="dropdown-${item.id}">
              ${item.sourceType === 'reminder' ? '' : `<div class="card-dropdown-item" data-pinid="${item.id}">${item.pinned ? '📌 Bỏ ghim' : '📌 Ghim lên đầu'}</div>`}
              <div class="card-dropdown-item danger" data-deleteid="${item.id}">🗑 Xóa</div>
            </div>
          </div>
        </div>
      </div>
      ${body}
      ${item.type !== 'quote' ? `<div class="card-footer">
        <span class="card-date">${item.date || ''}</span>
        <span class="card-space">${item.space || ''}</span>
      </div>` : ''}
    </div>`;
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
    if (space.id === 'design-inspiration' && item.type === 'image') return true;
    if (space.id === 'tech-notes' && item.type === 'code') return true;
    return keywords.some(function(keyword) { return keyword && fields.includes(keyword); });
  });
}

function getSpaceCount(space) {
  const relatedCount = getSpaceItems(space).length;
  return relatedCount;
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
    const image = item.type === 'image' && item.imageUrl ? `<img class="space-item-thumb" src="${escapeHtml(item.imageUrl)}" data-image-preview="${escapeHtml(item.imageUrl)}" data-image-title="${escapeHtml(title)}" data-page-url="${escapeHtml(url)}" alt="${escapeHtml(title)}">` : `<div class="space-item-type-icon">${typeLabel.slice(0,1)}</div>`;
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
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('mnemonics_reminders', function(r) {
      if (Array.isArray(r.mnemonics_reminders)) {
        reminders = r.mnemonics_reminders;
        renderReminders();
        refreshDashboardItems();
        if (cb) cb();
      } else {
        reminders = DEFAULT_REMINDERS.map(cloneReminder);
        chrome.storage.local.set({ mnemonics_reminders: reminders }, function() {
          renderReminders();
          refreshDashboardItems();
          if (cb) cb();
        });
      }
    });
  } else {
    const raw = localStorage.getItem('mnemonics_reminders');
    if (raw) {
      try { reminders = JSON.parse(raw); } catch(e) { reminders = []; }
    } else {
      reminders = DEFAULT_REMINDERS.map(cloneReminder);
      localStorage.setItem('mnemonics_reminders', JSON.stringify(reminders));
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
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ mnemonics_reminders: reminders }, function() {
      refreshDashboardItems();
      if (cb) cb();
    });
  } else {
    localStorage.setItem('mnemonics_reminders', JSON.stringify(reminders));
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
  const q = query.toLowerCase();
  const safeQuery = escapeHtml(query);
  const keywordCount = items.filter(item => keywordMatch(item, q)).length;

  // Gói miễn phí chỉ tìm theo từ khóa
  if (!isPro()) {
    semanticState = { query: '', scores: null };
    showAIResult(`Tìm thấy <b>${keywordCount}</b> kết quả chứa "<b>${safeQuery}</b>". Tìm theo ý nghĩa bằng AI, kể cả khi không nhớ đúng từ khóa, là tính năng của gói <b>Mastery</b>.
      <div class="ai-consent-actions"><button class="settings-btn primary" data-open-pricing="1">Xem gói Mastery</button></div>`);
    return;
  }

  // Dãy số/mã định danh không biểu đạt chủ đề đáng tin cậy với embedding;
  // chỉ giữ các mục khớp chữ để AI không kéo thêm nội dung không liên quan.
  if (/^\d+$/.test(query)) {
    semanticState = { query: '', scores: null };
    renderDashboard();
    showAIResult(keywordCount
      ? `Tìm thấy <b>${keywordCount}</b> ký ức chứa "<b>${safeQuery}</b>". Truy vấn chỉ gồm số nên đang lọc theo khớp chữ chính xác.`
      : `Không tìm thấy ký ức nào chứa "<b>${safeQuery}</b>".`);
    return;
  }

  // Một từ rất ngắn thường có nhiều nghĩa và MPNet dễ xếp nhầm nội dung.
  // Nếu đã có khớp chữ trực tiếp, không thêm kết quả semantic yếu vào đó.
  const normalizedQuery = normalizeText(query).trim();
  if (keywordCount > 0 && /^[a-z0-9]{1,4}$/.test(normalizedQuery)) {
    semanticState = { query: '', scores: null };
    renderDashboard();
    showAIResult(`Tìm thấy <b>${keywordCount}</b> ký ức khớp với "<b>${safeQuery}</b>". Vì từ khóa ngắn, chỉ hiển thị các kết quả khớp trực tiếp để tránh thêm mục không liên quan.`);
    return;
  }

  // Chưa đồng ý thì không gửi gì lên server: chỉ tìm theo từ khóa và hỏi một lần
  if (appSettings.aiSearch !== true) {
    semanticState = { query: '', scores: null };
    if (appSettings.aiSearch === null) {
      showAIResult(`Tìm thấy <b>${keywordCount}</b> kết quả chứa "<b>${safeQuery}</b>". Bật <b>tìm kiếm AI</b> để tìm theo ý nghĩa, kể cả khi không nhớ đúng từ khóa?
        <div class="ai-consent-note">Khi bật, truy vấn tìm kiếm cùng tiêu đề, ghi chú và thẻ sẽ được tìm kiếm theo ý nghĩa qua Cloud API và pgvector. Bạn có thể tắt bất cứ lúc nào trong Cài đặt. <a href="${MNEMONICS_API}/privacy" target="_blank" rel="noopener">Chính sách quyền riêng tư</a></div>
        <div class="ai-consent-actions"><button class="settings-btn primary" data-ai-consent="on">Bật tìm kiếm AI</button><button class="settings-btn" data-ai-consent="off">Không, cảm ơn</button></div>`);
    } else {
      hideAIResult();
    }
    return;
  }

  try {
    const session = await new Promise(resolve => getStorageValue('mnemonics_session', null, resolve));
    const token = session && session.accessToken;
    if (token) {
      const searchRes = await fetch(MNEMONICS_API + '/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ q: query, limit: 50 })
      });
      if (searchRes.ok) {
        const body = await searchRes.json();
        const searchItems = (body.data && body.data.items) || [];
        if (document.getElementById('search-input').value.trim() !== query) return;

        const scores = {};
        searchItems.forEach((r, idx) => { scores[String(r.id)] = 1.0 - (idx * 0.01); });
        semanticState = { query: q, scores: scores };
        renderDashboard();

        const total = items.filter(item => keywordMatch(item, q) || scores[String(item.id)] !== undefined).length;
        if (total === 0) {
          showAIResult(`Không tìm thấy ký ức nào liên quan đến "<b>${safeQuery}</b>" trong Database.`);
        } else {
          showAIResult(`Tìm thấy <b>${total}</b> ký ức liên quan đến "<b>${safeQuery}</b>" từ Cloud Database.`);
        }
        return;
      }
    }
    semanticState = { query: '', scores: null };
    renderDashboard();
    if (keywordCount > 0) {
      showAIResult(`Tìm thấy <b>${keywordCount}</b> kết quả chứa "<b>${safeQuery}</b>" (khớp theo từ khóa).`);
    } else {
      showAIResult(`Không tìm thấy ký ức nào chứa "<b>${safeQuery}</b>".`);
    }
  } catch (e) {
    semanticState = { query: '', scores: null };
    if (keywordCount > 0) {
      showAIResult(`Tìm thấy <b>${keywordCount}</b> kết quả chứa "<b>${safeQuery}</b>" (khớp theo từ khóa).`);
    } else {
      showAIResult(`Không tìm thấy kết quả nào chứa "<b>${safeQuery}</b>".`);
    }
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
    if (!isPro() && mnemonicsSavedThisMonth(baseMemoryItems) >= MNEMONICS_FREE_MONTHLY_LIMIT) {
      closeModal();
      showToast('Gói miễn phí lưu tối đa ' + MNEMONICS_FREE_MONTHLY_LIMIT + ' ký ức mỗi tháng');
      showPage('pricing');
      return;
    }
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

    getStorageValue('mnemonics_session', null, async function(session) {
      var token = session && session.accessToken;
      if (token) {
        try {
          if (type === 'image' || type === 'screenshot') {
            if (modalFileData && window.uploadImageCapture) {
              await window.uploadImageCapture(modalFileData, {
                title: newItem.title,
                note: newItem.note,
                sourceUrl: newItem.sourceUrl,
                type: type
              }, token);
            }
          } else {
            var capRes = await fetch(MNEMONICS_API + '/api/v1/captures', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
              body: JSON.stringify({
                type: type === 'link' ? 'link' : 'text',
                title: newItem.title,
                sourceUrl: newItem.sourceUrl || undefined,
                selectedText: contentVal || undefined,
                clientRequestId: crypto.randomUUID()
              })
            });
            if (capRes.ok) {
              var capData = await capRes.json().catch(function() { return {}; });
              var itemId = capData && capData.data && capData.data.id;
              if (itemId && newItem.tags && newItem.tags.length) {
                fetch(MNEMONICS_API + '/api/v1/items/' + itemId, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                  body: JSON.stringify({ tags: newItem.tags })
                }).catch(function() {});
              }
            }
          }
        } catch (apiErr) {
          console.warn('[Mnemonics] Error saving to API:', apiErr);
        }
      }

      baseMemoryItems.unshift(newItem);
      items = composeDashboardItems();
      const toStore = baseMemoryItems.filter(i => i.savedAt);

      const done = function() {
        closeModal();
        renderDashboard();
        renderBookRail();
        showToast('✦ Đã lưu ký ức thành công!');
        if (token) setTimeout(loadFromExtension, 500);
      };

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ mnemonics_items: toStore }, done);
      } else {
        localStorage.setItem('mnemonics_items', JSON.stringify(toStore));
        done();
      }
    });
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
  notifRediscover: true,
  aiSearch: null      // null = chưa hỏi, true = đã đồng ý gửi nội dung lên server, false = từ chối
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
  var ai = document.getElementById('setting-ai-search');
  if (ai) ai.checked = isPro() && appSettings.aiSearch === true;
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
  var loggedIn = Boolean(currentUser && currentUser.email);
  if (nameEl) nameEl.textContent = loggedIn ? (currentUser.name || currentUser.email) : 'Khách';
  if (emailEl) emailEl.textContent = loggedIn ? currentUser.email : 'Chưa đăng nhập';
  if (btnEl) btnEl.textContent = loggedIn ? 'Đăng xuất' : 'Đăng nhập';
  var avatarBtn = document.getElementById('btn-avatar-change');
  var avatarRemove = document.getElementById('btn-avatar-remove');
  var avatarHint = document.getElementById('settings-avatar-hint');
  if (avatarBtn) avatarBtn.disabled = !loggedIn;
  if (avatarRemove) avatarRemove.style.display = loggedIn && currentUser.avatar ? '' : 'none';
  if (avatarHint) avatarHint.textContent = loggedIn ? 'Ảnh JPG hoặc PNG, tự cắt vuông. Chỉ lưu trên máy này.' : 'Đăng nhập để đặt ảnh đại diện.';
  updateAuthUI();
}

// ---- Data export / import / clear ----
function exportData() {
  getStorageValue('mnemonics_items', [], function(savedItems) {
    getStorageValue('mnemonics_reminders', [], function(rem) {
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
      var values = { mnemonics_items: newItems };
      if (Array.isArray(data.reminders)) values.mnemonics_reminders = data.reminders;
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
  setStorageValues({ mnemonics_items: [], mnemonics_reminders: [] }, function() {
    baseMemoryItems = [...SAMPLE_ITEMS];
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

  var topicClusterBar = document.getElementById('topic-cluster-bar');
  if (topicClusterBar) topicClusterBar.addEventListener('click', function(e) {
    var chip = e.target.closest('[data-topic-cluster-id]');
    if (!chip) return;
    topicClusterSelection.selectedId = chip.dataset.topicClusterId || 'all';
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

  // ---- Khám phá lại ----
  var sidebarSerendipity = document.getElementById('sidebar-serendipity');
  if (sidebarSerendipity) sidebarSerendipity.addEventListener('click', openSerendipity);
  var serNext = document.getElementById('btn-serendipity-next');
  if (serNext) serNext.addEventListener('click', nextSerendipity);
  var serClose = document.getElementById('btn-serendipity-close');
  if (serClose) serClose.addEventListener('click', closeSerendipity);
  var serPin = document.getElementById('btn-serendipity-pin');
  if (serPin) serPin.addEventListener('click', function() {
    var item = currentSerendipityItem();
    if (item) togglePin(item.id);
  });
  var serDelete = document.getElementById('btn-serendipity-delete');
  if (serDelete) serDelete.addEventListener('click', function() {
    var item = currentSerendipityItem();
    if (!item) return;
    deleteItem(item.id);
    renderSerendipity();
  });

  // ---- Settings: avatar ----
  var avatarChange = document.getElementById('btn-avatar-change');
  var avatarInput = document.getElementById('avatar-file-input');
  if (avatarChange && avatarInput) {
    avatarChange.addEventListener('click', function() { avatarInput.click(); });
    avatarInput.addEventListener('change', function() { handleAvatarFile(this.files[0]); this.value = ''; });
  }
  var avatarRemoveBtn = document.getElementById('btn-avatar-remove');
  if (avatarRemoveBtn) avatarRemoveBtn.addEventListener('click', function() { saveAvatar(null); });

  // ---- Settings: AI search ----
  var aiSearchToggle = document.getElementById('setting-ai-search');
  if (aiSearchToggle) aiSearchToggle.addEventListener('change', function() { setAiSearch(this.checked); });

  // Nút đồng ý / từ chối hiện ngay trong ô kết quả AI
  var aiResultBox = document.getElementById('ai-result');
  if (aiResultBox) aiResultBox.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-ai-consent]');
    if (btn) setAiSearch(btn.dataset.aiConsent === 'on');
    if (e.target.closest('[data-open-pricing]')) showPage('pricing');
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
  if (upgradeBtn) upgradeBtn.addEventListener('click', function() {
    if (isPro()) openPayModal();
    else showPage('pricing');
  });
  var aiLock = document.getElementById('setting-ai-lock');
  if (aiLock) aiLock.addEventListener('click', function() { showPage('pricing'); });

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
  if (btnUpgrade) btnUpgrade.addEventListener('click', openPayModal);

  // ---- Thanh toán & mã kích hoạt ----
  var payClose = document.getElementById('btn-pay-close');
  if (payClose) payClose.addEventListener('click', closePayModal);
  var payActivate = document.getElementById('btn-pay-activate');
  if (payActivate) payActivate.addEventListener('click', submitActivationCode);
  var payLogin = document.getElementById('btn-pay-login');
  if (payLogin) payLogin.addEventListener('click', function() { closePayModal(); showPage('login'); });
  document.querySelectorAll('#pay-plan-toggle button').forEach(function(b) {
    b.addEventListener('click', function() { selectPayPlan(this.dataset.plan); });
  });
  var payQr = document.getElementById('pay-qr');
  if (payQr) payQr.addEventListener('error', function() {
    this.style.display = 'none';
    document.getElementById('pay-qr-missing').style.display = '';
  });

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
    openUrlInNewTab(this.dataset.url);
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
    // Phiên đăng nhập đã được lưu; sau khi tải lại trang hãy mở lại dashboard
    // thay vì luôn để người dùng ở landing như thể họ đã bị đăng xuất.
    if (currentUser && currentUser.email) showPage('dashboard');
  });
  loadSettings(function() { syncSettingsUI(); });
  loadFromExtension();
  loadSpacePrefs();
  loadReminders();
  renderDashboard();
  renderSpaces();
  renderReminders();
  renderBookRail();
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

  // Bấm vào Ghim / Bỏ ghim
  var pinBtn = e.target.closest('[data-pinid]');
  if (pinBtn) {
    e.stopPropagation();
    togglePin(pinBtn.dataset.pinid);
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

// ===== GHIM LÊN ĐẦU =====
function persistItems(cb) {
  setStorageValues({ mnemonics_items: baseMemoryItems.filter(function(i) { return i.savedAt; }) }, cb);
}

function togglePin(id) {
  const target = baseMemoryItems.find(function(i) { return String(i.id) === String(id); });
  if (!target) return;
  target.pinned = !target.pinned;
  target.isFavorite = target.pinned;

  getStorageValue('mnemonics_session', null, function(session) {
    var token = session && session.accessToken;
    if (token) {
      fetch(MNEMONICS_API + '/api/v1/items/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ isFavorite: target.pinned })
      }).catch(function(e) { console.warn('[Mnemonics] patch favorite on API failed:', e); });
    }
  });

  items = composeDashboardItems();
  persistItems(function() {
    renderDashboard();
    if (serendipityQueue.length) renderSerendipity();
    showToast(target.pinned ? '📌 Đã ghim lên đầu' : 'Đã bỏ ghim');
  });
}

// ===== KHÁM PHÁ LẠI =====
// Đưa lại từng ký ức cũ, mỗi lần một cái, để người dùng gặp lại thứ đã quên.
let serendipityQueue = [];
let serendipityIndex = 0;

function openSerendipity() {
  const pool = items.filter(function(i) { return i.sourceType !== 'reminder'; });
  if (pool.length === 0) { showToast('Chưa có ký ức nào để khám phá lại'); return; }
  // ưu tiên thứ đã lưu hơn một tuần; chưa đủ thì lấy tất cả
  const weekAgo = Date.now() - 7 * 86400000;
  const old = pool.filter(function(i) { return getItemTimestamp(i) < weekAgo; });
  const source = old.length >= 3 ? old : pool;
  serendipityQueue = source.map(function(i) { return [Math.random(), i.id]; })
    .sort(function(a, b) { return a[0] - b[0]; })
    .map(function(pair) { return pair[1]; });
  serendipityIndex = 0;
  renderSerendipity();
  document.getElementById('serendipity-overlay').classList.add('open');
}

function closeSerendipity() {
  serendipityQueue = [];
  document.getElementById('serendipity-overlay').classList.remove('open');
}

function currentSerendipityItem() {
  // bỏ qua những mục đã bị xóa trong lúc đang xem
  while (serendipityIndex < serendipityQueue.length) {
    const id = serendipityQueue[serendipityIndex];
    const item = items.find(function(i) { return String(i.id) === String(id); });
    if (item) return item;
    serendipityIndex++;
  }
  return null;
}

function renderSerendipity() {
  const item = currentSerendipityItem();
  const slot = document.getElementById('serendipity-card');
  const meta = document.getElementById('serendipity-meta');
  const pin = document.getElementById('btn-serendipity-pin');
  const done = !item;
  ['btn-serendipity-pin', 'btn-serendipity-delete', 'btn-serendipity-next'].forEach(function(id) {
    document.getElementById(id).style.display = done ? 'none' : '';
  });
  if (done) {
    meta.textContent = 'Hết rồi';
    slot.innerHTML = '<div class="serendipity-done">Bạn đã xem hết lượt này. Quay lại sau để gặp lại những ký ức khác.</div>';
    return;
  }
  const days = Math.floor((Date.now() - getItemTimestamp(item)) / 86400000);
  const when = !getItemTimestamp(item) ? '' : (days <= 0 ? ' · lưu hôm nay' : ' · lưu ' + days + ' ngày trước');
  meta.textContent = (serendipityIndex + 1) + '/' + serendipityQueue.length + when;
  slot.innerHTML = cardHtml(item);
  pin.textContent = item.pinned ? '📌 Bỏ ghim' : '📌 Ghim lên đầu';
}

function nextSerendipity() {
  serendipityIndex++;
  renderSerendipity();
}

// ===== DELETE ITEM =====
function deleteItem(id) {
  const target = items.find(function(i) { return String(i.id) === String(id); });
  if (target && target.sourceType === 'reminder') {
    deleteReminder(target.reminderId);
    return;
  }

  getStorageValue('mnemonics_session', null, function(session) {
    var token = session && session.accessToken;
    if (token) {
      fetch(MNEMONICS_API + '/api/v1/items/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      }).catch(function(e) { console.warn('[Mnemonics] delete on API failed:', e); });
    }
  });

  baseMemoryItems = baseMemoryItems.filter(function(i) { return String(i.id) !== String(id); });
  items = composeDashboardItems();
  var toStore = baseMemoryItems.filter(function(i) { return i.savedAt; });
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ mnemonics_items: toStore }, function() {
      renderDashboard();
      showToast('🗑 Đã xóa ký ức');
    });
  } else {
    localStorage.setItem('mnemonics_items', JSON.stringify(toStore));
    renderDashboard();
    showToast('🗑 Đã xóa ký ức');
  }
}
