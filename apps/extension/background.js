// Background service worker

let mnemonicsPendingScreenshot = null;
const MNEMONICS_API_URL = 'http://localhost:4000';

// Return a still-valid access token, refreshing proactively if the stored
// one is expired or close to expiring. Required because the cropper and
// context-menu paths upload through the background script which doesn't
// share the dashboard's auto-refresh timer — without this the upload
// returns "Xác thực không hợp lệ" whenever the JWT has expired but the
// storage cache hasn't been refreshed yet.
async function getValidAccessToken() {
  const stored = await new Promise(function(resolve) {
    chrome.storage.local.get('mnemonics_session', function(r) { resolve(r.mnemonics_session); });
  });
  if (!stored || !stored.accessToken) {
    throw new Error('Bạn cần đăng nhập trước khi lưu ảnh.');
  }

  // Check expiry. Supabase access_token JWTs carry an `exp` claim; the
  // session blob also has `expiresAt` (seconds since epoch) for clients
  // that don't want to decode the JWT.
  const expiresAtMs = (typeof stored.expiresAt === 'number' ? stored.expiresAt * 1000 : 0)
    || (function() {
      try {
        const parts = String(stored.accessToken).split('.');
        if (parts.length !== 3) return 0;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.exp ? payload.exp * 1000 : 0;
      } catch (_) { return 0; }
    })();
  const refreshThreshold = Date.now() + 60 * 1000; // refresh 1 minute before expiry
  if (expiresAtMs && expiresAtMs > refreshThreshold) {
    return stored.accessToken;
  }

  if (!stored.refreshToken) {
    throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trong dashboard.');
  }

  console.log('[mnemonics] access token expired or close to expiry, refreshing...');
  let response;
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken })
    });
  } catch (networkErr) {
    throw new Error('Không refresh được token: ' + networkErr.message);
  }
  let payload = {};
  try { payload = await response.json(); } catch (_) { payload = {}; }
  // API envelope is `{ data: { user, session } }`; the legacy code was
  // reading `payload.data.accessToken` (undefined) and silently
  // re-using the previous access token, which is why refresh appeared
  // to "do nothing" until the JWT fully expired.
  const session = payload && payload.data && payload.data.session;
  if (!response.ok || !session || !session.accessToken || !session.refreshToken) {
    // Refresh failed — wipe the stale session so the user has to re-login.
    chrome.storage.local.remove('mnemonics_session', function() {});
    throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trong dashboard.');
  }
  const next = Object.assign({}, stored, {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt || stored.expiresAt,
    user: (payload.data && payload.data.user) || stored.user
  });
  await new Promise(function(resolve) {
    chrome.storage.local.set({ mnemonics_session: next }, function() { resolve(); });
  });
  console.log('[mnemonics] token refreshed, expiresAt:', next.expiresAt);
  return next.accessToken;
}

// Delete a single memory item by id. The API returns 204 No Content on
// success so we MUST NOT parse the body. Token may be stale by the time
// the dashboard asks us to delete (because we delete through the
// background script specifically to handle refresh out-of-band), so
// refresh once on 401 and retry before surfacing the error.
async function deleteItemOnServer(itemId, accessToken) {
  let token = accessToken;
  let response;
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (networkErr) {
    throw new Error('Không kết nối được API: ' + (networkErr && networkErr.message ? networkErr.message : 'network error'));
  }

  if (response.status === 401) {
    const refreshed = await forceRefreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      });
    }
  }

  if (response.status === 204 || response.ok) return true;

  let body = {};
  try { body = await response.json(); } catch (_) { body = {}; }
  const message = body && body.error && body.error.message
    ? body.error.message
    : 'API từ chối yêu cầu (HTTP ' + response.status + ').';
  throw new Error(message);
}

