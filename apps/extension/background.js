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

async function uploadImageFromContextMenu(imageUrl, pageUrl, pageTitle, extra) {
  const accessToken = await getAccessToken();
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
  try {
    if (/^data:/i.test(imageUrl)) {
      const mimeMatch = /^data:([^;]+)/i.exec(imageUrl);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '');
      let binary;
      try { binary = atob(base64); }
      catch (decodeErr) { throw new Error('Không giải mã được ảnh data URL: ' + decodeErr.message); }
      const bytes = new Uint8Array(binary.length);
      for (let bi = 0; bi < binary.length; bi++) bytes[bi] = binary.charCodeAt(bi);
      blob = new Blob([bytes], { type: mime });
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
  return body;
}

// Open the cropper extension page pre-loaded with the remote image URL. The
// cropper will receive the image as a data: URL through the pending-screenshot
// mechanism so it doesn't have to fetch it directly (which would fail for
// CORS-blocked CDNs like Facebook/Instagram). The cropper will then offer
// the user a chance to crop before saving.
async function openCropperWithImage(imageUrl, pageUrl, pageTitle) {
  var displayUrl = (pageUrl || imageUrl).replace(/^https?:\/\//, '').slice(0, 80);

  var payload;
  if (!/^https?:\/\//i.test(imageUrl)) {
    console.log('[mnemonics] cropper: non-http URL, storing directly:', imageUrl.slice(0, 60));
    payload = { imageUrl: imageUrl, sourceUrl: pageUrl || '', displayUrl: displayUrl, title: pageTitle || 'Ảnh đã lưu', tags: ['ảnh', 'context-menu'] };
  } else {
    // Convert the CORS-blocked CDN image to a data: URL through the background
    // worker. data: URLs are same-origin to the extension so the canvas stays
    // untainted and cropping works without CORS/taint errors.
    console.log('[mnemonics] cropper: fetching image via FETCH_IMAGE_AS_DATA_URL:', imageUrl.slice(0, 80));
    try {
      var response = await new Promise(function(resolve) {
        chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_AS_DATA_URL', url: imageUrl }, resolve);
      });
      if (response && response.ok && response.data && response.data.dataUrl) {
        console.log('[mnemonics] cropper: FETCH_IMAGE_AS_DATA_URL ok, bytes:', response.data.byteLength, 'dataUrl len:', response.data.dataUrl.length);
        payload = { imageUrl: response.data.dataUrl, sourceUrl: pageUrl || '', displayUrl: displayUrl, title: pageTitle || 'Ảnh đã lưu', tags: ['ảnh', 'context-menu'] };
      } else {
        console.warn('[mnemonics] cropper: FETCH_IMAGE_AS_DATA_URL failed:', response && response.error, '— using raw URL');
        payload = { imageUrl: imageUrl, sourceUrl: pageUrl || '', displayUrl: displayUrl, title: pageTitle || 'Ảnh đã lưu', tags: ['ảnh', 'context-menu'] };
      }
    } catch (err) {
      console.warn('[mnemonics] cropper: background fetch threw:', err);
      payload = { imageUrl: imageUrl, sourceUrl: pageUrl || '', displayUrl: displayUrl, title: pageTitle || 'Ảnh đã lưu', tags: ['ảnh', 'context-menu'] };
    }
  }

  // Wait for the pending screenshot to be stored before opening the cropper tab.
  console.log('[mnemonics] cropper: storing pending, imageUrl type:', typeof payload.imageUrl, 'prefix:', String(payload.imageUrl).slice(0, 20));
  await new Promise(function(resolve) {
    chrome.runtime.sendMessage({ type: 'SET_PENDING_SCREENSHOT', payload: payload }, resolve);
  });
  console.log('[mnemonics] cropper: pending stored, opening tab');
  chrome.tabs.create({ url: chrome.runtime.getURL('screenshot-cropper.html') });
}

// After the server-side upload succeeds, also append a local item so the
// dashboard renders it immediately. The dashboard reads exclusively from
// chrome.storage.local — it never fetches from the API list — so without
// this mirror the user sees "nothing happened" even though the database
// has the row. The stored `imageUrl` is rewritten to the Supabase public
// storage URL when `serverResult.storageKey` is present, so the dashboard
// renders the uploaded copy directly instead of resetting back to the
// remote CDN (Facebook, Instagram, etc. block the API proxy).
function writeImageToLocalStore(imageUrl, pageUrl, pageTitle, serverResult) {
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
        const newItem = {
          id: Date.now(),
          title: (pageTitle || 'Ảnh đã lưu').slice(0, 80),
          excerpt: '',
          note: '',
          imageUrl: renderedImageUrl,
          sourceUrl: pageUrl || '',
          url: (pageUrl || '').replace(/^https?:\/\//, '').slice(0, 80),
          type: 'image',
          tags: ['context-menu'],
          savedAt: new Date().toISOString(),
          date: 'Vừa xong',
          space: 'Mới lưu'
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
      { id: 'save-image-crop-to-mnemonics', title: '★ Lưu & cắt ảnh (Mnemonics)', contexts: ['image'] },
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
    getAccessToken().then(function(session) {
      const itemsKey = getUserItemsKey(session);
      chrome.storage.local.get(itemsKey, function(r) {
        const items = r[itemsKey] || [];
        const newItem = {
          id: Date.now(),
          title: (linkText || pageTitle || linkUrl).slice(0, 80) || 'Link đã lưu',
          note: '',
          excerpt: '',
          sourceUrl: linkUrl,
          url: linkUrl.replace(/^https?:\/\//, '').slice(0, 80),
          type: 'link',
          tags: ['link'],
          savedAt: new Date().toISOString(),
          date: 'Vừa xong'
        };
        items.unshift(newItem);
        const payload = {};
        payload[itemsKey] = items.slice(0, 80);
        chrome.storage.local.set(payload, function() {
          chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(t) {
              if (t.url && t.url.includes('mnemonics-dashboard.html')) {
                chrome.tabs.sendMessage(t.id, { type: 'RELOAD_ITEMS' }).catch(function() {});
              }
            });
          });
          chrome.notifications.create({
            type: 'basic', iconUrl: 'icon48.png', title: 'Mnemonics',
            message: '🔗 Đã lưu link thành công!'
          });
        });
      });
    });
  }

  if (info.menuItemId === 'save-image-to-mnemonics') {
    const imageUrl = info.srcUrl || '';
    const pageUrl = tab.url || '';
    const pageTitle = tab.title || '';

    notifyCapture('Mnemonics', 'Đang tải ảnh lên database...', '...', '#f59e0b');
    uploadImageFromContextMenu(imageUrl, pageUrl, pageTitle)
      .then((serverResult) => writeImageToLocalStore(imageUrl, pageUrl, pageTitle, serverResult))
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
        if (error && error.code === 'CORS_BLOCKED') {
          notifyCapture('Mnemonics', 'Trang nguồn chặn CORS — mở cropper để bạn xử lý thủ công.', '!', '#f59e0b');
          try { openCropperWithImage(imageUrl, pageUrl, pageTitle); } catch (openErr) {
            console.error('Mnemonics cropper fallback failed:', openErr);
            notifyCapture('Mnemonics - Lỗi', 'Không mở được cropper.', '!', '#ef4444');
          }
          return;
        }
        writeImageToLocalStore(imageUrl, pageUrl, pageTitle)
          .then(() => notifyCapture(
            'Mnemonics - Đã lưu cục bộ',
            'Ảnh đã hiện trong dashboard nhưng database chưa lưu: ' + (error.message || 'lỗi không xác định'),
            '!',
            '#f59e0b'
          ))
          .catch((localError) => notifyCapture(
            'Mnemonics - Lỗi lưu ảnh',
            (error.message || 'Không lưu được vào database.') + ' ' + (localError.message || ''),
            '!',
            '#ef4444'
          ));
      });
  }

  if (info.menuItemId === 'save-image-crop-to-mnemonics') {
    const imageUrl = info.srcUrl || '';
    const pageUrl = tab.url || '';
    const pageTitle = tab.title || '';

    notifyCapture('Mnemonics', 'Đang mở cropper...', '✂️', '#5B3FE4');
    openCropperWithImage(imageUrl, pageUrl, pageTitle);
  }

  if (info.menuItemId === 'save-to-mnemonics') {
    const selectedText = info.selectionText || '';
    const pageUrl = tab.url || '';
    const pageTitle = tab.title || '';

    getAccessToken().then(function(session) {
      const itemsKey = getUserItemsKey(session);

      chrome.storage.local.get(itemsKey, function(r) {
        const items = r[itemsKey] || [];

        // Auto tags từ text được chọn
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

        const newItem = {
          id: Date.now(),
          title: pageTitle.slice(0, 80),
          note: selectedText.slice(0, 500),
          sourceUrl: pageUrl,
          url: pageUrl.replace(/^https?:\/\//, '').slice(0, 80),
          type: 'quote',
          tags: tags.length > 0 ? tags : ['trích dẫn'],
          savedAt: new Date().toISOString(),
          date: 'Vừa xong'
        };

        items.unshift(newItem);
        const toStore = items.slice(0, 50);

        const payload = {};
        payload[itemsKey] = toStore;
        chrome.storage.local.set(payload, function() {
          // Notify dashboard nếu đang mở
          chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(t) {
              if (t.url && t.url.includes('mnemonics-dashboard.html')) {
                chrome.tabs.sendMessage(t.id, { type: 'RELOAD_ITEMS' }).catch(function() {});
              }
            });
          });

          // Hiện thông báo nhỏ
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'Mnemonics',
            message: '★ Đã lưu trích dẫn thành công!'
          });
        });
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
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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
});
