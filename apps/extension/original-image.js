var image = document.getElementById('image');
var title = document.getElementById('title');
var download = document.getElementById('download');
var status = document.getElementById('status');

function showError(message) {
  status.textContent = message;
  status.hidden = false;
  image.hidden = true;
  download.hidden = true;
}

chrome.storage.local.get('mnemonics_original_image', function(result) {
  var payload = result.mnemonics_original_image;
  if (!payload || !payload.url) {
    showError('Không tìm thấy ảnh gốc. Hãy đóng trang này và mở lại từ dashboard.');
    return;
  }

  title.textContent = payload.title || 'Ảnh gốc';
  document.title = title.textContent + ' - Mnemonics';
  image.onload = function() {
    status.hidden = true;
    image.hidden = false;
  };
  image.onerror = function() {
    showError('Không thể hiển thị ảnh gốc. Hãy thử lưu ảnh lại từ extension.');
  };
  image.src = payload.url;
  download.href = payload.url;
  download.download = (payload.title || 'mnemonics-image').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.jpg';
});