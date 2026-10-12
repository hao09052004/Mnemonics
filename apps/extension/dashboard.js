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
  // Content clusters. Populated by `loadClusters()` and rendered by
  // `renderClusters()`. The web dashboard and the extension must
  // show the SAME clusters — neither client recomputes locally
  // (spec §12, §32).
  clusters: [],
  clusterDetail: null, // { id, items: string[] }
  search: { query: '', inFlight: false, hits: null },
  filter: { variant: 'all', favoritesOnly: false },
  detail: null,
  capture: false,
  loading: false,
  error: null,
  // Last query string sent to GET /api/v1/items. Surfaced in the empty
  // state so a "Favorites shows nothing" report can be diagnosed without
  // a debugger.
  lastItemsQuery: null,
  // Id of the card whose "..." overflow menu is open, or null. Only one
  // menu can reasonably be open at a time on a masonry grid.
  openMenuId: null
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
    // `localStorage` raises `SecurityError` on origins jsdom treats
    // as opaque (e.g. `chrome-extension://…` under Linux CI). The
    // `typeof` guard alone is not enough — the property exists, but
    // calling `getItem` throws. Fall through to `chrome.storage.local`
    // so a test that drives the dashboard from JSDOM still resolves a
    // session, and so a future browser policy cannot reject the load.
    let raw = null;
    try {
      raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem('mnemonics_session')
        : null;
    } catch (_) { /* opaque origin: no localStorage */ }
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

/**
 * Decide who the signed-in user is.
 *
 * `saveSession()` stores only the *flat* session
 * (`{ accessToken, refreshToken, expiresAt }`), so a reload finds a
 * session with no `user` field. Reading `session.user` alone made
 * `state.user` null on every reload, which silently disabled the
 * tab re-fetch in `bindEvents` (`DATA_TABS.has(next) && state.user`) —
 * the Favorites tab then rendered the previous route's rows and never
 * issued `?favorite=true`.
 *
 * The JWT is the only reliable source left, so decode the `sub` claim.
 * This is not a security decision (the API re-authorises every request);
 * it only decides which UI to draw.
 */
function resolveUser(session) {
  if (!session) return null;
  if (session.user) return session.user;
  const token = session.accessToken;
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    ));
    if (!payload || !payload.sub) return null;
    return {
      id: payload.sub,
      email: payload.email || null,
      // Provenance matters for the sign-out button: only a real session
      // write may clear storage, and this object never is one.
      derivedFromToken: true
    };
  } catch (_) {
    return null;
  }
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
  const user = (session && session.user) || (flat && flat.user) || null;
  state.user = user;
  // Persist `user` alongside the tokens. Without it the stored session
  // has no identity, so every reload resolved `state.user` to null and
  // silently disabled the tab re-fetch — the root cause of the Favorites
  // tab never requesting `?favorite=true`.
  const stored = flat ? Object.assign({}, flat, user ? { user } : {}) : null;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ mnemonics_session: stored || null });
  }
  // Mirror the session into localStorage for hosts (test runners,
  // local dev pages) where chrome.storage is unavailable. Same caveat
  // as the read: opaque origins raise SecurityError on access.
  try {
    if (typeof localStorage !== 'undefined') {
      if (stored) localStorage.setItem('mnemonics_session', JSON.stringify(stored));
      else localStorage.removeItem('mnemonics_session');
    }
  } catch (_) { /* opaque origin: skip mirror */ }
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

  // Logged because a silent `return null` on a missing session was the
  // reason the Favorites tab stayed empty with no visible error: the
  // grid rendered "No favorites yet." while no request was ever made.
  const who = (session.user && (session.user.email || session.user.id)) || 'unknown';
  console.log('[mnx] GET /items?' + params.toString()
    + '  user=' + who
    + '  (userId=' + ((session.user && session.user.id) || '?') + ')');

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
  const rows = (body.data && body.data.items) || [];
  console.log('[mnx] /items -> HTTP', r.status, rows.length, 'row(s); total=' + (body.data && body.data.total),
    'favorited=' + rows.filter((x) => x.is_favorite).length);
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
    // Search responses omit `is_favorite`, so a hit would render as
    // un-favorited even when the stored memory is a favorite. Preserve
    // the flag from the loaded list when we can resolve the id.
    isFavorite: hit.is_favorite !== undefined
      ? !!hit.is_favorite
      : !!(state.items.find((x) => String(x.id) === String(hit.id)) || {}).isFavorite,
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

/**
 * Read the Memory Understanding row (AI caption + TLDR) for an item.
 * Resolves to `null` when the row does not exist yet — the enrichment
 * job is async, so "no summary" is a normal state, not a failure.
 */
