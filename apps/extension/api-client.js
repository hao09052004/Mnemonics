var MNEMONICS_API_URL = 'http://localhost:4000';

function uploadImageCapture(imageDataUrl, payload, accessToken) {
  if (!accessToken) return Promise.reject(new Error('Bạn cần đăng nhập trước khi lưu ảnh.'));
  return fetch(imageDataUrl)
    .then(function(response) {
      if (!response.ok) throw new Error('Không đọc được ảnh đã cắt.');
      return response.blob();
    })
    .then(function(blob) {
      var form = new FormData();
      form.append('file', blob, 'mnemonics-screenshot.jpg');
      form.append('title', payload.title || 'Ảnh chụp màn hình');
      form.append('note', payload.note || '');
      form.append('sourceUrl', payload.sourceUrl || '');
      form.append('capturedAt', payload.capturedAt || new Date().toISOString());
      form.append('clientRequestId', crypto.randomUUID());

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
    clientRequestId: crypto.randomUUID()
  };

  if (type === 'image') {
    throw new Error('Image upload requires object storage before it can be sent to the API.');
  }
  return payload;
}

async function sendCaptureToApi(item, accessToken) {
  if (!accessToken) throw new Error('Bạn cần đăng nhập trước khi lưu dữ liệu.');
  const response = await fetch(`${MNEMONICS_API_URL}/api/v1/captures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(toCapturePayload(item))
  });
  if (!response.ok) throw new Error(`Capture API failed with status ${response.status}`);
  return { sent: true, data: await response.json() };
}