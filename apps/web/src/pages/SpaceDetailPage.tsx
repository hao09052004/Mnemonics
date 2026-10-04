import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import {
  ApiClient,
  type ItemDetail,
  type Session,
} from '../lib/api-client';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';

interface SpaceDetailPageProps {
  api: ApiClient;
}

export function SpaceDetailPage({ api }: SpaceDetailPageProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<MemoryCardItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (stored) setSession(stored);
  }, [api]);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    try {
      const token = await api.getValidAccessToken();
      if (!token) return;
      const { ids } = await api.listSpaceItems(id, token);
      const fetched = await Promise.all(
        ids.map((iid) => api.getItem(iid, token).catch(() => null))
      );
      const present = fetched.filter((x): x is ItemDetail => x !== null);
      setItems(
        present.map((it) => ({
          id: String(it.id),
          kind: it.kind,
          title: it.title,
          snippet: it.raw_text ?? it.snippet ?? '',
          source_url: it.source_url,
          image_url: it.image_url,
          tags: it.tags,
          captured_at: it.captured_at,
          status: it.status,
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [api, session, id]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!session) return null;

  return (
    <DashboardShell
      user={session.user}
      active="Spaces"
      onNavigate={(p) => {
        if (p === 'Everything') navigate('/app');
        else if (p === 'Spaces') navigate('/app/spaces');
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
      <EverythingView
        items={items}
        loading={loading}
        error={null}
        query=""
        onQueryChange={() => undefined}
        onSearch={undefined}
        filter="all"
        onFilterChange={() => undefined}
        onOpen={() => undefined}
        onCapture={() => undefined}
      />
    </DashboardShell>
  );
}