async function fetchEnrichment(itemId) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve(null);
      return;
    }
    chrome.runtime.sendMessage(
      { type: 'GET_ENRICHMENT', itemId },
      (response) => resolve(response && response.ok ? (response.data || null) : null)
    );
  });
}

// ----- item lookup ----------------------------------------------------

/**
 * Translate one `GET /api/v1/items` row into the shape the dashboard
 * renders. The BE returns snake_case columns and an `excerpt`-less body,
 * so without this the favorite heart and the card body would both stay
 * empty after a reload.
 */
function normalizeServerItem(row) {
  if (!row) return row;
  return Object.assign({}, row, {
    isFavorite: row.isFavorite !== undefined ? !!row.isFavorite : !!row.is_favorite,
    excerpt: row.excerpt || row.raw_text || row.ocr_text || '',
    savedAt: row.savedAt || row.captured_at || row.created_at || null,
    capturedAt: row.capturedAt || row.captured_at || null
  });
}

/**
 * Resolve a card id against whichever list is currently driving the
 * view: server items, or search hits when a query is active.
 */
function findItemById(id) {
  if (!id) return null;
  const key = String(id);
  return state.items.find((x) => String(x.id) === key)
    || (state.search.hits && state.search.hits.find((x) => String(x.id) === key))
    || null;
}

/** Replace one item in both lists so every render sees the new value. */
function patchItemEverywhere(id, mutate) {
  const key = String(id);
  const apply = (list) => (list || []).map((x) => (
    String(x.id) === key ? mutate(x) : x
  ));
  state.items = apply(state.items);
  if (state.search.hits) state.search.hits = apply(state.search.hits);
  if (state.detail && String(state.detail.id) === key) {
    state.detail = mutate(state.detail);
  }
}

// ----- card actions ---------------------------------------------------

/**
 * Flip `is_favorite` for a card. Optimistic: the heart fills before the
 * bridge round-trip resolves, and reverts if the server rejects the
 * write. The dashboard must never claim a state the BE did not accept.
 */
function handleToggleFavorite(item) {
  if (!item) return;
  const next = !item.isFavorite;
  patchItemEverywhere(item.id, (x) => Object.assign({}, x, { isFavorite: next }));
  // On the favorites route the grid is a filtered view, so un-favoriting
  // must remove the card — keeping it would show a card with an outline
  // heart inside a tab called "Favorites".
  if (state.route === 'favorites' && !next) {
    state.items = state.items.filter((x) => String(x.id) !== String(item.id));
    if (state.search.hits) {
      state.search.hits = state.search.hits.filter((x) => String(x.id) !== String(item.id));
    }
  }
  renderGrid();
  if (state.route === 'detail') renderDetail();

  toggleFavorite(item.id, next).then((res) => {
    if (res && res.ok) {
      // The favorites list came from `?favorite=true`, so it no longer
      // contains this row. Re-fetch rather than patch locally, otherwise
      // the tab drifts from the server's view of what is favorited.
      if (state.route === 'favorites' && !next) {
        loadAll().catch((err) => console.error('[mnx] favorites reload failed:', err));
      }
      return;
    }
    // Roll back so the heart stops lying about the server.
    patchItemEverywhere(item.id, (x) => Object.assign({}, x, { isFavorite: !next }));
    if (state.route === 'favorites' && !next) {
      state.items.push(Object.assign({}, item, { isFavorite: true }));
    }
    renderGrid();
    if (state.route === 'detail') renderDetail();
    toast('Không lưu được yêu thích', 'error');
  });
}

/**
 * Delete a card for real. `DELETE /api/v1/items/:id` removes the row and
 * every child record (enrichments, embeddings, tags, assets, jobs), so
 * this is irreversible — hence the confirmation.
 */
