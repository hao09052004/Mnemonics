import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { Icon } from '../components/dashboard/Icons';
import type { ApiClient, ItemDetail } from '../lib/api-client';
import { useLocale } from '../lib/locale';

interface ItemDetailPageProps {
  api: ApiClient;
}

export function ItemDetailPage({ api }: ItemDetailPageProps) {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [favoriting, setFavoriting] = useState(false);

  const id = params.id;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setError('TOKEN_EXPIRED');
        return;
      }
      const r = await api.getItem(id, token);
      setItem(r);
      setNotes(r.notes || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory');
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useEffect(() => {
    if (!id) return;
    void load();
  }, [id, load]);

  const handleToggleFavorite = async () => {
    if (!item || favoriting) return;
    const next = !item.is_favorite;
    setFavoriting(true);
    setItem((prev) => (prev ? { ...prev, is_favorite: next } : prev));
    try {
      const token = await api.getValidAccessToken();
      if (token) {
        await api.updateItem(item.id, { isFavorite: next }, token);
      }
    } catch {
      setItem((prev) => (prev ? { ...prev, is_favorite: !next } : prev));
    } finally {
      setFavoriting(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!item || notesSaving) return;
    setNotesSaving(true);
    setNotesSaved(false);
    try {
      const token = await api.getValidAccessToken();
      if (token) {
        await api.updateItem(item.id, { notes }, token);
        setItem((prev) => (prev ? { ...prev, notes } : prev));
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 2500);
      }
    } finally {
      setNotesSaving(false);
    }
  };

  if (!id) {
    return <p>Missing item id.</p>;
  }

  if (loading) {
    return (
      <div className="mnemonics-app-root">
        <p style={{ padding: 24 }}>{t('status_loading', 'Loading…')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mnemonics-app-root">
        <div className="dashboard-error" style={{ padding: 24 }}>
          <h1>Could not open this memory.</h1>
          <p>{error}</p>
          <button
            type="button"
            className="ghost"
            onClick={() => navigate('/app')}
          >
            {locale === 'vi' ? 'Về trang chủ' : 'Back to dashboard'}
          </button>
        </div>
      </div>
    );
  }

  if (!item) return null;

  const captured = new Date(item.captured_at);
  const subtitle = item.kind === 'link' && item.source_url ? item.source_url : '';

  return (
    <DashboardShell
      user={{ id: 'self', email: '', name: '', role: 'authenticated', emailVerified: true }}
      active="Everything"
      onNavigate={(page) => {
        if (page === 'Everything') navigate('/app');
        else if (page === 'Favorites') navigate('/app/favorites');
        else if (page === 'Spaces') navigate('/app/spaces');
        else if (page === 'Groups') navigate('/app/clusters');
        else if (page === 'Rediscover') navigate('/app/rediscover');
        else if (page === 'Reminders') navigate('/app/reminders');
      }}
      onCapture={() => navigate('/app')}
      onLogout={() => navigate('/')}
      demoMode={import.meta.env.VITE_DEMO_MODE === 'true'}
    >
      <div className="item-detail-page" data-testid="item-detail-page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            className="ghost item-detail-back"
            onClick={() => navigate(-1)}
            data-testid="item-detail-back"
          >
            {t('detail_back', '← Back')}
          </button>
          <button
            type="button"
            className={`ghost ${item.is_favorite ? 'is-favorite' : ''}`}
            onClick={handleToggleFavorite}
            disabled={favoriting}
            title={item.is_favorite ? (locale === 'vi' ? 'Bỏ yêu thích' : 'Remove favorite') : (locale === 'vi' ? 'Yêu thích' : 'Favorite')}
            aria-label={item.is_favorite ? (locale === 'vi' ? 'Bỏ yêu thích' : 'Remove favorite') : (locale === 'vi' ? 'Yêu thích' : 'Favorite')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: item.is_favorite ? 'var(--purple)' : undefined }}
          >
            <Icon name="heart" size={16} filled={item.is_favorite === true} />
            <span>{item.is_favorite ? t('detail_favorited', 'Favorited') : t('detail_favorite', 'Favorite')}</span>
          </button>
        </div>

        <header className="item-detail-header">
          <span className={`item-kind-pill item-kind-pill--${item.kind}`}>
            {item.kind}
          </span>
          <h1 data-testid="item-detail-title">{item.title || t('detail_untitled', 'Untitled')}</h1>
          {subtitle ? (
            <a
              className="item-detail-source"
              href={subtitle}
              target="_blank"
              rel="noopener noreferrer"
            >
              {subtitle}
            </a>
          ) : null}
          <p className="item-detail-meta">
            {locale === 'vi' ? 'Đã lưu ' : 'Saved '}
            {captured.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')} · status: {item.status}
          </p>
        </header>

        {item.snippet ? (
          <section className="item-detail-section item-detail-section--tldr" data-testid="item-detail-tldr" style={{ background: 'var(--mn-surface-2, rgba(255,255,255,0.03))', padding: '16px 20px', borderRadius: 12, border: '1px solid var(--mn-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--mn-text-2)', margin: 0 }}>{t('detail_tldr_title', 'TL;DR · Tóm tắt AI')}</h2>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(item.snippet || '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={13} />
                <span>{copied ? t('detail_copied', 'Đã sao chép') : t('detail_copy', 'Sao chép')}</span>
              </button>
            </div>
            <p style={{ marginTop: 10, marginBottom: 0, lineHeight: 1.6, color: 'var(--mn-text-1)', fontSize: 14 }}>
              {item.snippet}
            </p>
          </section>
        ) : null}

        {item.image_url ? (
          <img
            className="item-detail-image"
            src={item.image_url}
            alt={item.title}
            data-testid="item-detail-image"
          />
        ) : null}

        {item.raw_text ? (
          <section className="item-detail-section" data-testid="item-detail-raw">
            <h2>{t('detail_content', 'Content')}</h2>
            <pre className="item-detail-raw">{item.raw_text}</pre>
          </section>
        ) : null}

        {item.ocr_text ? (
          <section className="item-detail-section" data-testid="item-detail-ocr">
            <h2>{t('detail_ocr_text', 'OCR text')}</h2>
            <pre className="item-detail-raw">{item.ocr_text}</pre>
          </section>
        ) : null}

        {item.tags && item.tags.length > 0 ? (
          <section className="item-detail-section" data-testid="item-detail-tags">
            <h2>{t('detail_tags', 'Tags')}</h2>
            <ul className="item-detail-tags">
              {item.tags.map((t) => (
                <li key={t} className="item-detail-tag">
                  #{t}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="item-detail-section" data-testid="item-detail-notes">
          <h2>{t('detail_personal_notes', 'Ghi chú cá nhân')}</h2>
          <textarea
            className="item-detail-raw"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t('detail_notes_placeholder', 'Thêm ghi chú cá nhân của bạn cho ký ức này...')}
            style={{ width: '100%', resize: 'vertical', marginTop: 8, fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="btn-primary"
              disabled={notesSaving}
              onClick={handleSaveNotes}
              style={{ padding: '7px 16px', fontSize: 13, borderRadius: 6, cursor: 'pointer' }}
            >
              {notesSaving ? t('detail_saving_notes', 'Đang lưu…') : t('detail_save_notes', 'Lưu ghi chú')}
            </button>
            {notesSaved && <span style={{ color: 'var(--accent)', fontSize: 12 }}>✓ {t('detail_saved_notes', 'Đã lưu')}</span>}
          </div>
        </section>

        <div className="item-detail-actions">
          {item.source_url ? (
            <a
              className="ghost"
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('detail_open_original', 'Open original')}
            </a>
          ) : null}
          <button
            type="button"
            className="ghost danger"
            onClick={async () => {
              const label = item.title || (locale === 'vi' ? 'ghi nhớ này' : 'this memory');
              const confirmMsg = locale === 'vi' ? `Xóa "${label}"?` : `Delete "${label}"?`;
              if (!window.confirm(confirmMsg)) return;
              const token = await api.getValidAccessToken();
              if (!token) return;
              await api.deleteItem(item.id, token);
              navigate('/app');
            }}
          >
            {t('btn_delete', 'Delete')}
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}
