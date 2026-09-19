// Background service worker
let mnemonicsPendingScreenshot = null;
const MNEMONICS_API_URL = 'http://localhost:4000';

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

async function uploadImageFromContextMenu(imageUrl, pageUrl, pageTitle) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi lưu ảnh.');
  if (!imageUrl) throw new Error('Không tìm thấy URL ảnh.');

  // 1. Try the local proxy first — it bypasses CORS by fetching
  //    server-to-server. Most modern CDNs (Facebook, Instagram, Twitter)
  //    require this path.
  let blob;
  try {
    blob = await fetchImageViaLocalProxy(imageUrl);
  } catch (proxyError) {
    console.warn('[mnemonics] proxy fetch failed, trying direct:', proxyError && proxyError.message);
    // 2. Fall back to a direct background fetch — works for CORS-friendly
    //    hosts (Unsplash, Wikimedia, etc.).
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

  const mimeType = blob.type || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Định dạng ảnh không được hỗ trợ.');
  }

  const form = new FormData();
  form.append('file', blob, 'mnemonics-context-image');
  form.append('title', (pageTitle || 'Ảnh đã lưu').slice(0, 500));
  form.append('sourceUrl', pageUrl || '');
  form.append('capturedAt', new Date().toISOString());
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
// cropper will fetch the image itself (in page context) — if that also fails,
// the user still sees a clear error and can try a different image.
function openCropperWithImage(imageUrl, pageUrl, pageTitle) {
  const params = new URLSearchParams({
    src: imageUrl,
    sourceUrl: pageUrl || '',
    title: pageTitle || 'Ảnh đã lưu'
  });
  const cropperUrl = chrome.runtime.getURL('screenshot-cropper.html') + '?' + params.toString();
  chrome.tabs.create({ url: cropperUrl });
}

// After the server-side upload succeeds, also append a local item so the
// dashboard renders it immediately. The dashboard reads exclusively from
// chrome.storage.local — it never fetches from the API list — so without
// this mirror the user sees "nothing happened" even though the database
// has the row. imageUrl is kept as the original remote URL; the dashboard
// wraps it through the proxy at render time.
function writeImageToLocalStore(imageUrl, pageUrl, pageTitle) {
  return new Promise(function(resolve) {
    chrome.storage.local.get(['mnemonics_session'], function(sess) {
      const itemsKey = getUserItemsKey(sess.mnemonics_session);
      chrome.storage.local.get([itemsKey], function(r) {
        const items = r[itemsKey] || [];
        const newItem = {
          id: Date.now(),
          title: (pageTitle || 'Ảnh đã lưu').slice(0, 80),
          excerpt: '',
          note: '',
          imageUrl: imageUrl,
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
        chrome.storage.local.set(payload, function() { resolve(); });
      });
    });
  });
}


// Tạo context menu khi extension được cài
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-mnemonics',
    title: '★ Lưu vào Mnemonics',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'save-image-to-mnemonics',
    title: '★ Lưu ảnh vào Mnemonics',
    contexts: ['image']
  });
  chrome.contextMenus.create({
    id: 'save-link-to-mnemonics',
    title: '★ Lưu link vào Mnemonics',
    contexts: ['link']
  });
});

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
      .then(() => writeImageToLocalStore(imageUrl, pageUrl, pageTitle))
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
        // If the remote server blocked CORS or the fetch failed for any
        // reason we can't bypass from the background worker, open the
        // extension cropper so the user can still save the image.
        if (error && error.code === 'CORS_BLOCKED') {
          notifyCapture('Mnemonics', 'Trang nguồn chặn CORS — mở cropper để bạn xử lý thủ công.', '!', '#f59e0b');
          try { openCropperWithImage(imageUrl, pageUrl, pageTitle); } catch (openErr) {
            console.error('Mnemonics cropper fallback failed:', openErr);
            notifyCapture('Mnemonics - Lỗi', 'Không mở được cropper.', '!', '#ef4444');
          }
          return;
        }
        notifyCapture('Mnemonics - Lỗi lưu ảnh', error.message || 'Không lưu được ảnh vào database.', '!', '#ef4444');
      });
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
});
