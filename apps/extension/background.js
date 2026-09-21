// Background service worker
let mnemonicsPendingScreenshot = null;
const MNEMONICS_API_URL = 'http://localhost:4000';
// Mirror of .env → bucket + Supabase URL the API uploads into. The public
// bucket serves these URLs directly so the dashboard can <img src=...>
// them without bouncing through the API proxy (which can't authenticate
// to Facebook/Instagram/Twitter CDNs anyway).
const SUPABASE_STORAGE_BASE = 'https://jtmowwtmjtmceihzvreu.supabase.co/storage/v1/object/public/mnemonics-assets';

function getAccessToken() {
  return new Promise((resolve) => chrome.storage.local.get('mnemonics_session', (result) => {
    resolve(result.mnemonics_session && result.mnemonics_session.accessToken);
  }));
}

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

// Returns the chrome.storage.local key for the current user's items.
function getUserItemsKey(session) {
  const uid = session && session.user && session.user.id ? session.user.id : 'guest';
  return 'mnemonics_items_' + uid;
}

// When the API upload succeeds it returns `{ data: { storageKey, signedUrl } }` —
// the signed URL is a Supabase Storage URL that the browser can fetch
// directly, bypassing the proxy entirely (which can't authenticate to
// Facebook/Instagram/Twitter CDNs anyway). Prefer signedUrl, fall back to
// the original remote URL when the server didn't mint one (e.g. upload
// succeeded but signed-URL generation failed).
function rewriteUploadedImageUrl(originalImageUrl, serverResult) {
  const signedUrl = serverResult && serverResult.data && serverResult.data.signedUrl;
  if (signedUrl) return signedUrl;
  return originalImageUrl;
}

// Delete an item on the server. The caller is responsible for handling
// the 401 → refresh-token retry cycle (we just receive a valid token).
// A 204 response means success and we MUST NOT try to JSON.parse the
// body — older revisions of this module threw "Unexpected end of JSON"
// on the empty 204 body.
function deleteItemOnServer(itemId, accessToken) {
  return fetch(MNEMONICS_API_URL + '/api/v1/items/' + encodeURIComponent(itemId), {
    method: 'DELETE',
    headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : {}
  }).then(function(response) {
    if (response.status === 204) return; // success, no body
    if (!response.ok) {
      return response.text().then(function(body) {
        let msg = 'API xóa thất bại';
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.error && parsed.error.message) msg = parsed.error.message;
        } catch (_) { /* keep default */ }
        throw new Error(msg);
      });
    }
    return response.text().catch(function() { null });
  });
}

function setCaptureBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function notifyCapture(title, message, badgeText, badgeColor) {
  setCaptureBadge(badgeText || '', badgeColor || '#5B3FE4');
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon48.png',
    title,
    message
  }, (notificationId) => {
    if (chrome.runtime.lastError) {
      console.warn('Mnemonics notification unavailable:', chrome.runtime.lastError.message);
    }
    return notificationId;
  });
}

// Browser extension background fetch is blocked by CORS for most CDN images
// (Facebook, Instagram, etc. don't return Access-Control-Allow-Origin). The
// local Node API runs a /api/v1/proxy/image endpoint that fetches the image
// server-to-server and streams it back. We try that first; if the proxy is
// down or the host isn't allow-listed we fall back to direct fetch — which
// only succeeds for CORS-friendly CDNs — and finally fall back to the
// cropper extension page.
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
  const accessToken = await getValidAccessToken();
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

  const form = new FormData();
  form.append('file', blob, 'mnemonics-context-image');
  form.append('title', (pageTitle || 'Ảnh đã lưu').slice(0, 500));
  form.append('note', noteText.slice(0, 4000));
  form.append('sourceUrl', pageUrl || '');
  form.append('capturedAt', capturedAt);
  form.append('clientRequestId', crypto.randomUUID());

  const uploadResponse = await fetch(MNEMONICS_API_URL + '/api/v1/captures/image', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken },
    body: form
  });
  const body = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) {
    throw new Error(body.error && body.error.message ? body.error.message : 'API không lưu được ảnh.');
  }
  return Object.assign(body, { _resolvedDataUrl: resolvedDataUrl });
}