function handleDelete(item) {
  if (!item) return;
  const label = item.title || 'memory này';
  if (typeof confirm === 'function' && !confirm('Xóa "' + label + '"? Hành động này không thể hoàn tác.')) {
    return;
  }

  deleteItem(item.id).then((res) => {
    if (res && res.ok) {
      state.items = state.items.filter((x) => String(x.id) !== String(item.id));
      if (state.search.hits) {
        state.search.hits = state.search.hits.filter((x) => String(x.id) !== String(item.id));
      }
      if (state.detail && String(state.detail.id) === String(item.id)) {
        state.detail = null;
        setState({ route: lastRoute || 'everything' });
        return;
      }
      renderGrid();
      toast('Đã xóa memory', 'success');
      return;
    }
    toast('Không xóa được memory', 'error');
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
  // A render that throws silently (e.g. a missing DOM node, an
  // unexpected `state.user` shape) used to leave the entire grid
  // area blank with no signal. Catch it here and surface the error
  // through the existing cards-error panel so the user at least
  // sees a retry button.
  try {
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
    if (state.route === 'clusters') { renderClusters(); return; }
    if (state.route === 'cluster-detail') { renderClusterDetail(); return; }
    if (state.route === 'reminders') { renderReminders(); return; }
    if (state.route === 'settings') { renderSettings(); return; }
    if (state.route === 'detail') { renderDetail(); return; }
    if (state.route === 'capture') { /* no-op; CSS handles it */ return; }

    highlightActiveTab();
  } catch (err) {
    console.error('[mnx] renderRoute(' + state.route + ') threw:', err);
    const cards = $('cards-container');
    if (cards) cards.innerHTML = '';
    const empty = $('cards-empty'); if (empty) empty.hidden = true;
    const errEl = $('cards-error');
    if (errEl) {
      errEl.hidden = false;
      const msg = $('cards-error-message');
      if (msg) msg.textContent = 'Something went wrong rendering this view. ' +
        (err && err.message ? err.message : (err && err.name) || 'Unknown error');
    }
  }
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

  // A failed request is logged to the console but no longer surfaced
  // as a dedicated UI panel — the user sees the normal empty state
  // (e.g. "No favorites yet.") and can keep using the dashboard.
  const errEl = $('cards-error');
  if (errEl) { errEl.hidden = true; }
  const diag = $('cards-diagnostic');
  if (diag) {
    diag.hidden = true;
    diag.textContent = '';
  }

  if (state.error) {
    // Logged for debugging; the user sees the empty grid instead.
    console.warn('[mnx] renderRoute: state.error =', state.error, 'route =', state.route);
  }

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
    // Diagnostic for "the grid is empty although the API has data".
    // Shown on every empty route (not just favorites) because the
    // symptom — an empty grid with no console output — is the same
    // whether the query was wrong or the session was missing.
    return;
  }
  // Diagnostic is always-on (set above) on this route, so we don't
  // need to touch it again here. The empty panel can stay as the
  // user-facing copy.
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

  // M7 — explainability pill. One line, no expand (popup width
  // is constrained). Mirrors the web pill text.
  const explanationBlock = item.explanation
    ? `<div class="mnx-card__explainability"><span>Why this matched</span></div>` : '';

  const meta = (variant !== 'highlight')
    ? `<div class="mnx-card__meta"><span>${escapeHtml(sourceLabel(item))}</span>${tagBlock}</div>` : '';

  const itemId = escapeHtml(String(item.id));
  const menuOpen = state.openMenuId === itemId;
  const menuBlock = menuOpen ? `
      <div class="mnx-cardmenu" data-cardmenu>
        <button class="mnx-cardmenu__item" data-action="menu-favorite" role="menuitem">
          <svg width="14" height="14" aria-hidden="true"><use href="#i-heart"/></svg>
          ${isFav ? 'Remove favorite' : 'Add favorite'}
        </button>
        <button class="mnx-cardmenu__item mnx-cardmenu__item--danger" data-action="menu-delete" role="menuitem">
          <svg width="14" height="14" aria-hidden="true"><use href="#i-trash"/></svg>
          Delete
        </button>
      </div>` : '';

  return `<article class="mnx-card ${variant}" data-memory-id="${itemId}" tabindex="0" role="button" aria-label="Open memory">
    ${mediaBlock}
    <div class="mnx-card__body">
      <div class="mnx-card__top">
        <span class="mnx-eyebrow"><i></i>${eyebrow}${score}</span>
        <div class="mnx-card__actions">
          <button class="mnx-iconbtn ${isFav ? 'is-favorite' : ''}" data-action="favorite" aria-pressed="${isFav}" aria-label="Toggle favorite">
            <svg width="14" height="14" ${isFav ? 'fill="currentColor"' : ''}><use href="#i-heart"/></svg>
          </button>
          <div class="mnx-cardmenu-anchor">
            <button class="mnx-iconbtn" data-action="more" aria-haspopup="menu" aria-expanded="${menuOpen}" aria-label="More actions"><svg width="14" height="14"><use href="#i-more"/></svg></button>
            ${menuBlock}
          </div>
      </div>
    </div>
      <h3>${highlightTitle}</h3>
      ${excerptBlock}
      ${explanationBlock}
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

// ----- CLUSTERS -------------------------------------------------------
// The clusters view is a thin shell over the canonical cluster API.
// There is no client-side clustering here on purpose: a divergent
// implementation would violate spec §12 (web + extension parity) and
// §32 (no extension-only clustering).

async function loadClusters() {
  const token = await getAccessToken();
  if (!token) {
    state.clusters = [];
    return;
  }
  try {
    const r = await window.listClustersFromApi(token);
    state.clusters = (r && r.data && r.data.clusters) || [];
    state.clusterUnclustered = (r && r.data && r.data.unclusteredCount) || 0;
  } catch (e) {
    state.clusters = [];
    state.clusterError = (e && e.message) || 'Could not load groups.';
  }
}

function renderClusters() {
  highlightActiveTab();
  const host = $('clusters-host');
  if (!host) return;
  if (state.clusterLoading) {
    host.innerHTML = `<p style="color:var(--muted);font-size:13px">Loading groups…</p>`;
    return;
  }
  if (state.clusterError) {
    host.innerHTML = `
      <div class="mnx-empty" data-action="cluster-error">
        <div class="mnx-empty__inner">
          <div class="mnx-empty__mark"><span></span><span></span><span></span></div>
          <h1>Groups are unavailable right now</h1>
          <p>${escapeHtml(state.clusterError)}</p>
          <button class="primary" data-action="cluster-retry">Try again</button>
        </div>
      </div>`;
    return;
  }
  if (!state.clusters.length) {
    host.innerHTML = `
      <div class="mnx-empty">
        <div class="mnx-empty__inner">
          <div class="mnx-empty__mark"><span></span><span></span><span></span></div>
          <h1>No groups yet</h1>
          <p>Save more memories on a similar topic to see them cluster here.</p>
        </div>
      </div>`;
    return;
  }
  host.innerHTML = `
    <div class="mnx-clusters__head">
      <h1>Groups</h1>
      <p>${state.clusterUnclustered ? state.clusterUnclustered + ' memories are not in any group yet.' : ''}</p>
      <button class="mnx-button mnx-button--ghost" data-action="cluster-refresh">Refresh groups</button>
    </div>
    <ul class="mnx-clusters" data-testid="clusters-list">
      ${state.clusters.map((c) => `
        <li class="mnx-clusters__card" data-cluster-id="${escapeHtml(c.id)}" data-testid="cluster-card-${escapeHtml(c.id)}">
          <div class="mnx-clusters__card-head">
            <h2 class="mnx-clusters__card-title">${escapeHtml(c.title || 'Untitled group')}</h2>
            <span class="mnx-clusters__count">${c.itemCount || 0} memories</span>
          </div>
          ${c.summary ? `<p class="mnx-clusters__card-summary">${escapeHtml(c.summary)}</p>` : ''}
          <div class="mnx-clusters__previews">
            ${(c.representativeItems || []).slice(0, 3).map((p) => `
              <div class="mnx-clusters__preview">
                <span class="mnx-clusters__preview-kind">${escapeHtml(p.kind || '')}</span>
                <span class="mnx-clusters__preview-title">${escapeHtml(p.title || '')}</span>
              </div>
            `).join('')}
            ${(!c.representativeItems || c.representativeItems.length === 0) ? `
              <div class="mnx-clusters__preview mnx-clusters__preview--empty">Preview unavailable</div>
            ` : ''}
          </div>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderClusterDetail() {
  highlightActiveTab();
  const host = $('cluster-detail-host');
  if (!host) return;
  const detail = state.clusterDetail;
  if (!detail) {
    host.innerHTML = `<p style="color:var(--muted);font-size:13px">Loading group…</p>`;
    return;
  }
  // Milestone 2: members come from the hydrated response, not from
  // a global `state.items` intersection. The dashboard keeps a
  // separate page of "All memories" for the rest of the UI, but
  // the cluster view must show EXACTLY the members the backend
  // says are in this cluster.
  const items = detail.items || [];
  const total = detail.itemCount ?? items.length;
  host.innerHTML = `
    <div class="mnx-everything__header">
      <h1 class="mnx-everything__title">${escapeHtml(detail.title || 'Untitled group')}</h1>
      ${detail.summary ? `<p class="mnx-everything__subtitle">${escapeHtml(detail.summary)}</p>` : ''}
      <p class="mnx-everything__subtitle">${total} ${total === 1 ? 'memory' : 'memories'}</p>
      <div class="mnx-clusters__actions">
        <button class="primary" data-action="cluster-save-as-space">Save as Space</button>
      </div>
    </div>
    <div class="mnx-memory-grid" data-testid="cluster-items">
      ${items.length === 0 ? '<p style="color:var(--muted);font-size:13px">This group has no memories yet.</p>' : ''}
      ${items.map((it) => `
        <button class="mnx-card" data-memory-id="${escapeHtml(String(it.id))}" data-action="open-memory">
          <div class="mnx-card__body">
            <div class="mnx-card__top"><span class="mnx-eyebrow">${escapeHtml(it.kind || 'text')}</span></div>
            <h3>${escapeHtml(it.title || 'Untitled')}</h3>
          </div>
        </button>
      `).join('')}
    </div>
  `;
}

async function openClusterDetail(id) {
  state.route = 'cluster-detail';
  state.clusterDetail = null;
  renderRoute();
  const token = await getAccessToken();
  if (!token) return;
  try {
    const r = await window.getClusterFromApi(id, token);
    const d = (r && r.data) || {};
    // Authoritative title/summary/itemCount come from the cluster
    // row, never from a member. Members arrive as hydrated DTOs.
    state.clusterDetail = {
      id,
      title: d.cluster && d.cluster.title ? d.cluster.title : null,
      summary: d.cluster && d.cluster.summary ? d.cluster.summary : null,
      itemCount: d.cluster && typeof d.cluster.itemCount === 'number' ? d.cluster.itemCount : (d.items || []).length,
      items: d.items || []
    };
    renderRoute();
  } catch (e) {
    state.clusterDetail = { id, title: null, summary: null, itemCount: 0, items: [], error: e && e.message };
    renderRoute();
  }
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

/**
 * Which text the TLDR panel should show, in priority order.
 *
 * The AI summary (`enrichment.tldr`) is the product. `note` / `excerpt`
 * are the captured body — for a link capture they are empty, which is
 * why this panel used to read "No summary yet" for every link even
 * though the enrichment job had written a real summary.
 *
 * The `status` flag lets the UI say "đang xử lý" instead of pretending
 * the memory has no summary.
 */
function tldrViewFor(item) {
  const e = item && item.enrichment;
  if (e && e.tldr) {
    return { text: e.tldr, state: 'ready' };
  }
  // A captured body is real content, so show it immediately while the
  // AI summary is still being generated. Preferring "đang tạo…" over
  // text the user can already read would be strictly worse.
  const body = (item && (item.note || item.excerpt)) || '';
  const status = e && e.tldrStatus;
  if (body) return { text: body, state: 'fallback' };
  if (status === 'pending' || status === 'processing') {
    return { text: 'Đang tạo tóm tắt…', state: 'pending' };
  }
  if (status === 'failed') {
    return { text: 'Không tạo được tóm tắt.', state: 'failed' };
  }
  if (status === 'disabled') {
    return { text: 'Tóm tắt đang tắt.', state: 'disabled' };
  }
  return { text: 'Chưa có tóm tắt.', state: 'empty' };
}

/**
 * Fetch the enrichment row for `item` and merge it into state, then
 * re-render the detail modal if it is still the open item.
 *
 * The modal renders before this resolves, so the user sees the raw
 * capture immediately and the AI summary replaces it a beat later.
 * A null result is normal (job hasn't run) and is recorded as such so
 * the panel can say "đang tạo tóm tắt…" rather than "no summary".
 */
function loadEnrichmentFor(item) {
  if (!item || !item.id) return;
  const id = String(item.id);
  fetchEnrichment(id).then(function (enrichment) {
    // The user may have navigated away; don't clobber another item.
    if (!state.detail || String(state.detail.id) !== id) return;
    state.detail = Object.assign({}, state.detail, {
      enrichment: enrichment ? normalizeEnrichment(enrichment) : { tldr: null, tldrStatus: 'pending' }
    });
    if (state.route === 'detail') renderDetail();
  });
}

/** Map the API's snake_case enrichment row onto the UI's shape. */
function normalizeEnrichment(e) {
  if (!e) return null;
  return {
    caption: e.caption || null,
    captionStatus: e.captionStatus || e.caption_status || 'pending',
    tldr: e.tldr || null,
    tldrStatus: e.tldrStatus || e.tldr_status || 'pending',
    tldrSource: e.tldrSource || e.tldr_source || 'pending',
    tldrModel: e.tldrModel || e.tldr_model || null,
    summary: e.summary || null
  };
}

/** Human label for where the shown TLDR came from. */function tldrSourceLabel(item, state_) {
  const e = item && item.enrichment;
  if (state_ === 'ready' && e) {
    if (e.tldrSource === 'user') return 'bạn đã viết';
    if (e.tldrSource === 'cloud_ai') return e.tldrModel || 'cloud ai';
    if (e.tldrSource === 'local_ai') return e.tldrModel || 'local ai';
    return 'heuristic';
  }
  if (state_ === 'fallback') return 'nguyên văn';
  return '';
}

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

  const tldr = tldrViewFor(item);
  // Show provenance so the user can tell an AI summary from their own
  // notes or from a heuristic fallback.
  const tldrSource = tldrSourceLabel(item, tldr.state);

  side.innerHTML = `
    <div class="mnx-detail__side-head">
      <span class="mnx-eyebrow"><i></i>${escapeHtml(VARIANT_LABEL[variant])}</span>
      <button class="mnx-iconbtn" data-action="more"><svg width="16" height="16"><use href="#i-more"/></svg></button>
    </div>
    <h1>${escapeHtml(item.title || 'Saved memory')}</h1>
    ${source ? `<p class="mnx-detail__source">${source}<span>Saved ${escapeHtml(formatRelative(item.savedAt || item.captured_at))}</span></p>` : ''}

    <section class="mnx-detail__section tldr" data-tldr-state="${tldr.state}">
      <div class="mnx-section-label">TLDR ${tldrSource ? `<small>${escapeHtml(tldrSource)}</small>` : ''}</div>
      <p class="mnx-tldr-text">${escapeHtml(tldr.text)}</p>
      <div class="mnx-tldr-actions">
        <button data-action="copy-tldr" ${tldr.state === 'empty' || tldr.state === 'pending' ? 'disabled' : ''}><svg width="14" height="14"><use href="#i-copy"/></svg> Copy</button>
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

/** The limit the grid uses. The API caps at 100. */
const GRID_PAGE_SIZE = 100;

/**
 * Fetch the rows the current route needs.
 *
 * The favorites route MUST ask the server for `?favorite=true`. Filtering
 * the everything-list client-side looks equivalent but is not: that list
 * is capped at GRID_PAGE_SIZE, so a memory the user favorited last month
 * is simply not in it and the tab renders "No favorites yet" while the
 * heart on its card is filled. The server-side filter has no such blind
 * spot.
 *
 * Deliberately NOT `async`: it is passed straight into `fetchItems`,
 * which destructures its argument synchronously. An `async` version
 * returns a Promise, and destructuring a Promise yields `undefined`
 * for every key — so `fetchItems` would silently fall back to its own
 * defaults (`favorite=false, limit=50`) and the tab would keep showing
 * the capped, unfiltered list.
 */
function fetchItemsForRoute(route) {
  if (route === 'favorites') {
    return { favorite: true, limit: GRID_PAGE_SIZE };
  }
  return { limit: GRID_PAGE_SIZE };
}

async function loadAll() {
  state.loading = true;
  renderRoute();
  // Tag this request so a slower earlier one cannot clobber a newer
  // result. Switching Everything → Favorites fires two loads; without
  // this the slower one wins and the grid shows the wrong subset.
  const myEpoch = ++apiEpoch;
  const requestedRoute = state.route;
  try {
    const [itemsData, spaces] = await Promise.all([
      fetchItems(fetchItemsForRoute(requestedRoute)),
      fetchSpaces()
    ]);
    state.lastItemsQuery = 'limit=' + GRID_PAGE_SIZE
      + (requestedRoute === 'favorites' ? '&favorite=true' : '');
    if (myEpoch !== apiEpoch) return;   // superseded by a newer loadAll
    // 401 / network errors: previously surfaced a "sign in again"
    // panel. The user-facing UI now falls back to the normal empty
    // state (e.g. "No favorites yet."); the failure is still logged
    // to the console so devs can diagnose.
    if (itemsData === null) {
      console.warn('[mnx] loadAll: items fetch returned null (likely auth/refresh failure)');
      state.items = [];
      state.spaces = Array.isArray(spaces) ? spaces : [];
      state.error = null;
      state.loading = false;
      renderRoute();
      return;
    }
    const rawItems = (itemsData && itemsData.items) || [];
    // The API speaks snake_case (`is_favorite`); the dashboard renders
    // camelCase. Normalise once, here, instead of every read site.
    state.items = rawItems.map(normalizeServerItem);
    state.spaces = spaces;
    state.error = null;
    // If the user is currently viewing a detail modal, refresh the
    // open detail's reference so it shows fresh fields (e.g. updated
    // tags) after a save. Without this, state.detail would still
    // point at the pre-save object after loadAll replaces state.items.
    if (state.route === 'detail' && state.detail) {
      const fresh = state.items.find((x) => String(x.id) === String(state.detail.id));
      if (fresh) {
        state.detail = Object.assign({}, state.detail, fresh);
      }
    }
  } catch (e) {
    if (myEpoch !== apiEpoch) return;
    // Swallow the error into the console only. The next renderRoute
    // sees state.error = null, so the empty-state copy takes over.
    console.warn('[mnx] loadAll failed:', e);
    state.error = null;
  } finally {
    if (myEpoch === apiEpoch) {
      state.loading = false;
      renderRoute();
    }
  }
}

// ----- event handlers -------------------------------------------------

// Wire up chrome.runtime.onMessage so the dashboard reacts when
// background.js broadcasts RELOAD_ITEMS / ITEM_SAVED (after a save
// from the cropper, a PATCH from a popup action, etc.). Without this
// listener the new item lives in the DB but the open dashboard never
// re-fetches, so the tab appears stale until a manual reload.
//
// (Regression: 2026-10-04 — user saved a screenshot and the Everything
// tab did not show the new item.)
function bindRuntime() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ITEM_SAVED') {
      // Saved an item from somewhere (cropper, popup, context menu).
      // Show a brief toast so the open dashboard confirms the save
      // even if the user is on a tab other than Everything.
      if (state.user) {
        toast('Saved to Memories', 'success');
        loadAll().catch((err) => console.error('[mnx] live reload failed:', err));
      }
    } else if (msg.type === 'RELOAD_ITEMS') {
      // PATCH/DELETE from another surface — refresh silently.
      if (state.user) {
        loadAll().catch((err) => console.error('[mnx] live reload failed:', err));
      }
    }
  });
}

