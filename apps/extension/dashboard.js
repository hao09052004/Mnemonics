// =============================================================
// Mx Dashboard — vanilla JS, CSP-safe, no build, no inline.
//
// Architecture:
//   - state          : single source of truth, mutated via setState
//   - routes         : 'everything' | 'favorites' | 'spaces' | 'rediscover'
//                      | 'reminders' | 'settings' | 'login' | 'detail' | 'capture'
//   - renderX()      : re-render a region from state
//   - fetchX()       : wrap api-client + auth refresh
//
// The dashboard reads items via GET /api/v1/items, search via
// POST /api/v1/search, and patches / deletes via background bridge
// (chrome.runtime.sendMessage) so the background can refresh the
// access token out-of-band.
//
// All state mutations go through setState(patch). Region renders are
// idempotent and rebuild innerHTML from state — no virtual DOM.
// =============================================================

'use strict';

// ----- shared constants -----------------------------------------------

// `MNEMONICS_API_URL` is provided by `api-client.js` (declared with `var`
// so this is a no-op redeclaration). We just expose an alias on
// `window.MnemonicsDashboard` so internal functions don't depend on it
// leaking through the global namespace — keeps the bundled dashboard
// collision-free when more classic scripts get loaded onto the page.
// eslint-disable-next-line no-redeclare

// 6 memory card variants. Each maps to a CSS class suffix and an API kind set.
const VARIANT_KINDS = {
  all:         [],     // sentinel for "no filter"
  note:        ['text'],
  article:     ['link'],
  image:       ['image'],
  screenshot:  ['screenshot'],
  highlight:   ['text'], // highlighted items are still text kind on the BE
  document:    ['document']
};

const VARIANT_LABEL = {
  all: 'All', note: 'Notes', article: 'Articles', image: 'Images',
  screenshot: 'Screenshots', highlight: 'Highlights', document: 'Documents'
};

// ----- state -----------------------------------------------------------

const state = {
  route: 'login',
  user: null,
  items: [],
  spaces: [],
  search: { query: '', inFlight: false, hits: null },
  filter: { variant: 'all', favoritesOnly: false },
  detail: null,
  capture: false,
  loading: false,
  error: null
};

let lastRoute = null;       // persisted across reloads
let apiEpoch = 0;
let searchTimer = null;
let authMode = 'login';     // login | signup

// ----- helpers ---------------------------------------------------------

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const initialsOf = (nameOrEmail) => {
  const v = String(nameOrEmail || 'U').trim();
  if (v.includes('@')) return v[0].toUpperCase();
  return v.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase() || 'M';
};

function setState(patch) {
  Object.assign(state, patch);
  renderRoute();
}

// ----- session & auth --------------------------------------------------

function loadSession() {
  return new Promise((resolve) => {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('mnemonics_session') : null;
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && s.accessToken) {
          if (s.expiresAt && s.expiresAt * 1000 < Date.now()) return resolve(null);
          return resolve(s);
        }
      } catch (_) { /* ignore */ }
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('mnemonics_session', (r) => {
        resolve(r && r.mnemonics_session ? r.mnemonics_session : null);
      });
    } else {
      resolve(null);
    }
  });
}

function saveSession(session) {
  // Unwrap the API envelope. The server returns `{ user, session: { ... } }`
  // but every reader (dashboard.js, screenshot-cropper.js, background.js,
  // api-client.js, loadSession() above) expects the *unwrapped* shape with
  // a top-level `accessToken`. Storing the wrapped envelope would cause
  // `session.accessToken` to be undefined everywhere, manifesting as
  // 'Bạn cần đăng nhập trước khi lưu ảnh' right after a fresh sign-up.
  // (Regression: 2026-10-04 dashboard sign-in loop.)
  const flat = session && session.session ? session.session : session;
  state.user = flat && flat.user ? flat.user : (session && session.user ? session.user : null);
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ mnemonics_session: flat || null });
  }
  if (typeof localStorage !== 'undefined') {
    if (flat) localStorage.setItem('mnemonics_session', JSON.stringify(flat));
    else localStorage.removeItem('mnemonics_session');
  }
}