// After the server-side upload succeeds, also append a local item so the
// dashboard renders it immediately. The dashboard reads exclusively from
// chrome.storage.local — it never fetches from the API list — so without
// this mirror the user sees "nothing happened" even though the database
// has the row. The stored `imageUrl` is rewritten to the Supabase public
// storage URL when `serverResult.storageKey` is present, so the dashboard
// renders the uploaded copy directly instead of resetting back to the
// remote CDN (Facebook, Instagram, etc. block the API proxy).
// imageUrl — the URL passed in (Facebook CDN, blob URL, etc.)
// pageUrl — the page the image was on
// pageTitle — page title
// serverResult — null when upload failed; object when it succeeded
// resolvedDataUrl — optional base64 data URL from the blob fetch step.
//   Critical for re-sync: if the original CDN URL (Facebook, Instagram) has
//   expired since the first save, we still have the bytes cached as a data URL
//   and can re-upload without needing the original URL.
function writeImageToLocalStore(imageUrl, pageUrl, pageTitle, serverResult, resolvedDataUrl) {
  return new Promise(function(resolve, reject) {
    chrome.storage.local.get(['mnemonics_session'], function(sess) {
      if (chrome.runtime.lastError) {
        reject(new Error('Không đọc được phiên đăng nhập: ' + chrome.runtime.lastError.message));
        return;
      }
      const itemsKey = getUserItemsKey(sess.mnemonics_session);
      chrome.storage.local.get([itemsKey], function(r) {
        if (chrome.runtime.lastError) {
          reject(new Error('Không đọc được dữ liệu dashboard: ' + chrome.runtime.lastError.message));
          return;
        }
        const items = r[itemsKey] || [];
        // Prefer the Supabase Storage public URL so the dashboard can
        // <img src=...> the cached copy without going through the proxy
        // (which often fails for Facebook/Instagram/Twitter CDNs).
        const renderedImageUrl = rewriteUploadedImageUrl(imageUrl, serverResult);
        // If upload failed but we have a resolved data URL, use it so the card
        // actually renders AND re-sync can re-upload without the CDN URL.
        const effectiveImageUrl = (!serverResult && resolvedDataUrl)
          ? resolvedDataUrl
          : renderedImageUrl;
        const newItem = {
          id: Date.now(),
          title: (pageTitle || 'Ảnh đã lưu').slice(0, 80),
          excerpt: '',
          note: '',
          imageUrl: effectiveImageUrl,
          sourceUrl: pageUrl || '',
          url: (pageUrl || '').replace(/^https?:\/\//, '').slice(0, 80),
          type: 'image',
          tags: ['context-menu'],
          savedAt: new Date().toISOString(),
          date: 'Vừa xong',
          space: 'Mới lưu',
          // Mark the item as not-yet-uploaded whenever we don't have a
          // serverResult; the dashboard surfaces a "Đồng bộ lên database"
          // button on those rows. Once the user clicks it, we re-upload
          // and clear the flag in place.
          pendingUpload: !serverResult
        };
        items.unshift(newItem);
        const stored = items.slice(0, 80);
        const payload = {};
        payload[itemsKey] = stored;
        chrome.storage.local.set(payload, function() {
          if (chrome.runtime.lastError) {
            reject(new Error('Không ghi được dữ liệu dashboard: ' + chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      });
    });
  });
}

// Lắng nghe message DELETE_ITEM từ dashboard.
// Upload a non-image capture (link or text/quote) to the API. Returns
// the parsed JSON body on success. Throws with a human-readable message
// on network failure / 4xx so callers can show it.
async function uploadTextCapture(payload) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi lưu.');
  if (!payload || !payload.title) throw new Error('Thiếu tiêu đề.');
  const response = await fetch(MNEMONICS_API_URL + '/api/v1/captures', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error && body.error.message ? body.error.message : 'API không lưu được.');
  }
  return body;
}

// Mirror of the non-image item into chrome.storage.local so the dashboard
// shows it immediately even though the API list isn't queried. When
// `serverResult` is null we mark `pendingUpload: true` so the dashboard
// surfaces a "Đồng bộ" pill.
function writeGenericLocalStore(item, serverResult) {
  return new Promise(function(resolve, reject) {
    chrome.storage.local.get(['mnemonics_session'], function(sess) {
      if (chrome.runtime.lastError) {
        reject(new Error('Không đọc được phiên đăng nhập: ' + chrome.runtime.lastError.message));
        return;
      }
      const itemsKey = getUserItemsKey(sess.mnemonics_session);
      chrome.storage.local.get([itemsKey], function(r) {
        if (chrome.runtime.lastError) {
          reject(new Error('Không đọc được dữ liệu dashboard: ' + chrome.runtime.lastError.message));
          return;
        }
        const items = r[itemsKey] || [];
        const stored = Object.assign({}, item, {
          pendingUpload: !serverResult
        });
        items.unshift(stored);
        const trimmed = items.slice(0, 80);
        const payload = {};
        payload[itemsKey] = trimmed;
        chrome.storage.local.set(payload, function() {
          if (chrome.runtime.lastError) {
            reject(new Error('Không ghi được dữ liệu dashboard: ' + chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      });
    });
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

chrome.runtime.onInstalled.addListener(setupContextMenus);
// onStartup handles browser reboot; reload-from-disk skips onInstalled but
// still loads this background script — recreate the menus every time.
chrome.runtime.onStartup.addListener(setupContextMenus);
setupContextMenus();

// Xử lý khi user click context menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-link-to-mnemonics') {
    const linkUrl = info.linkUrl || '';
    const pageTitle = tab.title || '';
    const linkText = info.selectionText || '';
    const title = (linkText || pageTitle || linkUrl).slice(0, 80) || 'Link đã lưu';

    // Build the local-first item immediately so the dashboard shows it
    // even before the server confirms. We push it again after the API
    // call if we want — but here we just rely on the existing pattern.
    const localItem = {
      id: Date.now(),
      title: title,
      note: '',
      excerpt: '',
      sourceUrl: linkUrl,
      url: linkUrl.replace(/^https?:\/\//, '').slice(0, 80),
      type: 'link',
      tags: ['link'],
      savedAt: new Date().toISOString(),
      date: 'Vừa xong'
    };

    // Try the server first. If it succeeds, drop pendingUpload. If it
    // fails, still keep the local copy but mark it pendingUpload so the
    // dashboard surfaces a "Đồng bộ" pill.
    getAccessToken().then(function(session) {
      const itemsKey = getUserItemsKey(session);
      uploadTextCapture({
        type: 'link',
        title: title,
        sourceUrl: linkUrl,
        capturedAt: localItem.savedAt,
        clientRequestId: crypto.randomUUID()
      }).then(function() {
        writeGenericLocalStore(localItem, { ok: true });
        notifyDashboards('ITEM_SAVED');
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics',
          message: '🔗 Đã lưu link lên database!'
        });
      }).catch(function(error) {
        console.warn('Mnemonics link upload failed:', error);
        writeGenericLocalStore(localItem, null);
        notifyDashboards('ITEM_SAVED');
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics - Lưu cục bộ',
          message: 'Link chưa upload lên database: ' + (error.message || 'lỗi')
        });
      });
    });
  }

  if (info.menuItemId === 'save-image-to-mnemonics') {
    const imageUrl = info.srcUrl || '';
    const pageUrl = tab.url || '';
    const pageTitle = tab.title || '';

    notifyCapture('Mnemonics', 'Đang lưu ảnh...', '…', '#f59e0b');
    uploadImageFromContextMenu(imageUrl, pageUrl, pageTitle)
      .then((serverResult) => {
        const dataUrl = serverResult && serverResult._resolvedDataUrl ? serverResult._resolvedDataUrl : null;
        return writeImageToLocalStore(imageUrl, pageUrl, pageTitle, serverResult, dataUrl);
      })
      .then(() => {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(t => {
            if (t.url && t.url.includes('mnemonics-dashboard.html')) {
              chrome.tabs.sendMessage(t.id, { type: 'ITEM_SAVED' }).catch(() => {});
            }
          });
        });
        notifyCapture('Mnemonics', 'Đã lưu ảnh vào database!', '', '#22c55e');
      })
      .catch((error) => {
        console.warn('Mnemonics image upload failed:', error);
        const reason = (error && error.message) ? error.message : 'Lỗi không xác định';
        // When upload fails, try to fetch the image via background fetch
        // so we can persist it as a data URL for re-sync.
        tryResolveImageViaBackground(imageUrl)
          .then(function(dataUrl) {
            // Pass resolvedDataUrl so the card renders AND re-sync works
            return writeImageToLocalStore(imageUrl, pageUrl, pageTitle, null, dataUrl);
          })
          .catch(function() {
            // Could not resolve image at all — still save with original URL
            return writeImageToLocalStore(imageUrl, pageUrl, pageTitle, null, null);
          })
          .then(() => notifyCapture(
            'Mnemonics - Lưu cục bộ',
            'Ảnh chưa upload lên database, nhưng đã hiện trong dashboard. Chi tiết: ' + reason,
            '!',
            '#f59e0b'
          ))
          .catch((localError) => notifyCapture(
            'Mnemonics - Lỗi lưu ảnh',
            reason + '. ' + ((localError && localError.message) || ''),
            '!',
            '#ef4444'
          ));
      });
  }

  if (info.menuItemId === 'save-to-mnemonics') {
    const selectedText = info.selectionText || '';
    const pageUrl = tab.url || '';
    const pageTitle = tab.title || '';

    // Auto tags từ text được chọn (chỉ dùng cho local item; server
    // sẽ sinh tag riêng nếu muốn). Khi text quá ngắn hoặc không có
    // gì để chọn, fallback về pageUrl/anchor của tab.
    const stopwords = ['the','a','an','of','in','on','for','to','and','or','is','are','was','were',
      'this','that','with','from','have','will','your','page','home','có','của','và','với','từ',
      'này','đó','cho','một','các','được','không','thì','đã','đang','sẽ'];
    const words = selectedText.toLowerCase()
      .replace(/[^a-zA-Z0-9\sàáảãạăắặẳẵằâấậẩẫầèéẻẽẹêếệểễềìíỉĩịòóỏõọôốộổỗồơớợởỡờùúủũụưứựửữừỳýỷỹỵđ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.includes(w));
    const freq = {};
    words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    const tags = Object.keys(freq).sort((a,b) => freq[b]-freq[a]).slice(0, 4);

    const localItem = {
      id: Date.now(),
      title: pageTitle.slice(0, 80) || 'Đoạn trích',
      note: selectedText.slice(0, 500),
      excerpt: selectedText.slice(0, 280),
      sourceUrl: pageUrl,
      url: pageUrl.replace(/^https?:\/\//, '').slice(0, 80),
      type: 'quote',
      tags: tags.length > 0 ? tags : ['trích dẫn'],
      savedAt: new Date().toISOString(),
      date: 'Vừa xong'
    };

    // Server schema dùng type 'text' cho selection, không phải 'quote'.
    // Bỏ `tags` (server sẽ tự sinh) để tránh .strict() reject.
    const serverPayload = {
      type: 'text',
      title: localItem.title,
      sourceUrl: pageUrl || undefined,
      selectedText: selectedText || undefined,
      capturedAt: localItem.savedAt,
      clientRequestId: crypto.randomUUID()
    };

    uploadTextCapture(serverPayload)
      .then(function() {
        writeGenericLocalStore(localItem, { ok: true });
        notifyDashboards('ITEM_SAVED');
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics',
          message: '★ Đã lưu trích dẫn lên database!'
        });
      })
      .catch(function(error) {
        console.warn('Mnemonics text upload failed:', error);
        writeGenericLocalStore(localItem, null);
        notifyDashboards('ITEM_SAVED');
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics - Lưu cục bộ',
          message: 'Trích dẫn chưa upload lên database: ' + (error.message || 'lỗi')
        });
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
      capturedAt: payload.capturedAt || new Date().toISOString()
    })
      .then((serverItem) => {
        sendResponse({ ok: true, data: serverItem });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Upload failed' });
      });
    return true;
  }

  // Re-upload a single local item that was saved while the upload pipeline
  // was failing (token expired, network down, …). The dashboard finds the
  // matching row by its local id, sends the original imageUrl back here,
  // and we re-run the same upload pipeline as a fresh context-menu save.
  // On success the dashboard clears the `pendingUpload` flag.
  if (msg && msg.type === 'RESYNC_ITEM') {
    const imageUrl = msg.imageUrl || '';
    const sourceUrl = msg.sourceUrl || '';
    const title = msg.title || '';
    const note = msg.note || '';
    uploadImageFromContextMenu(imageUrl, sourceUrl, title, {
      note: note,
      capturedAt: msg.capturedAt || new Date().toISOString()
    })
      .then((serverItem) => {
        sendResponse({ ok: true, data: serverItem });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Resync failed' });
      });
    return true;
  }

  // Re-upload a link or text/quote item that initially failed to reach
  // Supabase. Shares the same /api/v1/captures endpoint as the live
  // context-menu flow.
  if (msg && msg.type === 'RESYNC_TEXT_ITEM') {
    const type = msg.itemType === 'link' ? 'link' : 'text';
    const serverPayload = {
      type: type,
      title: msg.title || (type === 'link' ? 'Link đã lưu' : 'Đoạn trích'),
      sourceUrl: msg.sourceUrl || undefined,
      selectedText: msg.selectedText || undefined,
      capturedAt: msg.capturedAt || new Date().toISOString(),
      clientRequestId: crypto.randomUUID()
    };
    uploadTextCapture(serverPayload)
      .then(function(serverItem) {
        sendResponse({ ok: true, data: serverItem });
      })
      .catch(function(error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Resync failed' });
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
        // Drop the cached API snapshot for the current user so the
        // next loadFromExtension() call shows the deletion immediately.
        chrome.storage.local.get(['mnemonics_session'], function(sess) {
          const uid = sess && sess.mnemonics_session && sess.mnemonics_session.user
            ? sess.mnemonics_session.user.id
            : null;
          const apiKey = 'mnemonics_api_items_' + (uid || 'guest');
          chrome.storage.local.get([apiKey], function(r) {
            const list = Array.isArray(r[apiKey]) ? r[apiKey] : [];
            const filtered = list.filter(function(it) { return String(it.id) !== String(itemId); });
            chrome.storage.local.set({ [apiKey]: filtered }, function() {});
          });
        });
        sendResponse({ ok: true });
      })
      .catch(function(error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : 'Delete failed' });
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
});

// (deleteItemOnServer is declared earlier in this file. Single source of truth.)