function bindEvents() {
  // Tabs (top nav + mobile). Clicking a tab both switches the route
  // AND re-fetches items if the destination is one that shows the
  // grid (everything / favorites / rediscover / spaces / space-detail).
  // Without this re-fetch, switching tabs after a save would show
  // stale items until manual reload.
  const DATA_TABS = new Set(['everything', 'favorites', 'rediscover', 'spaces', 'space-detail', 'clusters']);
  document.body.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-route-tab]');
    if (tab) {
      e.preventDefault();
      const next = tab.dataset.routeTab;
      setState({ route: next });
      if (DATA_TABS.has(next) && state.user) {
        if (next === 'clusters') {
          state.clusterLoading = true;
          renderRoute();
          loadClusters()
            .catch((err) => console.error('[mnx] cluster load failed:', err))
            .finally(() => { state.clusterLoading = false; renderRoute(); });
        } else {
          loadAll().catch((err) => console.error('[mnx] tab reload failed:', err));
        }
      }
      return;
    }
    const goHome = e.target.closest('[data-action="go-home"]');
    if (goHome) {
        e.preventDefault();
      setState({ route: 'everything' });
      if (state.user) loadAll().catch((err) => console.error('[mnx] home reload failed:', err));
      return;
    }
    const goSettings = e.target.closest('[data-action="go-settings"]');
    if (goSettings) { e.preventDefault(); setState({ route: 'settings' }); return; }

    // Retry the favorites fetch. The button is no longer rendered in
    // the UI (failures are now silent), but the hook is kept so
    // manual repro or future debug toggles can still re-issue the
    // request.
    const retryFav = e.target.closest('[data-action="retry-favorites"]');
    if (retryFav) {
      e.preventDefault();
      state.error = null;
      if (state.user) loadAll().catch((err) => console.warn('[mnx] favorites retry failed:', err));
      return;
    }

    // Cluster card click → open detail.
    const clusterCard = e.target.closest('[data-cluster-id]');
    if (clusterCard && state.route === 'clusters') {
      e.preventDefault();
      openClusterDetail(clusterCard.dataset.clusterId);
      return;
    }

    // Cluster refresh action.
    const clusterRefresh = e.target.closest('[data-action="cluster-refresh"]');
    if (clusterRefresh) {
      e.preventDefault();
      (async () => {
        state.clusterLoading = true;
        renderRoute();
        const token = await getAccessToken();
        if (token) {
          try { await window.refreshClustersFromApi(token); } catch (err) { console.warn('[mnx] cluster refresh failed:', err); }
        }
        await loadClusters();
        state.clusterLoading = false;
        renderRoute();
      })();
      return;
    }

    // Cluster error retry.
    const clusterRetry = e.target.closest('[data-action="cluster-retry"]');
    if (clusterRetry) {
      e.preventDefault();
      state.clusterError = null;
      state.clusterLoading = true;
      renderRoute();
      loadClusters()
        .catch((err) => console.error('[mnx] cluster retry failed:', err))
        .finally(() => { state.clusterLoading = false; renderRoute(); });
      return;
    }

    // Save cluster as Space.
    const saveAsSpace = e.target.closest('[data-action="cluster-save-as-space"]');
    if (saveAsSpace && state.clusterDetail) {
      e.preventDefault();
      (async () => {
        const token = await getAccessToken();
        if (!token) return;
        try {
          await window.saveClusterAsSpaceFromApi(state.clusterDetail.id, token, {});
          // Bounce back to spaces tab so the new space is visible.
          setState({ route: 'spaces' });
          loadAll().catch((err) => console.error('[mnx] space reload after save failed:', err));
        } catch (err) {
          console.warn('[mnx] save cluster as space failed:', err);
        }
      })();
      return;
    }

    // Open a memory card inside a cluster detail view.
    const openMem = e.target.closest('[data-memory-id][data-action="open-memory"]');
    if (openMem && state.route === 'cluster-detail') {
      e.preventDefault();
      openDetail(openMem.dataset.memoryId);
      return;
    }

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
      const id = card.dataset.memoryId;
      const item = findItemById(id);

      // Card actions. Each one owns its behaviour and must not fall
      // through to "open detail".
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const act = actionEl.dataset.action;

        if (act === 'favorite' || act === 'menu-favorite') {
          state.openMenuId = null;
          if (item) handleToggleFavorite(item);
          return;
        }

        if (act === 'more') {
          state.openMenuId = state.openMenuId === id ? null : id;
          renderGrid();
          return;
        }

        if (act === 'menu-delete') {
          state.openMenuId = null;
          if (item) handleDelete(item);
          return;
        }
      }

      // Clicking anywhere else on the card dismisses an open menu.
      if (state.openMenuId) { state.openMenuId = null; renderGrid(); return; }

      if (item) {
        lastRoute = state.route;
        setState({ detail: item, route: 'detail' });
        // Load the AI summary for this card. Rendered immediately from
        // whatever we have, then re-rendered when the fetch lands — the
        // enrichment job may not have run yet, and the modal must not
        // block on that.
        loadEnrichmentFor(item);
      }
      return;
    }

    // A click outside any card dismisses an open overflow menu.
    if (state.openMenuId) { state.openMenuId = null; renderGrid(); return; }

    // Detail-side buttons
    if (state.route === 'detail') {
      const ds = e.target.closest('[data-action]');
      if (ds) {
        const act = ds.dataset.action;
        if (act === 'detail-favorite') {
          if (state.detail) handleToggleFavorite(state.detail);
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
          // Copy whatever the panel is actually showing, not a stale
          // read of the raw capture.
          const text = tldrViewFor(state.detail).text;
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
    if (e.key === 'Escape' && state.openMenuId) {
      state.openMenuId = null;
      renderGrid();
      return;
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
      state.user = resolveUser(await loadSession());
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
      state.user = resolveUser(await loadSession());
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
  if (kind === 'document') {
    openDocumentCapturePicker();
    return;
  }
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

/**
 * Open the system file picker scoped to PDF/TXT/Markdown and POST the
 * chosen file to `/api/v1/captures/document`. The dashboard never
 * stores the bytes; chrome.storage.local is not touched here, so a
 * 20 MiB PDF cannot bloat the extension's storage budget. The server
 * response is the save boundary — we do not fabricate a memory card
 * on the client.
 */
function openDocumentCapturePicker() {
  // Reuse a single input element across clicks. Creating one each
  // time leaks DOM nodes if the user cancels repeatedly, and the
  // browser recycles the same picker permission.
  let input = document.getElementById('document-capture-input');
  if (!input) {
    input = document.createElement('input');
    input.id = 'document-capture-input';
    input.type = 'file';
    input.accept = '.pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
  }
  // Always clear `value` so the same file can be re-picked after
  // cancellation (browsers refuse to fire `change` otherwise).
  input.value = '';
  input.onchange = function () {
    const file = input.files && input.files[0];
    if (!file) return;
    uploadDocumentToCapture(file);
  };
  input.click();
}

function uploadDocumentToCapture(file) {
  const accessToken = state.session && state.session.accessToken;
  if (!accessToken) {
    toast('Please sign in first', 'error');
    return;
  }
  if (typeof window.uploadDocumentCapture !== 'function') {
    toast('Document upload unavailable', 'error');
    return;
  }
  // Best-effort default title from the filename. The user can rename
  // it later via PATCH /items/:id, mirroring the web flow.
  const defaultTitle = String(file.name || 'document').replace(/\.[^.]+$/, '').slice(0, 200);
  const form = new FormData();
  form.append('file', file, file.name || 'document');
  form.append('type', 'document');
  form.append('title', defaultTitle);
  form.append('sourceUrl', '');
  form.append('capturedAt', new Date().toISOString());
  form.append('clientRequestId',
    (crypto.randomUUID && crypto.randomUUID())
      || (String(Date.now()) + '-' + Math.random().toString(36).slice(2))
  );
  toast('Uploading ' + (file.name || 'document') + '…', 'success');
  Promise.resolve(window.uploadDocumentCapture(form, accessToken))
      .then(function (body) {
        toast('Saved', 'success');
        loadAll();
        return body;
      })
      .catch(function (err) {
        const message = err && err.message ? err.message : 'Upload failed';
        toast(message, 'error');
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
  try {
    bindRuntime();
  } catch (err) {
    console.error('[mnx] bindRuntime failed:', err);
  }
  const session = await loadSession();
  if (!session || !session.accessToken) {
    state.route = 'login';
    state.user = null;
    renderRoute();
      return;
    }
  state.user = resolveUser(session);
  state.route = 'everything';
  console.log('[mnx] init: session found, user =',
    state.user ? (state.user.email || state.user.id) : 'null');
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