import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';
import { ApiClient, type Item, type Session } from '../lib/api-client';
import { LoginForm } from '../components/LoginForm';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';

interface FavoritesPageProps {
  api: ApiClient;
}

/**
 * The Favorites tab.
 *
 * Mirrors the extension's `?favorite=true` server-side filter so a
 * memory favorited last month still shows up here even if it has
 * fallen out of the recent 50-row window. The heart on each card is
 * the same PATCH the dashboard uses everywhere else.
 *
 * Why a dedicated page (and not a chip filter on Everything):
 *   - Spec §dashboard-extension §7.0 calls out the same blind-spot
 *     for the extension; web must not regress on it.
 *   - A separate route keeps the URL shareable and the back button
 *     useful, matching the Spaces / Rediscover pattern.
 */
export function FavoritesPage({ api }: FavoritesPageProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoritingIds, setFavoritingIds] = useState<ReadonlySet<string>>(new Set());
  const [authView, setAuthView] = useState<'login' | 'forgot'>('login');

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (stored) setSession(stored);
  }, [api]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        console.warn('[FavoritesPage] no access token — session expired');
        setError('Your session has expired. Please sign in again.');
        return;
      }
      // Server-side filter — see `apps/api/src/routes/items.ts` line 79.
      const r = await api.listItems(token, { limit: 100, favorite: true });
      console.log('[FavoritesPage] loaded', r.items.length, 'favorites, total=', r.total);
      setItems(r.items);
    } catch (err) {
      console.error('[FavoritesPage] load failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load favorites');
    } finally {
      setLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const handleToggleFavorite = useCallback(
    async (id: string) => {
      if (favoritingIds.has(id)) return;
      const current = items.find((it) => String(it.id) === id);
      if (!current) return;
      const next = !current.is_favorite;

      // Optimistic: drop the card from this filtered list immediately
      // when un-favoriting, keep it when re-favoriting.
      setItems((prev) =>
        next ? prev : prev.filter((it) => String(it.id) !== id)
      );
      setFavoritingIds((prev) => new Set(prev).add(id));
      try {
        const token = await api.getValidAccessToken();
        if (!token) throw new Error('Session expired');
        await api.updateItem(id, { isFavorite: next }, token);
        if (next) {
          // Re-favoriting keeps the card in the list, but the row we
          // filtered out earlier was just re-added by the user, so no
          // refetch is needed — `next === true` keeps it visible.
        }
      } catch (err) {
        // Roll back the optimistic removal so the UI never lies.
        if (!next) {
          setItems((prev) =>
            prev.some((it) => String(it.id) === id)
              ? prev
              : [...prev, current]
          );
        }
        setError(err instanceof Error ? err.message : 'Failed to update favorite');
      } finally {
        setFavoritingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [api, favoritingIds, items]
  );

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

  const visible: MemoryCardItem[] = items.map((it) => ({
    id: String(it.id),
    kind: it.kind,
    title: it.title,
    snippet: it.snippet ?? it.raw_text ?? it.ocr_text ?? '',
    source_url: it.source_url,
    image_url: it.image_url,
    tags: it.tags,
    captured_at: it.captured_at,
    status: it.status,
    is_favorite: it.is_favorite,
  }));

  return (
    <DashboardShell
      user={session.user}
      active="Favorites"
      onNavigate={(p) => {
        if (p === 'Everything') navigate('/app');
        else if (p === 'Spaces') navigate('/app/spaces');
        else if (p === 'Rediscover') navigate('/app/rediscover');
        else if (p === 'Reminders') navigate('/app/reminders');
        else if (p === 'Settings') navigate('/app/settings');
        // 'Favorites' is the current page — no-op.
      }}
      onCapture={() => navigate('/app')}
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
        query=""
        onQueryChange={() => undefined}
        onSearch={async () => undefined}
        filter="all"
        onFilterChange={() => undefined}
        onOpen={() => undefined}
        onCapture={() => navigate('/app')}
        onDelete={async (id) => {
          try {
            const token = await api.getValidAccessToken();
            if (!token) return;
            await api.deleteItem(id, token);
            setItems((prev) => prev.filter((it) => String(it.id) !== id));
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete');
          }
        }}
        deletingIds={new Set()}
        onToggleFavorite={handleToggleFavorite}
        favoritingIds={favoritingIds}
        emptyState={{
          title: 'No favorites yet.',
          text: 'Tap the heart on any memory to save it here.',
          action: { label: 'Browse everything', onClick: () => navigate('/app') }
        }}
      />
    </DashboardShell>
  );
}