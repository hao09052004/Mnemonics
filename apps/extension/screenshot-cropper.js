var pending = null;
var img = document.getElementById('shot-img');
var stage = document.getElementById('stage');
var selection = document.getElementById('selection');
var viewer = document.getElementById('viewer-wrap');
var cropRect = null;
var mode = null;
var startPoint = null;
var moveOffset = null;
var fitScale = 1;
var zoom = 1;
var lastDisplayWidth = 0;
var screenshotObjectUrl = null;

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2200);
}
function notifyScreenshot(title, message) {
  if (typeof chrome !== 'undefined' && chrome.notifications) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: title,
      message: message
    });
  }
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function escapeHtml(value) {
  return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function getDisplaySize() {
  return { w: img.getBoundingClientRect().width || 1, h: img.getBoundingClientRect().height || 1 };
}
function getPoint(e) {
  var r = img.getBoundingClientRect();
  return { x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height) };
}
function isInside(p) {
  return cropRect && p.x >= cropRect.x && p.x <= cropRect.x + cropRect.w && p.y >= cropRect.y && p.y <= cropRect.y + cropRect.h;
}
function updateSelection() {
  if (!cropRect) { selection.style.display = 'none'; updateMeta(); return; }
  selection.style.display = 'block';
  selection.style.left = cropRect.x + 'px';
  selection.style.top = cropRect.y + 'px';
  selection.style.width = cropRect.w + 'px';
  selection.style.height = cropRect.h + 'px';
  updateMeta();
}
function updateMeta() {
  if (!img.naturalWidth) return;
  document.getElementById('original-size').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
  var cropSize = 'Chưa chọn';
  if (cropRect && cropRect.w > 0 && cropRect.h > 0) {
    var d = getDisplaySize();
    cropSize = Math.round(cropRect.w * img.naturalWidth / d.w) + ' × ' + Math.round(cropRect.h * img.naturalHeight / d.h) + ' px';
  }
  document.getElementById('crop-size').textContent = cropSize;
}
function computeFitScale() {
  var sideW = window.innerWidth > 900 ? 340 : 0;
  var availableW = Math.max(360, window.innerWidth - sideW - 64);
  var availableH = Math.max(300, window.innerHeight - 110);
  fitScale = Math.min(availableW / img.naturalWidth, availableH / img.naturalHeight, 1);
  if (!isFinite(fitScale) || fitScale <= 0) fitScale = 0.5;
}
function applyZoom(preserve) {
  if (!img.naturalWidth) return;
  var old = getDisplaySize();
  computeFitScale();
  var width = Math.max(260, Math.round(img.naturalWidth * fitScale * zoom));
  img.style.width = width + 'px';
  img.style.height = 'auto';
  // Cho browser tính height xong rồi scale crop.
  requestAnimationFrame(function() {
    var d = getDisplaySize();
    stage.style.width = d.w + 'px';
    stage.style.height = d.h + 'px';
    if (preserve && cropRect && old.w > 1 && old.h > 1) {
      var sx = d.w / old.w;
      var sy = d.h / old.h;
      cropRect = { x: cropRect.x * sx, y: cropRect.y * sy, w: cropRect.w * sx, h: cropRect.h * sy };
    } else if (!cropRect) {
      cropRect = { x: Math.round(d.w * 0.12), y: Math.round(d.h * 0.12), w: Math.round(d.w * 0.76), h: Math.round(d.h * 0.70) };
    }
    cropRect.x = clamp(cropRect.x, 0, d.w - Math.max(1, cropRect.w));
    cropRect.y = clamp(cropRect.y, 0, d.h - Math.max(1, cropRect.h));
    cropRect.w = clamp(cropRect.w, 1, d.w - cropRect.x);
    cropRect.h = clamp(cropRect.h, 1, d.h - cropRect.y);
    updateSelection();
    lastDisplayWidth = d.w;
  });
}
function setZoom(value, preserve) {
  zoom = value / 100;
  document.getElementById('zoom-slider').value = value;
  document.getElementById('zoom-value').textContent = value + '%';
  applyZoom(preserve !== false);
}
function drawStart(e) {
  if (!img.naturalWidth) return;
  var p = getPoint(e);
  if (isInside(p)) {
    mode = 'move';
    moveOffset = { x: p.x - cropRect.x, y: p.y - cropRect.y };
  } else {
    mode = 'draw';
    startPoint = p;
    cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
  }
  if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId);
  e.preventDefault();
  updateSelection();
}
function drawMove(e) {
  if (!mode) return;
  var p = getPoint(e);
  var d = getDisplaySize();
  if (mode === 'move' && cropRect && moveOffset) {
    cropRect.x = clamp(p.x - moveOffset.x, 0, d.w - cropRect.w);
    cropRect.y = clamp(p.y - moveOffset.y, 0, d.h - cropRect.h);
  } else if (mode === 'draw' && startPoint) {
    cropRect = { x: Math.min(startPoint.x, p.x), y: Math.min(startPoint.y, p.y), w: Math.abs(p.x - startPoint.x), h: Math.abs(p.y - startPoint.y) };
  }
  e.preventDefault();
  updateSelection();
}
function drawEnd() {
  if (!mode) return;
  var d = getDisplaySize();
  if (!cropRect || cropRect.w < 10 || cropRect.h < 10) {
    cropRect = { x: Math.round(d.w * 0.12), y: Math.round(d.h * 0.12), w: Math.round(d.w * 0.76), h: Math.round(d.h * 0.70) };
  }
  mode = null; startPoint = null; moveOffset = null;
  updateSelection();
}
function getOutputData(useCrop) {
  if (!useCrop || !cropRect) return pending.imageUrl;
  var d = getDisplaySize();
  var sx = cropRect.x * img.naturalWidth / d.w;
  var sy = cropRect.y * img.naturalHeight / d.h;
  var sw = cropRect.w * img.naturalWidth / d.w;
  var sh = cropRect.h * img.naturalHeight / d.h;
  var out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  var ctx = out.getContext('2d');
  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.92);
  } catch (canvasError) {
    // Cross-origin image with no CORS header → canvas is tainted.
    // Fall back to the original image URL so the user can still save
    // something. The capture pipeline accepts both data: and http(s)
    // URLs (background fetches with credentials: 'omit').
    console.warn('Canvas tainted, saving original image instead:', canvasError);
    return pending.imageUrl;
  }
}
function notifyDashboard() {
  if (chrome && chrome.tabs) {
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(tab) {
        if (tab.url && tab.url.includes('mnemonics-dashboard.html')) {
          chrome.tabs.sendMessage(tab.id, { type: 'RELOAD_ITEMS' }).catch(function(){});
        }
      });
    });
  }
}

