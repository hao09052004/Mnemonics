// ===== DATA =====
// (Sample/demo data was removed in task 19 ? it confused users into thinking
// their items leaked across accounts.)
const SPACES_DATA = [
  {
    id: 'design-inspiration',
    icon: '??',
    name: 'DESIGN INSPIRATION',
    desc: 'Screenshots, palette swatches and UI patterns captured while browsing the web.',
    count: 42,
    keywords: ['inspiration','design','inspiration','design','ui','ux','image','image'],
    updatedAt: '2026-06-25T08:00:00.000Z'
  },
  {
    id: 'tech-notes',
    icon: '??',
    name: 'TECH NOTES',
    desc: 'Articles, snippets and tech news saved while reading online.',
    count: 128,
    keywords: ['tech','tech','code','css','frontend','backend','spatial','hci'],
    updatedAt: '2026-06-24T10:00:00.000Z'
  },
  {
    id: 'japan-trip',
    icon: '??',
    name: 'JAPAN TRIP 2024',
    desc: 'Flight itineraries, hotel bookings and places on the to-visit list.',
    count: 15,
    keywords: ['japan','japan','trip','travel','trip','hotel','itinerary'],
    updatedAt: '2026-06-20T10:00:00.000Z'
  },
  {
    id: 'study-materials',
    icon: '??',
    name: 'STUDY MATERIALS',
    desc: 'Research articles, highlights from textbooks and study notes.',
    count: 89,
    keywords: ['study','materials','research','research','article','study','book'],
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
    title: 'Prep meeting: System architecture',
    tasks: [
      { text: 'Review caching strategy for offline mode', done: false },
      { text: 'Discuss WebSockets vs SSE', done: true },
      { text: 'Check API rate limits on the new endpoints', done: false }
    ],
    date: 'Yesterday',
    space: 'Work',
    createdAt: new Date().toISOString()
  },
  {
    id: 'sample-todo-1',
    kind: 'todo',
    title: 'Today\'s todo list',
    tasks: [
      { text: 'Review all items saved this week', done: false },
      { text: 'Tag important notes', done: false },
      { text: 'Review 2 items that need revisiting', done: true }
    ],
    date: 'Today',
    space: 'Study',
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
let serverSearchResults = null;
let searchRequestEpoch = 0;

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

function showVerificationBanner() {
  var banner = document.getElementById('settings-verify-banner');
  if (!banner) return;
  var verified = !!(currentUser && currentUser.emailVerified);
  var loggedIn = !!(typeof currentUser === 'object' && currentUser && currentUser.email);
  banner.style.display = (loggedIn && !verified) ? 'flex' : 'none';
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
  showVerificationBanner();
}

function loadAuthState(cb) {
  getStorageValue('mnemonics_session', null, function(session) {
    currentUser = session && session.user && session.accessToken ? session.user : null;
    updateAuthUI();
    // If the user is already signed in when the dashboard opens, skip
    // the marketing landing page entirely ? landing is only meaningful
    // for first-time / logged-out visitors. Otherwise we'd render
    // "Get started for free" while the avatar pill in the header is
    // already showing the logged-in user, which is contradictory.
    if (currentUser) {
      const activePage = document.querySelector('.page.active');
      const landingPage = document.getElementById('page-landing');
      if (activePage === landingPage) {
        showPage('dashboard');
      }
    }
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
  const response = await fetch((typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : 'http://localhost:4000') + '/api/v1/auth/' + path, {
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
    throw new Error(payload.error && payload.error.message ? payload.error.message : 'Authentication failed.');
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
    setAuthError('signup-error', 'Please fill in all fields.');
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setAuthError('signup-error', 'Email is not in a valid format.');
    return;
  }
  if (
    password.length < 10 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    setAuthError('signup-error', 'Password must be at least 10 chars with upper/lower/digit/symbol.');
    return;
  }
  if (password !== confirm) {
    setAuthError('signup-error', 'Password confirmation does not match.');
    return;
  }

  try {
    const data = await authRequest('register', { name, email, password });
    if (!data.session) throw new Error('Account created ? please confirm your email before signing in.');
    saveSession({ ...data.session, user: data.user }, function() {
      showToast('Mnemonics account created');
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
    setAuthError('login-error', 'Please enter email and password.');
    return;
  }

  try {
    const data = await authRequest('login', { email, password });
    saveSession({ ...data.session, user: data.user }, function() {
      showToast('Signed in');
      loadFromExtension(function() { showPage('dashboard'); });
    });
  } catch (error) {
    setAuthError('login-error', error.message);
  }
}

async function handleForgotPassword() {
  var emailInput = document.getElementById('forgot-email');
  var errEl = document.getElementById('forgot-error');
  var succEl = document.getElementById('forgot-success');
  var submitBtn = document.getElementById('btn-forgot-submit');
  if (!emailInput || !errEl || !succEl || !submitBtn) return;

  var email = normalizeEmail(emailInput.value);
  if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }
  if (succEl) { succEl.classList.remove('show'); succEl.textContent = ''; }

  if (!email) {
    errEl.textContent = 'Vui lòng nhập email để khôi phục mật khẩu.';
    errEl.classList.add('show');
    return;
  }
  // Light client-side email shape check; the server is the source of truth.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Email chưa đúng định dạng.';
    errEl.classList.add('show');
    return;
  }

  submitBtn.disabled = true;
  var originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'ĐANG GỬI...';
  try {
    var apiBase = (typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : 'http://localhost:4000');
    var response = await fetch(apiBase + '/api/v1/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      throw new Error(body.error && body.error.message ? body.error.message : 'Kh\u00f4ng th\u1ec3 g\u1eedi y\u00eau c\u1ea7u.');
    }
    succEl.textContent = 'Đã gửi yêu cầu khôi phục mật khẩu. Vui lòng kiểm tra hộp thư của bạn (kể cả thư mục spam).';
    succEl.classList.add('show');
    emailInput.value = '';
  } catch (error) {
    errEl.textContent = error.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    errEl.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}

function openForgotResetStep(prefill) {
  var stepRequest = document.getElementById('forgot-step-request');
  var stepReset = document.getElementById('forgot-step-reset');
  var titleEl = document.getElementById('forgot-modal-title');
  var errEl = document.getElementById('forgot-error');
  var succEl = document.getElementById('forgot-success');
  if (stepRequest) stepRequest.style.display = 'none';
  if (stepReset) stepReset.style.display = 'block';
  if (titleEl) titleEl.textContent = '🔑 Đặt lại mật khẩu';
  if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }
  if (succEl) { succEl.classList.remove('show'); succEl.textContent = ''; }
  var urlInput = document.getElementById('forgot-reset-url');
  if (urlInput && prefill && prefill.url) urlInput.value = prefill.url;
  var accInput = document.getElementById('forgot-access-token');
  if (accInput && prefill && prefill.accessToken) accInput.value = prefill.accessToken;
  var refInput = document.getElementById('forgot-refresh-token');
  if (refInput && prefill && prefill.refreshToken) refInput.value = prefill.refreshToken;
}

function extractTokensFromResetUrl(url) {
  if (!url) return null;
  try {
    var hashIdx = url.indexOf('#');
    var searchIdx = url.indexOf('?');
    var target = null;
    if (hashIdx >= 0) {
      // Supabase recovery links put tokens in the hash fragment.
      target = url.substring(hashIdx + 1);
    } else if (searchIdx >= 0) {
      target = url.substring(searchIdx + 1);
    } else {
      return null;
    }
    var pairs = target.split('&');
    var out = {};
    pairs.forEach(function(pair) {
      var eq = pair.indexOf('=');
      if (eq < 0) return;
      var k = decodeURIComponent(pair.substring(0, eq));
      var v = decodeURIComponent(pair.substring(eq + 1));
      out[k] = v;
    });
    if (out.access_token || out.refresh_token) {
      return { accessToken: out.access_token || '', refreshToken: out.refresh_token || '' };
    }
  } catch (e) { /* fall through */ }
  return null;
}

function validatePasswordShape(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Mật khẩu phải có ít nhất 10 ký tự.';
  }
  if (!/[a-z]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ thường.';
  if (!/[A-Z]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ hoa.';
  if (!/[0-9]/.test(password)) return 'Mật khẩu cần ít nhất 1 chữ số.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Mật khẩu cần ít nhất 1 ký hiệu đặc biệt.';
  return null;
}

async function handleForgotResetSubmit() {
  var errEl = document.getElementById('forgot-error');
  var succEl = document.getElementById('forgot-success');
  var submitBtn = document.getElementById('btn-forgot-reset-submit');
  if (!errEl || !succEl || !submitBtn) return;

  errEl.classList.remove('show'); errEl.textContent = '';
  succEl.classList.remove('show'); succEl.textContent = '';

  var urlInput = document.getElementById('forgot-reset-url');
  var accessInput = document.getElementById('forgot-access-token');
  var refreshInput = document.getElementById('forgot-refresh-token');
  var newPwInput = document.getElementById('forgot-new-password');
  var confirmInput = document.getElementById('forgot-new-password-confirm');

  var accessToken = (accessInput && accessInput.value) ? accessInput.value.trim() : '';
  var refreshToken = (refreshInput && refreshInput.value) ? refreshInput.value.trim() : '';

  // If a full URL was pasted, try to extract tokens from it.
  if ((!accessToken || !refreshToken) && urlInput && urlInput.value) {
    var extracted = extractTokensFromResetUrl(urlInput.value.trim());
    if (extracted) {
      accessToken = accessToken || extracted.accessToken;
      refreshToken = refreshToken || extracted.refreshToken;
      if (accessInput) accessInput.value = accessToken;
      if (refreshInput) refreshInput.value = refreshToken;
    }
  }

  var newPassword = newPwInput ? newPwInput.value : '';
  var confirmPassword = confirmInput ? confirmInput.value : '';

  if (!accessToken || !refreshToken) {
    errEl.textContent = 'Cần có access token và refresh token (dán link khôi phục hoặc nhập tay).';
    errEl.classList.add('show');
    return;
  }
  if (newPassword !== confirmPassword) {
    errEl.textContent = 'Mật khẩu nhập lại không khớp.';
    errEl.classList.add('show');
    return;
  }
  var pwError = validatePasswordShape(newPassword);
  if (pwError) {
    errEl.textContent = pwError;
    errEl.classList.add('show');
    return;
  }

  submitBtn.disabled = true;
  var originalLabel = submitBtn.textContent;
  submitBtn.textContent = 'ĐANG ĐẶT LẠI...';
  try {
    var apiBase = (typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : 'http://localhost:4000');
    var response = await fetch(apiBase + '/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: accessToken,
        refreshToken: refreshToken,
        newPassword: newPassword
      })
    });
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      throw new Error(body.error && body.error.message ? body.error.message : 'Không thể đặt lại mật khẩu.');
    }
    var data = body.data || {};
    if (data.session && data.user) {
      saveSession({ ...data.session, user: data.user }, function() {
        showToast('Mật khẩu đã được đặt lại');
        var forgotModal = document.getElementById('forgot-modal');
        if (forgotModal) forgotModal.classList.remove('open');
        loadFromExtension(function() { showPage('dashboard'); });
      });
    } else {
      succEl.textContent = 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.';
      succEl.classList.add('show');
      var forgotModal = document.getElementById('forgot-modal');
      setTimeout(function() {
        if (forgotModal) forgotModal.classList.remove('open');
        showPage('login');
      }, 1500);
    }
  } catch (error) {
    errEl.textContent = error.message || 'Có lỗi xảy ra, vui lòng thử lại.';
    errEl.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}

async function handleResendVerification() {
  var btn = document.getElementById('btn-resend-verification');
  if (!btn) return;
  var token = await getAccessToken();
  if (!token) {
    showToast('Bạn cần đăng nhập trước.');
    return;
  }
  btn.disabled = true;
  var originalLabel = btn.textContent;
  btn.textContent = 'ĐANG GỬI...';
  try {
    var apiBase = (typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : 'http://localhost:4000');
    var response = await fetch(apiBase + '/api/v1/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
    });
    if (response.status === 204 || response.ok) {
      showToast('Đã gửi lại email xác nhận. Vui lòng kiểm tra hộp thư.');
    } else {
      var body = await response.json().catch(function() { return {}; });
      throw new Error(body.error && body.error.message ? body.error.message : 'Không thể gửi lại email.');
    }
  } catch (error) {
    showToast(error.message || 'Có lỗi xảy ra');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function handleRefreshAccount() {
  var btn = document.getElementById('settings-refresh-account');
  var nameEl = document.getElementById('settings-account-name');
  var emailEl = document.getElementById('settings-account-email');
  if (!btn) return;
  var token = await getAccessToken();
  if (!token) {
    showToast('Bạn cần đăng nhập trước.');
    return;
  }
  btn.disabled = true;
  var originalLabel = btn.textContent;
  btn.textContent = 'ĐANG TẢI...';
  try {
    var apiBase = (typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : 'http://localhost:4000');
    var response = await fetch(apiBase + '/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    });
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      // Token may have expired; try refresh once.
      var refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await fetch(apiBase + '/api/v1/auth/me', {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + refreshed }
        });
        body = await response.json().catch(function() { return {}; });
      }
      if (!response.ok) {
        throw new Error(body.error && body.error.message ? body.error.message : 'Không thể tải thông tin.');
      }
    }
    var user = body && body.data && body.data.user ? body.data.user : null;
    if (!user) throw new Error('Phản hồi từ server không hợp lệ.');
    currentUser = user;
    saveSession({ accessToken: token, refreshToken: readRefreshToken(), expiresAt: readAccessTokenExpires(), user: user }, function() {
      if (nameEl) nameEl.textContent = user.name || user.email;
      if (emailEl) emailEl.textContent = user.emailVerified ? user.email : (user.email + ' · chưa xác nhận');
    });
    showVerificationBanner();
    showToast('Đã đồng bộ thông tin tài khoản');
    showToast('Đã đồng bộ thông tin tài khoản');
  } catch (error) {
    showToast(error.message || 'Có lỗi xảy ra');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function readRefreshToken() {
  try {
    var raw = localStorage.getItem('mnemonics_session');
    if (raw) {
      var sess = JSON.parse(raw);
      if (sess && sess.refreshToken) return sess.refreshToken;
    }
  } catch (e) {}
  return null;
}

function readAccessTokenExpires() {
  try {
    var raw = localStorage.getItem('mnemonics_session');
    if (raw) {
      var sess = JSON.parse(raw);
      if (sess && sess.expiresAt) return sess.expiresAt;
    }
  } catch (e) {}
  return null;
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
    showToast('Signed out');
    showPage('landing');
  });
}

// Demo login helper used by the optional "auth-demo-login" button.
// In production we don't ship demo credentials ? this is a no-op fallback so
// the listener at `DOMContentLoaded` doesn't throw `ReferenceError`.
async function loginDemoUser() {
  try {
    var data = await authRequest('login', {
      email: 'demo@mnemonics.local',
      password: 'DemoPass123!'
    });
    saveSession({ ...data.session, user: data.user }, function() {
      showToast('Demo account signed in');
      loadFromExtension(function() { showPage('dashboard'); });
    });
  } catch (error) {
    setAuthError('login-error', error.message || 'Demo login failed');
  }
}

// `readAccessToken` is provided by api-client.js (loaded before this
// file). Use that one so the popup and dashboard share the same logic.

async function silentRefresh(refreshToken) {
  try {
    const data = await authRequest('refresh', { refreshToken });
    if (data && data.session) {
      saveSession({ ...data.session, user: data.user || currentUser }, function() {
        showToast('Session automatically renewed');
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
// When the user clicks the heart on a card and lands on the
// Favorites page (or toggles the chip), we filter the dashboard to
// only show memories with `isFavorite === true`. Other filters
// (format, time) still apply on top.
let currentFavoritesOnly = false;
let currentTimeFilter = 'all';

// Classify an item by format for filtering/sorting
function getItemFormat(item) {
  // Visual captures (uploaded images + cropped screenshots) share the same
  // Image tab ? splitting them would force users to click two tabs to find
  // what they just saved, which feels broken.
  if (item.type === 'image' || item.type === 'screenshot') return 'image';
  if (item.type === 'file') return 'file';
  if (item.type === 'link') return 'link';
  if (item.type === 'quote') return 'quote';
  return 'text';
}

// Get timestamp for an item so we can filter by day/month/year
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
    if (currentFavoritesOnly && !item.isFavorite) return false;
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

// Render cards with sort/filter and the current search query
function renderDashboard() {
  var searchVal = '';
  var searchEl = document.getElementById('search-input');
  if (searchEl) searchVal = searchEl.value.toLowerCase().trim();
  var base;
  if (searchVal && Array.isArray(serverSearchResults)) {
    base = serverSearchResults;
  } else {
    base = searchVal ? items.filter(function(i) { return getSearchText(i).includes(searchVal); }) : items;
  }
  renderCards(applySortFilter(base));
}

// ===== BOOK / COURSE SUGGESTIONS (collab) =====
const TOPIC_OPTIONS = [
  { id: 'marketing', label: 'Marketing', keywords: ['marketing','mkt','brand','brand','ads','ads','seo','content','customer','product','product'] },
  { id: 'design', label: 'Design', keywords: ['design','design','ui','ux','inspiration','inspiration','pattern','typography'] },
  { id: 'tech', label: 'Tech', keywords: ['tech','tech','code','css','frontend','backend','ai','spatial','hci'] },
  { id: 'business', label: 'Business', keywords: ['business','business','startup','startup','finance','finance','management'] },
  { id: 'psychology', label: 'Psychology', keywords: ['psychology','psychology','habit','habit','behavior','behavior'] },
  { id: 'productivity', label: 'Productivity', keywords: ['productivity','productivity','habit','note','study','study','focus'] },
  { id: 'language', label: 'Language', keywords: ['english','english','language','language','ielts','toeic'] },
  { id: 'writing', label: 'Writing', keywords: ['writing','writing','content','copywriting','storytelling'] }
];

const BOOK_CATALOG = {
  marketing: [
    { title: 'This Is Marketing', author: 'Seth Godin', badge: 'Book', color: '#5B3FE4', icon: '??' },
    { title: 'Contagious: Why Things Catch On', author: 'Jonah Berger', badge: 'Book', color: '#e0447a', icon: '??' },
    { title: 'Digital Marketing 4.0 course', author: 'Mnemonics Academy', badge: 'Course', color: '#f59e0b', icon: '??' }
  ],
  design: [
    { title: 'The Design of Everyday Things', author: 'Don Norman', badge: 'Book', color: '#0ea5e9', icon: '??' },
    { title: 'Refactoring UI', author: 'Wathan & Schoger', badge: 'Book', color: '#5B3FE4', icon: '??' },
    { title: 'UI/UX Design Foundations', author: 'Mnemonics Academy', badge: 'Course', color: '#10b981', icon: '??' }
  ],
  tech: [
    { title: 'Clean Code', author: 'Robert C. Martin', badge: 'Book', color: '#334155', icon: '??' },
    { title: 'Pragmatic Programmer', author: 'Hunt & Thomas', badge: 'Book', color: '#f59e0b', icon: '??' },
    { title: 'Frontend Masters Path', author: 'Mnemonics Academy', badge: 'Course', color: '#5B3FE4', icon: '??' }
  ],
  business: [
    { title: 'The Lean Startup', author: 'Eric Ries', badge: 'Book', color: '#0ea5e9', icon: '??' },
    { title: 'Zero to One', author: 'Peter Thiel', badge: 'Book', color: '#334155', icon: '??' },
    { title: 'Lean startup', author: 'Mnemonics Academy', badge: 'Course', color: '#e0447a', icon: '??' }
  ],
  psychology: [
    { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', badge: 'Book', color: '#5B3FE4', icon: '??' },
    { title: 'Atomic Habits', author: 'James Clear', badge: 'Book', color: '#10b981', icon: '??' },
    { title: 'Behavioral psychology', author: 'Mnemonics Academy', badge: 'Course', color: '#f59e0b', icon: '??' }
  ],
  productivity: [
    { title: 'Deep Work', author: 'Cal Newport', badge: 'Book', color: '#334155', icon: '??' },
    { title: 'Atomic Habits', author: 'James Clear', badge: 'Book', color: '#10b981', icon: '??' },
    { title: 'Master personal productivity', author: 'Mnemonics Academy', badge: 'Course', color: '#5B3FE4', icon: '??' }
  ],
  language: [
    { title: 'English Grammar in Use', author: 'Raymond Murphy', badge: 'Book', color: '#0ea5e9', icon: '??' },
    { title: 'Word Power Made Easy', author: 'Norman Lewis', badge: 'Book', color: '#e0447a', icon: '??' },
    { title: 'IELTS 7.0+ Roadmap', author: 'Mnemonics Academy', badge: 'Course', color: '#10b981', icon: '??' }
  ],
  writing: [
    { title: 'On Writing Well', author: 'William Zinsser', badge: 'Book', color: '#f59e0b', icon: '??' },
    { title: 'Everybody Writes', author: 'Ann Handley', badge: 'Book', color: '#5B3FE4', icon: '??' },
    { title: 'Content & Copywriting', author: 'Mnemonics Academy', badge: 'Course', color: '#e0447a', icon: '??' }
  ]
};

let userTopics = [];

// Infer topic of interest from saved items if user hasn't picked manually
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
      <div class="book-panel-eyebrow">? Suggested for you</div>
      <div class="book-panel-title">Featured books & courses</div>
      <div class="book-panel-topic">Based on interest: <b>${escapeHtml(topic.label)}</b></div>
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
      <label>Change topic</label>
      <div class="format-chips">
        ${otherTopics.map(function(t) {
          return `<div class="format-chip" data-book-topic="${escapeHtml(t.id)}">${escapeHtml(t.label)}</div>`;
        }).join('')}
      </div>
    </div>
    <div class="book-panel-foot">Mnemonics partners with bookshops & learning platforms.<br>Pick a topic in <b>Settings</b> to personalize.</div>
  </div>`;
}

function reminderToMemoryItem(reminder) {
  const tasks = Array.isArray(reminder.tasks) ? reminder.tasks : [];
  const doneCount = tasks.filter(function(t) { return t.done; }).length;
  const totalCount = tasks.length;
  const kindLabel = reminder.kind === 'meeting' ? 'Meeting minutes' : 'Todo list';
  return {
    id: 'reminder-' + String(reminder.id),
    sourceType: 'reminder',
    reminderId: reminder.id,
    type: 'note',
    title: reminder.title || kindLabel,
    note: tasks.map(function(t) { return t.text; }).join('\n'),
    excerpt: `${kindLabel} ? ${doneCount}/${totalCount} done`,
    checks: tasks.map(function(t) { return { text: t.text, done: Boolean(t.done) }; }),
    tags: ['reminder', reminder.kind === 'meeting' ? 'meeting' : 'todo'],
    date: reminder.date || 'Today',
    space: reminder.space || 'Reminders',
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

// ===== SERVER-AUTHORITATIVE EXTENSION DATA =====
// Saved captures are loaded only from GET /api/v1/items. Per-user local
// capture keys are retained solely long enough to classify and discard
// explicitly pending legacy rows.
let apiRequestEpoch = 0;

function userCacheKey(uid) {
  return 'mnemonics_items_' + (uid || 'guest');
}

function userApiCacheKey(uid) {
  return 'mnemonics_api_items_' + (uid || 'guest');
}

function isPendingItem(item) {
  return item && item.pendingUpload === true;
}

function apiItemToLocalShape(item) {
  // Map server-side row to the local card shape. We keep `kind` and
  // `type` in sync (legacy code reads either) and pull text from
  // `raw_text`/`ocr_text` so snippet missing doesn't render empty.
  if (!item) return null;
  const kind = item.kind || item.type || 'text';
  const title = item.title || (kind === 'link' ? 'Saved link' : 'Saved item');
  return {
    id: item.id,
    kind,
    type: kind,
    title,
    excerpt: item.snippet || item.raw_text || item.ocr_text || '',
    note: item.raw_text || item.ocr_text || '',
    sourceUrl: item.source_url || '',
    url: item.source_url || '',
    imageUrl: item.image_url || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    capturedAt: item.captured_at || item.created_at || null,
    savedAt: item.captured_at || item.created_at || new Date().toISOString(),
    clientRequestId: item.client_request_id || null,
    date: 'Just now',
    space: '',
    status: item.status || null,
    isFavorite: item.is_favorite === true,
    serverSynced: true,
    pendingUpload: false
  };
}

async function fetchItemsFromApi(uid, accessToken, options) {
  if (!uid || !accessToken) return null;
  const silent = !!(options && options.silent);
  const epoch = ++apiRequestEpoch;

  async function request(token) {
    return fetch((typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : 'http://localhost:4000') + '/api/v1/items?limit=50', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    });
  }

  try {
    let token = accessToken;
    let response = await request(token);

    // Keep the dashboard usable across access-token expiry. The extension
    // auth client owns refresh-token persistence, so refresh exactly once
    // and retry the same read request before clearing the session.
    if (response.status === 401 && typeof refreshAccessToken === 'function') {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        token = refreshed;
        response = await request(token);
      }
    }

    if (response.status === 401) {
      // Silent polls (every 3s) must NOT log the user out — that would
      // create a flashing redirect loop where each refresh failure
      // bounces the dashboard back to the landing page. The next
      // explicit loadFromExtension call (after ITEM_SAVED or user
      // action) can still decide to clear the session.
      if (!silent) saveSession(null);
      return null;
    }
    if (!response.ok) return null;

    const json = await response.json().catch(() => null);
    if (!json || !json.data || !Array.isArray(json.data.items)) return null;
    if (epoch !== apiRequestEpoch) return null; // user switched accounts
    return json.data.items.map(apiItemToLocalShape).filter(Boolean);
  } catch (_) {
    return null;
  }
}

function getAccessTokenAsync() {
  return new Promise(function(resolve) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('mnemonics_session', function(r) {
        const session = r && r.mnemonics_session;
        if (!session || !session.accessToken) return resolve(null);
        resolve(session.accessToken);
      });
      return;
    }
    try {
      const raw = localStorage.getItem('mnemonics_session');
      if (!raw) return resolve(null);
      const parsed = JSON.parse(raw);
      resolve(parsed && parsed.accessToken ? parsed.accessToken : null);
    } catch (_) {
      resolve(null);
    }
  });
}

// `silent` = true on polling fetches so a transient error doesn't show
// the "Could not load saved memories" toast and kick the user out of
// the dashboard every 3 seconds. Initial loads (silent=false) still
// surface the error.
function loadFromExtension(cb, options) {
  const silent = !!(options && options.silent);
  const uid = currentUser && currentUser.id ? currentUser.id : 'guest';
  const itemsKey = userCacheKey(uid);
  const apiCacheKey = userApiCacheKey(uid);

  // Captures are server-authoritative. Local capture arrays are inspected
  // only to discard explicitly pending legacy rows; they are never rendered.
  return cleanupLegacyPendingCaptures(uid).then(function() {
    return getAccessTokenAsync();
  }).then(function(accessToken) {
    if (!accessToken) throw new Error('Sign in to load saved memories.');
    return fetchItemsFromApi(uid, accessToken, { silent: silent });
  }).then(function(serverItems) {
    if (!serverItems) throw new Error('Could not load saved memories.');
    baseMemoryItems = serverItems;
    refreshDashboardItems();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([itemsKey, apiCacheKey], function() {});
    } else {
      localStorage.removeItem(itemsKey);
      localStorage.removeItem(apiCacheKey);
    }
  }).catch(function(error) {
    // Silent polls (the 3-second background sync) shouldn't kick the
    // user out or spam toasts on every transient error. The dashboard
    // keeps whatever items it already had on screen.
    if (!silent) {
      baseMemoryItems = [];
      refreshDashboardItems();
      if (typeof showToast === 'function') showToast(error.message);
    }
  }).finally(function() {
    if (cb) cb();
  });
}

function discardExplicitPending(items) {
  return (Array.isArray(items) ? items : []).filter(function(item) {
    return !isPendingItem(item);
  });
}

function cleanupLegacyPendingCaptures(uid) {
  const key = userCacheKey(uid);
  return new Promise(function(resolve) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(key, function(result) {
        const existing = Array.isArray(result[key]) ? result[key] : [];
        const remaining = discardExplicitPending(existing);
        if (remaining.length === existing.length) return resolve(remaining);
        chrome.storage.local.set({ [key]: remaining }, function() { resolve(remaining); });
      });
      return;
    }
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const remaining = discardExplicitPending(existing);
    localStorage.setItem(key, JSON.stringify(remaining));
    resolve(remaining);
  });
}

function mergeServerItems(serverItems) {
  baseMemoryItems = serverItems || [];
  refreshDashboardItems();
}

// Listen for new items from the popup and reload
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.type === 'RELOAD_ITEMS' || msg.type === 'ITEM_SAVED') {
      loadFromExtension();
    }
  });
}

// Fallback: poll every 10 seconds to make sure we stay in sync, but
// skip the round-trip entirely while the tab is hidden — Chrome
// throttles background timers to 1/min anyway and a hidden dashboard
// doesn't need a refresh. Silent mode keeps transient errors from
// spamming toasts and from kicking the user back to the landing
// page mid-session.
function shouldSyncNow() {
  if (typeof document === 'undefined') return true;
  if (document.visibilityState !== 'visible') return false;
  // Don't fight the user: if they're actively scrolling or have the
  // search box focused, defer by a few seconds.
  if (window.__mnemonicsUserActive && Date.now() - window.__mnemonicsUserActive < 2500) {
    return false;
  }
  return true;
}

function scheduleSync() {
  if (window.__mnemonicsSyncScheduled) return;
  window.__mnemonicsSyncScheduled = setTimeout(function () {
    window.__mnemonicsSyncScheduled = null;
    if (!shouldSyncNow()) {
      scheduleSync();
      return;
    }
    loadFromExtension(null, { silent: true }).finally(scheduleSync);
  }, 10000);
}
scheduleSync();

if (typeof document !== 'undefined') {
  // Reset the active-window when the tab comes back so the next sync
  // fires immediately.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !window.__mnemonicsSyncScheduled) {
      scheduleSync();
    }
  });
  // Track user activity so we don't tear the DOM out from under their
  // scroll. `wheel` covers mouse + trackpad; `scroll` catches keyboard
  // page-up/page-down.
  ['wheel', 'scroll', 'touchstart', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      window.__mnemonicsUserActive = Date.now();
    }, { passive: true, capture: true });
  });
}

function updateCount() {
  const el = document.getElementById('item-count');
  if (el) el.textContent = items.length + ' memories saved this month.';
}

// Sync the favorites chip's visual state with `currentFavoritesOnly`.
// Called both from the chip handler and from the sidebar entry so the
// two entry points never disagree.
function updateFavoritesChip() {
  var chip = document.getElementById('favorites-chip');
  if (!chip) return;
  chip.classList.toggle('active', currentFavoritesOnly);
  chip.setAttribute('aria-pressed', currentFavoritesOnly ? 'true' : 'false');
}

// Exposed only for tests so the favorites-filter behaviour can be
// exercised without DOM side effects.
function setFavoritesOnlyForTests(value) {
  currentFavoritesOnly = !!value;
  updateFavoritesChip();
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


function requestRelatedItems(itemId, limit) {
  return new Promise(function(resolve, reject) {
    if (!itemId) {
      reject(new Error('Missing item id.'));
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('Related memories require the extension dashboard.'));
      return;
    }

    chrome.runtime.sendMessage(
      { type: 'GET_RELATED_ITEMS', itemId: itemId, limit: limit || 5 },
      function(response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Could not reach background sync.'));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || 'Could not load related memories.'));
          return;
        }
        resolve(Array.isArray(response.data) ? response.data : []);
      }
    );
  });
}

function relatedMemoriesHtml(item) {
  if (!item || !item.serverSynced || !item.id) return '';
  const itemId = escapeHtml(String(item.id));
  return '<div class="card-related-wrap">' +
    '<button type="button" class="related-btn" data-related-id="' + itemId + '">' +
      '↗ Related memories' +
    '</button>' +
    '<div class="related-results" data-related-results-for="' + itemId + '" hidden></div>' +
  '</div>';
}

async function loadRelatedMemories(button) {
  if (button.dataset.relatedLoaded === 'true') {
    hideRelatedMemories(button);
    return;
  }

  const itemId = button.dataset.relatedId;
  const results = document.querySelector('[data-related-results-for="' + CSS.escape(itemId) + '"]');
  if (!results) return;

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Loading related…';

  try {
    const related = await requestRelatedItems(itemId, 5);

    if (related.length === 0) {
      results.innerHTML = '<div class="related-empty">No strong semantic links yet.</div>';
    } else {
      results.innerHTML = related.map(function(item) {
        const similarity = Math.round(Number(item.similarity || 0) * 100);
        return '<button type="button" class="related-result" data-related-open-url="' +
          escapeHtml(String(item.id)) + '">' +
          '<span class="related-result-main">' +
            '<span class="related-result-title">' + escapeHtml(item.title || 'Untitled memory') + '</span>' +
            '<span class="related-result-meta">' + escapeHtml(String(item.type || 'item')) +
              ' · ' + similarity + '% similarity</span>' +
          '</span>' +
          '<span class="related-result-arrow">→</span>' +
        '</button>';
      }).join('');
    }

    results.hidden = false;
    button.textContent = '↗ Hide related memories';
    button.dataset.relatedLoaded = 'true';
  } catch (error) {
    results.innerHTML = '<div class="related-empty">' +
      escapeHtml(error && error.message ? error.message : 'Could not load related memories.') +
      '</div>';
    results.hidden = false;
    button.textContent = originalText;
  } finally {
    button.disabled = false;
  }
}

function hideRelatedMemories(button) {
  const itemId = button.dataset.relatedId;
  const results = document.querySelector('[data-related-results-for="' + CSS.escape(itemId) + '"]');
  if (!results) return;
  results.hidden = true;
  button.dataset.relatedLoaded = 'false';
  button.textContent = '↗ Related memories';
}

// ===== RENDER CARDS =====
function renderCards(data) {
  const container = document.getElementById('cards-container');
  document.getElementById('item-count').textContent = `${data.length} memories saved this month.`;

  // Build the "Sync to database" pill used by image/link/quote cards
  // that failed to upload the first time. Pass the matching payload
  // fields through data-* so the click handler can re-trigger the right
  // pipeline (image vs link vs text).
  function pendingBadgeHtml() { return ''; }

  if (data.length === 0) {
    if (currentFavoritesOnly) {
      container.innerHTML = `<div class="empty-state" style="column-span:all">
        <svg viewBox="0 0 48 48" fill="currentColor" stroke="currentColor" stroke-width="1.5" style="color:#ec4899"><path d="M24 42s-14-8-18-19c-2-5.5 2-12 8-12 3 0 5 1.5 6.5 3.5C22 12.5 24 11 27 11c6 0 10 6.5 8 12-4 11-11 19-11 19z"/></svg>
        <h3>Chưa có thẻ nhớ yêu thích</h3>
        <p>Click vào biểu tượng trái tim trên bất kỳ thẻ nhớ nào để thêm vào đây.</p>
      </div>`;
    } else {
      container.innerHTML = `<div class="empty-state" style="column-span:all">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="24" cy="24" r="20"/><path d="M16 20h16M16 28h10"/></svg>
        <h3>No results found</h3>
        <p>Try a different keyword or add a new memory</p>
      </div>`;
    }
    renderCards._lastSigs = null;
    return;
  }

  // ----- Smooth-scroll reconciliation --------------------------------
  // Re-rendering the entire cards container on every 3-second sync
  // wipes every <img> node, which forces the browser to re-download
  // already-loaded images and re-trigger fade-in transitions, causing
  // the visible "lag behind my scroll" jank. Instead we render once,
  // and on subsequent renders we keep the existing DOM nodes for cards
  // whose signature didn't change; only the cards that genuinely
  // mutated get their content swapped in. This makes the regular
  // background sync effectively free.
  const cardHtmls = data.map(item => {
    const isNew = item.date === 'Just now' || item.date === 'Today';
    const typeLabel = item.sourceType === 'reminder'
      ? (item.tags && item.tags.includes('meeting') ? 'MEETING MINUTES' : 'TODO LIST')
      : {article:'ARTICLE', image:'INSPIRATION', note:'QUICK NOTE', quote:'QUOTE', code:'CODE', link:'LINK', file:'FILE', screenshot:'SCREENSHOT'}[item.type] || 'ITEM';
    const typeClass = item.type;

    let body = '';
    if (item.type === 'quote') {
      body = `<div class="card-quote">${item.quote || item.note || item.excerpt || ''}</div>
        ${pendingBadgeHtml(item)}`;
    } else if ((item.type === 'image' || item.type === 'screenshot') && item.imageUrl) {
      const imageTitle = escapeHtml(item.title || (item.type === 'screenshot' ? 'Screenshot' : 'Saved image'));
      const imageSrc = escapeHtml(imageSrcForRender(item.imageUrl));
      const pageSrc = escapeHtml(item.sourceUrl || item.sourcePageUrl || item.pageUrl || item.url || '');
      // Show a short excerpt below the image so the card has the
      // [image → title → description] rhythm from the design sketch
      // instead of just an orphan image.
      const descText = item.note || item.excerpt || '';
      const descBlock = descText
        ? `<p class="card-excerpt">${escapeHtml(descText.length > 220 ? descText.slice(0, 220) + '…' : descText)}</p>`
        : '';
      const tagsBlock = Array.isArray(item.tags) && item.tags.length
        ? `<div class="card-tags">${item.tags.slice(0, 6).map(t=>`<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      const pendingBadge = pendingBadgeHtml(item);
      body = `<div class="card-image-wrap image-clickable" data-image-preview="${imageSrc}" data-image-title="${imageTitle}" data-page-url="${pageSrc}" title="Click to view image">
        <img src="${imageSrc}" alt="${imageTitle}" data-image-fallback="${escapeHtml(item.id)}" loading="lazy" decoding="async" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;display:block;">
        <div class="image-click-badge">${item.type === 'screenshot' ? 'View screenshot' : 'View image'}</div>
        ${pendingBadge}
      </div>
      <div class="card-body" style="padding-top:10px">
        <div class="card-title">${imageTitle}</div>
        ${descBlock}
        ${tagsBlock}
      </div>`;
    } else if ((item.type === 'image' || item.type === 'screenshot') && !item.imageUrl) {
      // Captured but the asset isn't available (upload failed mid-flight
      // or the Supabase signed URL was cleared). Render the placeholder
      // card so the row still has title + description instead of
      // silently disappearing from the dashboard. Click to lazy-fetch a
      // fresh signed URL via /api/v1/items/:id/image-url.
      const imageTitle = escapeHtml(item.title || (item.type === 'screenshot' ? 'Screenshot' : 'Saved image'));
      const descText = item.note || item.excerpt || '';
      const descBlock = descText
        ? `<p class="card-excerpt">${escapeHtml(descText.length > 220 ? descText.slice(0, 220) + '…' : descText)}</p>`
        : '';
      const tagsBlock = Array.isArray(item.tags) && item.tags.length
        ? `<div class="card-tags">${item.tags.slice(0, 6).map(t=>`<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      body = `<div class="card-body">
        <div class="card-image-wrap image-clickable" data-image-lazy="${escapeHtml(item.id)}" data-image-title="${imageTitle}" title="Click to load image" style="cursor:pointer">
          <div class="image-lazy-placeholder" style="background:var(--gray-bg);height:140px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--gray-mid);font-size:12px;font-weight:700;letter-spacing:0.5px">BẤM ĐỂ TẢI ẢNH</div>
        </div>
        <div class="card-title" style="margin-top:10px">${imageTitle}</div>
        ${descBlock}
        ${tagsBlock}
      </div>`;
    } else if (item.type === 'link') {
      const linkUrl = escapeHtml(normalizeExternalUrl(item.sourceUrl || item.url || item.note || ''));
      const displayUrl = escapeHtml((item.url || item.note || '').replace(/^https?:\/\//, '').slice(0, 60));
      body = `<div class="card-body">
        <div class="card-title">${escapeHtml(item.title || 'Saved link')}</div>
        ${item.excerpt ? `<p class="card-excerpt">${escapeHtml(item.excerpt)}</p>` : ''}
        ${linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener" data-open-link="${linkUrl}" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:4px">? ${displayUrl || 'Open link'} ?</a>` : ''}
        ${item.tags ? `<div class="card-tags">${item.tags.map(t=>`<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        ${pendingBadgeHtml(item)}
      </div>`;
    } else if (item.type === 'file') {
      const fileName = escapeHtml(item.fileName || item.title || 'Attachment');
      const fileSize = item.fileSize ? `<span style="color:var(--gray-mid);font-size:11px">${escapeHtml(item.fileSize)}</span>` : '';
      const dl = item.fileData ? `<a href="${escapeHtml(item.fileData)}" download="${fileName}" data-file-download="1" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--purple);text-decoration:none;margin-top:8px">? Download</a>` : '';
      body = `<div class="card-body">
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1.5px solid var(--gray-border);border-radius:10px;background:var(--gray-bg)">
          <div style="width:40px;height:40px;border-radius:8px;background:var(--purple-light);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">??</div>
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
          ? `<div class="card-reminder-meta">${typeLabel} ? ${doneCount}/${totalCount} done</div>`
          : '';
        const reminderId = item.sourceType === 'reminder' ? escapeHtml(item.reminderId) : '';
        body = `<div class="card-checklist ${item.sourceType === 'reminder' ? 'dashboard-reminder-card' : ''}">
          <div class="checklist-title">${escapeHtml(item.title)}</div>
          ${reminderBadge}
          ${item.checks.map(function(c, index) {
            const taskAttrs = item.sourceType === 'reminder'
              ? ` data-dashboard-reminder-id="${reminderId}" data-dashboard-task-index="${index}" title="Click to tick / untick"`
              : '';
            return `<div class="check-item ${c.done?'done':''} ${item.sourceType === 'reminder' ? 'reminder-clickable' : ''}"${taskAttrs}>
              <div class="check-box ${c.done?'checked':''}"></div><span>${escapeHtml(c.text)}</span>
            </div>`;
          }).join('')}
          ${item.sourceType === 'reminder' ? `<div class="dashboard-reminder-actions">
            <button class="dashboard-reminder-open" data-open-reminders="1">Open Reminders</button>
            <button class="dashboard-reminder-delete" data-dashboard-reminder-delete="${reminderId}">Delete</button>
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

    const heartBtn = `<button type="button" class="card-favorite-btn ${item.isFavorite ? 'is-favorite' : ''}" data-favoriteid="${item.id}" title="${item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}" aria-label="Toggle favorite" aria-pressed="${item.isFavorite ? 'true' : 'false'}">
            <svg viewBox="0 0 24 24" fill="${item.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
              <path d="M12 21s-7.5-4.6-9.7-9.2C.7 8.5 2.4 4 6.3 4c2.1 0 3.6 1.1 4.7 2.7C12.1 5.1 13.6 4 15.7 4c3.9 0 5.6 4.5 4 7.8C19.5 16.4 12 21 12 21z"/>
            </svg>
          </button>`;

    return `<div class="memory-card ${item.isFavorite ? 'is-favorite-card' : ''}" data-memory-id="${escapeHtml(String(item.id || ''))}">
      ${item.type !== 'note' ? `<div class="card-header">
        <span class="card-type ${typeClass}" data-reader-open="${escapeHtml(String(item.id || ''))}" title="Mở reader view">${item.type==='code'?`<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" style="width:11px;height:11px"><path d="M4 4l-3 3 3 3M10 4l3 3-3 3M8 2l-2 10"/></svg> `:''}${typeLabel}</span>
        <div style="display:flex;gap:6px;align-items:center">${isNew ? '<span style="background:#22c55e;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:0.5px">NEW</span>' : ''}
          ${heartBtn}
          <div class="card-menu-wrap">
            <span class="card-menu" data-menuid="${item.id}">?</span>
            <div class="card-dropdown" id="dropdown-${item.id}">
              <div class="card-dropdown-item danger" data-deleteid="${item.id}">? Delete</div>
            </div>
          </div>
        </div>
      </div>` : `<div class="card-header card-header-note">
        <div style="display:flex;gap:6px;align-items:center;margin-left:auto">${isNew ? '<span style="background:#22c55e;color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;letter-spacing:0.5px">NEW</span>' : ''}
          ${heartBtn}
          <div class="card-menu-wrap">
            <span class="card-menu" data-menuid="${item.id}">?</span>
            <div class="card-dropdown" id="dropdown-${item.id}">
              <div class="card-dropdown-item danger" data-deleteid="${item.id}">? Delete</div>
            </div>
          </div>
        </div>
      </div>`}
      ${body}
      ${relatedMemoriesHtml(item)}
      ${item.type !== 'quote' ? `<div class="card-footer">
        <span class="card-date">${item.date || ''}</span>
        <span class="card-space">${item.space || ''}</span>
      </div>` : ''}
    </div>`;
  });

  // Per-item signature. If a card's signature hasn't changed we reuse
  // the existing DOM node; otherwise we swap it. The signature covers
  // everything that affects the rendered HTML.
  function signatureFor(item) {
    var img = (item.imageUrl || '').slice(-120);
    return [
      item.id,
      item.title || '',
      item.note || '',
      item.excerpt || '',
      item.quote || '',
      img,
      (item.tags || []).join('|'),
      item.type,
      item.sourceType || '',
      item.space || '',
      item.date || '',
      item.status || '',
      item.isFavorite ? '1' : '0'
    ].join('\u0001');
  }

  const prevSigs = renderCards._lastSigs;
  const newSigs = data.map(signatureFor);
  let allUnchanged = false;
  if (prevSigs && prevSigs.length === newSigs.length) {
    allUnchanged = true;
    for (let i = 0; i < newSigs.length; i++) {
      if (prevSigs[i] !== newSigs[i]) { allUnchanged = false; break; }
    }
  }

  if (allUnchanged) {
    // Background sync round-tripped with zero mutations: do not even
    // touch the DOM. Scroll position and image decode state stay
    // exactly where the user left them.
    return;
  }

  // Index the existing DOM by `data-memory-id` so we can decide per
  // card whether to keep, replace, or insert.
  const existingById = new Map();
  for (const child of Array.from(container.children)) {
    const mid = child.getAttribute && child.getAttribute('data-memory-id');
    if (mid) existingById.set(mid, child);
  }

  // If the visible order (ids) is also unchanged, do surgical swaps
  // that preserve the DOM nodes for cards that didn't mutate.
  let sameOrder = prevSigs && prevSigs.length === newSigs.length;
  if (sameOrder) {
    for (let i = 0; i < newSigs.length; i++) {
      if (prevSigs[i].split('\u0001')[0] !== newSigs[i].split('\u0001')[0]) {
        sameOrder = false;
        break;
      }
    }
  }

  if (sameOrder) {
    // Surgical path: keep the existing DOM node for cards whose
    // signature didn't change, and only re-parse the cards that mutated.
    const cards = newSigs.map((sig, idx) => {
      const prev = prevSigs[idx];
      const id = sig.split('\u0001')[0];
      if (prev === sig && existingById.has(id)) {
        return existingById.get(id);
      }
      // Signature changed (or id missing): re-parse just this card's
      // HTML so the rest of the list keeps its scroll-anchored nodes
      // intact.
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtmls[idx];
      return tmp.firstElementChild;
    });
    const placeholder = document.createDocumentFragment();
    for (const node of cards) if (node) placeholder.appendChild(node);
    container.innerHTML = '';
    container.appendChild(placeholder);
    renderCards._lastSigs = newSigs;
    return;
  }

  // Different order/length: fall back to a full replace, but use a
  // DocumentFragment so the browser only reflows once.
  const html = cardHtmls.join('');
  container.innerHTML = '';
  const fragment = document.createRange().createContextualFragment(html);
  container.appendChild(fragment);
  renderCards._lastSigs = newSigs;
}

// ===== RENDER SPACES =====
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
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
    // Inspiration space shows both uploaded images AND cropped screenshots
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
      <h3>No favorite spaces yet</h3>
      <p>Click the star icon on any space to put it in your Favorites.</p>
    </div>`;
    return;
  }

  grid.innerHTML = data.map(function(s) {
    const isFavorite = favoriteSpaceIds.includes(s.id);
    const relatedCount = getSpaceItems(s).length;
    return `<div class="space-card" data-space-id="${escapeHtml(s.id)}">
      <div class="space-card-top">
        <div class="space-icon">${s.icon}</div>
        <button class="space-star ${isFavorite ? 'active' : ''}" data-space-favorite="${escapeHtml(s.id)}" title="${isFavorite ? 'Remove favorite' : 'Add favorite'}">?</button>
      </div>
      <div class="space-name">${escapeHtml(s.name)}</div>
      <p class="space-desc">${escapeHtml(s.desc)}</p>
      <div class="space-count">
        <span>${getSpaceCount(s)} items ? ${relatedCount} matches</span>
        <span class="space-ai">AI</span>
      </div>
      <div class="space-open-hint">Open space ?</div>
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
    showToast('Removed from Favorites');
  } else {
    favoriteSpaceIds.push(spaceId);
    showToast('Added to Favorites');
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
    <button class="space-back-btn" id="space-detail-back">? Back</button>
    <div class="space-detail-title-row">
      <div class="space-detail-icon">${space.icon}</div>
      <div>
        <div class="space-detail-name">${escapeHtml(space.name)}</div>
        <div class="space-detail-desc">${escapeHtml(space.desc)}</div>
      </div>
    </div>
    <div class="space-detail-actions">
      <button class="space-detail-btn ${isFavorite ? 'active' : ''}" id="space-detail-favorite" data-space-favorite="${escapeHtml(space.id)}">${isFavorite ? '? Favorited' : '? Favorite'}</button>
      <button class="space-detail-btn" id="space-detail-open-dashboard">Open in dashboard</button>
    </div>
  </div>
  <div class="space-detail-meta">
    <span>${getSpaceCount(space)} items</span>
    <span>${getSpaceItems(space).length} items matching your saved data</span>
    <span>Recently updated</span>
  </div>
  <div class="space-detail-search">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M12 12l3 3"/></svg>
    <input id="space-detail-search-input" type="text" placeholder="Search inside this space...">
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
      <h3>No items in this space yet</h3>
      <p>Save images, articles or notes with related tags and they will show up here.</p>
    </div>`;
    return;
  }

  container.innerHTML = data.map(function(item) {
    const typeLabel = { article:'Article', image:'Image', note:'Note', quote:'Quote', code:'Code' }[item.type] || 'Saved item';
    const title = item.title || item.quote || item.note || 'Saved memory';
    const body = item.excerpt || item.note || item.quote || item.url || (item.checks || []).map(function(c) { return c.text; }).join(' ? ') || '';
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
      ${url ? `<button class="space-item-open" data-space-open-url="${escapeHtml(url)}">Open source</button>` : ''}
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
  if (listCount) listCount.textContent = `${getFilteredReminders().length} reminders`;
}

function renderReminders() {
  const grid = document.getElementById('reminders-grid');
  if (!grid) return;
  const data = getFilteredReminders();
  updateReminderStats();

  if (data.length === 0) {
    grid.innerHTML = `<div class="reminder-empty"><h3>No matching reminders</h3><p>Create a new checklist or change the filter.</p></div>`;
    return;
  }

  grid.innerHTML = data.map(function(item) {
    const tasks = item.tasks || [];
    const doneCount = tasks.filter(t => t.done).length;
    const totalCount = tasks.length;
    const kindLabel = item.kind === 'meeting' ? 'MEETING MINUTES' : 'TODO LIST';
    const kindClass = item.kind === 'meeting' ? 'meeting' : 'todo';
    const safeId = String(item.id);

    return `<div class="reminder-card">
      <div class="reminder-card-main">
        <div class="reminder-card-head">
          <div class="reminder-card-title">${escapeHtml(item.title)}</div>
          <span class="reminder-kind ${kindClass}">${kindLabel}</span>
        </div>
        <div class="reminder-progress">${doneCount}/${totalCount} done</div>
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
          <span class="reminder-date">${escapeHtml(item.date || 'Today')}</span>
          <span style="color:#ddd;margin:0 6px">?</span>
          <span class="reminder-space">${escapeHtml(item.space || 'Work')}</span>
        </div>
        <div class="reminder-actions">
          <button class="reminder-delete" data-reminder-delete="${escapeHtml(safeId)}">Delete</button>
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
  const space = spaceEl ? spaceEl.value.trim() : 'Work';

  if (!title || taskLines.length === 0) {
    showToast('Enter a title and at least 1 checklist item!');
    return;
  }

  const newReminder = {
    id: Date.now(),
    kind,
    title,
    tasks: taskLines.map(text => ({ text, done: false })),
    date: 'Just now',
    space: space || 'Work',
    createdAt: new Date().toISOString()
  };

  reminders.unshift(newReminder);
  saveReminders(function() {
    titleEl.value = '';
    tasksEl.value = '';
    if (spaceEl) spaceEl.value = space || 'Work';
    reminderFilter = 'all';
    document.querySelectorAll('.reminder-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.reminderFilter === 'all'));
    renderReminders();
    showToast('? Reminder saved');
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
    showToast('Reminder deleted');
  });
}

// ===== SEARCH =====
function handleSearch(val) {
  clearTimeout(searchTimeout);
  const q = val.toLowerCase().trim();
  serverSearchResults = null;
  if (!q) {
    searchRequestEpoch += 1;
    renderDashboard();
    hideAIResult();
    return;
  }

  // Keep the local result visible while the server search is in flight.
  renderDashboard();

  searchTimeout = setTimeout(async function() {
    if (!currentUser || !currentUser.id) return;
    var requestEpoch = ++searchRequestEpoch;
    try {
      var token = await getAccessToken();
      if (!token) {
        token = await refreshAccessToken();
      }
      if (!token) return;

      var response = await searchItemsFromApi(q, token);
      if (requestEpoch !== searchRequestEpoch) return;

      var hits = response && Array.isArray(response.hits) ? response.hits : [];
      serverSearchResults = hits.map(function(hit) {
        return {
          id: hit.id,
          type: hit.kind || 'text',
          title: hit.title || 'Untitled',
          note: hit.snippet || '',
          excerpt: hit.snippet || '',
          tags: Array.isArray(hit.tags) ? hit.tags : [],
          savedAt: hit.captured_at || new Date().toISOString(),
          capturedAt: hit.captured_at || null,
          serverSynced: true,
          searchScore: hit.score
        };
      });
      renderDashboard();
      showAIResult(
        serverSearchResults.length
          ? 'Server search found <b>' + serverSearchResults.length + '</b> result(s) for "<b>' + escapeHtml(q) + '</b>".'
          : 'No server results for "<b>' + escapeHtml(q) + '</b>".'
      );
    } catch (error) {
      if (requestEpoch !== searchRequestEpoch) return;
      // Keep local search usable if the API is temporarily unavailable.
      serverSearchResults = null;
      renderDashboard();
      showAIResult('Server search unavailable — showing local matches.');
    }
  }, 350);

  clearTimeout(aiSearchTimeout);
  aiSearchTimeout = setTimeout(function() { doAISearch(val); }, 800);
}

async function doAISearch() {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;
  // Manual search without AI
  const q = query.toLowerCase();
  const matched = items.filter(item => getSearchText(item).includes(q));
  if (matched.length > 0) {
    showAIResult(`Found <b>${matched.length}</b> results for "<b>${query}</b>". The closest matches are shown below.`);
  } else {
    showAIResult(`No results for "<b>${query}</b>". Try a different keyword!`);
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

// Lazy-load the image for a placeholder card. The user clicked the
// placeholder so they expect to see the image — fetch a fresh signed
// URL, persist it on the matching item, and re-render the dashboard so
// the placeholder becomes a real image card.
async function lazyLoadItemImage(placeholderEl) {
  if (!placeholderEl) return;
  var itemId = placeholderEl.dataset.imageLazy;
  var title = placeholderEl.dataset.imageTitle || '';
  if (!itemId) return;

  // Visual feedback so the click doesn't feel like a no-op while we
  // hit the API.
  var placeholderInner = placeholderEl.querySelector('.image-lazy-placeholder');
  if (placeholderInner) placeholderInner.textContent = 'ĐANG TẢI…';

  try {
    var token = await getAccessTokenAsync();
    if (!token) {
      token = await refreshAccessToken();
    }
    if (!token) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
    var apiBase = (typeof MNEMONICS_API_URL !== 'undefined' ? MNEMONICS_API_URL : (window.MNEMONICS_API_URL || 'http://localhost:4000'));
    var response = await fetch(apiBase + '/api/v1/items/' + encodeURIComponent(itemId) + '/image-url', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      var errBody = await response.json().catch(function() { return {}; });
      throw new Error(errBody.error && errBody.error.message ? errBody.error.message : 'API từ chối (HTTP ' + response.status + ').');
    }
    var body = await response.json().catch(function() { return {}; });
    var freshUrl = body && body.data && body.data.image_url;
    if (!freshUrl) throw new Error('API không trả về URL ảnh.');

    // Persist the URL on the item so the next render keeps it.
    var item = baseMemoryItems.find(function(i) { return String(i.id) === String(itemId); });
    if (item) item.imageUrl = freshUrl;

    if (typeof showToast === 'function') showToast('Đã tải ảnh');

    // Either show inline by re-rendering the dashboard, or pop the full
    // viewer if the user double-clicked. The simplest path is the
    // preview overlay so the user gets an immediate "yes this worked"
    // before the masonry updates on the next poll.
    openImagePreview(freshUrl, title, item ? item.sourceUrl : '');
    refreshDashboardItems();
  } catch (error) {
    if (placeholderInner) placeholderInner.textContent = 'BẤM ĐỂ THỬ LẠI';
    if (typeof showToast === 'function') showToast('Không tải được ảnh: ' + (error.message || 'unknown'));
  }
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
  // browser ? proxying them just strips the token and breaks the load.
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
  titleEl.textContent = title || 'Saved image';
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
    var payload = { url: imageUrl, title: title || 'Original image' };
    chrome.storage.local.set({ mnemonics_original_image: payload }, function() {
      if (chrome.runtime.lastError) {
        showToast('Could not open original image');
        return;
      }
      chrome.tabs.create({ url: chrome.runtime.getURL('original-image.html') });
    });
    return;
  }

  window.open(imageUrl, '_blank', 'noopener');
}

// ===== READER MODAL (mymind-style) =====
let readerCurrentItem = null;

const READER_TYPE_LABELS = {
  article: 'ARTICLE',
  image: 'INSPIRATION',
  note: 'QUICK NOTE',
  quote: 'QUOTE',
  code: 'CODE',
  link: 'LINK',
  file: 'FILE',
  screenshot: 'SCREENSHOT'
};

function getReaderItem(id) {
  if (!id) return null;
  if (typeof items !== 'undefined' && Array.isArray(items)) {
    const found = items.find(function(i) { return String(i.id) === String(id); });
    if (found) return found;
  }
  if (typeof baseMemoryItems !== 'undefined' && Array.isArray(baseMemoryItems)) {
    return baseMemoryItems.find(function(i) { return String(i.id) === String(id); }) || null;
  }
  return null;
}

function readerFmtDate(item) {
  var iso = (item && (item.capturedAt || item.savedAt)) || '';
  if (!iso) return '';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('vi-VN', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

function readerBodyHtml(item) {
  var type = item.type || 'note';
  if (type === 'image' || type === 'screenshot') {
    var src = (typeof imageSrcForRender === 'function') ? imageSrcForRender(item.imageUrl || '') : (item.imageUrl || '');
    var imgTitle = String(item.title || (type === 'screenshot' ? 'Screenshot' : 'Saved image')).replace(/[<>&"']/g, '');
    if (src) {
      return '<img src="' + src + '" alt="' + imgTitle + '" data-image-fallback="' + String(item.id || '').replace(/[<>&"']/g, '') + '">';
    }
    return '<p style="color:#8c92a3;font-style:italic;">(Ảnh chưa được tải lên hoặc URL đã hết hạn.)</p>';
  }
  if (type === 'quote') {
    var quoteText = String(item.quote || item.note || item.excerpt || '').trim();
    return '<div class="reader-quote">' + (typeof escapeHtml === 'function' ? escapeHtml(quoteText) : quoteText) + '</div>';
  }
  if (type === 'code') {
    var codeText = String(item.note || item.excerpt || item.quote || '').trim();
    return '<pre>' + (typeof escapeHtml === 'function' ? escapeHtml(codeText) : codeText) + '</pre>';
  }
  // default: text/note/article/link
  var body = String(item.note || item.excerpt || '').trim();
  if (!body && (item.title || '').trim()) body = String(item.title).trim();
  var paragraphs = body.split(/\n\s*\n/).filter(function(p) { return p.trim().length > 0; });
  if (paragraphs.length === 0) {
    return '<p style="color:#8c92a3;font-style:italic;">(Chưa có nội dung.)</p>';
  }
  return paragraphs.map(function(p) {
    return '<p>' + (typeof escapeHtml === 'function' ? escapeHtml(p) : p) + '</p>';
  }).join('');
}

function readerRenderTags(item) {
  var wrap = document.getElementById('reader-tags');
  if (!wrap) return;
  var tags = Array.isArray(item.tags) ? item.tags.slice() : [];
  wrap.innerHTML = '';
  tags.forEach(function(tag) {
    var span = document.createElement('span');
    span.className = 'reader-tag';
    span.innerHTML = '<span>' + (typeof escapeHtml === 'function' ? escapeHtml(tag) : tag) + '</span>' +
      '<button type="button" class="reader-tag-x" data-rmtag="' + (typeof escapeHtml === 'function' ? escapeHtml(tag) : tag) + '" aria-label="Xóa tag">&times;</button>';
    wrap.appendChild(span);
  });
  // "+ Add tag" input row
  var addRow = document.createElement('div');
  addRow.className = 'reader-add-row';
  addRow.id = 'reader-tag-input-row';
  addRow.style.display = 'none';
  addRow.innerHTML = '<input type="text" id="reader-tag-input" placeholder="Tag mới..." maxlength="32">' +
    '<button type="button" id="reader-tag-save">Lưu</button>';
  wrap.parentNode && wrap.parentNode.appendChild(addRow);
}

function readerRenderNotes(item) {
  var wrap = document.getElementById('reader-notes');
  if (!wrap) return;
  // For now we use a single textarea seeded with item.note (user-editable
  // notes). Saving writes back via PATCH /items/:id { notes }.
  wrap.innerHTML = '';
  var noteText = String(item.note || '').trim();
  var box = document.createElement('div');
  box.className = 'reader-note';
  box.innerHTML = '<textarea id="reader-note-text" placeholder="Thêm ghi chú của bạn...">' +
    (typeof escapeHtml === 'function' ? escapeHtml(noteText) : noteText) + '</textarea>' +
    '<div class="reader-note-actions">' +
      '<button type="button" id="reader-note-save">Lưu ghi chú</button>' +
    '</div>';
  wrap.appendChild(box);
}

function openReaderModal(itemId) {
  var item = getReaderItem(itemId);
  if (!item) {
    if (typeof showToast === 'function') showToast('Không tìm thấy item.');
    return;
  }
  readerCurrentItem = item;

  var modal = document.getElementById('reader-modal');
  if (!modal) return;

  var typeKey = item.type || 'note';
  var typeLabel = READER_TYPE_LABELS[typeKey] || 'ITEM';
  var chip = document.getElementById('reader-type-chip');
  if (chip) {
    chip.textContent = typeLabel;
    chip.className = 'reader-type-chip ' + typeKey;
  }

  var titleEl = document.getElementById('reader-title');
  if (titleEl) {
    var titleText = String(item.title || '').trim();
    if (!titleText) {
      if (typeKey === 'quote') titleText = 'Trích dẫn';
      else if (typeKey === 'image' || typeKey === 'screenshot') titleText = 'Ảnh đã lưu';
      else if (typeKey === 'note') titleText = 'Ghi chú';
      else if (typeKey === 'link') titleText = 'Liên kết';
      else if (typeKey === 'code') titleText = 'Đoạn mã';
      else if (typeKey === 'file') titleText = 'Tệp';
      else titleText = 'Untitled';
    }
    titleEl.textContent = titleText;
  }

  var dateEl = document.getElementById('reader-date');
  if (dateEl) dateEl.textContent = readerFmtDate(item);

  var sourceEl = document.getElementById('reader-source');
  if (sourceEl) {
    var srcUrl = (typeof normalizeExternalUrl === 'function')
      ? normalizeExternalUrl(item.sourceUrl || item.url || item.pageUrl || '')
      : (item.sourceUrl || item.url || item.pageUrl || '');
    if (srcUrl) {
      sourceEl.innerHTML = 'Từ: <a href="' + srcUrl + '" target="_blank" rel="noopener noreferrer">' +
        ((typeof escapeHtml === 'function') ? escapeHtml(srcUrl) : srcUrl) + '</a>';
      sourceEl.style.display = '';
    } else {
      sourceEl.textContent = '';
      sourceEl.style.display = 'none';
    }
  }

  var bodyEl = document.getElementById('reader-body');
  if (bodyEl) bodyEl.innerHTML = readerBodyHtml(item);

  readerRenderTags(item);
  readerRenderNotes(item);

  // Action buttons
  var favBtn = document.getElementById('reader-fav');
  if (favBtn) {
    favBtn.classList.toggle('is-favorite', !!item.isFavorite);
    favBtn.textContent = item.isFavorite ? '♥' : '♡';
    favBtn.title = item.isFavorite ? 'Bỏ yêu thích' : 'Yêu thích';
  }
  var sourceLinkBtn = document.getElementById('reader-source-link');
  if (sourceLinkBtn) {
    var btnSrc = (typeof normalizeExternalUrl === 'function')
      ? normalizeExternalUrl(item.sourceUrl || item.url || item.pageUrl || '')
      : (item.sourceUrl || item.url || item.pageUrl || '');
    if (btnSrc) {
      sourceLinkBtn.style.display = '';
      sourceLinkBtn.dataset.url = btnSrc;
    } else {
      sourceLinkBtn.style.display = 'none';
    }
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeReaderModal() {
  var modal = document.getElementById('reader-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  readerCurrentItem = null;
}

function readerUpdateTagsLocally(itemId, nextTags) {
  // Mutate both the composed items array and the baseMemoryItems store
  // so the next renderDashboard() pass sees the new tag set without a
  // server round-trip.
  if (typeof items !== 'undefined' && Array.isArray(items)) {
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].id) === String(itemId)) {
        items[i].tags = nextTags.slice();
        break;
      }
    }
  }
  if (typeof baseMemoryItems !== 'undefined' && Array.isArray(baseMemoryItems)) {
    for (var j = 0; j < baseMemoryItems.length; j++) {
      if (String(baseMemoryItems[j].id) === String(itemId)) {
        baseMemoryItems[j].tags = nextTags.slice();
        break;
      }
    }
  }
}

function readerSaveTags(itemId, tags) {
  return new Promise(function(resolve, reject) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      // Test environment: just mutate local state.
      readerUpdateTagsLocally(itemId, tags);
      resolve({ ok: true, local: true });
      return;
    }
    chrome.runtime.sendMessage(
      { type: 'PATCH_ITEM', itemId: itemId, patch: { tags: tags } },
      function(response) {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Patch failed.'));
          return;
        }
        if (response && response.ok) {
          readerUpdateTagsLocally(itemId, tags);
          resolve(response);
        } else {
          reject(new Error((response && response.error) || 'Tag save failed.'));
        }
      }
    );
  });
}

function readerSaveNote(itemId, note) {
  return new Promise(function(resolve, reject) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      readerUpdateTagsLocally(itemId, []); // no-op for notes local path
      resolve({ ok: true, local: true });
      return;
    }
    chrome.runtime.sendMessage(
      { type: 'PATCH_ITEM', itemId: itemId, patch: { notes: note } },
      function(response) {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Patch failed.'));
          return;
        }
        if (response && response.ok) {
          resolve(response);
        } else {
          reject(new Error((response && response.error) || 'Note save failed.'));
        }
      }
    );
  });
}

function readerCopy() {
  if (!readerCurrentItem) return;
  var item = readerCurrentItem;
  var parts = [];
  if (item.title) parts.push(item.title);
  if (item.quote) parts.push('"' + item.quote + '"');
  if (item.note) parts.push(item.note);
  if (item.sourceUrl || item.url) parts.push(item.sourceUrl || item.url);
  if (Array.isArray(item.tags) && item.tags.length) parts.push('#' + item.tags.join(' #'));
  var text = parts.filter(function(s) { return s && String(s).trim(); }).join('\n\n');
  if (!text) {
    if (typeof showToast === 'function') showToast('Không có nội dung để copy.');
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      if (typeof showToast === 'function') showToast('Đã copy vào clipboard.');
    }, function() {
      if (typeof showToast === 'function') showToast('Không copy được.');
    });
  }
}

// ===== ADD ITEM =====
let modalFileData = null;    // base64 of a file/image to paste or attach
let modalFileName = '';
let modalFileSize = '';
let modalClientRequestId = null;

function openAddModal() {
  document.getElementById('add-modal').classList.add('open');
  document.getElementById('new-title').value = '';
  document.getElementById('new-content').value = '';
  var urlEl = document.getElementById('new-url'); if (urlEl) urlEl.value = '';
  var fileEl = document.getElementById('new-file'); if (fileEl) fileEl.value = '';
  var prev = document.getElementById('modal-file-preview'); if (prev) prev.innerHTML = '';
  modalFileData = null; modalFileName = ''; modalFileSize = '';
  modalClientRequestId = null;
  document.getElementById('ai-tags-preview').innerHTML = '<span style="font-size:13px;color:var(--gray-text)">Enter some content and AI will suggest tags...</span>';
  updateModalTypeFields(document.getElementById('new-type').value);
}
function closeModal() {
  document.getElementById('add-modal').classList.remove('open');
}

// Show/hide URL and file inputs based on the selected type
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
    if (type === 'screenshot') fileLabel.textContent = 'Paste a screenshot (Ctrl/Cmd+V) here, or pick an image file';
    else if (type === 'image') fileLabel.textContent = 'Pick an image from your device';
    else fileLabel.textContent = 'Pick an attachment';
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
  // Cap at ~4MB so we stay within the storage quota
  if (file.size > 4 * 1024 * 1024) {
    showToast('File too large (max 4MB for offline items)');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    modalFileData = e.target.result;
    modalFileName = file.name || 'attachment';
    modalFileSize = formatFileSize(file.size);
    var titleEl = document.getElementById('new-title');
    if (titleEl && !titleEl.value.trim()) titleEl.value = modalFileName.slice(0, 80);
    var prev = document.getElementById('modal-file-preview');
    if (prev) {
      if (/^data:image\//.test(modalFileData)) {
        prev.innerHTML = '<img src="' + modalFileData + '" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--gray-border)">';
      } else {
        prev.innerHTML = '<div style="font-size:12px;color:var(--gray-text)">?? ' + escapeHtml(modalFileName) + ' ? ' + modalFileSize + '</div>';
      }
    }
  };
  reader.readAsDataURL(file);
}

// Allow pasting screenshots directly into the modal
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
        showToast('Screenshot pasted');
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
  const words = content.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/);
  const stopwords = ['the','a','an','of','in','on','for','to','and','or','is','are','the','of','and','with','of','this','or','for','one','the','be','not','and'];
  const freq = {};
  words.filter(w => w.length > 3 && !stopwords.includes(w)).forEach(w => freq[w] = (freq[w]||0)+1);
  const tags = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
  const finalTags = tags.length > 0 ? tags : ['ghi ch?'];
  preview.innerHTML = finalTags.map(t => `<span class="ai-tag">${t}</span>`).join('');
  preview.dataset.tags = JSON.stringify(finalTags);
}

async function saveItem() {
  try {
    const title = document.getElementById('new-title').value.trim();
    const contentVal = document.getElementById('new-content').value.trim();
    const type = document.getElementById('new-type').value;
    const urlEl = document.getElementById('new-url');
    const urlVal = urlEl ? urlEl.value.trim() : '';

    // Check minimum data for each capture type
    if (type === 'link' && !urlVal && !contentVal) { showToast('Enter a URL!'); return; }
    if ((type === 'file' || type === 'image' || type === 'screenshot') && !modalFileData && !urlVal) {
      showToast('Please pick or paste a file or image!'); return;
    }
    if (type !== 'link' && type !== 'file' && type !== 'image' && type !== 'screenshot' && !title && !contentVal) {
      showToast('Please enter some content!'); return;
    }

    const tagsEl = document.getElementById('ai-tags-preview');
    let tags = [];
    try { tags = JSON.parse(tagsEl.dataset.tags || '[]'); } catch(e){}
    if (tags.length === 0) {
      const text = (title + ' ' + contentVal).toLowerCase();
      const stopwords = ['the','a','an','of','in','on','for','to','and','or','is','are','the','of','and','with','of','this','or','for','one','the','be','not'];
      const words = text.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopwords.includes(w));
      const freq = {};
      words.forEach(w => freq[w] = (freq[w]||0)+1);
      tags = Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,3);
    }

    const newItem = {
      id: Date.now(), type,
      tags: tags.length ? tags : ['ghi ch?'],
      date: 'Just now', space: 'Just saved',
      savedAt: new Date().toISOString(),
      clientRequestId: modalClientRequestId || crypto.randomUUID()
    };
    modalClientRequestId = newItem.clientRequestId;

    if (type === 'link') {
      const link = normalizeExternalUrl(urlVal || contentVal);
      newItem.title = title || (link.replace(/^https?:\/\//, '').slice(0, 60)) || 'Saved link';
      newItem.url = link;
      newItem.sourceUrl = link;
      newItem.excerpt = contentVal || '';
      if ((!tags || tags.length === 0)) newItem.tags = ['link'];
    } else if (type === 'image' || type === 'screenshot') {
      newItem.title = title || (type === 'screenshot' ? 'Screenshot' : 'Saved image');
      newItem.imageUrl = modalFileData || normalizeExternalUrl(urlVal);
      newItem.sourceUrl = normalizeExternalUrl(urlVal) || '';
      newItem.note = contentVal;
      if (!newItem.tags || newItem.tags.length === 0) newItem.tags = type === 'screenshot' ? ['screenshot'] : ['image'];
    } else if (type === 'file') {
      newItem.title = title || modalFileName || 'Attachment';
      newItem.fileName = modalFileName;
      newItem.fileData = modalFileData;
      newItem.fileSize = modalFileSize;
      newItem.excerpt = contentVal || '';
      if (!newItem.tags || newItem.tags.length === 0) newItem.tags = ['file'];
    } else {
      newItem.title = title || contentVal.slice(0, 60);
      newItem.note = contentVal;
      newItem.excerpt = contentVal.slice(0, 120);
      if (type === 'quote') newItem.quote = contentVal || title;
    }

    const accessToken = await getAccessTokenAsync();
    if (!accessToken) throw new Error('Sign in before saving a memory.');
    if (newItem.type === 'file') throw new Error('File captures are not supported by the capture API.');
    if (newItem.type === 'image' || newItem.type === 'screenshot') {
      // Preserve the discriminator on the API payload. The popup
      // sends `type: 'screenshot'` from the screenshot flow, and
      // the dashboard's own right-click / drag-save paths send
      // `type: 'image'` (web images). Without this hint the API
      // defaults to 'screenshot', which is the wrong pipeline for
      // a Facebook CDN image.
      await uploadImageCapture(newItem.imageUrl, {
        type: newItem.type,
        title: newItem.title,
        note: newItem.note,
        sourceUrl: newItem.sourceUrl,
        capturedAt: newItem.savedAt,
        clientRequestId: newItem.clientRequestId
      }, accessToken);
    } else {
      await sendCaptureToApi(newItem, accessToken);
    }
    modalClientRequestId = null;
    closeModal();
    loadFromExtension();
    showToast('? Memory saved successfully!');
  } catch(err) {
    showToast('Save failed: ' + err.message);
  }
}

// ===== TOAST =====
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// Supabase Storage signed URLs expire after 1 hour. When the dashboard
// has been open longer than that, <img> tags break with no UI feedback.
// Hook a delegated `error` listener on the cards container so we can
// react to broken images without needing an inline `onerror=` handler
// (which the extension's CSP would block anyway).
function attachImageErrorRecovery() {
  var cardsEl = document.getElementById('cards');
  if (!cardsEl || cardsEl.dataset.mnemonicsImageRecovery === '1') return;
  cardsEl.dataset.mnemonicsImageRecovery = '1';
  cardsEl.addEventListener('error', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'IMG') return;
    if (target.dataset.mnemonicsRetried === '1') {
      // Already retried this session — don't loop.
      target.style.background = 'var(--gray-bg)';
      target.alt = 'Ảnh không khả dụng';
      return;
    }
    target.dataset.mnemonicsRetried = '1';
    // Throttle: if multiple images break at once (very common — they
    // all expire together), we only want to fetch the list once.
    if (!window.__mnemonicsImageErrorTimer) {
      window.__mnemonicsImageErrorTimer = setTimeout(function () {
        window.__mnemonicsImageErrorTimer = null;
        loadFromExtension(null, { silent: true });
      }, 400);
    }
  }, true /* capture: error events don't bubble */);
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

// Auto-switch with system when in 'system' mode
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

// Sync settings page UI with current state
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
  if (nameEl) nameEl.textContent = loggedIn ? (currentUser.name || currentUser.email) : 'Guest';
  if (emailEl) emailEl.textContent = loggedIn ? currentUser.email : 'Not signed in';
  if (btnEl) btnEl.textContent = loggedIn ? 'Sign out' : 'Sign in';
  if (planEl) planEl.textContent = loggedIn ? ((currentUser.plan || 'Memory') + ' (free)') : 'Memory (free)';
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
      showToast('? Export complete');
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
      if (!newItems) { showToast('Invalid file!'); return; }
      var values = {};
      values[userItemsKey()] = newItems.slice(0, 200);
      if (Array.isArray(data.reminders)) values[userRemindersKey()] = data.reminders;
      if (data.settings) values.mnemonics_settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      setStorageValues(values, function() {
        loadSettings(function() {
          loadReminders(function() {
            loadFromExtension(function() {
              syncSettingsUI();
              showToast('? Imported ' + newItems.length + ' items');
            });
          });
        });
      });
    } catch (err) {
      showToast('Failed to read file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function clearAllData() {
  var ok = window.confirm('Delete ALL memories and reminders? This cannot be undone.\n\nTip: Export your data first as a backup.');
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
    showToast('All data has been deleted');
  });
}

// ===== BIND ALL EVENT LISTENERS (no inline onclick) =====
document.addEventListener('DOMContentLoaded', function() {
  try {
  // Wire the delegated image-error recovery BEFORE anything else so we
  // catch broken Supabase signed URLs on first paint, not after a
  // subsequent render.
  attachImageErrorRecovery();

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

  var authForgotLink = document.getElementById('auth-forgot-link');
  if (authForgotLink) authForgotLink.addEventListener('click', function() {
    var forgotModal = document.getElementById('forgot-modal');
    var loginEmail = document.getElementById('login-email');
    var forgotEmail = document.getElementById('forgot-email');
    if (forgotEmail && loginEmail) forgotEmail.value = loginEmail.value || '';
    var errEl = document.getElementById('forgot-error');
    var succEl = document.getElementById('forgot-success');
    if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }
    if (succEl) { succEl.classList.remove('show'); succEl.textContent = ''; }
    if (forgotModal) forgotModal.classList.add('open');
  });

  var btnForgotCancel = document.getElementById('btn-forgot-cancel');
  if (btnForgotCancel) btnForgotCancel.addEventListener('click', function() {
    var forgotModal = document.getElementById('forgot-modal');
    if (forgotModal) forgotModal.classList.remove('open');
  });

  var btnForgotSubmit = document.getElementById('btn-forgot-submit');
  if (btnForgotSubmit) btnForgotSubmit.addEventListener('click', function(e) {
    e.preventDefault();
    handleForgotPassword();
  });

  var forgotEmailInput = document.getElementById('forgot-email');
  if (forgotEmailInput) forgotEmailInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleForgotPassword();
  });

  var btnForgotBack = document.getElementById('btn-forgot-back');
  if (btnForgotBack) btnForgotBack.addEventListener('click', function() {
    var stepRequest = document.getElementById('forgot-step-request');
    var stepReset = document.getElementById('forgot-step-reset');
    var titleEl = document.getElementById('forgot-modal-title');
    var errEl = document.getElementById('forgot-error');
    var succEl = document.getElementById('forgot-success');
    if (stepRequest) stepRequest.style.display = 'block';
    if (stepReset) stepReset.style.display = 'none';
    if (titleEl) titleEl.textContent = '🔑 Khôi phục mật khẩu';
    if (errEl) { errEl.classList.remove('show'); errEl.textContent = ''; }
    if (succEl) { succEl.classList.remove('show'); succEl.textContent = ''; }
  });

  var btnForgotResetSubmit = document.getElementById('btn-forgot-reset-submit');
  if (btnForgotResetSubmit) btnForgotResetSubmit.addEventListener('click', function(e) {
    e.preventDefault();
    handleForgotResetSubmit();
  });

  var forgotUrlInput = document.getElementById('forgot-reset-url');
  if (forgotUrlInput) forgotUrlInput.addEventListener('input', function() {
    var extracted = extractTokensFromResetUrl(this.value.trim());
    if (!extracted) return;
    var accInput = document.getElementById('forgot-access-token');
    var refInput = document.getElementById('forgot-refresh-token');
    if (accInput && !accInput.value && extracted.accessToken) accInput.value = extracted.accessToken;
    if (refInput && !refInput.value && extracted.refreshToken) refInput.value = extracted.refreshToken;
  });

  var btnResend = document.getElementById('btn-resend-verification');
  if (btnResend) btnResend.addEventListener('click', handleResendVerification);

  var btnRefreshAccount = document.getElementById('settings-refresh-account');
  if (btnRefreshAccount) btnRefreshAccount.addEventListener('click', handleRefreshAccount);

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

  // Favorites: enter the dashboard with `currentFavoritesOnly = true`,
  // matching the user's mental model "I clicked Yêu thích → see only
  // hearts". Toggling it back off requires clicking the chip again or
  // the dashboard sidebar entry.
  var sidebarFavorites = document.getElementById('sidebar-favorites');
  if (sidebarFavorites) sidebarFavorites.addEventListener('click', function() {
    currentFavoritesOnly = true;
    updateFavoritesChip();
    showPage('dashboard');
  });

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
    if (chip) {
      currentFormatFilter = chip.dataset.format;
      this.querySelectorAll('.format-chip').forEach(function(c) { c.classList.toggle('active', c === chip); });
      renderDashboard();
      return;
    }
    // The Favorites chip lives in the same chip row but uses a
    // different data-attribute, so the format handler above doesn't
    // touch it. Toggle the global `currentFavoritesOnly` flag instead.
    var favChip = e.target.closest('[data-favorites-only]');
    if (favChip) {
      currentFavoritesOnly = !currentFavoritesOnly;
      updateFavoritesChip();
      renderDashboard();
    }
  });

  // ---- Book rail interactions ----
  var cardsContainer = document.getElementById('cards-container');
  if (cardsContainer) cardsContainer.addEventListener('click', function(e) {
    var readerChip = e.target.closest('[data-reader-open]');
    if (readerChip) {
      e.preventDefault();
      e.stopPropagation();
      openReaderModal(readerChip.getAttribute('data-reader-open'));
      return;
    }

    var relatedBtn = e.target.closest('[data-related-id]');
    if (relatedBtn) {
      loadRelatedMemories(relatedBtn);
      return;
    }

    var relatedOpen = e.target.closest('[data-related-open-url]');
    if (relatedOpen) {
      var relatedId = relatedOpen.dataset.relatedOpenUrl;
      var target = items.find(function(item) { return String(item.id) === String(relatedId); });
      if (target) {
        var targetCard = document.querySelector('[data-memory-id="' + CSS.escape(relatedId) + '"]');
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetCard.style.outline = '2px solid var(--purple)';
          setTimeout(function() { targetCard.style.outline = ''; }, 1400);
        } else {
          showToast('This related memory is not in the current view.');
        }
      } else {
        showToast('Open the related memory from the dashboard results.');
      }
      return;
    }
  });

  // ---- Reader modal interactions (delegated) ----
  var readerModal = document.getElementById('reader-modal');
  if (readerModal) {
    readerModal.addEventListener('click', function(e) {
      // Close on backdrop or ×
      if (e.target.closest('[data-reader-close]')) {
        closeReaderModal();
        return;
      }

      // Remove a tag chip
      var rmTag = e.target.closest('[data-rmtag]');
      if (rmTag && readerCurrentItem) {
        var removeName = rmTag.getAttribute('data-rmtag');
        var nextTags = (Array.isArray(readerCurrentItem.tags) ? readerCurrentItem.tags : [])
          .filter(function(t) { return String(t) !== String(removeName); });
        readerSaveTags(readerCurrentItem.id, nextTags).then(function() {
          readerCurrentItem.tags = nextTags;
          readerRenderTags(readerCurrentItem);
          if (typeof renderDashboard === 'function') renderDashboard();
        }).catch(function(err) {
          if (typeof showToast === 'function') showToast('Không xóa được tag: ' + (err.message || err));
        });
        return;
      }

      // Show "+ Add tag" input row
      var addTagBtn = e.target.closest('#reader-add-tag');
      if (addTagBtn) {
        var row = document.getElementById('reader-tag-input-row');
        if (row) {
          row.style.display = 'flex';
          var input = document.getElementById('reader-tag-input');
          if (input) input.focus();
        }
        return;
      }

      // Save new tag
      if (e.target.closest('#reader-tag-save') && readerCurrentItem) {
        var tagInput = document.getElementById('reader-tag-input');
        if (!tagInput) return;
        var raw = String(tagInput.value || '').trim();
        if (!raw) {
          if (typeof showToast === 'function') showToast('Nhập tag trước đã.');
          return;
        }
        var existing = Array.isArray(readerCurrentItem.tags) ? readerCurrentItem.tags.slice() : [];
        if (existing.some(function(t) { return String(t).toLowerCase() === raw.toLowerCase(); })) {
          if (typeof showToast === 'function') showToast('Tag "' + raw + '" đã tồn tại.');
          return;
        }
        existing.push(raw);
        readerSaveTags(readerCurrentItem.id, existing).then(function() {
          readerCurrentItem.tags = existing;
          tagInput.value = '';
          readerRenderTags(readerCurrentItem);
          if (typeof renderDashboard === 'function') renderDashboard();
          if (typeof showToast === 'function') showToast('Đã thêm tag.');
        }).catch(function(err) {
          if (typeof showToast === 'function') showToast('Lỗi: ' + (err.message || err));
        });
        return;
      }

      // Save note
      if (e.target.closest('#reader-note-save') && readerCurrentItem) {
        var ta = document.getElementById('reader-note-text');
        if (!ta) return;
        var newNote = String(ta.value || '');
        readerSaveNote(readerCurrentItem.id, newNote).then(function() {
          readerCurrentItem.note = newNote;
          if (typeof showToast === 'function') showToast('Đã lưu ghi chú.');
        }).catch(function(err) {
          if (typeof showToast === 'function') showToast('Lỗi: ' + (err.message || err));
        });
        return;
      }

      // Favorite toggle
      if (e.target.closest('#reader-fav') && readerCurrentItem) {
        if (typeof toggleFavorite === 'function') {
          toggleFavorite(readerCurrentItem.id);
          // After toggleFavorite mutates isFavorite locally, refresh the
          // heart button next tick.
          setTimeout(function() {
            var fresh = getReaderItem(readerCurrentItem.id);
            if (!fresh) return;
            var favBtn = document.getElementById('reader-fav');
            if (favBtn) {
              favBtn.classList.toggle('is-favorite', !!fresh.isFavorite);
              favBtn.textContent = fresh.isFavorite ? '\u2665' : '\u2661';
              favBtn.title = fresh.isFavorite ? 'Bỏ yêu thích' : 'Yêu thích';
            }
            readerCurrentItem.isFavorite = fresh.isFavorite;
          }, 0);
        }
        return;
      }

      // Copy
      if (e.target.closest('#reader-copy')) {
        readerCopy();
        return;
      }

      // Open source link
      var sourceLink = e.target.closest('#reader-source-link');
      if (sourceLink) {
        var u = sourceLink.dataset.url;
        if (u) {
          if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url: u });
          } else {
            window.open(u, '_blank', 'noopener');
          }
        }
        return;
      }

      // Delete
      if (e.target.closest('#reader-delete') && readerCurrentItem) {
        var delId = readerCurrentItem.id;
        if (!confirm('Xóa item này vĩnh viễn?')) return;
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          if (typeof showToast === 'function') showToast('Không xóa được ngoài extension context.');
          return;
        }
        chrome.runtime.sendMessage({ type: 'DELETE_ITEM', itemId: delId }, function(response) {
          if (chrome.runtime && chrome.runtime.lastError) {
            if (typeof showToast === 'function') showToast('Lỗi: ' + chrome.runtime.lastError.message);
            return;
          }
          if (response && response.ok) {
            if (typeof showToast === 'function') showToast('Đã xóa.');
            closeReaderModal();
            // Mutate local arrays so the next render reflects the deletion
            if (typeof items !== 'undefined' && Array.isArray(items)) {
              items = items.filter(function(i) { return String(i.id) !== String(delId); });
            }
            if (typeof baseMemoryItems !== 'undefined' && Array.isArray(baseMemoryItems)) {
              baseMemoryItems = baseMemoryItems.filter(function(i) { return String(i.id) !== String(delId); });
            }
            if (typeof renderDashboard === 'function') renderDashboard();
          } else {
            if (typeof showToast === 'function') showToast('Không xóa được: ' + ((response && response.error) || 'unknown'));
          }
        });
        return;
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && readerModal.classList.contains('open')) {
        closeReaderModal();
      }
    });

    // Tag input: Enter to save
    document.addEventListener('keydown', function(e) {
      if (!readerModal.classList.contains('open')) return;
      var input = document.getElementById('reader-tag-input');
      if (e.key === 'Enter' && document.activeElement === input) {
        e.preventDefault();
        document.getElementById('reader-tag-save') && document.getElementById('reader-tag-save').click();
      }
    });
  }

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
      showToast('Opening ' + bookCard.dataset.bookOpen + ' on the partner page (demo)');
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

  // ---- Modal: change type ? show URL/file input ----
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
  if (btnUpgrade) btnUpgrade.addEventListener('click', function() { showToast('Redirecting to checkout?'); });

  var btnModalCancel = document.getElementById('btn-modal-cancel');
  if (btnModalCancel) btnModalCancel.addEventListener('click', closeModal);

  var btnModalSave = document.getElementById('btn-modal-save');
  if (btnModalSave) btnModalSave.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    saveItem();
  });

  // Fallback: event delegation across the entire modal
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

    // Lazy-load placeholder — the captured image exists on the server
    // but the inline `imageUrl` came back null (signed URL signing
    // hiccuped when listing items). On click, ask the API for a
    // freshly-signed URL, persist it on the item, and re-render the
    // card so the user sees the actual image without a page reload.
    var lazyTarget = e.target.closest('[data-image-lazy]');
    if (lazyTarget) {
      lazyLoadItemImage(lazyTarget);
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

// Click outside to close dropdown
document.addEventListener('click', function() {
  document.querySelectorAll('.card-dropdown.open').forEach(d => d.classList.remove('open'));
});

// Event delegation for the cards container
document.addEventListener('click', function(e) {
  // Click on a card
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

  // Click delete
  var deleteBtn = e.target.closest('[data-deleteid]');
  if (deleteBtn) {
    e.stopPropagation();
    deleteItem(deleteBtn.dataset.deleteid);
    return;
  }

  // Click the heart: toggle the favorite flag. The button stops
  // propagation so it doesn't bubble up to the menu-close handler
  // listening on document. `e.preventDefault` keeps the button from
  // triggering any form-submit if the dashboard is ever embedded in
  // one.
  var favBtn = e.target.closest('[data-favoriteid]');
  if (favBtn) {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(favBtn.dataset.favoriteid);
    return;
  }

  // Click to open link
  var linkBtn = e.target.closest('[data-open-link]');
  if (linkBtn) {
    e.preventDefault();
    e.stopPropagation();
    openUrlInNewTab(linkBtn.dataset.openLink);
    return;
  }
});

// ===== DELETE ITEM =====
//
// Two cases:
//   1. The row was already synced to the server (`serverSynced === true`
//      or, for legacy rows, no `pendingUpload` flag). We issue the
//      DELETE through the background script (which handles 401 ? refresh
//      ? retry) and only remove the local row on success. A 204 from
//      the API is the success signal; clients MUST NOT try to parse a
//      JSON body off a 204.
//   2. The row is purely local (pendingUpload). We just drop it.
function deleteItem(id) {
  const target = items.find(function(i) { return String(i.id) === String(id); });
  if (target && target.sourceType === 'reminder') {
    deleteReminder(target.reminderId);
    return;
  }

  const isPending = target && target.pendingUpload === true;
  const looksServerId = target && /^[0-9a-f-]{8,}/i.test(String(target.id));

  if (isPending || !looksServerId) {
    baseMemoryItems = baseMemoryItems.filter(function(i) { return String(i.id) !== String(id); });
    items = composeDashboardItems();
    renderDashboard();
    showToast('Memory removed');
    return;
  }

  // Optimistic local removal so the UI feels instant; we'll re-add if
  // the network call fails so the user can retry.
  baseMemoryItems = baseMemoryItems.filter(function(i) { return String(i.id) !== String(id); });
  items = composeDashboardItems();
  renderDashboard();

  sendDeleteToServer(id).then(function() {
    loadFromExtension();
    showToast('Memory deleted');
  }).catch(function(err) {
    // Re-add the row so the user doesn't think it's gone.
    if (target) {
      baseMemoryItems.unshift(target);
      items = composeDashboardItems();
      renderDashboard();
    }
    showToast('Could not delete: ' + (err && err.message ? err.message : 'unknown error'));
  });
}

// Issue DELETE /api/v1/items/:id. The background script handles token
// refresh; we only ever see a resolved promise (success or final
// failure). 204 No Content is the success case and we MUST NOT parse
// the body ? older code threw here when the response was empty.
function sendDeleteToServer(id) {
  return new Promise(function(resolve, reject) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('This page must run inside the extension to delete from the server.'));
      return;
    }
    chrome.runtime.sendMessage({ type: 'DELETE_ITEM', itemId: id }, function(response) {
      if (chrome.runtime && chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'Could not reach the background script.'));
        return;
      }
      if (response && response.ok) resolve();
      else reject(new Error((response && response.error) || 'Delete API failed.'));
    });
  });
}

