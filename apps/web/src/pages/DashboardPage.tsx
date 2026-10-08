import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import {
  CaptureSheet,
  type CaptureAction,
} from '../components/dashboard/CaptureSheet';
import { DocumentCaptureDialog } from '../components/dashboard/DocumentCaptureDialog';
import { CreateSpaceDialog } from '../components/spaces/CreateSpaceDialog';
import { SpacePicker } from '../components/spaces/SpacePicker';
import { hasActiveCriteria, ruleFromView } from '../lib/space-rule';
import { LoginForm } from '../components/LoginForm';
import { ForgotPasswordForm } from '../components/ForgotPasswordForm';
import {
  ApiClient,
  type Item,
  type Session,
  type SpaceColor,
  type SpaceRule,
} from '../lib/api-client';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';
import { normalizeKind, type MemoryLabel } from '../lib/memory-kind';
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
  const [documentCaptureOpen, setDocumentCaptureOpen] = useState(false);
  const [authView, setAuthView] = useState<'login' | 'forgot'>('login');
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  const [favoritingIds, setFavoritingIds] = useState<ReadonlySet<string>>(new Set());
  const [spacePickerIds, setSpacePickerIds] = useState<string[] | null>(null);
  const [smartDialogOpen, setSmartDialogOpen] = useState(false);
  const [smartCreating, setSmartCreating] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);
  const epoch = useRef(0);

  /**
   * The criteria a Space would be built from right now. Derived rather
   * than stored so it can never drift from what the search actually ran.
   */
  const currentRule = useMemo(() => ruleFromView(query, filter), [query, filter]);
  const canSaveAsSpace = hasActiveCriteria(currentRule);

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

  /**
   * Delete a memory. Confirms first (destructive + irreversible, so we
   * never fire it on a single stray click), calls `DELETE /items/:id`,
   * then drops the row from local state so the card disappears without
   * a refetch. The BE deletes the item and every child row
   * (enrichments, embeddings, tags, assets, jobs) in one transaction.
   */
  const handleDelete = useCallback(
    async (id: string) => {
      if (deletingIds.has(id)) return;

      const target =
        items.find((it) => String(it.id) === id) ??
        (searchHits ?? []).find((it) => String(it.id) === id);
      const label = target?.title || 'this memory';
      if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;

      setDeletingIds((prev) => new Set(prev).add(id));
      try {
        const token = await api.getValidAccessToken();
        if (!token) {
          setError('TOKEN_EXPIRED');
          return;
        }
        await api.deleteItem(id, token);
        // Remove from whichever list is currently driving the view.
        setItems((prev) => prev.filter((it) => String(it.id) !== id));
        setSearchHits((prev) =>
          prev ? prev.filter((it) => String(it.id) !== id) : prev
        );
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to delete memory'
        );
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [api, deletingIds, items, searchHits]
  );

  /**
   * Flip `items.is_favorite`. Optimistic: the heart fills immediately and
   * reverts if the PATCH fails, because a favorite toggle is a low-stakes
   * action and waiting on the round-trip makes the card feel dead.
   */
  const handleToggleFavorite = useCallback(
    async (id: string) => {
      if (favoritingIds.has(id)) return;

      const current =
        items.find((it) => String(it.id) === id) ??
        (searchHits ?? []).find((it) => String(it.id) === id);
      if (!current) return;
      const next = !current.is_favorite;

      const patch = (list: Item[]) =>
        list.map((it) =>
          String(it.id) === id ? { ...it, is_favorite: next } : it
        );

      setFavoritingIds((prev) => new Set(prev).add(id));
      setItems(patch);
      setSearchHits((prev) => (prev ? patch(prev) : prev));

      try {
        const token = await api.getValidAccessToken();
        if (!token) {
          setError('TOKEN_EXPIRED');
          return;
        }
        await api.updateItem(id, { isFavorite: next }, token);
      } catch (err) {
        // Roll the heart back so the UI never lies about the DB.
        setItems((prev) => patch(prev).map((it) => ({ ...it, is_favorite: !next })));
        setSearchHits((prev) =>
          prev ? patch(prev).map((it) => ({ ...it, is_favorite: !next })) : prev
        );
        setError(
          err instanceof Error ? err.message : 'Failed to update favorite'
        );
      } finally {
        setFavoritingIds((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(id);
          return nextSet;
        });
      }
    },
    [api, favoritingIds, items, searchHits]
  );

  /**
   * Freeze the current search into a Smart Space.
   *
   * The rule is sent as-is; the server stores criteria and resolves
   * them through the same search service, so the Space is a live view
   * rather than a snapshot of today's results.
   */
  const handleCreateSmartSpace = useCallback(
    async (input: { name: string; description: string; color: SpaceColor }) => {
      if (!canSaveAsSpace) return;
      setSmartCreating(true);
      setSmartError(null);
      try {
        const token = await api.getValidAccessToken();
        if (!token) throw new Error('Session expired');
        const space = await api.createSmartSpace(
          {
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
            color: input.color,
            rule: currentRule
          },
          token
        );
        setSmartDialogOpen(false);
        navigate(`/app/spaces/${space.id}`);
      } catch (err) {
        setSmartError(
          err instanceof Error ? err.message : 'Could not create Smart Space'
        );
      } finally {
        setSmartCreating(false);
      }
    },
    [api, canSaveAsSpace, currentRule, navigate]
  );

  const visible: MemoryCardItem[] = (searchHits ?? items).map((it) => ({
    id: String(it.id),
    kind: it.kind,
    title: it.title,
    // `/search` returns a pre-built `snippet`; `GET /items` returns the
    // stored `raw_text` / `ocr_text` columns instead. Both feed the same
    // card body, so fall back instead of rendering an empty card.
    snippet: it.snippet ?? it.raw_text ?? it.ocr_text ?? '',
    source_url: it.source_url,
    image_url: it.image_url,
    tags: it.tags,
    captured_at: it.captured_at,
    status: it.status,
    is_favorite: it.is_favorite,
  }));

  const handleNavigate = (page: DashboardPageName) => {
    if (page === 'Everything') navigate('/app');
    else if (page === 'Spaces') navigate('/app/spaces');
    else if (page === 'Groups') navigate('/app/clusters');
    else if (page === 'Rediscover') navigate('/app/rediscover');
    else if (page === 'Reminders') navigate('/app/reminders');
    else if (page === 'Settings') navigate('/app/settings');
    else if (page === 'Favorites') {
      // Surface the dedicated favorites page so the heart on any card
      // has a place to live. The page hits `?favorite=true` server-side,
      // matching the extension's favourites tab.
      navigate('/app/favorites');
    }
  };

  const handleCaptureAction = (a: CaptureAction) => {
    if (a === 'document') {
      setDocumentCaptureOpen(true);
      return;
    }
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
        onDelete={handleDelete}
        deletingIds={deletingIds}
        onToggleFavorite={handleToggleFavorite}
        favoritingIds={favoritingIds}
        onAddToSpace={(ids) => setSpacePickerIds(ids)}
      >
        {/* Only offered once a search or filter is active. With no
            criteria the stored rule would match every memory, which is
            just Everything under a different name. */}
        {canSaveAsSpace ? (
          <button
            type="button"
            className="ghost"
            data-testid="save-as-space"
            onClick={() => {
              setSmartError(null);
              setSmartDialogOpen(true);
            }}
          >
            Save as Space
          </button>
        ) : null}
      </EverythingView>

      {spacePickerIds ? (
        <SpacePicker
          api={api}
          itemIds={spacePickerIds}
          onClose={() => setSpacePickerIds(null)}
          onAdded={() => setError(null)}
        />
      ) : null}

      {smartDialogOpen ? (
        <CreateSpaceDialog
          mode="smart"
          rule={currentRule}
          onClose={() => setSmartDialogOpen(false)}
          onSubmit={handleCreateSmartSpace}
          busy={smartCreating}
          error={smartError}
        />
      ) : null}

      <CaptureSheet
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onAction={handleCaptureAction}
      />

      <DocumentCaptureDialog
        api={api}
        open={documentCaptureOpen}
        onClose={() => setDocumentCaptureOpen(false)}
        onUploaded={() => {
          // Refresh the list so the new memory appears with
          // "Processing document…" — the actual extraction runs in the
          // background and the next reload will show the real title.
          void loadList();
        }}
      />
    </DashboardShell>
  );
}