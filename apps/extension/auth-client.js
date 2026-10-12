/**
 * Shared frontend auth client (browser-side only).
 *
 * Goals:
 *   - One source of truth for the auth API contract used by both the
 *     extension dashboard (apps/extension) and any future web client
 *     (apps/web).
 *   - Storage-agnostic via pluggable storage adapter (chrome.storage.local
 *     for the extension; localStorage for the web/dev preview).
 *   - Never logs tokens.
 *
 * Loaded as a plain ES module via `<script type="module">` or bundled by
 * Vite/webpack later. There is no transpilation step for the extension —
 * the file uses explicit `.js` extensions and `var` where convenient.
 */

const DEFAULT_BASE_URL = 'http://localhost:4000';

export class AuthError extends Error {
  constructor(code, message, requestId) {
    super(message);
    this.code = code || 'AUTH_ERROR';
    this.requestId = requestId || null;
  }
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function validatePasswordStrength(value) {
  if (typeof value !== 'string' || value.length < 10) return false;
  return /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

export function createStorage(impl) {
  if (!impl) throw new Error('Storage adapter is required');
  return {
    get(key) {
      return new Promise((resolve) => impl.get(key, (value) => resolve(value ?? null)));
    },
    set(key, value) {
      return new Promise((resolve) => impl.set({ [key]: value }, () => resolve()));
    },
    remove(key) {
      return new Promise((resolve) => impl.remove(key, () => resolve()));
    }
  };
}

export function createChromeStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    throw new Error('chrome.storage.local is not available');
  }
  return createStorage({
    get(key, cb) {
      chrome.storage.local.get([key], (r) => cb(r[key]));
    },
    set(values, cb) {
      chrome.storage.local.set(values, () => cb && cb());
    },
    remove(key, cb) {
      chrome.storage.local.remove([key], () => cb && cb());
    }
  });
}

export function createLocalStorage(getWindow) {
  const w = getWindow ? getWindow() : (typeof window !== 'undefined' ? window : null);
  if (!w) throw new Error('localStorage is not available');
  return {
    async get(key) {
      try {
        const raw = w.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    async set(key, value) {
      w.localStorage.setItem(key, JSON.stringify(value ?? null));
    },
    async remove(key) {
      w.localStorage.removeItem(key);
    }
  };
}

export function createAuthClient({ baseUrl = DEFAULT_BASE_URL, fetchImpl, now = () => Date.now() } = {}) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!f) throw new Error('fetch implementation is required');
  let tokenRefreshTimer = null;

  async function post(path, body, accessToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    let response;
    try {
      response = await f(baseUrl + path, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new AuthError('NETWORK_ERROR', 'Không thể kết nối tới máy chủ.');
    }
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      throw new AuthError(payload?.error?.code, payload?.error?.message || `HTTP ${response.status}`, payload?.error?.requestId);
    }
    return payload.data;
  }

  function clearRefreshTimer() {
    if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
    }
  }

  function scheduleRefresh(session, onRefreshed) {
    clearRefreshTimer();
    if (!session || !session.accessToken || !session.refreshToken || !session.expiresAt) return;
    const expiresAtMs = session.expiresAt * 1000;
    const fireAt = Math.max(now() + 5_000, expiresAtMs - 5 * 60_000); // 5 min before expiry
    const delay = fireAt - now();
    tokenRefreshTimer = setTimeout(() => {
      refresh({ refreshToken: session.refreshToken })
        .then((data) => onRefreshed && onRefreshed(data))
        .catch(() => undefined);
    }, delay);
  }

  async function register({ email, password, name }) {
    return await post('/api/v1/auth/register', { email, password, name });
  }

  async function login({ email, password }) {
    return await post('/api/v1/auth/login', { email, password });
  }

  async function refresh({ refreshToken }) {
    return await post('/api/v1/auth/refresh', { refreshToken });
  }

  async function logout(accessToken) {
    // Logout returns 204 with no body; we still call post via a wrapper.
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    let r;
    try {
      r = await f(baseUrl + '/api/v1/auth/logout', { method: 'POST', headers, body: '' });
    } catch (e) {
      throw new AuthError('NETWORK_ERROR', 'Không thể kết nối tới máy chủ.');
    }
    return r.status;
  }

  async function forgotPassword({ email }) {
    return await post('/api/v1/auth/forgot-password', { email });
  }

  return {
    register,
    login,
    refresh,
    logout,
    forgotPassword,
    scheduleRefresh,
    clearRefreshTimer
  };
}

export function createSessionStore(storage, key = 'mnemonics_session') {
  let listeners = [];
  return {
    async load() {
      const value = await storage.get(key);
      return value || null;
    },
    async save(session) {
      await storage.set(key, session);
      for (const l of listeners) l(session ? 'login' : 'logout', session);
    },
    async clear() {
      await storage.remove(key);
      for (const l of listeners) l('logout', null);
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => { listeners = listeners.filter((l) => l !== listener); };
    }
  };
}
