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
import { useLocale } from '../../lib/locale';

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
  const { t } = useLocale();
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
        className="capture-sheet capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Upload a document"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-header-left">
            <div className="dialog-icon-badge dialog-icon-badge--doc">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
            </div>
            <div>
              <h2>{t('dialog_doc_title', 'Upload document')}</h2>
              <p className="dialog-sub">{t('dialog_doc_sub', 'Tải lên tài liệu PDF, DOCX hoặc văn bản để lập chỉ mục.')}</p>
            </div>
          </div>
          <button type="button" className="dialog-close-btn" onClick={handleCancel} aria-label={t('dialog_doc_close', 'Close')}>
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          data-testid="document-file-input"
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
              data-testid="document-pick-file"
              onClick={(e) => {
                e.stopPropagation();
                pickFile();
              }}
              disabled={phase === 'uploading' || phase === 'finalizing'}
            >
              {t('dialog_doc_choose', 'Choose file…')}
            </button>
            <p className="dropzone-hint">
              {t('dialog_doc_drop_hint', 'Kéo thả hoặc bấm để chọn tệp tài liệu')}
            </p>
            <p className="dropzone-sub">
              {t('dialog_doc_drop_sub', 'Hỗ trợ PDF, DOCX, TXT (tối đa 20 MB). Tự động phân tích nội dung văn bản.')}
            </p>
          </div>
        ) : null}

        {error && !fileState ? (
          <p className="document-error" data-testid="document-error">
            <span>⚠️</span> {error}
          </p>
        ) : null}

        {fileState ? (
          <div data-testid="document-summary" className="file-summary-container">
            <div className="document-summary-row">
              <span className="document-filename">{fileState.name}</span>
              <span className="document-filesize">{fmtBytes(fileState.size)}</span>
              <button
                type="button"
                className="file-change-btn"
                onClick={pickFile}
                disabled={phase === 'uploading' || phase === 'finalizing'}
              >
                {t('dialog_doc_change', 'Đổi tệp')}
              </button>
            </div>

            <label className="document-title-label">
              <span>{t('dialog_doc_title_label', 'Tiêu đề')}</span>
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
                {t('btn_cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
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
                  ? t('status_saving', 'Uploading…')
                  : phase === 'saved'
                    ? t('status_saved', 'Saved')
                    : t('dialog_doc_save_btn', 'Save to Mnemonics')}
              </button>
            </div>
            {error ? (
              <p className="document-error" data-testid="document-error">
                <span>⚠️</span> {error}
              </p>
            ) : null}
            {phase === 'saved' ? (
              <p className="document-status" data-testid="document-status">
                <span>✓</span> {t('dialog_doc_saved_status', 'Saved — processing document…')}
              </p>
            ) : null}
          </div>
        ) : null}

        {!fileState && (
          <div className="document-actions" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="ghost document-close"
              onClick={handleCancel}
              disabled={phase === 'uploading' || phase === 'finalizing'}
            >
              {t('dialog_doc_close', 'Close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}