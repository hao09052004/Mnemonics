import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { Icon } from '../components/dashboard/Icons';
import {
  ApiClient,
  type Session,
  type SpaceWithCount,
  type SpaceSuggestion,
} from '../lib/api-client';

interface SpacesPageProps {
  api: ApiClient;
}

export function SpacesPage({ api }: SpacesPageProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [spaces, setSpaces] = useState<SpaceWithCount[]>([]);
  const [suggestions, setSuggestions] = useState<SpaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (stored) setSession(stored);
  }, [api]);

  const loadAll = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const token = await api.getValidAccessToken();
      if (!token) return;
      const [list, sugs] = await Promise.all([
        api.listSpaces(token),
        api.listSuggestions(token).catch(() => []),
      ]);
      setSpaces(list);
      setSuggestions(sugs);
    } finally {
      setLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    if (session) loadAll();
  }, [session, loadAll]);

  const handleAccept = useCallback(
    async (id: string) => {
      if (!session) return;
      const token = await api.getValidAccessToken();
      if (!token) return;
      await api.acceptSuggestion(id, token);
      await loadAll();
    },
    [api, session, loadAll]
  );

  if (!session) return null;

  return (
    <DashboardShell
      user={session.user}
      active="Spaces"
      onNavigate={(p) => {
        if (p === 'Everything') navigate('/app');
        else if (p === 'Rediscover') navigate('/app/rediscover');
      }}
      onCapture={() => undefined}
      onLogout={() => {
        api.saveSession(null);
        setSession(null);
        navigate('/');
      }}
      demoMode={false}
    >
      <main className="main standard">
        <header className="page-header">
          <div>
            <span className="eyebrow">YOUR COLLECTIONS</span>
            <h1>Spaces</h1>
            <p>Bring related memories together.</p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => navigate('/app/spaces/new')}
            data-testid="new-space-btn"
          >
            <Icon name="plus" size={16} /> New Space
          </button>
        </header>

        <section>
          <div className="dashboard-heading" style={{ marginBottom: 12 }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>My Spaces</h1>
            <span className="memory-count">{spaces.length}</span>
          </div>
          {loading && spaces.length === 0 ? (
            <p>Loading…</p>
          ) : spaces.length === 0 ? (
            <p style={{ color: 'var(--secondary)' }}>No spaces yet.</p>
          ) : (
            <div className="spaces-grid">
              {spaces.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="space-card"
                  onClick={() => navigate(`/app/spaces/${s.id}`)}
                >
                  <div className="collage" aria-hidden="true">
                    <Icon name="file" />
                  </div>
                  <h3 style={{ margin: '6px 0', fontSize: 15 }}>
                    {s.name}
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: 'var(--secondary)',
                    }}
                  >
                    {s.itemCount} memories
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: 56 }}>
          <span className="eyebrow">SUGGESTED</span>
          {suggestions.length === 0 ? (
            <p style={{ marginTop: 8, color: 'var(--secondary)' }}>
              No suggestions right now.
            </p>
          ) : (
            <div className="spaces-grid" style={{ marginTop: 12 }}>
              {suggestions.map((sg) => (
                <article key={sg.id} className="space-card">
                  <h3 style={{ margin: '6px 0', fontSize: 15 }}>
                    {sg.suggestedName}
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: 'var(--secondary)',
                    }}
                  >
                    {sg.suggestedDescription}
                  </p>
                  <button
                    type="button"
                    className="primary"
                    style={{ marginTop: 12 }}
                    onClick={() => handleAccept(sg.id)}
                  >
                    Create Space
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </DashboardShell>
  );
}