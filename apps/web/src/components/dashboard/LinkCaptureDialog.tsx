import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';

export interface LinkCaptureDialogProps {
  api: ApiClient;
  open: boolean;
  onClose: () => void;
  /** Called after the server accepted the capture so the list can refresh. */
  onSaved?: (itemId: string) => void;
}

type Phase = 'idle' | 'saving' | 'saved' | 'error';

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function LinkCaptureDialog({
  api,
  open,
  onClose,
  onSaved
}: LinkCaptureDialogProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useState<string>('')[0] || uuid();

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
      setUrl('');
      setTitle('');
      setNote('');
    }
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = url.trim();
    if (!isValidUrl(trimmed)) {
      setPhase('error');
      setError('Please enter a valid http:// or https:// URL.');
      return;
    }
    setPhase('saving');
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setPhase('error');
        setError('Session expired. Please sign in again.');
        return;
      }
      const r = await api.createLinkCapture(
        {
          url: trimmed,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          clientRequestId: requestIdRef
        },
        token
      );
      setPhase('saved');
      onSaved?.(r.id);
    } catch (err) {
      setPhase('error');
      if (err instanceof Error) {
        setError(err.message || 'Could not save the link.');
      } else {
        setError('Could not save the link.');
      }
    }
  }

  function handleCancel() {
    if (phase === 'saving') return;
    onClose();
  }

  const disabled = phase === 'saving' || phase === 'saved';

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={handleCancel}
      data-testid="link-capture-dialog"
    >
      <div
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Save a link"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Save a link</h2>
        <label className="document-title-label">
          URL
          <input
            type="url"
            data-testid="link-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            disabled={disabled}
            autoFocus
          />
        </label>
        <label className="document-title-label">
          Title (optional)
          <input
            type="text"
            data-testid="link-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            maxLength={200}
          />
        </label>
        <label className="document-title-label">
          Note (optional)
          <textarea
            data-testid="link-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
            maxLength={2000}
            rows={3}
          />
        </label>
        {error ? (
          <p className="document-error" data-testid="link-error">
            {error}
          </p>
        ) : null}
        {phase === 'saved' ? (
          <p className="document-status" data-testid="link-status">
            Saved — processing…
          </p>
        ) : null}
        <div className="document-actions">
          <button
            type="button"
            className="ghost"
            data-testid="link-cancel"
            onClick={handleCancel}
            disabled={disabled}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="link-save"
            onClick={handleSave}
            disabled={!url.trim() || disabled}
          >
            {phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved' : 'Save link'}
          </button>
        </div>
      </div>
    </div>
  );
}