// Toggle the `is_favorite` flag on an item. The dashboard sends the
// intended next value (true/false) so the background doesn't have to
// read state first — keeps the round-trip atomic. Goes through the
// same `getValidAccessToken` → 401 → refresh → retry loop as every
// other write.
async function setFavoriteOnServer(itemId, isFavorite, accessToken) {
  let token = accessToken;
  let response;
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ isFavorite: !!isFavorite })
    });
  } catch (networkErr) {
    throw new Error('Không kết nối được API: ' + (networkErr && networkErr.message ? networkErr.message : 'network error'));
  }

  if (response.status === 401) {
    const refreshed = await forceRefreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isFavorite: !!isFavorite })
      });
    }
  }

  if (response.ok) {
    let body = {};
    try { body = await response.json(); } catch (_) { body = {}; }
    return body.item || { id: itemId, isFavorite: !!isFavorite };
  }

  let body = {};
  try { body = await response.json(); } catch (_) { body = {}; }
  const message = body && body.error && body.error.message
    ? body.error.message
    : 'API từ chối yêu cầu (HTTP ' + response.status + ').';
  throw new Error(message);
}

// Generic PATCH against /items/:id. Supports a subset of fields that
// the reader modal writes (title, notes, isFavorite, tags). The server
// rejects anything it doesn't recognise with NO_UPDATES, so this stays
// narrowly scoped.
async function patchItemOnServer(itemId, patch, accessToken) {
  let token = accessToken;
  let response;
  const payload = {};
  if (patch && typeof patch.title === 'string') payload.title = patch.title;
  if (patch && typeof patch.notes === 'string') payload.notes = patch.notes;
  if (patch && typeof patch.isFavorite === 'boolean') payload.isFavorite = patch.isFavorite;
  if (patch && Array.isArray(patch.tags)) payload.tags = patch.tags;
  if (Object.keys(payload).length === 0) {
    throw new Error('Patch trống: cần truyền ít nhất title/notes/isFavorite/tags.');
  }
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    throw new Error('Không kết nối được API: ' + (networkErr && networkErr.message ? networkErr.message : 'network error'));
  }
  if (response.status === 401) {
    const refreshed = await forceRefreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    }
  }
  if (response.ok) {
    let body = {};
    try { body = await response.json(); } catch (_) { body = {}; }
    return body.item || { id: itemId, ...payload };
  }
  let body = {};
  try { body = await response.json(); } catch (_) { body = {}; }
  const message = body && body.error && body.error.message
    ? body.error.message
    : 'API từ chối yêu cầu (HTTP ' + response.status + ').';
  throw new Error(message);
}


// Force a refresh after the server rejects an otherwise-unexpired access token.
// This is the recovery path for revoked/rotated JWTs; getValidAccessToken()
// only refreshes proactively near expiry.
async function forceRefreshAccessToken() {
  const stored = await new Promise(function(resolve) {
    chrome.storage.local.get('mnemonics_session', function(r) {
      resolve(r.mnemonics_session);
    });
  });

  if (!stored || !stored.refreshToken) {
    throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trong dashboard.');
  }

  let response;
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken })
    });
  } catch (networkErr) {
    throw new Error('Không refresh được token: ' + networkErr.message);
  }

  const payload = await response.json().catch(function() { return {}; });
  const session = payload && payload.data && payload.data.session;
  if (!response.ok || !session || !session.accessToken || !session.refreshToken) {
    chrome.storage.local.remove('mnemonics_session', function() {});
    throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trong dashboard.');
  }

  const next = Object.assign({}, stored, {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt || stored.expiresAt,
    user: (payload.data && payload.data.user) || stored.user
  });

  await new Promise(function(resolve) {
    chrome.storage.local.set({ mnemonics_session: next }, function() { resolve(); });
  });

  return next.accessToken;
}


async function fetchImageViaLocalProxy(imageUrl) {
  const proxyUrl = MNEMONICS_API_URL + '/api/v1/proxy/image?url=' + encodeURIComponent(imageUrl);
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    const wrapped = new Error('PROXY_FAILED:' + response.status);
    wrapped.code = 'PROXY_FAILED';
    wrapped.status = response.status;
    throw wrapped;
  }
  return response.blob();
}

