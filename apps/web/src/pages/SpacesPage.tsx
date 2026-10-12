import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { Icon } from '../components/dashboard/Icons';
import {
  CreateSpaceDialog,
  SpaceRuleSummary
} from '../components/spaces/CreateSpaceDialog';
import {
  SpaceDot,
  SpaceKindBadge,
  spaceColorVars
} from '../components/spaces/SpaceIdentity';
import '../components/spaces/spaces.css';
import {
  ApiClient,
  type Session,
  type SpaceColor,
  type SpaceWithCount
} from '../lib/api-client';

interface SpacesPageProps {
  api: ApiClient;
}

/**
 * All Spaces.
 *
 * Smart counts are requested with `withCounts: 1`, which costs one
 * search per smart Space. That is the right trade here: this is the
 * only page where a user browses their Spaces, and a card reading
 * "Auto" instead of a number would be actively unhelpful. Manual
 * counts come from a cheap indexed COUNT and never pay for it.
 */
export function SpacesPage({ api }: SpacesPageProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [spaces, setSpaces] = useState<SpaceWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
        setError('Your session has expired. Please sign in again.');
        return;
      }
      setSpaces(await api.listSpaces(token, { withCounts: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Spaces');
    } finally {
      setLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const handleCreate = useCallback(
    async (input: { name: string; description: string; color: SpaceColor }) => {
      setCreating(true);
      setCreateError(null);
      try {
        const token = await api.getValidAccessToken();
        if (!token) throw new Error('Session expired');
        await api.createSpace(
          {
            name: input.name,
            ...(input.description ? { description: input.description } : {}),
            color: input.color,
            spaceType: 'manual'
          },
          token
        );
        setDialogOpen(false);
        await load();
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : 'Could not create Space');
      } finally {
        setCreating(false);
      }
    },
    [api, load]
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
      onCapture={() => navigate('/app')}
      onLogout={() => {
        api.saveSession(null);
        setSession(null);
        navigate('/');
      }}
      demoMode={import.meta.env.VITE_DEMO_MODE === 'true'}
    >
      <main className="spaces-page">
        <header className="spaces-page__head">
          <div>
            <h1 className="spaces-page__title">Spaces</h1>
            <p className="spaces-page__sub">
              Organize memories around the things that matter.
            </p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCreateError(null);
              setDialogOpen(true);
            }}
            data-testid="new-space-btn"
          >
            <Icon name="plus" size={16} /> New Space
          </button>
        </header>

        {error ? (
          <p role="alert" data-testid="spaces-error">
            {error}
          </p>
        ) : null}

        <section>
          <h2 className="spaces-section__label">
            My Spaces
            <span className="memory-count">{spaces.length}</span>
          </h2>

          {loading && spaces.length === 0 ? (
            <p className="space-picker__hint">Loading Spaces…</p>
          ) : spaces.length === 0 ? (
            <div className="space-card" data-testid="spaces-empty" style={{ cursor: 'default' }}>
              <p className="space-card__count">
                Create a Space to keep related memories together.
              </p>
              <button
                type="button"
                className="primary"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setDialogOpen(true)}
              >
                New Space
              </button>
            </div>
          ) : (
            <div className="spaces-grid" data-testid="spaces-grid">
              {spaces.map((space) => {
                const vars = spaceColorVars(space.color);
                const tiles = space.previewItems.slice(0, 4);
                return (
                  <button
                    key={space.id}
                    type="button"
                    className="space-card"
                    style={{ borderLeftColor: vars.dot }}
                    data-testid={`space-card-${space.id}`}
                    onClick={() => navigate(`/app/spaces/${space.id}`)}
                  >
                    <div className="space-card__top">
                      <SpaceDot color={space.color} />
                      <h3 className="space-card__name">{space.name}</h3>
                      <SpaceKindBadge kind={space.spaceType} />
                    </div>

                    <p className="space-card__count">
                      {space.itemCount === null
                        ? 'Updating…'
                        : `${space.itemCount} ${
                            space.itemCount === 1 ? 'memory' : 'memories'
                          }`}
                    </p>

                    {tiles.length > 0 ? (
                      <div className="space-card__preview" aria-hidden="true">
                        {tiles.map((tile) => (
                          <div className="space-card__tile" key={tile.id} title={tile.title}>
                            <span>{shortKind(tile.kind)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {space.spaceType === 'smart' && space.rule ? (
                      <SpaceRuleSummary rule={space.rule} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {dialogOpen ? (
        <CreateSpaceDialog
          mode="manual"
          onClose={() => setDialogOpen(false)}
          onSubmit={handleCreate}
          busy={creating}
          error={createError}
        />
      ) : null}
    </DashboardShell>
  );
}

/**
 * Tile label for a preview.
 *
 * Thumbnails live behind the signed-asset endpoint, which the Spaces
 * list does not mint URLs for, so a tile shows the memory's kind rather
 * than an image that would fail to load — a grid of broken images reads
 * as data loss.
 */
function shortKind(kind: string): string {
  switch (kind) {
    case 'image':
      return 'img';
    case 'screenshot':
      return 'shot';
    case 'link':
      return 'link';
    case 'text':
      return 'note';
    default:
      return kind.slice(0, 4) || 'item';
  }
}
