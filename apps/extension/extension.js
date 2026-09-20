var currentType = 'article';
var currentTags = [];
var savedItems = [];
var tagTimer = null;
var currentPageUrl = '';
var currentPageTitle = '';
var pendingScreenshotData = '';
var pendingScreenshotTitle = '';
var originalScreenshotData = '';
var screenshotImage = null;
var cropRect = null;
var cropMode = null;
var cropStart = null;
var cropOffset = null;

function loadItems(cb) {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('mnemonics_session', function(result) {
      var session = result.mnemonics_session || null;
      var uid = session && session.user && session.user.id ? session.user.id : 'guest';
      chrome.storage.local.get('mnemonics_items_' + uid, function(r) {
        savedItems = r['mnemonics_items_' + uid] || [];
        if (cb) cb();
      });
    });
  } else {
    savedItems = JSON.parse(localStorage.getItem('mnemonics_items') || '[]');
    if (cb) cb();
  }
}

function saveItems(cb) {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('mnemonics_session', function(result) {
      var session = result.mnemonics_session || null;
      var uid = session && session.user && session.user.id ? session.user.id : 'guest';
      var payload = {};
      payload['mnemonics_items_' + uid] = savedItems;
      chrome.storage.local.set(payload, cb);
    });
  } else {
    localStorage.setItem('mnemonics_items', JSON.stringify(savedItems));
    if (cb) cb();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('open-dashboard').addEventListener('click', function() {
    var url = chrome.runtime.getURL('mnemonics-dashboard.html');
    chrome.tabs.create({ url: url });
  });

  document.getElementById('btn-more').addEventListener('click', resetForm);
  document.getElementById('btn-done').addEventListener('click', function() { window.close(); });
  document.getElementById('save-btn').addEventListener('click', saveCapture);
  var captureScreenshotBtn = document.getElementById('capture-screenshot-btn');
  if (captureScreenshotBtn) captureScreenshotBtn.addEventListener('click', captureScreenshot);
  document.getElementById('cap-note').addEventListener('input', function() { onNoteInput(this.value); });
  document.getElementById('cap-title').addEventListener('input', function() { onNoteInput(this.value); });

  document.querySelectorAll('.type-chip').forEach(function(chip) {
    chip.addEventListener('click', function() { selectType(this, this.dataset.type); });
  });

  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs[0]) {
        var url = tabs[0].url || '';
        currentPageUrl = url;
        var title = tabs[0].title || '';
        currentPageTitle = title;
        document.getElementById('tab-url').textContent = url.replace(/^https?:\/\//, '').slice(0, 55);
        document.getElementById('cap-title').value = title.slice(0, 80);
        if (title) autoTagsFromContent(title);
      }
    });
  }

  loadItems(renderRecent);
});

function selectType(el, type) {
  document.querySelectorAll('.type-chip').forEach(function(c) { c.classList.remove('selected'); });
  el.classList.add('selected');
  currentType = type;
}

function onNoteInput(val) {
  clearTimeout(tagTimer);
  if (val.length > 3) {
    tagTimer = setTimeout(function() { autoTagsFromContent(val); }, 500);
  }
}

function autoTagsFromContent(content) {
  if (!content || content.length < 3) return;
  var row = document.getElementById('tags-row');
  var stopwords = ['the','a','an','of','in','on','for','to','and','or','is','are','was','were',
    'this','that','with','from','have','will','your','page','home'];
  var words = content.toLowerCase().replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/)
    .filter(function(w) { return w.length > 3 && stopwords.indexOf(w) === -1; });
  var freq = {};
  words.forEach(function(w) { freq[w] = (freq[w] || 0) + 1; });
  var tags = Object.keys(freq).sort(function(a,b){ return freq[b]-freq[a]; }).slice(0, 4);
  currentTags = tags.length > 0 ? tags : ['ghi chú'];
  row.innerHTML = currentTags.map(function(t) { return '<span class="ai-tag">'+t+'</span>'; }).join('');
}

function clearScreenshotPreview() {
  pendingScreenshotData = '';
  pendingScreenshotTitle = '';
  originalScreenshotData = '';
  screenshotImage = null;
  cropRect = null;
  cropMode = null;
  cropStart = null;
  cropOffset = null;

  var preview = document.getElementById('screenshot-preview');
  var canvas = document.getElementById('screenshot-canvas');
  var selection = document.getElementById('crop-selection');
  var meta = document.getElementById('screenshot-crop-meta');

  if (canvas) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
  }
  if (selection) selection.style.display = 'none';
  if (meta) meta.textContent = 'Kéo trên ảnh để chọn vùng cần lưu.';
  if (preview) preview.classList.remove('show');
}

