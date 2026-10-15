import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';
import { extractSmartTags } from '../../lib/smart-tags';
import { useLocale } from '../../lib/locale';

export interface ImageCaptureDialogProps {
  api: ApiClient;
  open: boolean;
  onClose: () => void;
  /** Called after the server accepted the capture so the list can refresh. */
  onSaved?: (itemId: string) => void;
}

const ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

type Phase = 'idle' | 'uploading' | 'finalizing' | 'saved' | 'error';

function defaultTitleFor(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function ImageCaptureDialog({
  api,
  open,
  onClose,
  onSaved
}: ImageCaptureDialogProps) {
  const { t } = useLocale();
  const [fileState, setFileState] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useState<string>('')[0] || uuid();

  const smartTags = useMemo(() => {
    const combined = (title + ' ' + note).trim();
    return extractSmartTags(combined, 'ảnh chụp');
  }, [title, note]);

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
      setFileState(null);
      setTitle('');
      setNote('');
      setPreview(null);
      setIsDragging(false);
    }
  }, [open]);

  // Clean up the preview URL on unmount or when the dialog closes.
  useEffect(() => {
    if (!open && preview) {
      URL.revokeObjectURL(preview);
    }
  }, [open, preview]);

  function pickFile() {
    inputRef.current?.click();
  }

  function handleImageSelected(f: File, customTitle?: string) {
    if (f.size > MAX_BYTES) {
      setPhase('error');
      setError(t('dialog_image_size_error', 'Image is too large. The maximum is 10 MB.'));
      setFileState(null);
      setPreview(null);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setPhase('error');
      setError(t('dialog_image_type_error', 'Unsupported image type. Use JPEG, PNG, or WebP.'));
      setFileState(null);
      setPreview(null);
      return;
    }
    setError(null);
    setFileState(f);
    setTitle(customTitle || defaultTitleFor(f.name));
    setPhase('idle');
    const url = URL.createObjectURL(f);
    setPreview(url);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    handleImageSelected(f);
  }

  // Listen for clipboard paste (Ctrl+V) when dialog is open
  useEffect(() => {
    if (!open) return;
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            handleImageSelected(
              file,
              `Ảnh chụp màn hình · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            );
            break;
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [open]);

  async function captureScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Trình duyệt chưa hỗ trợ chụp màn hình trực tiếp. Bạn có thể nhấn PrintScreen hoặc Win+Shift+S rồi nhấn Ctrl+V để dán.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `screenshot-${Date.now()}.jpg`, { type: 'image/jpeg' });
          handleImageSelected(
            file,
            `Ảnh chụp màn hình · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          );
        }
      }, 'image/jpeg', 0.9);
    } catch {
      // User cancelled picker
    }
  }

  async function handleConfirm() {
    if (!fileState) return;
    setPhase('uploading');
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setPhase('error');
        setError('Session expired. Please sign in again.');
        return;
      }
      const r = await api.uploadImageCapture(
        {
          file: fileState,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          clientRequestId: requestIdRef
        },
        token,
        (p) => {
          if (p === 'uploading') setPhase('uploading');
          else setPhase('finalizing');
        }
      );
      setPhase('saved');
      onSaved?.(r.id);
    } catch (err) {
      setPhase('error');
      const code = (err as { code?: string })?.code;
      if (code === 'IMAGE_FILE_REQUIRED') {
        setError('Please choose an image file.');
      } else if (err instanceof Error) {
        setError(err.message || 'Upload failed');
      } else {
        setError('Upload failed');
      }
    }
  }

  function handleCancel() {
    if (phase === 'uploading' || phase === 'finalizing') return;
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={handleCancel}
      data-testid="image-capture-dialog"
    >
      <div
        className="capture-sheet capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Upload an image"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-header-left">
            <div className="dialog-icon-badge dialog-icon-badge--image">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
            </div>
            <div>
              <h2>{t('dialog_image_title', 'Upload image')}</h2>
              <p className="dialog-sub">{t('dialog_image_sub', 'Tải lên hình ảnh, ảnh chụp màn hình hoặc tài liệu scan.')}</p>
            </div>
          </div>
          <button type="button" className="dialog-close-btn" onClick={handleCancel} aria-label={t('dialog_image_close', 'Close')}>
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          data-testid="image-file-input"
          onChange={handleFileChange}
          hidden
        />

        {!fileState ? (
          <div
            className={`dropzone-area ${isDragging ? 'is-dragging' : ''}`}
            onClick={pickFile}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleImageSelected(f);
            }}
          >
            <div className="dropzone-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="dropzone-pick-btn"
                data-testid="image-pick-file"
                onClick={(e) => {
                  e.stopPropagation();
                  pickFile();
                }}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                {t('dialog_image_choose', 'Choose image…')}
              </button>
              <button
                type="button"
                className="dropzone-pick-btn"
                style={{ background: 'var(--purple-soft, rgba(91,63,228,0.12))', color: 'var(--purple-text, #a78bfa)', border: '1px solid var(--purple)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  captureScreen();
                }}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                {t('dialog_image_screenshot', '📸 Screenshot')}
              </button>
            </div>
            <p className="dropzone-hint">
              {t('dialog_image_drop_hint', 'Kéo thả, dán ảnh chụp (Ctrl+V) hoặc bấm để chọn ảnh')}
            </p>
            <p className="dropzone-sub">
              {t('dialog_image_drop_sub', 'Hỗ trợ JPEG, PNG, WebP (tối đa 10 MB). Hệ thống tự động OCR & trích xuất chữ.')}
            </p>
          </div>
        ) : (
          <div data-testid="image-summary" className="file-summary-container">
            {preview ? (
              <div className="image-preview-wrapper">
                <img
                  src={preview}
                  alt="preview"
                  className="image-preview"
                  data-testid="image-preview"
                />
              </div>
            ) : null}
            <div className="document-summary-row">
              <span className="document-filename">{fileState.name}</span>
              <span className="document-filesize">{fmtBytes(fileState.size)}</span>
              <button
                type="button"
                className="file-change-btn"
                onClick={pickFile}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                {t('dialog_image_change', 'Đổi ảnh')}
              </button>
            </div>
            <label className="document-title-label">
              <span>{t('dialog_image_title_label', 'Tiêu đề')}</span>
              <input
                type="text"
                data-testid="image-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={phase === 'uploading' || phase === 'finalizing' || phase === 'saved'}
                maxLength={200}
              />
            </label>
            <label className="document-title-label">
              <span>{t('dialog_image_note_label', 'Ghi chú (không bắt buộc)')}</span>
              <textarea
                data-testid="image-note-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={phase === 'uploading' || phase === 'finalizing' || phase === 'saved'}
                maxLength={2000}
                rows={3}
                placeholder={t('dialog_image_note_placeholder', 'Ghi chú về hình ảnh này...')}
              />
            </label>
            <div className="smart-tags-preview" style={{ marginTop: 6, marginBottom: 8, padding: '10px 14px', background: 'var(--purple-soft, rgba(91,63,228,0.08))', borderRadius: 8, border: '1px solid rgba(91,63,228,0.18)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', color: 'var(--purple, #5B3FE4)', textTransform: 'uppercase', marginBottom: 6 }}>
                {t('dialog_image_smart_tags', '★ Smart Tags (Auto-suggested)')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {smartTags.map((tag) => (
                  <span key={tag} style={{ background: 'var(--surface, #1e222b)', color: 'var(--purple-text, #a78bfa)', fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 14, border: '1px solid rgba(167,139,250,0.25)' }}>
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
            <div className="document-actions">
              <button
                type="button"
                className="ghost"
                data-testid="image-cancel"
                onClick={handleCancel}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                {t('btn_cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                data-testid="image-save"
                onClick={handleConfirm}
                disabled={
                  phase === 'uploading' ||
                  phase === 'finalizing' ||
                  phase === 'saved'
                }
              >
                {phase === 'uploading' || phase === 'finalizing'
                  ? t('status_saving', 'Uploading…')
                  : phase === 'saved'
                    ? t('status_saved', 'Saved')
                    : t('dialog_image_btn_save', 'Save image')}
              </button>
            </div>
            {error ? (
              <p className="document-error" data-testid="image-error">
                <span>⚠️</span> {error}
              </p>
            ) : null}
            {phase === 'saved' ? (
              <p className="document-status" data-testid="image-status">
                <span>✓</span> {t('dialog_image_saved_ocr', 'Saved — running OCR…')}
              </p>
            ) : null}
          </div>
        )}
        {error && !fileState ? (
          <p className="document-error" data-testid="image-error">
            <span>⚠️</span> {error}
          </p>
        ) : null}
        {!fileState && (
          <div className="document-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="ghost document-close"
              onClick={handleCancel}
              disabled={phase === 'uploading' || phase === 'finalizing'}
            >
              {t('dialog_image_close', 'Close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