// ===== FAVORITE ITEM =====
//
// Optimistic flip: the user clicks the heart, we immediately update
// the in-memory item, re-render the dashboard (the reconciler only
// touches cards whose `isFavorite` flag actually changed, so neighbours
// stay put), then ask the background script to PATCH the row on the
// server. On failure we revert the local flip and toast the error.
function toggleFavorite(id) {
  var target = baseMemoryItems.find(function(i) { return String(i.id) === String(id); });
  if (!target) {
    showToast('Memory not found.');
    return;
  }

  if (target.pendingUpload === true || !/^[0-9a-f-]{8,}/i.test(String(target.id))) {
    // Not yet synced. Until it is, there's no server-side flag to flip.
    showToast('Save this memory first to favorite it.');
    return;
  }

  var next = !target.isFavorite;
  // Optimistic update on the underlying record + any composed
  // dashboard item so the next render sees the new value.
  target.isFavorite = next;
  for (var k = 0; k < items.length; k++) {
    if (String(items[k].id) === String(id)) items[k].isFavorite = next;
  }
  renderDashboard();

  sendFavoritePatch(id, next).then(function() {
    // No-op on success — the optimistic flip is the truth until the
    // next background sync round-trip re-reads the row. A toast here
    // would be noise on every click.
  }).catch(function(err) {
    // Rollback so the UI doesn't lie about the persisted state.
    target.isFavorite = !next;
    for (var j = 0; j < items.length; j++) {
      if (String(items[j].id) === String(id)) items[j].isFavorite = !next;
    }
    renderDashboard();
    showToast('Could not update favorite: ' + (err && err.message ? err.message : 'unknown error'));
  });
}

function sendFavoritePatch(id, isFavorite) {
  return new Promise(function(resolve, reject) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('This page must run inside the extension to favorite items.'));
      return;
    }
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_FAVORITE_ITEM', itemId: id, isFavorite: isFavorite },
      function(response) {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Could not reach the background script.'));
          return;
        }
        if (response && response.ok) resolve(response.item);
        else reject(new Error((response && response.error) || 'Favorite API failed.'));
      }
    );
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { userCacheKey, userApiCacheKey, apiItemToLocalShape, isPendingItem, discardExplicitPending, cleanupLegacyPendingCaptures, mergeServerItems, fetchItemsFromApi, loadFromExtension, toggleFavorite };
}
