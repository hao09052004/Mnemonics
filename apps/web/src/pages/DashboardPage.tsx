import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import {
  CaptureSheet,
  type CaptureAction,
} from '../components/dashboard/CaptureSheet';
import { LoginForm } from '../components/LoginForm';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';
import {
  ApiClient,
  type Item,
  type Session,
} from '../lib/api-client';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';
import type { MemoryLabel } from '../lib/memory-kind';
import type { DashboardPage as DashboardPageName } from '../components/dashboard/DashboardTopNav';

interface DashboardPageProps {
  api: ApiClient;
}

export function DashboardPage({ api }: DashboardPageProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<MemoryLabel | 'all'>('all');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [authView, setAuthView] = useState<'login' | 'forgot'>('login');
  const epoch = useRef(0);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (!stored) return;
    setSession(stored);
  }, [api]);

  const loadList = useCallback(async () => {
    if (!session) return;
    const e = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setError('TOKEN_EXPIRED');
        return;
      }
      const r = await api.listItems(token, { limit: 50 });
      if (e !== epoch.current) return;
      setItems(r.items);
      setSearchHits(null);
    } catch (err) {
      if (e !== epoch.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load items');
    } finally {
      if (e === epoch.current) setLoading(false);
    }
  }, [api, session]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!session) return;
      const e = ++epoch.current;
      setLoading(true);
      setError(null);
      try {
        const token = await api.getValidAccessToken();
        if (!token) {
          setError('TOKEN_EXPIRED');
          return;
        }
        const r = await api.search({ q, limit: 50 }, token);
        if (e !== epoch.current) return;
        setSearchHits(r.hits);
      } catch (err) {
        if (e !== epoch.current) return;
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (e === epoch.current) setLoading(false);
      }
    },
    [api, session]
  );

  useEffect(() => {
    if (session && !query) loadList();
  }, [session, query, loadList]);

  const visible: MemoryCardItem[] = (searchHits ?? items).map((it) => ({
    id: String(it.id),
    kind: it.kind,
    title: it.title,
    snippet: it.snippet,
    source_url: it.source_url,
    image_url: it.image_url,
    tags: it.tags,
    captured_at: it.captured_at,
    status: it.status,
  }));

  const handleNavigate = (page: DashboardPageName) => {
    if (page === 'Everything') navigate('/app');
    else if (page === 'Spaces') navigate('/app/spaces');
    else if (page === 'Rediscover') navigate('/app/rediscover');
    else if (page === 'Reminders') navigate('/app/reminders');
    else if (page === 'Settings') navigate('/app/settings');
    else if (page === 'Favorites') {
      // The new dashboard surfaces favorites via a chip filter, not a
      // separate top-nav destination. No-op keeps the contract honest.
    }
  };

  const handleCaptureAction = (a: CaptureAction) => {
    // Minimal: open the dashboard quick-note flow. Real capture flows
    // (image upload, link pasting) reuse the existing routes; here we
    // just reset the query so the user sees the new card.
    if (a === 'note' || a === 'link') {
      setQuery('');
      setSearchHits(null);
    }
  };

  if (!session) {
    if (authView === 'forgot') {
      return (
        <ForgotPasswordForm
          api={api}
          onCancel={() => setAuthView('login')}
          onResetRequested={() => undefined}
        />
      );
    }
    return (
      <LoginForm
        api={api}
        onLogin={(s) => {
          setSession(s);
          api.saveSession(s);
        }}
        onForgotPassword={() => setAuthView('forgot')}
      />
    );
  }

  return (
    <DashboardShell
      user={session.user}
      active="Everything"
      onNavigate={handleNavigate}
      onCapture={() => setCaptureOpen(true)}
      onLogout={() => {
        api.saveSession(null);
        setSession(null);
        navigate('/');
      }}
      demoMode={import.meta.env.VITE_DEMO_MODE === 'true'}
    >
      <EverythingView
        items={visible}
        loading={loading}
        error={error}
        query={query}
        onQueryChange={setQuery}
        onSearch={runSearch}
        filter={filter}
        onFilterChange={setFilter}
        onOpen={() => undefined}
        onCapture={() => setCaptureOpen(true)}
      />
      <CaptureSheet
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onAction={handleCaptureAction}
      />
    </DashboardShell>
  );
}