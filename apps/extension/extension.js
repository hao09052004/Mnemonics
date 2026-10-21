var MNEMONICS_API_URL = 'https://mnemonics-api.onrender.com';
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get('mnemonics_api_url', function(r) {
    if (r && r.mnemonics_api_url) MNEMONICS_API_URL = r.mnemonics_api_url;
  });
}

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
var extensionCurrentUser = null;

function normalizeAccountEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function setAccountError(message) {
  var error = document.getElementById('account-error');
  if (!error) return;
  error.textContent = message || '';
  error.classList.toggle('show', Boolean(message));
}

function renderAccountState() {
  var name = document.getElementById('account-name');
  var email = document.getElementById('account-email');
  var open = document.getElementById('account-open');
  var logout = document.getElementById('account-logout');
  var signedIn = Boolean(extensionCurrentUser && extensionCurrentUser.email);

  if (name) name.textContent = signedIn ? (extensionCurrentUser.name || extensionCurrentUser.email) : 'Khách';
  if (email) email.textContent = signedIn ? extensionCurrentUser.email : 'Đăng nhập để đồng bộ với Web Dashboard';
  if (open) open.hidden = signedIn;
  if (logout) logout.hidden = !signedIn;
  if (signedIn) {
    var panel = document.getElementById('account-panel');
    if (panel) panel.hidden = true;
  }
}

function notifyAccountChanged() {
  try {
    var pending = chrome.runtime.sendMessage({ type: 'ACCOUNT_CHANGED' });
    if (pending && typeof pending.catch === 'function') pending.catch(function() {});
  } catch (e) {}
}

function setAccountView(view) {
  var login = view === 'login';
  document.getElementById('account-login-view').hidden = !login;
  document.getElementById('account-signup-view').hidden = login;
  document.getElementById('account-tab-login').classList.toggle('active', login);
  document.getElementById('account-tab-signup').classList.toggle('active', !login);
  document.getElementById('account-tab-login').setAttribute('aria-selected', String(login));
  document.getElementById('account-tab-signup').setAttribute('aria-selected', String(!login));
  setAccountError('');
}

// Read current valid session access token
function getValidToken() {
  return new Promise(function(resolve) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      var raw = localStorage.getItem('mnemonics_session');
      try {
        var parsed = raw ? JSON.parse(raw) : null;
        resolve(parsed ? parsed.accessToken : null);
      } catch (e) { resolve(null); }
      return;
    }
    chrome.storage.local.get('mnemonics_session', function(r) {
      var session = r && r.mnemonics_session;
      if (session && session.accessToken) {
        resolve(session.accessToken);
      } else {
        resolve(null);
      }
    });
  });
}

function handleExtensionLogin(event) {
  event.preventDefault();
  var email = normalizeAccountEmail(document.getElementById('account-login-email').value);
  var password = document.getElementById('account-login-password').value;
  var submit = document.getElementById('account-login-submit');
  setAccountError('');
  if (!email || !password) { setAccountError('Vui lòng nhập email và mật khẩu.'); return; }
  submit.disabled = true;

  fetch(MNEMONICS_API_URL + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  })
  .then(function(res) {
    return res.json().then(function(body) {
      if (!res.ok) {
        throw new Error((body.error && body.error.message) || 'Email hoặc mật khẩu không chính xác.');
      }
      return body.data;
    });
  })
  .then(function(data) {
    var user = data.user || {};
    var session = data.session || {};
    var storedSession = {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        avatar: user.avatar || null,
        plan: user.plan || 'Mastery'
      }
    };
    chrome.storage.local.set({
      mnemonics_session: storedSession,
      mnemonics_current_user: storedSession.user
    }, function() {
      extensionCurrentUser = storedSession.user;
      document.getElementById('account-login-password').value = '';
      document.getElementById('account-panel').hidden = true;
      renderAccountState();
      notifyAccountChanged();
      loadRecent();
    });
  })
  .catch(function(err) {
    setAccountError(err.message || 'Không thể đăng nhập lúc này.');
  })
  .finally(function() {
    submit.disabled = false;
  });
}