async function blobUrlToDataUrl(blobUrl) {
  // Background pages can't use canvas toImageBitmap from cross-origin URLs
  // without CORS. Instead we use fetch with img → canvas. This still needs
  // CORS unless the image is already CORS-open or we use a CORS proxy.
  // As a last resort for stubborn CDNs (Facebook, Instagram), we skip the
  // data-URL caching and the user will need to re-screenshot manually.
  try {
    const response = await fetch(blobUrl, { credentials: 'omit' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const blob = await response.blob();
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(new Error('FileReader failed')); };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null; // CORS or network blocked — caller must fall back
  }
}

// When the image proxy (server-to-server fetch) fails, we attempt one more
// pass using the background page's fetch.  Background pages are exempt from
// most CORS restrictions so this works for CDNs that block the extension's
// service worker.  If that also fails we return null so the caller can
// show the user a "sync failed" pill.
async function tryResolveImageViaBackground(imageUrl) {
  try {
    const response = await fetch(imageUrl, { credentials: 'omit', redirect: 'follow' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(new Error('read failed')); };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}

async function uploadImageFromContextMenu(imageUrl, pageUrl, pageTitle, extra) {
  let accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi lưu ảnh.');
  if (!imageUrl) throw new Error('Không tìm thấy URL ảnh.');
  const noteText = extra && extra.note ? extra.note : '';
  const capturedAt = extra && extra.capturedAt ? extra.capturedAt : new Date().toISOString();

  // Resolve the image to a Blob. data: URLs are decoded locally (so we
  // don't need any network fetch and CORS is irrelevant). Remote http(s)
  // URLs go through the local proxy first (bypasses CORS by fetching
  // server-to-server); fallback to a direct background fetch which only
  // works for CORS-friendly CDNs.
  let blob;
  let resolvedDataUrl = null; // cached data URL to persist on failure
  try {
    if (/^data:/i.test(imageUrl)) {
      const mimeMatch = /^data:([^;]+)/i.exec(imageUrl);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '');
      // Decode base64 in chunks to avoid blowing the call stack on large
      // images (a typical 1MB JPEG decodes to ~1.3MB of binary). The naive
      // `String.fromCharCode.apply(null, bytes)` throws RangeError above
      // ~256KB.
      let binary;
      try { binary = atob(base64); }
      catch (decodeErr) { throw new Error('Không giải mã được ảnh data URL: ' + decodeErr.message); }
      const CHUNK = 0x8000;
      const bytes = new Uint8Array(binary.length);
      for (let off = 0; off < binary.length; off += CHUNK) {
        const slice = binary.substr(off, CHUNK);
        for (let bi = 0; bi < slice.length; bi++) bytes[off + bi] = slice.charCodeAt(bi);
      }
      blob = new Blob([bytes], { type: mime });
      resolvedDataUrl = imageUrl; // already a data URL
      console.log('[mnemonics] upload: data URL decoded locally, mime:', mime, 'size:', bytes.length);
    } else if (/^https?:\/\//i.test(imageUrl)) {
      try {
        blob = await fetchImageViaLocalProxy(imageUrl);
      } catch (proxyError) {
        console.warn('[mnemonics] proxy fetch failed, trying direct:', proxyError && proxyError.message);
        let directResponse;
        try {
          directResponse = await fetch(imageUrl, { credentials: 'omit', redirect: 'follow' });
        } catch (networkError) {
          const wrapped = new Error('CORS_BLOCKED: ' + (networkError && networkError.message ? networkError.message : 'fetch failed'));
          wrapped.code = 'CORS_BLOCKED';
          throw wrapped;
        }
        if (!directResponse.ok) throw new Error('Không tải được ảnh từ trang nguồn (' + directResponse.status + ').');
        if (directResponse.type === 'opaque') {
          const wrapped = new Error('CORS_BLOCKED: opaque response');
          wrapped.code = 'CORS_BLOCKED';
          throw wrapped;
        }
        blob = await directResponse.blob();
        // Convert blob to data URL so we can persist it if the upload fails.
        // This is the critical step that lets us re-upload without needing
        // the original URL to still be valid (Facebook URLs expire).
        resolvedDataUrl = await new Promise(function(resolve, reject) {
          const reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.onerror = function() { reject(new Error('read failed')); };
          reader.readAsDataURL(blob);
        });
      }
    } else {
      throw new Error('URL ảnh không hỗ trợ: ' + String(imageUrl).slice(0, 40));
    }
  } catch (blobError) {
    console.warn('[mnemonics] image blob resolution failed:', blobError && blobError.message);
    throw blobError;
  }

  const mimeType = blob.type || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Định dạng ảnh không được hỗ trợ.');
  }

// Derive a sensible filename for the multipart upload. The browser
// loses the original filename when we fetch the image via the local
// proxy (a Blob has no `name`) and the API uses
// `request.file.originalname` to build the storage key. Without a
// real extension Supabase falls back to `application/octet-stream`
// for the `Content-Type`, so the signed URL serves back the bytes
// without an image MIME type and Chrome blocks it.
function extensionForMime(mime) {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/svg+xml': return 'svg';
    default: return 'jpg';
  }
}

function tryExtractFilename(url) {
  if (!url) return '';
  try {
    var u = new URL(url);
    var last = u.pathname.split('/').pop() || '';
    // Strip query / hash and keep only the basename.
    return last.split('?').slice(-1)[0] || last;
  } catch (_) { return ''; }
}

function pickUploadFilename(imageUrl, mime) {
  var ext = extensionForMime(mime);
  var fromUrl = tryExtractFilename(imageUrl);
  if (fromUrl && /\.(jpe?g|png|webp|gif|svg)$/i.test(fromUrl)) return fromUrl;
  var ts = Date.now();
  return 'capture-' + ts + '.' + ext;
}

const form = new FormData();
form.append('file', blob, pickUploadFilename(imageUrl, mimeType));
// Right-click on an <img> is a remote image, not a screenshot.
// The extension's screenshot flow has its own upload path
// (extension.js → savePendingScreenshot → uploadImageCapture) which
// sends type='screenshot'; keep the explicit branch here so the
// OCR pipeline treats web images and screenshots differently.
form.append('type', 'image');
form.append('title', (pageTitle || 'Ảnh đã lưu').slice(0, 500));
form.append('note', noteText.slice(0, 4000));
form.append('sourceUrl', pageUrl || '');
form.append('capturedAt', capturedAt);
  const clientRequestId = extra && extra.clientRequestId ? extra.clientRequestId : crypto.randomUUID();
  form.append('clientRequestId', clientRequestId);

  let uploadResponse = await fetch(MNEMONICS_API_URL + '/api/v1/captures/image', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: form
  });

  if (uploadResponse.status === 401) {
    accessToken = await forceRefreshAccessToken();
    uploadResponse = await fetch(MNEMONICS_API_URL + '/api/v1/captures/image', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken },
      body: form
    });
  }

  const body = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    throw new Error(body.error && body.error.message ? body.error.message : 'API không lưu được ảnh.');
  }
  return Object.assign(body, {
    _resolvedDataUrl: resolvedDataUrl,
    _clientRequestId: clientRequestId
  });
}

