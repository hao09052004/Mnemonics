var image = document.getElementById('image');
var title = document.getElementById('title');
var download = document.getElementById('download');
var status = document.getElementById('status');

function showError(message) {
  console.error('[original-image]', message);
  status.textContent = message;
  status.hidden = false;
  image.hidden = true;
  download.hidden = true;
}

// Chrome's CORP/ORB strips cross-origin HTTPS responses that don't send
// `Cross-Origin-Resource-Policy: cross-origin`. Supabase Storage doesn't
// add that header, so loading the signed URL directly inside an
// extension page produces a black <img>. Convert the bytes to a
// data: URL through the background service worker (which is not a
// document context and can fetch any image without CORP), then drop the
// data: URL into <img src>.
function fetchAsDataUrl(originalUrl) {
  return new Promise(function(resolve, reject) {
    chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_AS_DATA_URL', url: originalUrl }, function(response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok && response.data && response.data.dataUrl) {
        resolve(response.data.dataUrl);
      } else {
        reject(new Error((response && response.error) || 'Không tải được ảnh'));
      }
    });
  });
}

chrome.storage.local.get('mnemonics_original_image', function(result) {
  var payload = result.mnemonics_original_image;
  console.log('[original-image] payload received:', {
    hasPayload: !!payload,
    urlPreview: payload && payload.url ? String(payload.url).slice(0, 80) + '...' : null,
    urlLength: payload && payload.url ? String(payload.url).length : 0,
    title: payload && payload.title
  });
  if (!payload || !payload.url) {
    showError('Không tìm thấy ảnh gốc. Hãy đóng trang này và mở lại từ dashboard.');
    return;
  }

  title.textContent = payload.title || 'Ảnh gốc';
  document.title = title.textContent + ' - Mnemonics';
  image.onload = function() {
    console.log('[original-image] image displayed');
    status.hidden = true;
    image.hidden = false;
  };
  image.onerror = function(evt) {
    console.error('[original-image] image failed:', evt);
    showError('Không thể hiển thị ảnh gốc. Hãy thử lưu ảnh lại từ extension.');
  };

  // If the URL is already a data: / blob: / chrome-extension: we can
  // assign it directly; otherwise route through the background worker to
  // dodge Chrome's cross-origin isolation for extension pages.
  var directUrl = payload.url;
  if (/^(data:|blob:|chrome-extension:)/i.test(directUrl)) {
    image.src = directUrl;
    download.href = directUrl;
  } else {
    status.textContent = 'Đang tải ảnh gốc...';
    fetchAsDataUrl(directUrl)
      .then(function(dataUrl) {
        console.log('[original-image] converted to data URL, length:', dataUrl.length);
        image.src = dataUrl;
        download.href = dataUrl;
      })
      .catch(function(err) {
        console.error('[original-image] fetchAsDataUrl failed:', err);
        // Last-ditch fallback: try the signed URL directly. If it fails
        // the onerror handler above will show the error message.
        image.src = directUrl;
        download.href = directUrl;
      });
  }
  download.download = (payload.title || 'mnemonics-image').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.jpg';
});