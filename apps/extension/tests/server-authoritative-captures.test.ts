import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const extensionSource = readFileSync(join(__dirname, '..', 'extension.js'), 'utf8');
const backgroundSource = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const cropperSource = readFileSync(join(__dirname, '..', 'screenshot-cropper.js'), 'utf8');
const dashboardSource = readFileSync(join(__dirname, '..', 'dashboard.js'), 'utf8');

function bodyBetween(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

describe('server-authoritative capture flows', () => {
  it('popup link/text saves await the JSON API before reporting success', () => {
    const body = bodyBetween(extensionSource, 'async function saveCapture()', 'function resetForm()');
    expect(body).toContain('await sendCaptureToApi');
    expect(body.indexOf('await sendCaptureToApi')).toBeLessThan(body.indexOf("type: 'ITEM_SAVED'"));
    expect(body).not.toContain('chrome.storage.local.set');
    expect(body).not.toContain('pendingUpload');
  });

  it('popup image saves use multipart upload without a local capture write', () => {
    const body = bodyBetween(extensionSource, 'async function savePendingScreenshot', 'var pendingCaptureRequestId');
    expect(body).toContain('await uploadImageCapture');
    expect(body.indexOf('await uploadImageCapture')).toBeLessThan(body.indexOf("type: 'ITEM_SAVED'"));
    expect(body).not.toContain('mnemonics_items_');
  });

  it('dashboard modal awaits the matching API helper before closing and refreshing', () => {
    const body = bodyBetween(dashboardSource, 'async function saveItem()', '// ===== TOAST =====');
    expect(body).toContain('await uploadImageCapture');
    expect(body).toContain('await sendCaptureToApi');
    expect(body.indexOf('await sendCaptureToApi')).toBeLessThan(body.indexOf('closeModal()'));
    expect(body).not.toContain('chrome.storage.local.set');
    expect(body).not.toContain('localStorage.setItem');
  });

  it('background context-menu failures do not create durable fallbacks', () => {
    const body = bodyBetween(backgroundSource, '// Context-menu captures', '// Trao dữ liệu ảnh chụp');
    expect(body).toContain('uploadTextCapture');
    expect(body).toContain('uploadImageFromContextMenu');
    expect(body).not.toContain('writeGenericLocalStore');
    expect(body).not.toContain('writeImageToLocalStore');
    expect(body).not.toContain('Lưu cục bộ');
    expect(backgroundSource).not.toContain('mnemonics-pending-sync');
  });

  it('cropper awaits upload, preserves request id for retry, and clears transport only on success or cancel', () => {
    const saveBody = bodyBetween(cropperSource, 'async function saveScreenshot', 'function cancelCropper');
    expect(saveBody).toContain('await sendMessageWithRetry');
    expect(saveBody).toContain('pending.clientRequestId || crypto.randomUUID()');
    expect(saveBody.indexOf('await sendMessageWithRetry')).toBeLessThan(saveBody.indexOf("safeSend('CLEAR_PENDING_SCREENSHOT')"));
    expect(saveBody).not.toContain('mnemonics_items_');
    expect(saveBody.slice(saveBody.indexOf('catch (error)'))).not.toContain('CLEAR_PENDING_SCREENSHOT');

    const cancelBody = bodyBetween(cropperSource, 'function cancelCropper', 'function loadPending');
    expect(cancelBody).toContain('CLEAR_PENDING_SCREENSHOT');
    expect(cancelBody).not.toContain('UPLOAD_IMAGE_FROM_CROPPER');
  });
});