// Forward RELOAD_ITEMS / ITEM_SAVED broadcasts to every open dashboard
// tab — keeps the cards-container in sync without a refresh.
function notifyDashboards(type) {
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(function(t) {
      if (t.url && t.url.includes('mnemonics-dashboard.html')) {
        chrome.tabs.sendMessage(t.id, { type: type }).catch(function() {});
      }
    });
  });
}

// Lightweight toast-style notification. The full implementation lives in the
// dashboard itself; the background script only has chrome.notifications so we
// surface a tiny status pill that the next dashboard open can pick up via
// the ITEM_SAVED broadcast.
function notifyCapture(title, message, glyph, color) {
  // 1) Persist a pending status so the dashboard can render it when it
  // next opens (covers the case where the dashboard isn't open at all).
  try {
    const status = {
      title: title || 'Mnemonics',
      message: message || '',
      glyph: glyph || '•',
      color: color || '#5B3FE4',
      at: new Date().toISOString()
    };
    chrome.storage.local.set({ mnemonics_last_capture_status: status });
  } catch (_) { /* storage may be unavailable; ignore */ }

  // 2) Show a native notification as immediate feedback.
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: title || 'Mnemonics',
      message: (glyph ? glyph + '  ' : '') + (message || '')
    });
  } catch (_) { /* notifications may be blocked; ignore */ }
}

