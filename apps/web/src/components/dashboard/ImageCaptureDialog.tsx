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

  // Clean up the preview URL on unmount or when the dialog closes.
  useEffect(() => {
    if (!open && preview) {
      URL.revokeObjectURL(preview);
    }
  }, [open, preview]);

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
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Upload an image"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Upload image</h2>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          data-testid="image-file-input"
          onChange={handleFileChange}
          hidden
        />
        {!fileState ? (
          <button
            type="button"
            data-testid="image-pick-file"
            onClick={pickFile}
            disabled={phase === 'uploading' || phase === 'finalizing'}
          >
            Choose image…
          </button>
        ) : (
          <div data-testid="image-summary">
            {preview ? (
              <img
                src={preview}
                alt="preview"
                className="image-preview"
                data-testid="image-preview"
              />
            ) : null}
            <div className="document-summary-row">
              <span className="document-filename">{fileState.name}</span>
              <span className="document-filesize">{fmtBytes(fileState.size)}</span>
            </div>
            <label className="document-title-label">
              Title
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
              Note (optional)
              <textarea
                data-testid="image-note-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={phase === 'uploading' || phase === 'finalizing' || phase === 'saved'}
                maxLength={2000}
                rows={3}
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
                {error}
              </p>
            ) : null}
            {phase === 'saved' ? (
              <p className="document-status" data-testid="image-status">
                Saved — running OCR…
              </p>
            ) : null}
          </div>
        )}
        {error && !fileState ? (
          <p className="document-error" data-testid="image-error">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="ghost document-close"
          onClick={handleCancel}
          disabled={phase === 'uploading' || phase === 'finalizing'}
        >
          Close
        </button>
      </div>
    </div>
  );
}