function handleExtensionSignup(event) {
  event.preventDefault();
  var name = document.getElementById('account-signup-name').value.trim();
  var email = normalizeAccountEmail(document.getElementById('account-signup-email').value);
  var password = document.getElementById('account-signup-password').value;
  var confirm = document.getElementById('account-signup-confirm').value;
  var submit = document.getElementById('account-signup-submit');
  setAccountError('');
  if (!name || !email || !password || !confirm) { setAccountError('Vui lòng nhập đầy đủ thông tin.'); return; }
  if (password.length < 6) { setAccountError('Mật khẩu cần tối thiểu 6 ký tự.'); return; }
  if (password !== confirm) { setAccountError('Mật khẩu nhập lại chưa khớp.'); return; }
  submit.disabled = true;

  fetch(MNEMONICS_API_URL + '/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password, name: name })
  })
  .then(function(res) {
    return res.json().then(function(body) {
      if (!res.ok) {
        throw new Error((body.error && body.error.message) || 'Không thể tạo tài khoản.');
      }
      return body.data;
    });
  })
  .then(function(data) {
    if (data && data.session && data.session.accessToken) {
      var user = data.user || {};
      var session = data.session;
      var storedSession = {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: {
          id: user.id,
          email: user.email,
          name: name || user.name || user.email,
          avatar: null,
          plan: 'Mastery'
        }
      };
      chrome.storage.local.set({
        mnemonics_session: storedSession,
        mnemonics_current_user: storedSession.user
      }, function() {
        extensionCurrentUser = storedSession.user;
        document.getElementById('account-panel').hidden = true;
        renderAccountState();
        notifyAccountChanged();
        loadRecent();
      });
    } else {
      setAccountView('login');
      document.getElementById('account-login-email').value = email;
      setAccountError('Tạo tài khoản thành công! Hãy đăng nhập.');
    }
  })
  .catch(function(err) {
    setAccountError(err.message || 'Không thể tạo tài khoản lúc này.');
  })
  .finally(function() {
    submit.disabled = false;
  });
}

function handleExtensionLogout() {
  chrome.storage.local.remove(['mnemonics_session', 'mnemonics_current_user'], function() {
    extensionCurrentUser = null;
    renderAccountState();
    notifyAccountChanged();
    loadRecent();
  });
}

function loadAuthState(cb) {
  chrome.storage.local.get(['mnemonics_session', 'mnemonics_current_user'], function(r) {
    if (r.mnemonics_session && r.mnemonics_session.user) {
      extensionCurrentUser = r.mnemonics_session.user;
    } else if (r.mnemonics_current_user && r.mnemonics_current_user.email) {
      extensionCurrentUser = r.mnemonics_current_user;
    } else {
      extensionCurrentUser = null;
    }
    renderAccountState();
    if (cb) cb();
  });
}

document.addEventListener('DOMContentLoaded', function() {
  var accountPanel = document.getElementById('account-panel');
  document.getElementById('account-open').addEventListener('click', function() {
    accountPanel.hidden = !accountPanel.hidden;
    if (!accountPanel.hidden) {
      setAccountView('login');
      document.getElementById('account-login-email').focus();
    }
  });
  document.getElementById('account-tab-login').addEventListener('click', function() { setAccountView('login'); });
  document.getElementById('account-tab-signup').addEventListener('click', function() { setAccountView('signup'); });
  document.getElementById('account-login-view').addEventListener('submit', handleExtensionLogin);
  document.getElementById('account-signup-view').addEventListener('submit', handleExtensionSignup);
  document.getElementById('account-logout').addEventListener('click', handleExtensionLogout);

  loadAuthState();

  document.getElementById('open-dashboard').addEventListener('click', function() {
    var url = chrome.runtime.getURL('mnemonics-dashboard.html');
    chrome.tabs.create({ url: url });
  });

  var openAnalytics = document.getElementById('open-analytics');
  if (openAnalytics) {
    openAnalytics.addEventListener('click', function() {
      chrome.tabs.create({ url: 'https://mnemonics-one.vercel.app/app/analytics?tab=funnel' });
    });
  }

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

  loadRecent();
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
    'this','that','with','from','have','will','your','page','home','và','của','các','được','trong','cho'];
  var words = content.toLowerCase().replace(/[^a-zA-Z0-9\sàáảãạăắặẳẵằâấậẩẫầèéẻẽẹêếệểễềìíỉĩịòóỏõọôốộổỗồơớợởỡờùúủũụưứựửữừỳýỷỹỵđ]/g, ' ').split(/\s+/)
    .filter(function(w) { return w.length > 2 && stopwords.indexOf(w) === -1; });
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
}

function captureScreenshot() {
  var btn = document.getElementById('capture-screenshot-btn');
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.captureVisibleTab) {
    alert('Trình duyệt chưa hỗ trợ chụp màn hình từ popup.');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Đang chụp màn hình...'; }

  chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 }, function(dataUrl) {
    function resetButton() {
      if (btn) { btn.disabled = false; btn.textContent = '📸 CHỤP & CẮT MÀN HÌNH'; }
    }
    if (chrome.runtime && chrome.runtime.lastError) {
      resetButton();
      alert('Không chụp được màn hình: ' + chrome.runtime.lastError.message);
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

    chrome.runtime.sendMessage({ type: 'SET_PENDING_SCREENSHOT', payload: payload }, function(response) {
      chrome.storage.local.set({ mnemonics_pending_screenshot: payload }, function() {
        var url = chrome.runtime.getURL('screenshot-cropper.html') + '?t=' + Date.now();
        chrome.tabs.create({ url: url }, function() {
          resetButton();
          window.close();
        });
      });
    });
  });
}