// Wrap a chrome.runtime.sendMessage call in a promise that survives
// background-worker idle. MV3 service workers get killed after ~30s of
// inactivity; the first message after that throws "Could not establish
// connection" because the worker hasn't woken up yet. Retrying once after
// a short delay lets the worker spin back up so the second attempt
// succeeds — this is the same trick the official Chrome samples use.
function sendMessageWithRetry(payload, maxAttempts) {
  maxAttempts = maxAttempts || 3;
  return new Promise(function(resolve, reject) {
    var attempt = 0;
    var lastError = null;
    function tryOnce() {
      attempt += 1;
      chrome.runtime.sendMessage(payload, function(response) {
        if (chrome.runtime.lastError) {
          lastError = chrome.runtime.lastError.message || 'connection error';
          console.warn('[mnemonics] sendMessage attempt', attempt, 'failed:', lastError);
          if (attempt < maxAttempts) {
            setTimeout(tryOnce, 250);
            return;
          }
          reject(new Error(lastError));
          return;
        }
        resolve(response);
      });
    }
    tryOnce();
  });
}

function showLoadError(message) {
  stage.style.display = 'none';
  var empty = document.getElementById('empty-state');
  empty.style.display = 'block';
  empty.innerHTML = '<h1>Không hiển thị được ảnh chụp</h1><p>' + escapeHtml(message || 'Ảnh chưa truyền sang cropper đúng cách. Hãy đóng trang này và chụp lại.') + '</p>';
}

function setPendingPayload(payload) {
  pending = payload;
  if (!pending || !pending.imageUrl) {
    showLoadError('Ảnh chụp bị rỗng hoặc sai định dạng. Hãy chụp lại một lần nữa.');
    return;
  }

  document.getElementById('stage').style.display = 'inline-block';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('title-input').value = pending.title || 'Ảnh chụp màn hình';
  document.getElementById('note-input').value = pending.note || '';
  document.getElementById('source-url').textContent = (pending.displayUrl || pending.sourceUrl || '—').slice(0, 34);
  document.getElementById('tags-row').innerHTML = (pending.tags || ['ảnh chụp','screenshot']).map(function(t){ return '<span class="tag">' + escapeHtml(t) + '</span>'; }).join('');

  img.onload = function() {
    cropRect = null;
    setZoom(100, false);
    updateMeta();
  };
  img.onerror = function() {
    showLoadError('Trình duyệt không tải được ảnh. Ảnh có thể đã bị xóa hoặc URL không hợp lệ.');
  };

  if (screenshotObjectUrl) {
    URL.revokeObjectURL(screenshotObjectUrl);
    screenshotObjectUrl = null;
  }

  // Load the image. data: / blob: URLs are same-origin to the extension
  // so canvas stays untainted (required for cropping). Remote https:// URLs
  // from legacy URL-param flow are shown directly (cropping may fail with
  // a tainted-canvas error — acceptable fallback).
  var sourceUrl = pending.imageUrl;
  if (/^data:/i.test(sourceUrl) || /^(blob:|chrome-extension:)/i.test(sourceUrl)) {
    img.src = sourceUrl;
  } else if (/^https?:\/\//i.test(sourceUrl)) {
    // Legacy path: direct URL from ?src= param. Display-only; crop may taint canvas.
    img.src = sourceUrl;
  } else {
    showLoadError('Định dạng ảnh không nhận diện được: ' + sourceUrl.slice(0, 50));
  }
}

