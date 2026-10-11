import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';

export interface NoteCaptureDialogProps {
  api: ApiClient;
  open: boolean;
  onClose: () => void;
  /** Called after the server accepted the capture so the list can refresh. */
  onSaved?: (itemId: string) => void;
}

type Phase = 'idle' | 'saving' | 'saved' | 'error';

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function NoteCaptureDialog({
  api,
  open,
  onClose,
  onSaved
}: NoteCaptureDialogProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useState<string>('')[0] || uuid();

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
      setTitle('');
      setContent('');
    }
  }, [open]);

  if (!open) return null;

  async function handleSave() {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle && !trimmedContent) {
      setPhase('error');
      setError('Please add a title or some content.');
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
      const r = await api.createNoteCapture(
        {
          title: trimmedTitle || trimmedContent.slice(0, 80),
          content: trimmedContent,
          clientRequestId: requestIdRef
        },
        token
      );
      setPhase('saved');
      onSaved?.(r.id);
    } catch (err) {
      setPhase('error');
      if (err instanceof Error) {
        setError(err.message || 'Could not save the note.');
      } else {
        setError('Could not save the note.');
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
      data-testid="note-capture-dialog"
    >
      <div
        className="capture-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Save a quick note"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Quick note</h2>
        <label className="document-title-label">
          Title
          <input
            type="text"
            data-testid="note-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            maxLength={200}
            placeholder="A short title for the note"
            autoFocus
          />
        </label>
        <label className="document-title-label">
          Content
          <textarea
            data-testid="note-content-input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={disabled}
            maxLength={8000}
            rows={6}
            placeholder="Write the note. Vietnamese and Unicode are supported."
          />
        </label>
        {error ? (
          <p className="document-error" data-testid="note-error">
            {error}
          </p>
        ) : null}
        {phase === 'saved' ? (
          <p className="document-status" data-testid="note-status">
            Saved — processing…
          </p>
        ) : null}
        <div className="document-actions">
          <button
            type="button"
            className="ghost"
            data-testid="note-cancel"
            onClick={handleCancel}
            disabled={disabled}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="note-save"
            onClick={handleSave}
            disabled={(!title.trim() && !content.trim()) || disabled}
          >
            {phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}
