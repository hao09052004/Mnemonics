import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { ClusterDetailView } from '../components/dashboard/ClusterDetailView';
import {
  ApiClient,
  type Item,
  type Session
} from '../lib/api-client';

interface ClusterDetailPageProps {
  api: ApiClient;
}

export function ClusterDetailPage({ api }: ClusterDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);

  useEffect(() => {
    setSession(api.loadStoredSession());
  }, [api]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listItems(session.accessToken, { limit: 200 });
        if (cancelled) return;
        setItems(res.items);
      } catch {
        // The detail view can still show cluster member ids without
        // full item rows; let it surface its own error if the
        // cluster itself fails to load.
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, session]);

  const onOpen = useCallback(
    (itemId: string) => {
      navigate(`/app/items/${encodeURIComponent(itemId)}`);
    },
    [navigate]
  );

  const onLogout = useCallback(() => {
    api.saveSession(null);
    setSession(null);
    navigate('/');
  }, [api, navigate]);

  if (!session) {
    return (
      <DashboardShell
        user={{ id: '', email: '', role: 'user', emailVerified: false, name: '' }}
        active="Groups"
        onNavigate={() => undefined}
        onCapture={() => undefined}
        onLogout={onLogout}
      >
        <main className="spaces-page" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      user={session.user}
      active="Groups"
      onNavigate={(p) => {
        if (p === 'Everything') navigate('/app');
        else if (p === 'Spaces') navigate('/app/spaces');
        else if (p === 'Favorites') navigate('/app/favorites');
        else if (p === 'Rediscover') navigate('/app/rediscover');
      }}
      onCapture={() => navigate('/app')}
      onLogout={onLogout}
    >
      <ClusterDetailView
        api={api}
        accessToken={session.accessToken}
        items={items}
        loadingItems={loadingItems}
        onOpenItem={onOpen}
      />
    </DashboardShell>
  );
}
