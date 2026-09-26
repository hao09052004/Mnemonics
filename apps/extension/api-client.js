var MNEMONICS_API_URL = 'http://localhost:4000';

// Read the access token from chrome.storage.local (preferred) or localStorage
// (when running outside the extension for tests). Returns null if no
// session is present or the session has expired. Used by popup + dashboard.
function readAccessToken() {
  var raw = null;
  try {
    raw = localStorage.getItem('mnemonics_session');
    if (raw) {
      var sess = JSON.parse(raw);
      if (sess && sess.accessToken) {
        if (sess.expiresAt && sess.expiresAt * 1000 < Date.now()) return null;
        return sess.accessToken;
      }
    }
  } catch (e) { /* ignore */ }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    var captured;
    chrome.storage.local.get('mnemonics_session', function(r) {
      captured = r && r.mnemonics_session ? r.mnemonics_session.accessToken : null;
    });
    if (captured) return captured;
    // chrome.storage.local.get is async; the synchronous shim above is
    // best-effort. For popup fast-path, callers can await getAccessToken().
    return null;
  }
  return null;
}

// Async variant: read access token with proper chrome.storage.local round-trip.
// Used by background-message flows where we need the truly current value.
function getAccessToken() {
  return new Promise(function(resolve) {
    try {
      var raw = localStorage.getItem('mnemonics_session');
      if (raw) {
        var sess = JSON.parse(raw);
        if (sess && sess.accessToken) {
          if (sess.expiresAt && sess.expiresAt * 1000 < Date.now()) {
            return resolve(null);
          }
          return resolve(sess.accessToken);
        }
      }
    } catch (e) { /* ignore */ }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('mnemonics_session', function(r) {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(r && r.mnemonics_session ? r.mnemonics_session.accessToken : null);
      });
      return;
    }
    resolve(null);
  });
}

// Convert a `data:image/...;base64,...` URL into a Blob without going through
// `fetch(dataUrl)` — Chrome's CSP `connect-src 'self' <api>` blocks data URLs
// and throws `Refused to connect because it violates the document's Content
// Security Policy`. atob + Uint8Array bypasses CSP entirely.
function dataUrlToBlob(dataUrl) {
  var match = /^data:([^;]+)(;base64)?,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Không đọc được ảnh — định dạng không hợp lệ.');
  var mimeType = match[1] || 'image/jpeg';
  var isBase64 = !!match[2];
  var data = match[3] || '';
  var bytes;
  if (isBase64) {
    var binary = atob(data);
    bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    bytes = new Uint8Array(data.length);
    for (var j = 0; j < data.length; j++) bytes[j] = data.charCodeAt(j);
  }
  return new Blob([bytes], { type: mimeType });
}

// Convert any image source (data URL, blob URL, or http(s) URL) into a Blob.
// CSP only blocks `connect-src` against network URLs we didn't allow-list, so
// blob: and data: can be processed locally without a fetch round-trip.
function imageSourceToBlob(src) {
  if (!src) throw new Error('Không có ảnh để tải lên.');
  if (src.startsWith('blob:')) {
    return fetch(src).then(function(r) {
      if (!r.ok) throw new Error('Không đọc được ảnh (blob).');
      return r.blob();
    });
  }
  if (src.startsWith('data:')) {
    return Promise.resolve(dataUrlToBlob(src));
  }
  return fetch(src).then(function(r) {
    if (!r.ok) throw new Error('Không tải được ảnh từ trang nguồn.');
    return r.blob();
  });
}

