import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../dashboard/Icons';
import { SpaceColorPicker, SpaceDot, spaceColorVars } from './SpaceIdentity';
import type { ApiClient, SpaceColor, SpaceWithCount } from '../../lib/api-client';
import './spaces.css';

interface SpacePickerProps {
  api: ApiClient;
  /** Memories to add. Empty renders the picker in "create only" mode. */
  itemIds: string[];
  onClose: () => void;
  /** Called after at least one memory lands in a Space. */
  onAdded?: (space: SpaceWithCount, addedCount: number) => void;
  onCreateNew?: () => void;
}

/**
 * "Add to Space" sheet.
 *
 * Lists only manual Spaces: a smart Space decides its own membership,
 * so offering it here would produce a write the server rejects. That
 * exclusion is a product rule, not a missing feature, and the empty
 * state says so rather than looking broken.
 */
export function SpacePicker({ api, itemIds, onClose, onAdded, onCreateNew }: SpacePickerProps) {
  const [spaces, setSpaces] = useState<SpaceWithCount[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<SpaceColor>('violet');
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await api.getValidAccessToken();
        if (!token) throw new Error('Session expired');
        // No withCounts: the picker shows names, not totals, and every
        // smart Space would otherwise cost a search on open.
        const all = await api.listSpaces(token);
        if (!cancelled) setSpaces(all);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load Spaces');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Dismiss on outside click / Escape, matching the card overflow menu.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const manual = useMemo(
    () => spaces.filter((s) => s.spaceType === 'manual'),
    [spaces]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return manual;
    return manual.filter((s) => s.name.toLowerCase().includes(q));
  }, [manual, query]);

  const addTo = useCallback(
    async (space: SpaceWithCount) => {
      if (busyId || itemIds.length === 0) return;
      setBusyId(space.id);
      setError(null);
      try {
        const token = await api.getValidAccessToken();
        if (!token) throw new Error('Session expired');
        const result = await api.addItemsToSpace(space.id, itemIds, token);
        onAdded?.(space, result.added.length);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not add memories');
      } finally {
        setBusyId(null);
      }
    },
    [api, busyId, itemIds, onAdded, onClose]
  );

  const createAndAdd = useCallback(async () => {
    const name = newName.trim();
    if (!name || busyId) return;
    setBusyId('__new__');
    setError(null);
    try {
      const token = await api.getValidAccessToken();
      if (!token) throw new Error('Session expired');
      const space = await api.createSpace(
        { name, color: newColor, spaceType: 'manual' },
        token
      );
      if (itemIds.length > 0) {
        const result = await api.addItemsToSpace(space.id, itemIds, token);
        onAdded?.({ ...space, itemCount: null, previewItems: [] }, result.added.length);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Space');
    } finally {
      setBusyId(null);
    }
  }, [api, busyId, itemIds, newName, newColor, onAdded, onClose]);

  const selectedLabel =
    itemIds.length === 1 ? '1 memory' : `${itemIds.length} memories`;

  return (
    <div className="space-picker-backdrop" role="presentation">
      <div
        className="space-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Add to Space"
        ref={panelRef}
        data-testid="space-picker"
      >
        <header className="space-picker__head">
          <h2>Add to Space</h2>
          {itemIds.length > 0 ? (
            <span className="space-picker__count">{selectedLabel}</span>
          ) : null}
        </header>

        {itemIds.length > 0 ? (
          <div className="space-picker__search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              placeholder="Search Spaces"
              aria-label="Search Spaces"
              data-testid="space-picker-search"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        ) : null}

        <div className="space-picker__list">
          {loading ? (
            <p className="space-picker__hint">Loading Spaces…</p>
          ) : filtered.length === 0 ? (
            <p className="space-picker__hint" data-testid="space-picker-empty">
              {manual.length === 0
                ? 'No manual Spaces yet. Create one below.'
                : 'No Space matches that name.'}
            </p>
          ) : (
            filtered.map((space) => {
              const vars = spaceColorVars(space.color);
              const busy = busyId === space.id;
              return (
                <button
                  key={space.id}
                  type="button"
                  className="space-picker__row"
                  data-testid={`space-picker-row-${space.id}`}
                  disabled={busy || itemIds.length === 0}
                  onClick={() => addTo(space)}
                  style={{ borderLeftColor: vars.dot }}
                >
                  <SpaceDot color={space.color} />
                  <span className="space-picker__name">{space.name}</span>
                  <span className="space-picker__meta">
                    {busy ? 'Adding…' : `${space.itemCount ?? 0}`}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {spaces.some((s) => s.spaceType === 'smart') ? (
          <p className="space-picker__note">
            Smart Spaces fill themselves from their saved search, so they are not listed
            here.
          </p>
        ) : null}

        {error ? (
          <p className="space-picker__error" role="alert" data-testid="space-picker-error">
            {error}
          </p>
        ) : null}

        {creating ? (
          <div className="space-picker__create" data-testid="space-picker-create">
            <label className="field-label" htmlFor="space-picker-name">
              New Space
            </label>
            <input
              id="space-picker-name"
              className="field-input"
              value={newName}
              maxLength={120}
              placeholder="M&A Research"
              data-testid="space-picker-name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createAndAdd();
              }}
            />
            <SpaceColorPicker value={newColor} onChange={setNewColor} label="Colour" />
            <div className="space-picker__actions">
              <button type="button" className="ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!newName.trim() || busyId === '__new__'}
                data-testid="space-picker-create-submit"
                onClick={() => void createAndAdd()}
              >
                {busyId === '__new__' ? 'Creating…' : 'Create & add'}
              </button>
            </div>
          </div>
        ) : onCreateNew ? (
          <button
            type="button"
            className="space-picker__new"
            data-testid="space-picker-new"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={14} /> New Space
          </button>
        ) : (
          <button
            type="button"
            className="space-picker__new"
            data-testid="space-picker-new"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={14} /> Create New Space
          </button>
        )}
      </div>
    </div>
  );
}