// Text / link capture from the context menu. Mirrors `sendCaptureToApi`
// in api-client.js so we don't need a cross-context import (the service
// worker is independent from the page's globals).
async function uploadTextCapture(payload) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi lưu.');
  if (!payload || !payload.type) throw new Error('Thiếu loại capture.');
  if (!payload.clientRequestId) payload.clientRequestId = crypto.randomUUID();
  if (!payload.capturedAt) payload.capturedAt = new Date().toISOString();

  let response;
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/captures', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessToken
      },
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    throw new Error('Không kết nối được API: ' + (networkErr && networkErr.message ? networkErr.message : 'network error'));
  }

  let body = {};
  try { body = await response.json(); } catch (_) { body = {}; }
  if (!response.ok) {
    const message = body && body.error && body.error.message
      ? body.error.message
      : 'API từ chối yêu cầu (HTTP ' + response.status + ').';
    throw new Error(message);
  }
  return body;
}


// Tạo context menu khi extension được cài
let contextMenusSetupInProgress = false;

function setupContextMenus() {
  if (contextMenusSetupInProgress) return;
  contextMenusSetupInProgress = true;

  // chrome.contextMenus.create errors if you call it twice with the same id
  // — wipe first so reload-from-disk (which doesn't fire onInstalled)
  // doesn't leave stale state.
  chrome.contextMenus.removeAll(function() {
    const menus = [
      { id: 'save-to-mnemonics', title: '★ Lưu vào Mnemonics', contexts: ['selection'] },
      { id: 'save-image-to-mnemonics', title: '★ Lưu ảnh vào Mnemonics', contexts: ['image'] },
      { id: 'save-link-to-mnemonics', title: '★ Lưu link vào Mnemonics', contexts: ['link'] }
    ];
    let remaining = menus.length;
    menus.forEach(function(menu) {
      chrome.contextMenus.create(menu, function() {
        remaining -= 1;
        if (remaining === 0) contextMenusSetupInProgress = false;
      });
    });
  });
}

chrome.runtime.onInstalled.addListener(function() {
  setupContextMenus();
});
// onStartup handles browser reboot; recreate menus and resume any pending
// uploads that were left in local storage while the browser was offline.
chrome.runtime.onStartup.addListener(function() {
  setupContextMenus();
});
setupContextMenus();