async function saveCapture() {
  var title = document.getElementById('cap-title').value.trim();
  var note = document.getElementById('cap-note').value.trim();
  var url = document.getElementById('tab-url').textContent;
  if (!title) {
    var el = document.getElementById('cap-title');
    el.focus(); el.style.borderColor = '#ef4444';
    setTimeout(function(){ el.style.borderColor = ''; }, 1500);
    return;
  }

  var token = await getValidToken();
  if (!token) {
    // Prompt to log in so everything goes directly to database
    var panel = document.getElementById('account-panel');
    if (panel) panel.hidden = false;
    setAccountView('login');
    setAccountError('Vui lòng đăng nhập bằng Gmail để lưu vào Database.');
    return;
  }

  doSaveCapture(title, note, url, token);
}

async function doSaveCapture(title, note, url, token) {
  if (currentTags.length === 0) autoTagsFromContent(title + ' ' + note);
  var saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Đang lưu vào Cloud...';

  var itemType = currentType === 'link' ? 'link' : (currentType === 'quote' ? 'quote' : 'text');
  var payload = {
    type: itemType === 'link' ? 'link' : 'text',
    title: title,
    sourceUrl: currentPageUrl || url,
    selectedText: note || undefined,
    capturedAt: new Date().toISOString(),
    clientRequestId: crypto.randomUUID()
  };

  try {
    var response = await fetch(MNEMONICS_API_URL + '/api/v1/captures', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    });

    var resBody = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      throw new Error((resBody && resBody.error && resBody.error.message) || 'Lỗi HTTP ' + response.status);
    }
    var itemId = resBody && resBody.data && resBody.data.id;
    if (itemId) {
      var tagsToSave = (currentTags && currentTags.length) ? currentTags.slice() : [];
      if (currentType === 'quote' && !tagsToSave.includes('trích dẫn')) tagsToSave.unshift('trích dẫn');
      if (currentType === 'link' && !tagsToSave.includes('link')) tagsToSave.unshift('link');
      if (currentType === 'note' && !tagsToSave.includes('ghi chú')) tagsToSave.unshift('ghi chú');
      if (currentType === 'article' && !tagsToSave.includes('bài viết')) tagsToSave.unshift('bài viết');

      if (tagsToSave.length > 0) {
        fetch(MNEMONICS_API_URL + '/api/v1/items/' + itemId, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          },
          body: JSON.stringify({ tags: tagsToSave })
        }).catch(function(e) { console.warn('Patch tags failed:', e); });
      }
    }

    // Success! Notify dashboard
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'ITEM_SAVED' });
    }

    document.getElementById('success-tags').innerHTML = currentTags.map(function(t){ return '<span class="ai-tag">'+t+'</span>'; }).join('');
    document.getElementById('success-overlay').classList.add('show');
    loadRecent();
  } catch (err) {
    alert('Không thể lưu vào Database: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '★ LƯU KÝ ỨC';
  }
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
  loadRecent();
}

async function loadRecent() {
  var container = document.getElementById('recent-list');
  var token = await getValidToken();
  if (!token) {
    container.innerHTML = '<div style="font-size:12px;color:#bbb;text-align:center;padding:8px 0">Đăng nhập để xem ký ức gần đây</div>';
    return;
  }

  fetch(MNEMONICS_API_URL + '/api/v1/items?limit=3', {
    headers: { Authorization: 'Bearer ' + token }
  })
  .then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function(body) {
    var items = (body.data && body.data.items) || [];
    if (items.length === 0) {
      container.innerHTML = '<div style="font-size:12px;color:#bbb;text-align:center;padding:8px 0">Chưa có ký ức nào được lưu</div>';
      return;
    }
    container.innerHTML = items.map(function(item) {
      var tagsHtml = (item.tags || []).slice(0, 3).map(function(t){ return '<span class="recent-tag">' + t + '</span>'; }).join('');
      var dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('vi-VN') : 'Vừa xong';
      return '<div class="recent-item"><div class="recent-dot"></div><div style="flex:1">'
        + '<div class="recent-title">' + (item.title || 'Không có tiêu đề') + '</div>'
        + '<div class="recent-meta">' + dateStr + ' · ' + (item.kind || 'ký ức') + '</div>'
        + '<div class="recent-tags">' + tagsHtml + '</div></div></div>';
    }).join('');
  })
  .catch(function() {
    container.innerHTML = '<div style="font-size:12px;color:#bbb;text-align:center;padding:8px 0">Chưa có ký ức nào được lưu</div>';
  });
}
