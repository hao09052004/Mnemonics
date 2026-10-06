import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { EverythingView } from '../components/dashboard/EverythingView';
import { SpaceRuleSummary } from '../components/spaces/CreateSpaceDialog';
import {
  SpaceColorPicker,
  SpaceDot,
  SpaceKindBadge
} from '../components/spaces/SpaceIdentity';
import { SpacePicker } from '../components/spaces/SpacePicker';
import '../components/spaces/spaces.css';
import {
  ApiClient,
  type ItemDetail,
  type Session,
  type SpaceWithCount
} from '../lib/api-client';
import type { MemoryCardItem } from '../components/dashboard/MemoryCard';

interface SpaceDetailPageProps {
  api: ApiClient;
}

type EditState = { name: string; color: NonNullable<SpaceWithCount['color']> } | null;

/**
 * A single Space, manual or smart.
 *
 * Both kinds render through the same `EverythingView` and the same
 * `MemoryCard` — building a second card UI for Spaces is exactly how a
 * feature starts to look like a separate application. The only real
 * divergence is the membership action: a manual Space offers "remove
 * from Space" (which drops the join row and nothing else), a smart
 * Space cannot, because its membership is computed from its rule.
 */
export function SpaceDetailPage({ api }: SpaceDetailPageProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [space, setSpace] = useState<SpaceWithCount | null>(null);
  const [items, setItems] = useState<MemoryCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState>(null);
  const [pickerFor, setPickerFor] = useState<string[] | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (stored) setSession(stored);
  }, [api]);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const space = await api.getSpace(id, token);
      if (!space) {
        setError('That Space no longer exists.');
        setSpace(null);
        return;
      }
      setSpace(space);

      // The server already resolved membership (persisted rows for a
      // manual Space, a live search for a smart one) and returned
      // lightweight tiles. Full item detail is fetched only for the
      // bodies the cards need.
      const { ids } = await api.listSpaceItems(id, token);
      const fetched = await Promise.all(
        ids.map((itemId) => api.getItem(itemId, token).catch(() => null))
      );
      setItems(
        fetched
          .filter((x): x is ItemDetail => x !== null)
          .map((it) => ({
            id: String(it.id),
            kind: it.kind,
            title: it.title,
            snippet: it.raw_text ?? it.snippet ?? '',
            source_url: it.source_url,
            image_url: it.image_url,
            tags: it.tags,
            captured_at: it.captured_at,
            is_favorite: it.is_favorite,
            status: it.status
          }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this Space');
    } finally {
      setLoading(false);
    }
  }, [api, session, id]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const handleSaveEdit = useCallback(async () => {
    if (!space || !editing) return;
    setSavingEdit(true);
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) throw new Error('Session expired');
      await api.updateSpace(space.id, { name: editing.name.trim(), color: editing.color }, token);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this Space');
    } finally {
      setSavingEdit(false);
    }
  }, [api, space, editing, load]);

  /**
   * Drop the membership join row. The memory itself is untouched — the
   * user is ungrouping it, not destroying it — so this is not
   * confirmable: it is reversible by re-adding from Everything.
   */
  const handleRemove = useCallback(
    async (itemId: string) => {
      if (!space) return;
      // Optimistic: the card leaves the grid immediately, and comes
      // back if the server disagrees.
      const snapshot = items;
      setItems((prev) => prev.filter((it) => it.id !== itemId));
      try {
        const token = await api.getValidAccessToken();
        if (!token) throw new Error('Session expired');
        await api.removeItemFromSpace(space.id, itemId, token);
      } catch (err) {
        setItems(snapshot);
        setError(err instanceof Error ? err.message : 'Could not remove from Space');
      }
    },
    [api, space, items]
  );

  const handleDeleteSpace = useCallback(async () => {
    if (!space) return;
    if (!window.confirm('Delete this Space?\n\nYour memories will remain in Mnemonics.')) return;
    try {
      const token = await api.getValidAccessToken();
      if (!token) throw new Error('Session expired');
      await api.deleteSpace(space.id, token);
      navigate('/app/spaces');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this Space');
    }
  }, [api, space, navigate]);

  if (!session) return null;

  if (!space) {
    return (
      <DashboardShell
        user={session.user}
        active="Spaces"
        onNavigate={() => navigate('/app/spaces')}
        onCapture={() => navigate('/app')}
        onLogout={() => navigate('/')}
        demoMode={false}
      >
        <main className="spaces-page">
          <p role="alert" data-testid="space-error">
            {error ?? 'Space not found.'}
          </p>
          <button type="button" className="ghost" onClick={() => navigate('/app/spaces')}>
            Back to Spaces
          </button>
        </main>
      </DashboardShell>
    );
  }

  const isManual = space.spaceType === 'manual';

  return (
    <DashboardShell
      user={session.user}
      active="Spaces"
      onNavigate={(p) => {
        if (p === 'Everything') navigate('/app');
        else if (p === 'Spaces') navigate('/app/spaces');
        else if (p === 'Rediscover') navigate('/app/rediscover');
      }}
      onCapture={() => navigate('/app')}
      onLogout={() => {
        api.saveSession(null);
        setSession(null);
        navigate('/');
      }}
      demoMode={import.meta.env.VITE_DEMO_MODE === 'true'}
    >
      <main className="spaces-page">
        <header className="space-detail__head">
          <h1 className="space-detail__title" data-testid="space-detail-title">
            <SpaceDot color={space.color} size={11} />
            {space.name}
          </h1>
          <div className="space-detail__actions">
            <button
              type="button"
              className="ghost"
              data-testid="space-edit-btn"
              onClick={() =>
                setEditing({ name: space.name, color: space.color ?? 'violet' })
              }
            >
              Edit
            </button>
            <button
              type="button"
              className="ghost selection-bar__danger"
              data-testid="space-delete-btn"
              onClick={() => void handleDeleteSpace()}
            >
              Delete
            </button>
          </div>
        </header>

        <div className="space-detail__meta">
          <SpaceKindBadge kind={space.spaceType} />
          <span data-testid="space-detail-count">
            {space.itemCount === null
              ? items.length
              : space.itemCount}{' '}
            {space.itemCount === 1 ? 'memory' : 'memories'}
          </span>
          {space.updatedAt ? (
            <span className="space-card__rule">
              Updated {new Date(space.updatedAt).toLocaleDateString('en-US', {
                day: '2-digit',
                month: 'short'
              })}
            </span>
          ) : null}
        </div>

        {space.spaceType === 'smart' && space.rule ? (
          <div
            className="space-dialog__criteria"
            style={{ marginBottom: 18 }}
            data-testid="space-detail-rules"
          >
            <span className="field-label">Saved criteria</span>
            <SpaceRuleSummary rule={space.rule} />
            <p className="space-picker__note">
              Memories matching this search appear here on their own. Change the criteria
              with Edit.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" data-testid="space-error">
            {error}
          </p>
        ) : null}

        {items.length === 0 && !loading ? (
          <div className="space-card" style={{ cursor: 'default' }} data-testid="space-empty">
            <p className="space-card__count">
              {isManual
                ? 'No memories here yet.'
                : 'No memories currently match this Space.'}
            </p>
            {isManual ? (
              <button
                type="button"
                className="primary"
                style={{ alignSelf: 'flex-start' }}
                data-testid="space-empty-add"
                onClick={() => navigate('/app')}
              >
                Add memories
              </button>
            ) : null}
          </div>
        ) : (
          <EverythingView
            items={items}
            loading={loading}
            error={null}
            query=""
            onQueryChange={() => undefined}
            filter="all"
            onFilterChange={() => undefined}
            onOpen={() => undefined}
            onCapture={() => navigate('/app')}
            /* A smart Space's membership is derived, so there is no
               join row to delete — offering the action would promise
               something the server rejects. */
            onDelete={isManual ? (itemId) => void handleRemove(itemId) : undefined}
          />
        )}
      </main>

      {pickerFor ? (
        <SpacePicker
          api={api}
          itemIds={pickerFor}
          onClose={() => setPickerFor(null)}
          onAdded={() => void load()}
        />
      ) : null}

      {editing ? (
        <div
          className="space-dialog-backdrop"
          role="presentation"
          onClick={() => setEditing(null)}
        >
          <div
            className="space-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Edit Space"
            data-testid="space-edit-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit Space</h2>
            <label className="field-label" htmlFor="space-edit-name">
              Name
            </label>
            <input
              id="space-edit-name"
              className="field-input"
              value={editing.name}
              maxLength={120}
              data-testid="space-edit-name"
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <SpaceColorPicker
              value={editing.color}
              onChange={(color) => setEditing({ ...editing, color })}
              label="Colour"
            />
            <div className="space-dialog__actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setEditing(null)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!editing.name.trim() || savingEdit}
                data-testid="space-edit-save"
                onClick={() => void handleSaveEdit()}
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
