/**
 * DocumentCaptureDialog — the second half of `Upload Document`.
 *
 * The CaptureSheet exposes the action and opens a hidden `<input type=file>`
 * for the user. Once a file is picked, this dialog handles confirmation:
 * filename, default title (the filename minus extension), editable title,
 * upload progress, and the final "Saved" / "Processing document…" state.
 *
 * The dialog never sends bytes to itself; `ApiClient.uploadDocumentCapture`
 * is the single network entry point and the server is the save boundary.
 */
import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';

export interface DocumentCaptureDialogProps {
  api: ApiClient;
  open: boolean;
  /** Called when the dialog should disappear (cancel, after success, close). */
  onClose: () => void;
  /** Called after the server accepted the capture so the list can refresh. */
  onUploaded?: (itemId: string) => void;
}

const ACCEPT = '.pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown';
const MAX_BYTES = 20 * 1024 * 1024;

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

/**
 * A safe, headless UUID-ish identifier for idempotency retries. Good enough
 * for client-side deduplication across retries of the same in-flight upload.
 */
function uuid(): string {
  // crypto.randomUUID is available in every browser the web app targets.
  // The `globalThis.crypto` guard keeps Node test environments happy.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function DocumentCaptureDialog({
  api,
  open,
  onClose,
  onUploaded
}: DocumentCaptureDialogProps) {
  const [fileState, setFileState] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef<string>('');

  // Reset when the dialog opens so a previous error / file doesn't leak.
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
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
      setError('File is too large. The maximum is 20 MB.');
      setFileState(null);
      return;
    }
    setError(null);
    setFileState(f);
    setTitle(defaultTitleFor(f.name));
    setPhase('idle');
    requestIdRef.current = uuid();
    // Clear the input value so picking the same file twice in a row
    // still re-emits a change event.
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
      const r = await api.uploadDocumentCapture(
        {
          file: fileState,
          title: title.trim() || defaultTitleFor(fileState.name),
          clientRequestId: requestIdRef.current || uuid()
        },
        token,
        (p) => {
          if (p === 'uploading') setPhase('uploading');
          else setPhase('finalizing');
        }
      );
      setPhase('saved');
      onUploaded?.(r.id);
    } catch (err) {
      setPhase('error');
      const code = (err as { code?: string })?.code;
      if (code === 'UNSUPPORTED_DOCUMENT_MIME') {
        setError('Unsupported file type. Please choose a PDF, TXT, or Markdown file.');
      } else if (code === 'DOCUMENT_TOO_LARGE') {
        setError('File is too large. The maximum is 20 MB.');
      } else if (code === 'NETWORK_ERROR') {
        setError('Upload failed. Check your connection and try again.');
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
      data-testid="document-capture-dialog"
    >
      <div
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Upload a document"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Upload document</h2>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          data-testid="document-file-input"
          onChange={handleFileChange}
          hidden
        />
        {!fileState ? (
          <button
            type="button"
            data-testid="document-pick-file"
            onClick={pickFile}
            disabled={phase === 'uploading' || phase === 'finalizing'}
          >
            Choose file…
          </button>
        ) : null}
        {error && !fileState ? (
          <p className="document-error" data-testid="document-error">
            {error}
          </p>
        ) : null}
        {fileState ? (
          <div data-testid="document-summary">
            <div className="document-summary-row">
              <span className="document-filename">{fileState.name}</span>
              <span className="document-filesize">{fmtBytes(fileState.size)}</span>
            </div>
            <label className="document-title-label">
              Title
              <input
                type="text"
                data-testid="document-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={phase === 'uploading' || phase === 'finalizing' || phase === 'saved'}
                maxLength={200}
              />
            </label>
            <div className="document-actions">
              <button
                type="button"
                className="ghost"
                data-testid="document-cancel"
                onClick={handleCancel}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="document-save"
                onClick={handleConfirm}
                disabled={
                  !title.trim() ||
                  phase === 'uploading' ||
                  phase === 'finalizing' ||
                  phase === 'saved'
                }
              >
                {phase === 'uploading' || phase === 'finalizing'
                  ? 'Uploading…'
                  : phase === 'saved'
                    ? 'Saved'
                    : 'Save to Mnemonics'}
              </button>
            </div>
            {error ? (
              <p className="document-error" data-testid="document-error">
                {error}
              </p>
            ) : null}
            {phase === 'saved' ? (
              <p className="document-status" data-testid="document-status">
                Saved — processing document…
              </p>
            ) : null}
          </div>
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