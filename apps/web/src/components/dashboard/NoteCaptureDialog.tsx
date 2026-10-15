import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../../lib/api-client';
import { extractSmartTags } from '../../lib/smart-tags';
import { useLocale } from '../../lib/locale';

export interface NoteCaptureDialogProps {
  api: ApiClient;
  open: boolean;
  onClose: () => void;
  /** Called after the server accepted the capture so the list can refresh. */
  onSaved?: (itemId: string) => void;
  mode?: 'note' | 'quote';
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
  onSaved,
  mode = 'note'
}: NoteCaptureDialogProps) {
  const { t, locale } = useLocale();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useState<string>('')[0] || uuid();

  const smartTags = useMemo(() => {
    const combined = (title + ' ' + content).trim();
    return extractSmartTags(combined, mode === 'quote' ? 'trích dẫn' : 'ghi chú');
  }, [title, content, mode]);

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
        className="capture-sheet capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'quote' ? t('dialog_note_quote_title', 'Save a quote') : t('dialog_note_quick_title', 'Save a quick note')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div className="dialog-header-left">
            <div className="dialog-icon-badge dialog-icon-badge--note">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {mode === 'quote' ? (
                  <>
                    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 1-1 2c0 1.25.75 2 2 2z" />
                    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 1-1 2c0 1.25.75 2 2 2z" />
                  </>
                ) : (
                  <>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </>
                )}
              </svg>
            </div>
            <div>
              <h2>{mode === 'quote' ? t('dialog_note_quote_title', 'Save Quote') : t('dialog_note_quick_title', 'Quick note')}</h2>
              <p className="dialog-sub">
                {mode === 'quote'
                  ? t('dialog_note_quote_sub', 'Lưu trích dẫn, câu nói tâm đắc vào Second Brain.')
                  : t('dialog_note_quick_sub', 'Lưu nhanh ý tưởng hoặc ghi chú vào Second Brain.')}
              </p>
            </div>
          </div>
          <button type="button" className="dialog-close-btn" onClick={handleCancel} aria-label={t('btn_close', 'Close')}>
            ✕
          </button>
        </div>

        <label className="document-title-label">
          <span>{mode === 'quote' ? t('dialog_note_author_label', 'Tác giả / Nguồn') : t('dialog_note_title_label', 'Tiêu đề')}</span>
          <input
            type="text"
            data-testid="note-title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={disabled}
            maxLength={200}
            placeholder={
              mode === 'quote'
                ? locale === 'vi'
                  ? 'Ví dụ: Steve Jobs, Sách Atomic Habits...'
                  : 'e.g. Steve Jobs, Atomic Habits...'
                : locale === 'vi'
                  ? 'Tiêu đề ngắn gọn cho ghi chú'
                  : 'A short title for the note'
            }
            autoFocus
          />
        </label>
        <label className="document-title-label">
          <span>{mode === 'quote' ? t('dialog_note_quote_label', 'Đoạn trích dẫn') : t('dialog_note_content_label', 'Nội dung ghi chú')}</span>
          <textarea
            data-testid="note-content-input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={disabled}
            maxLength={8000}
            rows={5}
            placeholder={
              mode === 'quote'
                ? locale === 'vi'
                  ? 'Dán hoặc viết đoạn trích dẫn tâm đắc...'
                  : 'Paste or type a memorable quote...'
                : locale === 'vi'
                  ? 'Viết nội dung ghi chú. Hỗ trợ tiếng Việt và Unicode.'
                  : 'Write the note. Vietnamese and Unicode are supported.'
            }
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
          <p className="document-error" data-testid="note-error">
            <span>⚠️</span> {error}
          </p>
        ) : null}
        {phase === 'saved' ? (
          <p className="document-status" data-testid="note-status">
            <span>✓</span> {t('dialog_note_saved_proc', 'Saved — processing…')}
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
            {t('btn_cancel', 'Cancel')}
          </button>
          <button
            type="button"
            data-testid="note-save"
            onClick={handleSave}
            disabled={(!title.trim() && !content.trim()) || disabled}
          >
            {phase === 'saving' ? t('status_saving', 'Saving…') : phase === 'saved' ? t('status_saved', 'Saved') : (mode === 'quote' ? t('dialog_note_save_quote', 'Save quote') : t('dialog_note_save_note', 'Save note'))}
          </button>
        </div>
      </div>
    </div>
  );
}