function captureScreenshot() {
  var btn = document.getElementById('capture-screenshot-btn');

  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
    alert('Trình duyệt hiện tại chưa hỗ trợ chụp màn hình từ extension.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Đang chụp màn hình...'; }

  chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 82 }, function(dataUrl) {
    function resetButton() {
      if (btn) { btn.disabled = false; btn.textContent = '📸 CHỤP & CẮT MÀN HÌNH'; }
    }

    if (chrome.runtime && chrome.runtime.lastError) {
      resetButton();
      alert('Không chụp được màn hình trang này: ' + chrome.runtime.lastError.message);
      return;
    }
    if (!dataUrl || !/^data:image\//.test(dataUrl)) {
      resetButton();
      alert('Không chụp được màn hình trang này.');
      return;
    }

    var titleEl = document.getElementById('cap-title');
    var noteEl = document.getElementById('cap-note');
    var payload = {
      imageUrl: dataUrl,
      title: ((titleEl && titleEl.value.trim()) || currentPageTitle || 'Ảnh chụp màn hình').slice(0, 80),
      note: noteEl ? noteEl.value.trim() : '',
      sourceUrl: currentPageUrl || '',
      displayUrl: (currentPageUrl || '').replace(/^https?:\/\//, '').slice(0, 80),
      tags: currentTags && currentTags.length ? currentTags.slice(0, 4) : ['ảnh chụp', 'screenshot'],
      capturedAt: new Date().toISOString()
    };

    var backgroundOk = false;
    chrome.runtime.sendMessage({ type: 'SET_PENDING_SCREENSHOT', payload: payload }, function(response) {
      backgroundOk = !(chrome.runtime && chrome.runtime.lastError) && response && response.ok;

      // Storage chỉ là fallback. Nếu storage fail nhưng background còn giữ ảnh thì cropper vẫn mở được.
      chrome.storage.local.set({ mnemonics_pending_screenshot: payload }, function() {
        var storageError = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : '';
        if (!backgroundOk && storageError) {
          resetButton();
          alert('Không truyền được ảnh sang trang cropper: ' + storageError);
          return;
        }
        var url = chrome.runtime.getURL('screenshot-cropper.html') + '?t=' + Date.now();
        chrome.tabs.create({ url: url }, function() {
          resetButton();
          window.close();
        });
      });
    });
  });
}

