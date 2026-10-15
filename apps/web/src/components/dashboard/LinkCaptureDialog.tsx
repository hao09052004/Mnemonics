import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';
import { extractPageMetadata, type ExtractedPage } from '../../lib/page-metadata';
import { extractSmartTags } from '../../lib/smart-tags';
import { useLocale } from '../../lib/locale';

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
  const { t, locale } = useLocale();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useState<string>('')[0] || uuid();

  const smartTags = useMemo(() => {
    const combined = (title + ' ' + note + ' ' + url).trim();
    return extractSmartTags(combined, 'link');
  }, [title, note, url]);

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
        className="capture-sheet capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('dialog_link_title', 'Save a link')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-header-left">
            <div className="dialog-icon-badge dialog-icon-badge--link">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <h2>{t('dialog_link_title', 'Save a link')}</h2>
              <p className="dialog-sub">{t('dialog_link_sub', 'Lưu trang web, bài viết hoặc tài liệu trực tuyến.')}</p>
            </div>
          </div>
          <button type="button" className="dialog-close-btn" onClick={handleCancel} aria-label={t('btn_close', 'Close')}>
            ✕
          </button>
        </div>

        <label className="document-title-label">
          <span>{t('dialog_link_url_label', 'Đường dẫn (URL)')}</span>
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
          <span>{t('dialog_link_title_label', 'Tiêu đề (không bắt buộc)')}</span>
          <input
            type="text"
            data-testid="link-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            maxLength={200}
            placeholder={t('dialog_link_title_placeholder', 'Tự động trích xuất nếu để trống...')}
          />
        </label>
        <label className="document-title-label">
          <span>{t('dialog_link_note_label', 'Ghi chú thêm (không bắt buộc)')}</span>
          <textarea
            data-testid="link-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
            maxLength={2000}
            rows={3}
            placeholder={t('dialog_link_note_placeholder', 'Thêm tóm tắt hoặc lý do bạn lưu liên kết này...')}
          />
        </label>

        <div className="smart-tags-preview" style={{ marginTop: 6, marginBottom: 8, padding: '10px 14px', background: 'var(--purple-soft, rgba(91,63,228,0.08))', borderRadius: 8, border: '1px solid rgba(91,63,228,0.18)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', color: 'var(--purple, #5B3FE4)', textTransform: 'uppercase', marginBottom: 6 }}>
            ★ {locale === 'vi' ? 'Smart Tags (Tự động gợi ý)' : 'Smart Tags (Auto suggested)'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {smartTags.map((tag) => (
              <span key={tag} style={{ background: 'var(--surface, #1e222b)', color: 'var(--purple-text, #a78bfa)', fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 14, border: '1px solid rgba(167,139,250,0.25)' }}>
                #{tag}
              </span>
            ))}
          </div>
        </div>
        {error ? (
          <p className="document-error" data-testid="link-error">
            <span>⚠️</span> {error}
          </p>
        ) : null}
        {phase === 'saved' ? (
          <p className="document-status" data-testid="link-status">
            <span>✓</span> {t('dialog_link_saved_proc', 'Saved — processing…')}
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
            {t('btn_cancel', 'Cancel')}
          </button>
          <button
            type="button"
            data-testid="link-save"
            onClick={handleSave}
            disabled={!url.trim() || disabled}
          >
            {phase === 'saving' ? t('status_saving', 'Saving…') : phase === 'saved' ? t('status_saved', 'Saved') : t('dialog_link_btn_save', 'Save link')}
          </button>
        </div>
      </div>
    </div>
  );
}