function uploadImageCapture(imageDataUrl, payload, accessToken) {
  if (!accessToken) return Promise.reject(new Error('Bạn cần đăng nhập trước khi lưu ảnh.'));
  return imageSourceToBlob(imageDataUrl)
    .then(function(blob) {
      var mimeType = blob.type || 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Định dạng ảnh không được hỗ trợ.');
      }
      var ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      var form = new FormData();
      form.append('file', blob, 'mnemonics-screenshot.' + ext);
      form.append('title', payload.title || 'Ảnh chụp màn hình');
      form.append('note', payload.note || '');
      form.append('sourceUrl', payload.sourceUrl || '');
      form.append('capturedAt', payload.capturedAt || new Date().toISOString());
      form.append('clientRequestId', payload.clientRequestId || crypto.randomUUID());

      return fetch(MNEMONICS_API_URL + '/api/v1/captures/image', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        body: form
      });
    })
    .then(function(response) {
      return response.json().catch(function() { return {}; }).then(function(body) {
        if (!response.ok) {
          throw new Error(body.error && body.error.message ? body.error.message : 'API không lưu được ảnh.');
        }
        return body;
      });
    });
}

function toCapturePayload(item) {
  const type = item.type === 'image' || item.type === 'screenshot' ? 'image' : item.type === 'link' ? 'link' : 'text';
  const payload = {
    type,
    title: String(item.title || 'Untitled').trim().slice(0, 500),
    sourceUrl: item.sourceUrl || undefined,
    selectedText: item.note || item.excerpt || undefined,
    capturedAt: item.capturedAt || item.savedAt || new Date().toISOString(),
    clientRequestId: item.clientRequestId || crypto.randomUUID()
  };

  if (type === 'image') {
    throw new Error('Image upload requires object storage before it can be sent to the API.');
  }
  return payload;
}

async function refreshAccessToken() {
  var raw = null;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      raw = await new Promise(function(resolve) {
        chrome.storage.local.get('mnemonics_session', function(r) {
          resolve(r && r.mnemonics_session ? r.mnemonics_session : null);
        });
      });
    } else {
      raw = JSON.parse(localStorage.getItem('mnemonics_session') || 'null');
    }
  } catch (e) {
    raw = null;
  }

  if (!raw || !raw.refreshToken) return null;

  var response;
  try {
    response = await fetch(MNEMONICS_API_URL + '/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: raw.refreshToken })
    });
  } catch (e) {
    return null;
  }

  var body = await response.json().catch(function() { return {}; });
  var session = body && body.data && body.data.session;
  if (!response.ok || !session || !session.accessToken) return null;

  var next = Object.assign({}, raw, {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || raw.refreshToken,
    expiresAt: session.expiresAt || raw.expiresAt,
    user: (body.data && body.data.user) || raw.user
  });

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await new Promise(function(resolve) {
        chrome.storage.local.set({ mnemonics_session: next }, resolve);
      });
    } else {
      localStorage.setItem('mnemonics_session', JSON.stringify(next));
    }
  } catch (e) {
    // The refreshed token is still returned to the caller even if persistence fails.
  }

  return next.accessToken;
}

async function sendCaptureRequest(payload, accessToken) {
  return fetch(MNEMONICS_API_URL + '/api/v1/captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify(payload)
  });
}

async function sendCaptureToApi(item, accessToken) {
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi lưu dữ liệu.');

  var payload = toCapturePayload(item);
  var token = accessToken;
  var response = await sendCaptureRequest(payload, token);

  // A stale access token should not turn a valid local capture into a
  // permanent pending item. Refresh exactly once, then retry the same
  // idempotent clientRequestId so the API can safely deduplicate it.
  if (response.status === 401) {
    var refreshed = await refreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await sendCaptureRequest(payload, token);
    }
  }

  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) {
    var message = body && body.error && body.error.message
      ? body.error.message
      : 'Capture API failed with status ' + response.status;
    throw new Error(message);
  }
  return { sent: true, data: body };
}


async function searchItemsFromApi(query, accessToken) {
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi tìm kiếm.');

  async function request(token) {
    return fetch(MNEMONICS_API_URL + '/api/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ q: query, limit: 50, offset: 0 })
    });
  }

  var token = accessToken;
  var response = await request(token);

  if (response.status === 401) {
    var refreshed = await refreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await request(token);
    }
  }

  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) {
    var message = body && body.error && body.error.message
      ? body.error.message
      : 'Search API failed with status ' + response.status;
    throw new Error(message);
  }

  return body;
}
