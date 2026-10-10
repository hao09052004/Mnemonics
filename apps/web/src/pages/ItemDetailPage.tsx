import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import type { ApiClient, ItemDetail } from '../lib/api-client';

interface ItemDetailPageProps {
  api: ApiClient;
}

export function ItemDetailPage({ api }: ItemDetailPageProps) {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (!id) {
    return <p>Missing item id.</p>;
  }

  if (loading) {
    return (
      <div className="mnemonics-app-root">
        <p style={{ padding: 24 }}>Loading…</p>
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
            Back to dashboard
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
        else if (page === 'Spaces') navigate('/app/spaces');
        else if (page === 'Groups') navigate('/app/clusters');
      }}
      onCapture={() => navigate('/app')}
      onLogout={() => navigate('/')}
      demoMode={import.meta.env.VITE_DEMO_MODE === 'true'}
    >
      <div className="item-detail-page" data-testid="item-detail-page">
        <button
          type="button"
          className="ghost item-detail-back"
          onClick={() => navigate(-1)}
          data-testid="item-detail-back"
        >
          ← Back
        </button>
        <header className="item-detail-header">
          <span className={`item-kind-pill item-kind-pill--${item.kind}`}>
            {item.kind}
          </span>
          <h1 data-testid="item-detail-title">{item.title || 'Untitled'}</h1>
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
            Saved {captured.toLocaleString()} · status: {item.status}
          </p>
        </header>

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
            <h2>Content</h2>
            <pre className="item-detail-raw">{item.raw_text}</pre>
          </section>
        ) : null}

        {item.ocr_text ? (
          <section className="item-detail-section" data-testid="item-detail-ocr">
            <h2>OCR text</h2>
            <pre className="item-detail-raw">{item.ocr_text}</pre>
          </section>
        ) : null}

        {item.tags && item.tags.length > 0 ? (
          <section className="item-detail-section" data-testid="item-detail-tags">
            <h2>Tags</h2>
            <ul className="item-detail-tags">
              {item.tags.map((t) => (
                <li key={t} className="item-detail-tag">
                  #{t}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="item-detail-actions">
          {item.source_url ? (
            <a
              className="ghost"
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open original
            </a>
          ) : null}
          <button
            type="button"
            className="ghost danger"
            onClick={async () => {
              if (!window.confirm(`Delete "${item.title || 'this memory'}"?`)) return;
              const token = await api.getValidAccessToken();
              if (!token) return;
              await api.deleteItem(item.id, token);
              navigate('/app');
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}