async function authPost(path, body, accessToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  const response = await fetch(window.MNEMONICS_API_URL + '/api/v1/auth/' + path, {
    method: 'POST', headers, body: JSON.stringify(body || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error && data.error.message || 'Authentication failed');
  return data.data;
}

async function loginUser(email, password) {
  const data = await authPost('login', { email, password });
  saveSession(data);
  return data;
}

async function signupUser(name, email, password) {
  const data = await authPost('register', { name, email, password });
  saveSession(data);
  return data;
}

// ----- data fetches ----------------------------------------------------

async function fetchItems({ favorite = false, limit = 50, capturedAfter = null } = {}) {
  const session = await loadSession();
  if (!session || !session.accessToken) return null;
  let token = session.accessToken;

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (favorite) params.set('favorite', 'true');

  async function req(t) {
    return fetch(window.MNEMONICS_API_URL + '/api/v1/items?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + t }
    });
  }

  let r = await req(token);
  if (r.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) { token = refreshed.accessToken; r = await req(token); }
  }
  if (r.status === 401) { handleAuthFailure(); return null; }
  if (!r.ok) throw new Error('Failed to load items (HTTP ' + r.status + ')');
  const body = await r.json();
  return body.data || { items: [], total: 0, limit, offset: 0 };
}

async function fetchSpaces() {
  const session = await loadSession();
  if (!session || !session.accessToken) return [];
  let token = session.accessToken;

  async function req(t) {
    return fetch(window.MNEMONICS_API_URL + '/api/v1/spaces', {
      headers: { Authorization: 'Bearer ' + t }
    });
  }
  let r = await req(token);
  if (r.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) { token = refreshed.accessToken; r = await req(token); }
  }
  if (r.status === 401) { handleAuthFailure(); return []; }
  if (!r.ok) return [];
  const body = await r.json();
  return (body.data && body.data.spaces) || [];
}

async function searchItems(q, filters) {
  const session = await loadSession();
  if (!session || !session.accessToken) return [];
  let token = session.accessToken;
  const payload = { q, limit: 50, offset: 0 };
  if (filters && filters.kind && filters.kind.length) payload.filters = { kind: filters.kind };

  async function req(t) {
    return fetch(window.MNEMONICS_API_URL + '/api/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify(payload)
    });
  }
  let r = await req(token);
  if (r.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) { token = refreshed.accessToken; r = await req(token); }
  }
  if (r.status === 401) { handleAuthFailure(); return []; }
  if (!r.ok) return [];
  const body = await r.json();
  return (body.hits || []).map((hit) => ({
    id: hit.id,
    kind: hit.kind || 'text',
    title: hit.title || 'Untitled',
    excerpt: hit.snippet || '',
    note: hit.snippet || '',
    tags: Array.isArray(hit.tags) ? hit.tags : [],
    savedAt: hit.captured_at || new Date().toISOString(),
    capturedAt: hit.captured_at || null,
    isFavorite: false,
    serverSynced: true,
    searchScore: hit.score,
    rawQuery: q
  }));
}

async function refreshToken() {
  const session = await loadSession();
  if (!session || !session.refreshToken) return null;
  try {
    const r = await fetch(window.MNEMONICS_API_URL + '/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!r.ok) { handleAuthFailure(); return null; }
    const body = await r.json();
    const fresh = body.data || {};
    // API envelope is {user, session:{accessToken,...}}. saveSession()
    // unwraps it before storing, so pass the envelope shape here.
    saveSession(fresh);
    return loadSession();
  } catch (_) { handleAuthFailure(); return null; }
}

// Centralised auth-failure handler: clears the session, drops in-memory
// state, shows a toast, and routes back to /login so the user can
// re-authenticate instead of staring at a 401'd grid.
function handleAuthFailure() {
  saveSession(null);
  state.items = []; state.spaces = []; state.detail = null; state.search.results = [];
  setState({ route: 'login', user: null });
  toast('Phiên đã hết hạn, vui lòng đăng nhập lại', 'error');
}

async function patchItem(itemId, patch) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false, error: 'No background bridge available' });
      return;
    }
    chrome.runtime.sendMessage({ type: 'PATCH_ITEM', itemId, patch }, (response) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'No response' });
    });
  });
}