function renderScreenshotCropper(dataUrl) {
  var preview = document.getElementById('screenshot-preview');
  var canvas = document.getElementById('screenshot-canvas');
  var selection = document.getElementById('crop-selection');
  var meta = document.getElementById('screenshot-crop-meta');
  if (!preview || !canvas || !selection) return;

  preview.classList.add('show');
  if (meta) meta.textContent = 'Đang tải ảnh chụp...';

  screenshotImage = new Image();
  screenshotImage.onload = function() {
    var cropper = document.getElementById('screenshot-cropper');
    var boxWidth = (cropper && cropper.clientWidth) ? cropper.clientWidth : 320;
    var maxHeight = 280;
    var ratio = Math.min(boxWidth / screenshotImage.naturalWidth, maxHeight / screenshotImage.naturalHeight, 1);
    var w = Math.max(1, Math.round(screenshotImage.naturalWidth * ratio));
    var h = Math.max(1, Math.round(screenshotImage.naturalHeight * ratio));

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(screenshotImage, 0, 0, w, h);

    // Mặc định chọn vùng trung tâm để user thấy ngay đây là crop tool.
    cropRect = {
      x: Math.round(w * 0.10),
      y: Math.round(h * 0.12),
      w: Math.round(w * 0.80),
      h: Math.round(h * 0.70)
    };
    updateCropSelection();
    if (meta) meta.textContent = 'Kéo để tạo vùng cắt mới. Kéo trong khung tím để di chuyển vùng cắt.';
  };
  screenshotImage.src = dataUrl;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCropPoint(e) {
  var canvas = document.getElementById('screenshot-canvas');
  if (!canvas || !canvas.width || !canvas.height) return { x: 0, y: 0 };
  var rect = canvas.getBoundingClientRect();
  var x = (e.clientX - rect.left) * (canvas.width / rect.width);
  var y = (e.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: clamp(x, 0, canvas.width),
    y: clamp(y, 0, canvas.height)
  };
}

function isInsideCrop(point) {
  return cropRect &&
    point.x >= cropRect.x && point.x <= cropRect.x + cropRect.w &&
    point.y >= cropRect.y && point.y <= cropRect.y + cropRect.h;
}

function startCropPointer(e) {
  if (!screenshotImage) return;
  var cropper = document.getElementById('screenshot-cropper');
  var point = getCropPoint(e);

  if (isInsideCrop(point)) {
    cropMode = 'move';
    cropOffset = { x: point.x - cropRect.x, y: point.y - cropRect.y };
  } else {
    cropMode = 'draw';
    cropStart = point;
    cropRect = { x: point.x, y: point.y, w: 0, h: 0 };
  }

  if (cropper && cropper.setPointerCapture) cropper.setPointerCapture(e.pointerId);
  e.preventDefault();
  updateCropSelection();
}

function moveCropPointer(e) {
  if (!screenshotImage || !cropMode) return;
  var canvas = document.getElementById('screenshot-canvas');
  var point = getCropPoint(e);

  if (cropMode === 'move' && cropRect && cropOffset) {
    cropRect.x = clamp(point.x - cropOffset.x, 0, canvas.width - cropRect.w);
    cropRect.y = clamp(point.y - cropOffset.y, 0, canvas.height - cropRect.h);
  }

  if (cropMode === 'draw' && cropStart) {
    cropRect = {
      x: Math.min(cropStart.x, point.x),
      y: Math.min(cropStart.y, point.y),
      w: Math.abs(point.x - cropStart.x),
      h: Math.abs(point.y - cropStart.y)
    };
  }

  e.preventDefault();
  updateCropSelection();
}

function endCropPointer(e) {
  if (!cropMode) return;
  if (cropRect && (cropRect.w < 8 || cropRect.h < 8)) {
    var canvas = document.getElementById('screenshot-canvas');
    cropRect = {
      x: Math.round(canvas.width * 0.10),
      y: Math.round(canvas.height * 0.12),
      w: Math.round(canvas.width * 0.80),
      h: Math.round(canvas.height * 0.70)
    };
  }
  cropMode = null;
  cropStart = null;
  cropOffset = null;
  updateCropSelection();
}

function updateCropSelection() {
  var canvas = document.getElementById('screenshot-canvas');
  var cropper = document.getElementById('screenshot-cropper');
  var selection = document.getElementById('crop-selection');
  var meta = document.getElementById('screenshot-crop-meta');
  if (!canvas || !cropper || !selection || !cropRect) return;

  var cropperRect = cropper.getBoundingClientRect();
  var canvasRect = canvas.getBoundingClientRect();
  var scaleX = canvasRect.width / canvas.width;
  var scaleY = canvasRect.height / canvas.height;
  var left = (canvasRect.left - cropperRect.left) + cropRect.x * scaleX;
  var top = (canvasRect.top - cropperRect.top) + cropRect.y * scaleY;

  selection.style.display = 'block';
  selection.style.left = left + 'px';
  selection.style.top = top + 'px';
  selection.style.width = Math.max(1, cropRect.w * scaleX) + 'px';
  selection.style.height = Math.max(1, cropRect.h * scaleY) + 'px';

  if (meta && screenshotImage && canvas.width && canvas.height) {
    var naturalW = Math.round(cropRect.w * screenshotImage.naturalWidth / canvas.width);
    var naturalH = Math.round(cropRect.h * screenshotImage.naturalHeight / canvas.height);
    meta.textContent = 'Vùng cắt: ' + naturalW + ' × ' + naturalH + ' px. Kéo để chọn lại vùng khác.';
  }
}

function getScreenshotDataForSave(useCrop) {
  if (!originalScreenshotData || !screenshotImage) return pendingScreenshotData;
  if (!useCrop || !cropRect || cropRect.w < 8 || cropRect.h < 8) return originalScreenshotData;

  var canvas = document.getElementById('screenshot-canvas');
  var sx = cropRect.x * screenshotImage.naturalWidth / canvas.width;
  var sy = cropRect.y * screenshotImage.naturalHeight / canvas.height;
  var sw = cropRect.w * screenshotImage.naturalWidth / canvas.width;
  var sh = cropRect.h * screenshotImage.naturalHeight / canvas.height;

  var out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  var ctx = out.getContext('2d');
  ctx.drawImage(screenshotImage, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.9);
}

function savePendingScreenshot(useCrop) {
  if (!pendingScreenshotData) return;

  var note = document.getElementById('cap-note').value.trim();
  var title = pendingScreenshotTitle || (currentPageTitle || 'Ảnh chụp màn hình');
  var tags = currentTags && currentTags.length ? currentTags.slice(0, 4) : ['ảnh chụp', 'screenshot'];
  var displayUrl = (currentPageUrl || '').replace(/^https?:\/\//, '').slice(0, 80);
  var finalImage = getScreenshotDataForSave(useCrop !== false);
  var item = {
    id: Date.now(),
    title: useCrop === false ? title : (title + ' · vùng cắt'),
    note: note,
    excerpt: note,
    imageUrl: finalImage,
    sourceUrl: currentPageUrl,
    url: displayUrl,
    type: 'screenshot',
    tags: tags,
    savedAt: new Date().toISOString(),
    date: 'Vừa xong',
    space: 'Mới lưu'
  };

  savedItems.unshift(item);
  if (savedItems.length > 80) savedItems = savedItems.slice(0, 80);
  saveItems(function() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'ITEM_SAVED' });
    }
    document.getElementById('success-tags').innerHTML = tags.map(function(t){ return '<span class="ai-tag">'+t+'</span>'; }).join('');
    document.getElementById('success-overlay').classList.add('show');
    clearScreenshotPreview();
    renderRecent();
  });
}