async function saveScreenshot(useCrop) {
  if (!pending || !pending.imageUrl) return;
  var title = document.getElementById('title-input').value.trim() || pending.title || 'Ảnh chụp màn hình';
  var note = document.getElementById('note-input').value.trim();
  var tags = Array.isArray(pending.tags) && pending.tags.length ? pending.tags : ['ảnh chụp', 'screenshot'];
  var item = {
    id: crypto.randomUUID(),
    title: useCrop ? (title + ' · vùng cắt') : title,
    note: note,
    excerpt: note,
    imageUrl: getOutputData(useCrop),
    sourceUrl: pending.sourceUrl || '',
    url: pending.displayUrl || (pending.sourceUrl || '').replace(/^https?:\/\//, '').slice(0, 80),
    type: 'screenshot',
    tags: tags,
    savedAt: new Date().toISOString(),
    date: 'Vừa xong',
    space: 'Mới lưu',
    clientRequestId: pending.clientRequestId || crypto.randomUUID()
  };
  pending.clientRequestId = item.clientRequestId;
  var saveButtons = [document.getElementById('save-crop-btn'), document.getElementById('save-full-btn')];
  saveButtons.forEach(function(button) { if (button) button.disabled = true; });

  var session = await new Promise(function(resolve) {
    chrome.storage.local.get('mnemonics_session', function(result) { resolve(result.mnemonics_session || null); });
  });

  try {
    var imageUrl = item.imageUrl || '';
    var isDataUrl = /^data:image\//.test(imageUrl);
    // Try server-side upload (requires login AND either a data: URL OR a
    // remote http(s) URL we can re-fetch through the local proxy).
    if (session && session.accessToken && (isDataUrl || /^https?:\/\//.test(imageUrl))) {
      // Forward the upload to the background worker so it can use
      // `fetchImageViaLocalProxy` (which handles the proxy + direct
      // fallback the same way context-menu saves do), then POST the
      // resulting Blob to /captures/image. If `chrome.runtime` is not
      // available (e.g. the page is open outside the extension context),
      // fall back to a direct fetch from the page.
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Không liên lạc được với background script (chrome.runtime không khả dụng). Hãy mở cropper từ extension context.');
      }
      var uploadResult;
      try {
        uploadResult = await sendMessageWithRetry({
          type: 'UPLOAD_IMAGE_FROM_CROPPER',
          imageUrl: imageUrl,
          payload: {
            title: item.title,
            note: item.note,
            sourceUrl: item.sourceUrl,
            capturedAt: item.savedAt,
            clientRequestId: item.clientRequestId
          }
        });
        if (!uploadResult || !uploadResult.ok) {
          throw new Error((uploadResult && uploadResult.error) || 'Không upload được ảnh lên server.');
        }
      } catch (msgErr) {
        throw new Error(msgErr && msgErr.message ? msgErr.message : 'Không liên lạc được với background script.');
      }
      console.log('[mnemonics] cropper upload ok:', uploadResult && uploadResult.data && uploadResult.data.id);
    } else {
      throw new Error('Bạn cần đăng nhập trước khi lưu ảnh.');
    }

    // Notify the dashboard so it reloads without waiting for the next poll.
    var safeSend = function(type) {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try { chrome.runtime.sendMessage({ type: type }, function() { void chrome.runtime.lastError; }); } catch (_) {}
      }
    };
    safeSend('CLEAR_PENDING_SCREENSHOT');
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try { chrome.storage.local.set({ mnemonics_pending_screenshot: null }, function() { void chrome.runtime.lastError; }); } catch (_) {}
    }
    safeSend('ITEM_SAVED');

    showToast('Đã lưu ảnh vào database');
    notifyScreenshot('Mnemonics', 'Đã lưu ảnh vào database.');
    setTimeout(function(){ window.close(); }, 650);

  } catch (error) {
    saveButtons.forEach(function(button) { if (button) button.disabled = false; });
    var message = error && error.message ? error.message : 'Không lưu được ảnh vào database.';
    showToast(message);
    notifyScreenshot('Mnemonics - Lỗi lưu ảnh', message);
  }
}
function cancelCropper() {
  chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_SCREENSHOT' }, function(){});
  chrome.storage.local.set({ mnemonics_pending_screenshot: null }, function(){ window.close(); });
}
function loadPending() {
  // 1. If the page was opened via context-menu fallback, the background
  // passes the image URL through `?src=`. Prefer that because the cropper
  // needs the URL to fetch directly.
  var params = new URLSearchParams(window.location.search);
  var srcParam = params.get('src');
  if (srcParam) {
    // For remote https:// URLs (e.g. from FB/IG), convert to data: URL
    // through the background worker so canvas stays untainted.
    if (/^https?:\/\//i.test(srcParam)) {
      sendMessageWithRetry({ type: 'FETCH_IMAGE_AS_DATA_URL', url: srcParam })
        .then(function(response) {
          var payload;
          if (response && response.ok && response.data && response.data.dataUrl) {
            payload = {
              imageUrl: response.data.dataUrl,
              sourceUrl: params.get('sourceUrl') || '',
              displayUrl: (params.get('sourceUrl') || srcParam).replace(/^https?:\/\//, '').slice(0, 80),
              title: params.get('title') || 'Ảnh đã lưu',
              tags: ['ảnh', 'context-menu']
            };
          } else {
            // Conversion failed — still open the cropper with the raw URL
            // (display may work, cropping may taint canvas)
            payload = {
              imageUrl: srcParam,
              sourceUrl: params.get('sourceUrl') || '',
              displayUrl: (params.get('sourceUrl') || srcParam).replace(/^https?:\/\//, '').slice(0, 80),
              title: params.get('title') || 'Ảnh đã lưu',
              tags: ['ảnh', 'context-menu']
            };
          }
          setPendingPayload(payload);
        })
        .catch(function(err) {
          console.warn('[mnemonics] FETCH_IMAGE_AS_DATA_URL via cropper failed:', err);
          setPendingPayload({
            imageUrl: srcParam,
            sourceUrl: params.get('sourceUrl') || '',
            displayUrl: (params.get('sourceUrl') || srcParam).replace(/^https?:\/\//, '').slice(0, 80),
            title: params.get('title') || 'Ảnh đã lưu',
            tags: ['ảnh', 'context-menu']
          });
        });
    } else {
      setPendingPayload({
        imageUrl: srcParam,
        sourceUrl: params.get('sourceUrl') || '',
        displayUrl: (params.get('sourceUrl') || srcParam).replace(/^https?:\/\//, '').slice(0, 80),
        title: params.get('title') || 'Ảnh đã lưu',
        tags: ['ảnh', 'context-menu']
      });
    }
    return;
  }

  function fallbackToStorage() {
    chrome.storage.local.get('mnemonics_pending_screenshot', function(r) {
      setPendingPayload(r.mnemonics_pending_screenshot);
    });
  }

  sendMessageWithRetry({ type: 'GET_PENDING_SCREENSHOT' })
    .then(function(response) {
      if (response && response.ok && response.payload && response.payload.imageUrl) {
        setPendingPayload(response.payload);
        return;
      }
      fallbackToStorage();
    })
    .catch(function(err) {
      console.warn('[mnemonics] GET_PENDING_SCREENSHOT failed:', err);
      fallbackToStorage();
    });
}
stage.addEventListener('pointerdown', drawStart);
stage.addEventListener('pointermove', drawMove);
stage.addEventListener('pointerup', drawEnd);
stage.addEventListener('pointercancel', drawEnd);
stage.addEventListener('pointerleave', drawEnd);
document.getElementById('zoom-slider').addEventListener('input', function(){ setZoom(Number(this.value), true); });
document.getElementById('fit-btn').addEventListener('click', function(){ setZoom(100, true); });
document.getElementById('save-crop-btn').addEventListener('click', function(){ saveScreenshot(true); });
document.getElementById('save-full-btn').addEventListener('click', function(){ saveScreenshot(false); });
document.getElementById('cancel-btn').addEventListener('click', cancelCropper);
window.addEventListener('resize', function(){ applyZoom(true); });
window.addEventListener('beforeunload', function(){ if (screenshotObjectUrl) URL.revokeObjectURL(screenshotObjectUrl); });
loadPending();