// Context-menu captures are confirmed by the API before the extension reports success.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-link-to-mnemonics') {
    const linkUrl = info.linkUrl || '';
    const title = (info.selectionText || tab.title || linkUrl).slice(0, 80) || 'Link đã lưu';
    uploadTextCapture({
      type: 'link',
      title,
      sourceUrl: linkUrl,
      capturedAt: new Date().toISOString(),
      clientRequestId: crypto.randomUUID()
    }).then(function() {
      notifyDashboards('ITEM_SAVED');
      chrome.notifications.create({ type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics', message: '🔗 Đã lưu link lên database!' });
    }).catch(function(error) {
      chrome.notifications.create({ type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics - Lỗi lưu link', message: error.message || 'Không lưu được link.' });
    });
  }

  if (info.menuItemId === 'save-image-to-mnemonics') {
    const imageUrl = info.srcUrl || '';
    notifyCapture('Mnemonics', 'Đang lưu ảnh...', '…', '#f59e0b');
    uploadImageFromContextMenu(imageUrl, tab.url || '', tab.title || '', { clientRequestId: crypto.randomUUID() })
      .then(function() {
        notifyDashboards('ITEM_SAVED');
        notifyCapture('Mnemonics', 'Đã lưu ảnh vào database!', '', '#22c55e');
      })
      .catch(function(error) {
        notifyCapture('Mnemonics - Lỗi lưu ảnh', error.message || 'Không lưu được ảnh.', '!', '#ef4444');
      });
  }

  if (info.menuItemId === 'save-to-mnemonics') {
    const selectedText = info.selectionText || '';
    uploadTextCapture({
      type: 'text',
      title: (tab.title || 'Đoạn trích').slice(0, 80),
      sourceUrl: tab.url || undefined,
      selectedText: selectedText || undefined,
      capturedAt: new Date().toISOString(),
      clientRequestId: crypto.randomUUID()
    }).then(function() {
      notifyDashboards('ITEM_SAVED');
      chrome.notifications.create({ type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics', message: '★ Đã lưu trích dẫn lên database!' });
    }).catch(function(error) {
      chrome.notifications.create({ type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics - Lỗi lưu', message: error.message || 'Không lưu được trích dẫn.' });
    });
  }
});

// Trao dữ liệu ảnh chụp màn hình giữa popup và trang cropper.
// Dùng background memory để tránh lỗi ảnh dataURL quá lớn khi truyền qua storage.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SET_PENDING_SCREENSHOT') {
    mnemonicsPendingScreenshot = msg.payload || null;
    sendResponse({ ok: true });
    return true;
  }

  if (msg && msg.type === 'GET_PENDING_SCREENSHOT') {
    sendResponse({ ok: true, payload: mnemonicsPendingScreenshot });
    return true;
  }

  if (msg && msg.type === 'CLEAR_PENDING_SCREENSHOT') {
    mnemonicsPendingScreenshot = null;
    sendResponse({ ok: true });
    return true;
  }

  if (msg && msg.type === 'ITEM_SAVED') {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.url && tab.url.includes('mnemonics-dashboard.html')) {
          chrome.tabs.sendMessage(tab.id, { type: 'RELOAD_ITEMS' }).catch(() => {});
        }
      });
    });
    sendResponse({ ok: true });
    return true;
  }

  // Convert an external image URL to a data: URL the extension page can
  // render. chrome-extension pages can display `<img src="data:...">` and
  // `<img src="blob:...">` unconditionally, but cross-origin HTTPS
  // responses without `Cross-Origin-Resource-Policy: cross-origin` are
  // blocked by Chrome's CORP/ORB and just show as black squares. Fetching
  // the bytes from the background service worker (which is not a document
  // context and is not subject to CORP) and re-encoding as a data URL
  // sidesteps that check entirely. Same trick used by other screenshot
  // extensions.
  if (msg && msg.type === 'FETCH_IMAGE_AS_DATA_URL') {
    const imageUrl = String(msg.url || '');
    if (!/^https?:\/\//i.test(imageUrl)) {
      sendResponse({ ok: false, error: 'URL không hợp lệ' });
      return true;
    }
    fetch(imageUrl, { credentials: 'omit' })
      .then(async (response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        if (!/^image\/(jpeg|png|webp|gif)/i.test(contentType)) {
          throw new Error('Không phải ảnh: ' + contentType);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
          throw new Error('Ảnh quá lớn (>10MB)');
        }
        // Build base64 in chunks so a 1MB+ image doesn't blow the JS call
        // stack. `btoa(bigString)` itself works on the whole string, but
        // building the binary string byte-by-byte crashes above ~256KB.
        const bytes = new Uint8Array(arrayBuffer);
        const CHUNK = 0x8000;
        let binary = '';
        for (let off = 0; off < bytes.length; off += CHUNK) {
          const slice = bytes.subarray(off, off + CHUNK);
          binary += String.fromCharCode.apply(null, slice);
        }
        const base64 = btoa(binary);
        sendResponse({
          ok: true,
          data: { dataUrl: 'data:' + contentType.split(';')[0] + ';base64,' + base64, byteLength: arrayBuffer.byteLength }
        });
      })
      .catch((err) => {
        console.warn('[Mnemonics] fetchImageAsDataUrl failed:', err);
        sendResponse({ ok: false, error: err.message || 'Fetch thất bại' });
      });
    return true;
  }

  if (msg && msg.type === 'UPLOAD_IMAGE_FROM_CROPPER') {
    const imageUrl = msg.imageUrl || '';
    const payload = msg.payload || {};
    uploadImageFromContextMenu(imageUrl, payload.sourceUrl || '', payload.title || '', {
      note: payload.note || '',
      capturedAt: payload.capturedAt || new Date().toISOString(),
      clientRequestId: payload.clientRequestId || crypto.randomUUID()
    })
      .then((serverItem) => {
        sendResponse({ ok: true, data: serverItem });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Upload failed' });
      });
    return true;
  }

  // Fetch semantic neighbors for a dashboard card. Keep this in the
  // service worker so the dashboard never needs to own auth-token refresh.
  if (msg && msg.type === 'GET_RELATED_ITEMS') {
    const itemId = String(msg.itemId || '');
    const limit = Math.min(Math.max(Number(msg.limit || 5), 1), 10);

    if (!itemId) {
      sendResponse({ ok: false, error: 'itemId is required' });
      return true;
    }

    getValidAccessToken()
      .then(async function(accessToken) {
        const apiBase = MNEMONICS_API_URL;
        async function request(token) {
          return fetch(
            apiBase + '/api/v1/items/' + encodeURIComponent(itemId) + '/related?limit=' + limit,
            { method: 'GET', headers: { Authorization: 'Bearer ' + token } }
          );
        }

        let response = await request(accessToken);
        if (response.status === 401) {
          const refreshed = await forceRefreshAccessToken();
          response = await request(refreshed);
        }

        const body = await response.json().catch(function() { return {}; });
        if (!response.ok) {
          throw new Error(
            body && body.error && body.error.message
              ? body.error.message
              : 'Could not load related memories.'
          );
        }

        sendResponse({ ok: true, data: body.related_items || [] });
      })
      .catch(function(error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : 'Could not load related memories.'
        });
      });

    return true;
  }

  // Delete an item on the server. The dashboard optimistically drops
  // the row locally before sending this; if the call fails it re-adds.
  // We handle the 401-refresh-retry cycle by going through
  // `getValidAccessToken` (same as every other write path).
  if (msg && msg.type === 'DELETE_ITEM') {
    const itemId = msg.itemId;
    if (!itemId) {
      sendResponse({ ok: false, error: 'itemId is required' });
      return true;
    }
    getValidAccessToken()
      .then(function(accessToken) {
        return deleteItemOnServer(itemId, accessToken);
      })
      .then(function() {
        sendResponse({ ok: true });
      })
      .catch(function(error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Delete failed' });
      });
    return true;
  }

  // Flip the `is_favorite` flag on an item. The dashboard sends the
  // intended next value (true/false). We mirror the DELETE_ITEM flow
  // for token refresh; on success we echo the new item back so the
  // dashboard can reconcile without re-fetching the whole list.
  if (msg && msg.type === 'TOGGLE_FAVORITE_ITEM') {
    const itemId = msg.itemId;
    if (!itemId) {
      sendResponse({ ok: false, error: 'itemId is required' });
      return true;
    }
    const next = !!msg.next;
    const isFavorite = msg.isFavorite !== undefined ? !!msg.isFavorite : next;
    getValidAccessToken()
      .then(function(accessToken) {
        return setFavoriteOnServer(itemId, isFavorite, accessToken);
      })
      .then(function(item) {
        sendResponse({ ok: true, item: item });
      })
      .catch(function(error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Favorite failed' });
      });
    return true;
  }

  // PATCH_ITEM: write back title/notes/isFavorite/tags from the reader
  // modal. Mirrors the auth + retry behaviour of TOGGLE_FAVORITE_ITEM.
  if (msg && msg.type === 'PATCH_ITEM') {
    const itemId = msg.itemId;
    const patch = msg.patch;
    if (!itemId || !patch || typeof patch !== 'object') {
      sendResponse({ ok: false, error: 'itemId and patch object are required' });
      return true;
    }
    getValidAccessToken()
      .then(function(accessToken) {
        return patchItemOnServer(itemId, patch, accessToken);
      })
      .then(function(item) {
        sendResponse({ ok: true, item: item });
      })
      .catch(function(error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Patch failed' });
      });
    return true;
  }

  // Operator/dev-only message: ask the service worker to reload itself.
  // Useful when a popup or dashboard tab wants to pick up new background
  // code without going through chrome://extensions. The reload happens
  // asynchronously and the call returns immediately.
  if (msg && msg.type === 'RESTART_EXTENSION') {
    sendResponse({ ok: true });
    setTimeout(function() { chrome.runtime.reload(); }, 50);
    return true;
  }

  // Capture from the dashboard's "Save Link" / "Quick Note" sheet.
  // Reuses uploadTextCapture so the path is identical to the context
  // menu + popup save flows.
  if (msg && msg.type === 'CAPTURE_FROM_DASHBOARD') {
    const payload = msg.payload || {};
    uploadTextCapture(payload)
      .then((data) => {
        sendResponse({ ok: true, data });
        notifyDashboards('ITEM_SAVED');
      })
      .catch((err) => {
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Capture failed' });
      });
    return true;
  }
});

// (deleteItemOnServer is declared earlier in this file. Single source of truth.)