async function deleteItem(itemId) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false, error: 'No background bridge available' });
      return;
    }
    chrome.runtime.sendMessage({ type: 'DELETE_ITEM', itemId }, (response) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: 'No response' });
    });
  });
}

async function toggleFavorite(itemId, isFavorite) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ ok: false });
      return;
    }
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_FAVORITE_ITEM', itemId, isFavorite },
      (response) => resolve(response || { ok: false })
    );
  });
}

// ----- kind mapping ----------------------------------------------------

function kindToVariant(item) {
  if (!item) return 'note';
  if (item.kind === 'link') return 'article';
  if (item.kind === 'image') return 'image';
  if (item.kind === 'screenshot') return 'screenshot';
  if (item.kind === 'document') return 'document';
  if (item.kind === 'text') {
    if (!item.raw_text && item.ocr_text) return 'highlight';
    return 'note';
  }
  return 'note';
}

function itemMatchesVariant(item, variant) {
  if (variant === 'all') return true;
  const kinds = VARIANT_KINDS[variant] || [];
  return kinds.includes(item.kind);
}

// ----- top-level render dispatch --------------------------------------

function renderRoute() {
  document.body.dataset.route = state.route;
  // Show top nav and mobile nav only when authed
  document.querySelectorAll('[data-when="authed"]').forEach((el) => {
    el.hidden = !state.user;
  });

  if (state.route === 'login') { renderLogin(); return; }
  if (state.route === 'everything' || state.route === 'favorites' || state.route === 'rediscover') {
    renderGrid(); return;
  }
  if (state.route === 'spaces') { renderSpaces(); return; }
  if (state.route === 'reminders') { renderReminders(); return; }
  if (state.route === 'settings') { renderSettings(); return; }
  if (state.route === 'detail') { renderDetail(); return; }
  if (state.route === 'capture') { /* no-op; CSS handles it */ return; }

  highlightActiveTab();
}

// ----- nav + tab highlighting -----------------------------------------

