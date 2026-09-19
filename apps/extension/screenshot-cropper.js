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
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.92);
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

function showLoadError(message) {
  stage.style.display = 'none';
  var empty = document.getElementById('empty-state');
  empty.style.display = 'block';
  empty.innerHTML = '<h1>Không hiển thị được ảnh chụp</h1><p>' + escapeHtml(message || 'Ảnh chưa truyền sang cropper đúng cách. Hãy đóng trang này và chụp lại.') + '</p>';
}

function setPendingPayload(payload) {
  pending = payload;
  if (!pending || !pending.imageUrl || !/^data:image\//.test(pending.imageUrl)) {
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
    showLoadError('Ảnh chụp đã được tạo nhưng trình duyệt đang chặn/không đọc được data ảnh. Bản này đã thêm cơ chế truyền ảnh mới, hãy reload extension rồi chụp lại.');
  };

  if (screenshotObjectUrl) {
    URL.revokeObjectURL(screenshotObjectUrl);
    screenshotObjectUrl = null;
  }

  // Dùng blob URL để ảnh lớn load ổn hơn dataURL trực tiếp.
  try {
    fetch(pending.imageUrl)
      .then(function(res) { return res.blob(); })
      .then(function(blob) {
        screenshotObjectUrl = URL.createObjectURL(blob);
        img.src = screenshotObjectUrl;
      })
      .catch(function() { img.src = pending.imageUrl; });
  } catch (e) {
    img.src = pending.imageUrl;
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
    space: 'Mới lưu'
  };
  var saveButtons = [document.getElementById('save-crop-btn'), document.getElementById('save-full-btn')];
  saveButtons.forEach(function(button) { if (button) button.disabled = true; });

  var session = await new Promise(function(resolve) {
    chrome.storage.local.get('mnemonics_session', function(result) { resolve(result.mnemonics_session || null); });
  });

  // Always save to local storage first so the dashboard can display the item
  // immediately, even if the server upload fails.
  var userId = session && session.user && session.user.id ? session.user.id : 'guest';
  var storageKey = 'mnemonics_items_' + userId;

  try {
    // Try server-side upload (requires login).
    if (session && session.accessToken) {
      await uploadImageCapture(item.imageUrl, {
        title: item.title,
        note: item.note,
        sourceUrl: item.sourceUrl,
        capturedAt: item.savedAt
      }, session.accessToken);
    } else {
      // No login — still save locally so the user doesn't lose the screenshot.
      showToast('Chưa đăng nhập — ảnh chỉ được lưu cục bộ.');
    }

    // Append to local storage under the correct user namespace.
    var stored = await new Promise(function(resolve) {
      chrome.storage.local.get(storageKey, function(r) { resolve(r[storageKey] || []); });
    });
    stored.unshift(item);
    await new Promise(function(resolve) {
      chrome.storage.local.set({ [storageKey]: stored }, resolve);
    });

    // Notify the dashboard so it reloads without waiting for the next poll.
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_SCREENSHOT' }, function() {});
    chrome.storage.local.set({ mnemonics_pending_screenshot: null }, function() {});
    chrome.runtime.sendMessage({ type: 'ITEM_SAVED' }, function() {});

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
  function fallbackToStorage() {
    chrome.storage.local.get('mnemonics_pending_screenshot', function(r) {
      setPendingPayload(r.mnemonics_pending_screenshot);
    });
  }

  chrome.runtime.sendMessage({ type: 'GET_PENDING_SCREENSHOT' }, function(response) {
    if (chrome.runtime && chrome.runtime.lastError) {
      fallbackToStorage();
      return;
    }
    if (response && response.ok && response.payload && response.payload.imageUrl) {
      setPendingPayload(response.payload);
      return;
    }
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
