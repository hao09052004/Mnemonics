import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';

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
  const [fileState, setFileState] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useState<string>('')[0] || uuid();

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
      setFileState(null);
      setTitle('');
      setNote('');
      setPreview(null);
    }
  }, [open]);

  // Clean up the preview URL on unmount or when the dialog closes.
  useEffect(() => {
    if (!open && preview) {
      URL.revokeObjectURL(preview);
    }
  }, [open, preview]);

  if (!open) return null;

  function pickFile() {
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setPhase('error');
      setError('Image is too large. The maximum is 10 MB.');
      setFileState(null);
      setPreview(null);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setPhase('error');
      setError('Unsupported image type. Use JPEG, PNG, or WebP.');
      setFileState(null);
      setPreview(null);
      return;
    }
    setError(null);
    setFileState(f);
    setTitle(defaultTitleFor(f.name));
    setPhase('idle');
    // Build a local preview URL.
    const url = URL.createObjectURL(f);
    setPreview(url);
    if (inputRef.current) inputRef.current.value = '';
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
              <h2>Upload image</h2>
              <p className="dialog-sub">Tải lên hình ảnh, ảnh chụp màn hình hoặc tài liệu scan.</p>
            </div>
          </div>
          <button type="button" className="dialog-close-btn" onClick={handleCancel} aria-label="Close">
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
          <div className="dropzone-area" onClick={pickFile}>
            <div className="dropzone-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
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
              Choose image…
            </button>
            <p className="dropzone-hint">
              Kéo thả hoặc bấm để chọn ảnh từ thiết bị
            </p>
            <p className="dropzone-sub">
              Hỗ trợ JPEG, PNG, WebP (tối đa 10 MB). Hệ thống tự động OCR & trích xuất chữ.
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
                Đổi ảnh
              </button>
            </div>
            <label className="document-title-label">
              <span>Tiêu đề</span>
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
              <span>Ghi chú (không bắt buộc)</span>
              <textarea
                data-testid="image-note-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={phase === 'uploading' || phase === 'finalizing' || phase === 'saved'}
                maxLength={2000}
                rows={3}
                placeholder="Ghi chú về hình ảnh này..."
              />
            </label>
            <div className="document-actions">
              <button
                type="button"
                className="ghost"
                data-testid="image-cancel"
                onClick={handleCancel}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                Cancel
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
                  ? 'Uploading…'
                  : phase === 'saved'
                    ? 'Saved'
                    : 'Save image'}
              </button>
            </div>
            {error ? (
              <p className="document-error" data-testid="image-error">
                <span>⚠️</span> {error}
              </p>
            ) : null}
            {phase === 'saved' ? (
              <p className="document-status" data-testid="image-status">
                <span>✓</span> Saved — running OCR…
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
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