function highlightActiveTab() {
  document.querySelectorAll('[data-route-tab]').forEach((tab) => {
    if (tab.dataset.routeTab === state.route) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

// ----- EVERYTHING / FAVORITES / REDISCOVER (shared grid) --------------

function renderGrid() {
  highlightActiveTab();

  const titles = {
    everything: ['Everything', 'Your saved memories in one place.'],
    favorites: ['Favorites', 'Memories you marked with a heart.'],
    rediscover: ['Rediscover', 'Things worth remembering again.']
  };
  const [title, sub] = titles[state.route] || titles.everything;
  const t = $('route-title'); if (t) t.textContent = title;
  const s = $('route-sub');   if (s) s.textContent = sub;

  // Show favorites chip only when on favorites route.
  state.filter.favoritesOnly = (state.route === 'favorites');

  // Sync filter chips.
  document.querySelectorAll('#filter-chips .mnx-chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', chip.dataset.variant === state.filter.variant ? 'true' : 'false');
  });

  // Resolve the items list: search hits > server items.
  const items = state.search.hits || state.items;

  // Apply variant filter + favorites-only.
  const filtered = items.filter((it) => {
    if (!itemMatchesVariant(it, state.filter.variant)) return false;
    if (state.filter.favoritesOnly && !it.isFavorite) return false;
    return true;
  });

  $('memory-count').textContent = filtered.length + ' memor' + (filtered.length === 1 ? 'y' : 'ies');

  const host = $('cards-host');
  const empty = $('cards-empty');
  const skel  = $('cards-skeleton');
  const cards = $('cards-container');

  if (state.loading) {
    empty.hidden = true; cards.innerHTML = ''; skel.hidden = false;
    return;
  }
  skel.hidden = true;

  if (filtered.length === 0) {
    cards.innerHTML = '';
    empty.hidden = false;
    const t1 = $('empty-title'), t2 = $('empty-text');
    if (state.search.query) {
      t1.textContent = 'No memories found.';
      t2.textContent = 'Try another keyword or a different content type.';
    } else if (state.filter.favoritesOnly) {
      t1.textContent = 'No favorites yet.';
      t2.textContent = 'Tap the heart on any memory to add it here.';
    } else {
      t1.textContent = 'Your memory starts here.';
      t2.textContent = 'Save something worth remembering.';
    }
    return;
  }
  empty.hidden = true;
  cards.innerHTML = filtered.map(renderCard).join('');
}

function renderCard(item) {
  const variant = kindToVariant(item);
  const tags = Array.isArray(item.tags) ? item.tags.slice(0, 6) : [];
  const tagBlock = tags.length
    ? `<div class="mnx-card__meta-tags">${tags.map((t) => '#' + escapeHtml(t)).join(' ')}</div>` : '';
  const isFav = !!item.isFavorite;
  const eyebrow = VARIANT_LABEL[variant] || 'Memory';
  const excerpt = (item.excerpt || item.note || '').slice(0, 220);
  const titleText = escapeHtml(item.title || (variant === 'screenshot' ? 'Screenshot' : 'Saved item'));
  const highlightTitle = item.rawQuery ? highlightMatch(item.title || '', item.rawQuery) : titleText;
  const score = (typeof item.searchScore === 'number')
    ? `<span class="mnx-chip" style="margin-left:8px">${(item.searchScore * 100).toFixed(0)}%</span>` : '';

  let mediaBlock = '';
  if ((variant === 'image' || variant === 'screenshot') && item.image_url) {
    mediaBlock = `<div class="mnx-card__image"><img src="${escapeHtml(item.image_url)}" alt="${titleText}" loading="lazy" decoding="async"></div>`;
  } else if (variant === 'article' && item.image_url) {
    mediaBlock = `<div class="mnx-card__image"><img src="${escapeHtml(item.image_url)}" alt="${titleText}" loading="lazy" decoding="async"></div>`;
  }

  const excerptBlock = (variant !== 'highlight' && excerpt)
    ? `<p>${escapeHtml(excerpt)}</p>` : '';

  const meta = (variant !== 'highlight')
    ? `<div class="mnx-card__meta"><span>${escapeHtml(sourceLabel(item))}</span>${tagBlock}</div>` : '';

  return `<article class="mnx-card ${variant}" data-memory-id="${escapeHtml(String(item.id))}" tabindex="0" role="button" aria-label="Open memory">
    ${mediaBlock}
    <div class="mnx-card__body">
      <div class="mnx-card__top">
        <span class="mnx-eyebrow"><i></i>${eyebrow}${score}</span>
        <div class="mnx-card__actions">
          <button class="mnx-iconbtn ${isFav ? 'is-favorite' : ''}" data-action="favorite" aria-pressed="${isFav}" aria-label="Toggle favorite">
            <svg width="14" height="14"><use href="#i-heart"/></svg>
          </button>
          <button class="mnx-iconbtn" data-action="more" aria-label="More"><svg width="14" height="14"><use href="#i-more"/></svg></button>
        </div>
      </div>
      <h3>${highlightTitle}</h3>
      ${excerptBlock}
      ${meta}
    </div>
  </article>`;
}

function sourceLabel(item) {
  if (item.source_url) {
    try {
      const u = new URL(item.source_url);
      return u.hostname.replace(/^www\./, '');
    } catch (_) { return item.source_url.slice(0, 40); }
  }
  if (item.kind === 'image') return 'Image';
  if (item.kind === 'screenshot') return 'Screenshot';
  if (item.kind === 'note') return 'Note';
  return 'Memory';
}

function highlightMatch(text, query) {
  if (!text || !query) return escapeHtml(text || '');
  const safe = escapeHtml(String(text));
  const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return safe.replace(re, '<mark style="background:var(--purple-soft);color:var(--purple-text);padding:0 3px;border-radius:3px">$1</mark>');
}

// ----- SPACES ----------------------------------------------------------

function renderSpaces() {
  highlightActiveTab();
  const grid = $('spaces-grid');
  if (!state.spaces || state.spaces.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:13px">No spaces yet. Save some memories with shared tags to start one.</p>';
    return;
  }
  grid.innerHTML = state.spaces.map((s) => `
    <button class="mnx-space-card" data-space-id="${escapeHtml(s.id)}">
      <h3>${escapeHtml(s.name || 'Untitled space')}</h3>
      <p>${escapeHtml(s.item_count || 0)} memories · updated ${escapeHtml(formatRelative(s.updated_at))}</p>
    </button>
  `).join('');
}

function formatRelative(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

// ----- REMINDERS ------------------------------------------------------

function renderReminders() {
  highlightActiveTab();
  const host = $('reminders-host');
  const items = state.items.filter((it) => it.kind === 'text' && Array.isArray(it.checks) && it.checks.length);
  if (items.length === 0) {
    host.innerHTML = `
      <div class="mnx-empty">
        <div class="mnx-empty__inner">
          <div class="mnx-empty__mark"><span></span><span></span><span></span></div>
          <h1>No reminders yet</h1>
          <p>Save notes with checkboxes from the popup to create reminders.</p>
        </div>
      </div>`;
    return;
  }
  host.innerHTML = items.map((it) => {
    const done = it.checks.filter((c) => c.done).length;
    const total = it.checks.length;
    return `<article class="mnx-card note" data-memory-id="${escapeHtml(String(it.id))}" style="max-width:720px;margin-bottom:14px;cursor:default">
      <div class="mnx-card__body">
        <div class="mnx-card__top">
          <span class="mnx-eyebrow"><i></i>Reminder · ${done}/${total} done</span>
        </div>
        <h3>${escapeHtml(it.title || 'Reminder')}</h3>
        ${it.checks.map((c, i) => `
          <label style="display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--border);color:${c.done ? 'var(--muted)' : 'var(--text)'}">
            <input type="checkbox" data-toggle-check="${escapeHtml(String(it.id))}" data-check-index="${i}" ${c.done ? 'checked' : ''}>
            <span style="${c.done ? 'text-decoration:line-through' : ''}">${escapeHtml(c.text || '')}</span>
          </label>
        `).join('')}
      </div>
    </article>`;
  }).join('');
}

// ----- SETTINGS -------------------------------------------------------

function renderSettings() {
  highlightActiveTab();
  const host = $('settings-host');
  const u = state.user || {};
  host.innerHTML = `
    <section style="padding:18px 0;border-top:1px solid var(--border)">
      <div class="mnx-section-label">Account</div>
      <p style="margin:8px 0 4px;font:500 14px/1.4 var(--font-sans);color:var(--text)">${escapeHtml(u.name || u.email || 'Signed in')}</p>
      <p style="margin:0;color:var(--muted);font-size:12px">${escapeHtml(u.email || '')}</p>
    </section>
    <section style="padding:18px 0;border-top:1px solid var(--border)">
      <div class="mnx-section-label">Extension</div>
      <p style="margin:8px 0;color:var(--secondary);font-size:13px;line-height:1.5">
        The offline dashboard is loaded from this extension. Click the popup's <b>Dashboard</b> button any time to open this view.
      </p>
    </section>
    <section style="padding:18px 0;border-top:1px solid var(--border)">
      <div class="mnx-section-label">Sign out</div>
      <button class="mnx-btn-ghost" data-action="logout" style="margin-top:10px">Log out</button>
    </section>
  `;
}

// ----- LOGIN ----------------------------------------------------------

function renderLogin() {
  document.querySelectorAll('[data-when="authed"]').forEach((el) => { el.hidden = true; });
  const toggle = $('toggle-auth-mode');
  const loginForm = $('login-form');
  const signupForm = $('signup-form');
  const isSignup = authMode === 'signup';
  loginForm.hidden = isSignup;
  signupForm.hidden = !isSignup;
  toggle.textContent = isSignup ? 'I already have an account' : 'Create a new account';
  $('login-error').textContent = '';
  $('signup-error').textContent = '';
}

// ----- DETAIL ---------------------------------------------------------

function renderDetail() {
  const item = state.detail;
  if (!item) { setState({ route: lastRoute || 'everything' }); return; }
  const media = $('detail-media');
  const side = $('detail-side');

  const variant = kindToVariant(item);
  if (item.image_url && (variant === 'image' || variant === 'screenshot' || variant === 'article')) {
    media.innerHTML = `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title || '')}">`;
  } else {
    media.innerHTML = `<div class="mnx-detail__text-preview">
      <span class="mnx-eyebrow"><i></i>${escapeHtml(VARIANT_LABEL[variant])}</span>
      <h2>${escapeHtml(item.title || 'Saved memory')}</h2>
      <p>${escapeHtml(item.note || item.excerpt || '')}</p>
    </div>`;
  }

  const source = item.source_url
    ? `<svg width="14" height="14"><use href="#i-link"/></svg> ${escapeHtml(sourceLabel(item))}` : '';

  const tagsBlock = (Array.isArray(item.tags) && item.tags.length)
    ? `<div class="mnx-tag-list">${item.tags.map((t) => `<span>#${escapeHtml(t)}</span>`).join('')}</div>`
    : '<span style="color:var(--muted);font-size:12px">No tags</span>';

  side.innerHTML = `
    <div class="mnx-detail__side-head">
      <span class="mnx-eyebrow"><i></i>${escapeHtml(VARIANT_LABEL[variant])}</span>
      <button class="mnx-iconbtn" data-action="more"><svg width="16" height="16"><use href="#i-more"/></svg></button>
    </div>
    <h1>${escapeHtml(item.title || 'Saved memory')}</h1>
    ${source ? `<p class="mnx-detail__source">${source}<span>Saved ${escapeHtml(formatRelative(item.savedAt || item.captured_at))}</span></p>` : ''}

    <section class="mnx-detail__section tldr">
      <div class="mnx-section-label">TLDR <small>understood</small></div>
      <p class="mnx-tldr-text">${escapeHtml(item.note || item.excerpt || 'No summary yet.')}</p>
      <div class="mnx-tldr-actions">
        <button data-action="copy-tldr"><svg width="14" height="14"><use href="#i-copy"/></svg> Copy</button>
        <button data-action="edit-note">Edit</button>
      </div>
    </section>

    <section class="mnx-detail__section">
      <div class="mnx-section-label">Tags</div>
      ${tagsBlock}
    </section>

    <section class="mnx-detail__section">
      <div class="mnx-section-label">Your notes</div>
      <textarea class="mnx-input" data-bind="notes" rows="4" style="margin-top:10px">${escapeHtml(item.notes || '')}</textarea>
      <button class="mnx-btn-primary" data-action="save-notes" style="margin-top:10px">Save notes</button>
    </section>

    <div class="mnx-detail__actions">
      <button data-action="detail-favorite"><svg width="14" height="14"><use href="#i-heart"/></svg>Favorite</button>
      <button data-action="share"><svg width="14" height="14"><use href="#i-share"/></svg>Share</button>
      ${item.source_url ? `<button class="open-source" data-action="open-source">Open source <svg width="14" height="14"><use href="#i-arrow"/></svg></button>` : ''}
  `;
}

// ----- data loaders ---------------------------------------------------

async function loadAll() {
  state.loading = true;
  renderRoute();
  try {
    const [itemsData, spaces] = await Promise.all([
      fetchItems({ limit: 50 }),
      fetchSpaces()
    ]);
    state.items = (itemsData && itemsData.items) || [];
    state.spaces = spaces;
    state.error = null;
  } catch (e) {
    state.error = e.message || String(e);
    toast(state.error, 'error');
  } finally {
    state.loading = false;
    renderRoute();
  }
}

// ----- event handlers -------------------------------------------------

function bindEvents() {
  // Tabs (top nav + mobile)
  document.body.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-route-tab]');
    if (tab) { e.preventDefault(); setState({ route: tab.dataset.routeTab }); return; }
    const goHome = e.target.closest('[data-action="go-home"]');
    if (goHome) { e.preventDefault(); setState({ route: 'everything' }); return; }
    const goSettings = e.target.closest('[data-action="go-settings"]');
    if (goSettings) { e.preventDefault(); setState({ route: 'settings' }); return; }

    // Detail close
    if (e.target.closest('[data-action="close-detail"]')) {
      e.preventDefault(); setState({ route: lastRoute || 'everything', detail: null }); return;
    }

    // Capture sheet
    const openCapture = e.target.closest('[data-action="open-capture"]');
    if (openCapture) { e.preventDefault(); setState({ route: 'capture' }); return;
    }
    if (e.target.id === 'capture-sheet') {
      setState({ route: lastRoute || 'everything' }); return;
    }
    const captureBtn = e.target.closest('[data-capture]');
    if (captureBtn) {
      e.preventDefault();
      handleCaptureAction(captureBtn.dataset.capture);
      return;
    }

    // Filter chips
    const chip = e.target.closest('#filter-chips .mnx-chip');
    if (chip && !chip.hasAttribute('aria-disabled')) {
      setState({ filter: Object.assign({}, state.filter, { variant: chip.dataset.variant }) });
      renderGrid();
      return;
    }

    // Card click → detail
    const card = e.target.closest('.mnx-card[data-memory-id]');
    if (card) {
      // Ignore clicks on the card actions (favorite, more).
      if (e.target.closest('[data-action]')) {
        if (e.target.closest('[data-action="favorite"]')) {
          const id = card.dataset.memoryId;
          const item = state.items.find((x) => String(x.id) === String(id));
          if (item) {
            item.isFavorite = !item.isFavorite;
            toggleFavorite(id, item.isFavorite);
            renderGrid();
          }
          return;
        }
        if (e.target.closest('[data-action="more"]')) {
          return;
        }
      }
      const id = card.dataset.memoryId;
      const item = state.items.find((x) => String(x.id) === String(id))
        || (state.search.hits && state.search.hits.find((x) => String(x.id) === String(id)));
      if (item) {
        lastRoute = state.route;
        setState({ detail: item, route: 'detail' });
      }
      return;
    }

    // Detail-side buttons
    if (state.route === 'detail') {
      const ds = e.target.closest('[data-action]');
      if (ds) {
        const act = ds.dataset.action;
        if (act === 'detail-favorite') {
          const item = state.detail;
          if (item) {
            item.isFavorite = !item.isFavorite;
            toggleFavorite(item.id, item.isFavorite);
            renderDetail();
          }
          return;
        }
        if (act === 'open-source' && state.detail && state.detail.source_url) {
          if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.create({ url: state.detail.source_url });
          } else {
            window.open(state.detail.source_url, '_blank');
          }
          return;
        }
        if (act === 'copy-tldr') {
          const text = (state.detail && (state.detail.note || state.detail.excerpt)) || '';
          navigator.clipboard && navigator.clipboard.writeText(text);
          toast('Copied to clipboard', 'success');
          return;
        }
        if (act === 'save-notes') {
          const ta = document.querySelector('[data-bind="notes"]');
          if (ta && state.detail) {
            patchItem(state.detail.id, { notes: ta.value })
              .then((r) => {
                if (r && r.ok) {
                  state.detail.notes = ta.value;
                  toast('Notes saved', 'success');
                } else { toast('Could not save notes', 'error'); }
              });
          }
          return;
        }
      }
    }

    // Spaces card
    const spaceCard = e.target.closest('[data-space-id]');
    if (spaceCard) { return; /* detail view TBD */ }

    // Reminders checkbox
    const cb = e.target.closest('[data-toggle-check]');
    if (cb) {
      const id = cb.dataset.toggleCheck;
      const idx = Number(cb.dataset.checkIndex);
      const item = state.items.find((x) => String(x.id) === String(id));
      if (item && item.checks && item.checks[idx]) {
        item.checks[idx].done = cb.checked;
        renderReminders();
      }
      return;
    }

    // Login / signup
    if (e.target.id === 'toggle-auth-mode') {
      e.preventDefault();
      authMode = (authMode === 'login') ? 'signup' : 'login';
      renderLogin();
      return;
    }
    if (e.target.closest('[data-action="logout"]')) {
      saveSession(null);
      state.items = []; state.spaces = [];
      setState({ route: 'login', user: null });
      return;
    }
  });

  // Search input
  const searchInput = $('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (!q) {
        state.search.query = '';
        state.search.hits = null;
        renderGrid();
        return;
      }
      searchTimer = setTimeout(() => doSearch(q), 350);
    });
  }

  // ⌘K / Ctrl+K focuses search
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchInput) searchInput.focus();
    }
    if (e.key === 'Escape' && state.route === 'detail') {
      setState({ route: lastRoute || 'everything', detail: null });
    }
  });

  // Login / signup forms
  const loginForm = $('login-form');
  if (loginForm) loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    $('login-error').textContent = '';
    try {
      await loginUser(email, password);
      state.user = (await loadSession()).user;
      setState({ route: 'everything' });
      loadAll();
    } catch (err) {
      $('login-error').textContent = err.message || 'Sign in failed';
    }
  });

  const signupForm = $('signup-form');
  if (signupForm) signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('signup-name').value.trim();
    const email = $('signup-email-2').value.trim();
    const password = $('signup-password').value;
    $('signup-error').textContent = '';
    try {
      await signupUser(name, email, password);
      state.user = (await loadSession()).user;
      setState({ route: 'everything' });
      loadAll();
    } catch (err) {
      $('signup-error').textContent = err.message || 'Sign up failed';
    }
  });
}