function saveCapture() {
  var title = document.getElementById('cap-title').value.trim();
  var note = document.getElementById('cap-note').value.trim();
  var url = document.getElementById('tab-url').textContent;
  if (!title) {
    var el = document.getElementById('cap-title');
    el.focus(); el.style.borderColor = '#ef4444';
    setTimeout(function(){ el.style.borderColor = ''; }, 1500);
    return;
  }
  if (currentTags.length === 0) autoTagsFromContent(title + ' ' + note);
  var item = {
    id: Date.now(), title: title, note: note, url: url, sourceUrl: currentPageUrl,
    type: currentType, tags: currentTags,
    savedAt: new Date().toISOString(), date: 'Vừa xong'
  };
  // Với loại Link: lưu URL trang hiện tại làm đường dẫn chính
  if (currentType === 'link') {
    item.sourceUrl = currentPageUrl || note;
    item.url = (currentPageUrl || note || '').replace(/^https?:\/\//, '').slice(0, 80);
    item.excerpt = note;
    if (!item.tags || item.tags.length === 0) item.tags = ['link'];
  }

  // Persist to chrome.storage.local *first* so the dashboard updates
  // immediately, then upload to /api/v1/captures if we have a session.
  // The DB only accepts type: 'link' | 'text' | 'image', so we map the
  // popup's wider type vocabulary through api-client.js#toCapturePayload.
  savedItems.unshift(item);
  if (savedItems.length > 50) savedItems = savedItems.slice(0, 50);

  saveItems(function() {
    // Thông báo cho dashboard biết có item mới
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'ITEM_SAVED' });
    }
  });

  // Best-effort server upload. Failures don't block the local save.
  if (currentType !== 'image') {
    // Use async variant so the popup correctly reads from
    // chrome.storage.local (the sync shim returns null there).
    if (typeof getAccessToken === 'function') {
      getAccessToken().then(function(accessToken) {
        if (!accessToken) return;
        var apiItem = Object.assign({}, item, { capturedAt: item.savedAt });
        if (typeof sendCaptureToApi === 'function') {
          sendCaptureToApi(apiItem, accessToken).catch(function(err) {
            console.warn('[mnemonics popup] capture upload failed', err);
          });
        }
      });
    }
  }

  document.getElementById('success-tags').innerHTML = currentTags.map(function(t){ return '<span class="ai-tag">'+t+'</span>'; }).join('');
  document.getElementById('success-overlay').classList.add('show');
}

function resetForm() {
  document.getElementById('success-overlay').classList.remove('show');
  document.getElementById('cap-title').value = '';
  document.getElementById('cap-note').value = '';
  document.getElementById('tags-row').innerHTML = '<span style="font-size:11px;color:#a78bfa">Nhập nội dung để tạo tags...</span>';
  currentTags = [];
  document.getElementById('save-btn').disabled = false;
  document.getElementById('save-btn').textContent = '★ LƯU KÝ ỨC';
  clearScreenshotPreview();
  loadItems(renderRecent);
}

function renderRecent() {
  var container = document.getElementById('recent-list');
  if (savedItems.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:#bbb;text-align:center;padding:8px 0">Chưa có ký ức nào được lưu</div>';
    return;
  }
  container.innerHTML = savedItems.slice(0, 3).map(function(item) {
    var tagsHtml = (item.tags||[]).slice(0,3).map(function(t){ return '<span class="recent-tag">'+t+'</span>'; }).join('');
    return '<div class="recent-item"><div class="recent-dot"></div><div style="flex:1">'
      +'<div class="recent-title">'+item.title+'</div>'
      +'<div class="recent-meta">'+item.date+' · '+item.type+'</div>'
      +'<div class="recent-tags">'+tagsHtml+'</div></div></div>';
  }).join('');
}
