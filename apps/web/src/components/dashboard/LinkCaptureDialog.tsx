import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';
import { extractPageMetadata, type ExtractedPage } from '../../lib/page-metadata';

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

/**
 * Fetch the URL, parse the HTML, and return an `ExtractedPage`
 * suitable for the API's `sourceMetadata` field. Returns
 * `undefined` on any failure (CORS, offline, parser error) so
 * the dialog save never blocks on metadata.
 */
async function safeExtractMetadata(url: string): Promise<ExtractedPage | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let html = '';
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal
      });
      if (!res.ok) return undefined;
      const raw = await res.text();
      html = raw.length > 400_000 ? raw.slice(0, 400_000) : raw;
    } finally {
      clearTimeout(timer);
    }
    if (!html) return undefined;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return await extractPageMetadata(doc, url);
  } catch (_) {
    return undefined;
  }
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
      // M1: best-effort extract of OG / JSON-LD metadata from
      // the page the user typed the URL into. We never block the
      // save on this — failure leaves sourceMetadata undefined.
      const sourceMetadata = await safeExtractMetadata(trimmed);
      const r = await api.createLinkCapture(
        {
          url: trimmed,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          clientRequestId: requestIdRef,
          ...(sourceMetadata ? { sourceMetadata } : {})
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
