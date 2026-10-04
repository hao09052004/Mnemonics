import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const extensionSource = readFileSync(join(__dirname, '..', 'extension.js'), 'utf8');
const backgroundSource = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const cropperSource = readFileSync(join(__dirname, '..', 'screenshot-cropper.js'), 'utf8');

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

  // The dashboard used to host its own capture modal that called
  // uploadImageCapture / sendCaptureToApi directly. The new dashboard
  // routes captures through the background service worker (which
  // owns token refresh) via `CAPTURE_FROM_DASHBOARD`. That contract
  // is covered by the background message handler and the new
  // dashboard code path; see apps/extension/dashboard.js +
  // apps/extension/background.js for the wiring.

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

import { describe as _dType, expect as _eType, it as _iType } from 'vitest';
_dType('cropper upload type wiring (regression: Screenshots tab empty after save)', () => {
  // Reproduction of the 2026-10-04 incident where saving a screenshot
  // via the cropper produced an item the dashboard could not surface
  // in the "Screenshots" filter chip. Root cause: screenshot-cropper
  // correctly tags the local item as type='screenshot', and the
  // background's UPLOAD_IMAGE_FROM_CROPPER handler is supposed to
  // forward that to the API. But the body of uploadImageFromContextMenu
  // hardcodes form.append('type', 'image'), so the saved row gets
  // kind='image' on the server side, the dashboard renders it as the
  // 'image' variant, and VARIANT_KINDS.screenshot = ['screenshot']
  // filters it out of the Screenshots tab.
  //
  // The fix: pass the desired type through the call chain
  //   screenshot-cropper -> background.UPLOAD_IMAGE_FROM_CROPPER
  //   -> uploadImageFromContextMenu(extra.type)
  //   -> form.append('type', extra.type || 'image')
  // so the API persists the right kind and the dashboard's filter
  // chip matches.
  _iType('cropper message payload declares a type', () => {
    const sendBody = bodyBetween(cropperSource, "type: 'UPLOAD_IMAGE_FROM_CROPPER'", "safeSend('CLEAR_PENDING_SCREENSHOT')");
    expect(sendBody, 'cropper must declare captureType so the background can route it').toMatch(/captureType:\s*['"]screenshot['"]/);
  });

  _iType('background handler forwards the type through to uploadImageFromContextMenu', () => {
    const handler = bodyBetween(backgroundSource, "msg.type === 'UPLOAD_IMAGE_FROM_CROPPER'", 'showScreenshotNotification');
    expect(handler, 'background must pass type to uploadImageFromContextMenu (via extra)').toMatch(/type:\s*(payload\.type|captureType|msg\.captureType)/);
  });

  _iType('uploadImageFromContextMenu sends the requested type to the API', () => {
    const fn = bodyBetween(backgroundSource, 'async function uploadImageFromContextMenu', '// Context-menu captures');
    // The bug: form.append('type', 'image') was hardcoded. The fix
    // pulls the value from extra so screenshot uploads land as
    // 'screenshot' in the DB and match the Screenshots filter chip.
    expect(fn, 'uploadImageFromContextMenu must derive type from extra').toMatch(/extra[^=\n]*\.type/);
    expect(fn, 'form.append must use the derived type, not a hardcoded literal').toMatch(/form\.append\('type',\s*captureType/);
    expect(fn, 'no hardcoded type=\'image\' — every caller declares its own type').not.toMatch(/form\.append\('type',\s*'image'\s*\)/);
  });
});