async function doSearch(q) {
  state.search.query = q;
  state.search.inFlight = true;
  renderGrid();
  try {
    const variant = state.filter.variant;
    const filters = variant === 'all' ? {} : { kind: VARIANT_KINDS[variant] || [] };
    const hits = await searchItems(q, filters);
    state.search.hits = hits;
  } catch (e) {
    state.search.hits = [];
    toast('Search unavailable', 'error');
  } finally {
    state.search.inFlight = false;
    renderGrid();
    updateSearchMeta();
  }
}

function updateSearchMeta() {
  const meta = $('search-meta');
  if (!meta) return;
  if (!state.search.query) { meta.innerHTML = ''; return; }
  const n = state.search.hits ? state.search.hits.length : 0;
  meta.innerHTML = n > 0
    ? `Found <b>${n}</b> memor${n === 1 ? 'y' : 'ies'} for <b>${escapeHtml(state.search.query)}</b>`
    : `No matches for <b>${escapeHtml(state.search.query)}</b>`;
}

function handleCaptureAction(kind) {
  setState({ route: lastRoute || 'everything' });
  if (kind === 'document') return; // disabled in spec
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.runtime) {
    toast('Capture requires the extension popup', 'error');
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const payload = {
      type: kind,
      title: (tab && tab.title || 'Untitled').slice(0, 200),
      sourceUrl: tab && tab.url || '',
      capturedAt: new Date().toISOString(),
      clientRequestId: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now())
    };
    chrome.runtime.sendMessage({ type: 'CAPTURE_FROM_DASHBOARD', payload }, (response) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        toast(chrome.runtime.lastError.message || 'Capture failed', 'error');
        return;
      }
      if (response && response.ok) {
        toast('Saved', 'success');
        loadAll();
      } else {
        toast((response && response.error) || 'Capture failed', 'error');
      }
    });
  });
}

// ----- toast ----------------------------------------------------------

let toastTimer = null;
function toast(message, kind) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('is-error', 'is-success');
  if (kind === 'error') el.classList.add('is-error');
  if (kind === 'success') el.classList.add('is-success');
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), 2400);
}

// ----- init -----------------------------------------------------------

async function init() {
  try {
    bindEvents();
  } catch (err) {
    console.error('[mnx] bindEvents failed:', err);
  }
  const session = await loadSession();
  if (!session || !session.accessToken) {
    state.route = 'login';
    state.user = null;
    renderRoute();
    return;
  }
  state.user = session.user || null;
  state.route = 'everything';
  try {
    renderRoute();
  } catch (err) {
    console.error('[mnx] initial renderRoute failed:', err);
  }
  loadAll().catch((err) => console.error('[mnx] loadAll failed:', err));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}