/**
 * Content Clusters — overview view.
 *
 * The dashboard's landing surface for the "Groups" feature. A calm
 * list of clusters with previews, a count, and a single "Refresh"
 * action; tap a card to open the detail view. No controls the
 * backend cannot serve, no AI-only labels, no mymind-style hero
 * collage.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ClusterSummary, type ApiClient } from '../../lib/api-client';
import { EmptyState } from './EmptyState';

interface ClustersViewProps {
  api: ApiClient;
  accessToken: string;
}

const SESSION_KEY = 'mnemonics:clusters:state';

interface PersistedState {
  lastSeenUpdatedAt?: string;
}

export function ClustersView({ api, accessToken }: ClustersViewProps) {
  const navigate = useNavigate();
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [unclusteredCount, setUnclusteredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await api.listClusters(accessToken);
      setClusters(result.clusters);
      setUnclusteredCount(result.unclusteredCount);
    } catch (e) {
      // 404 means the backend has the feature off — the route
      // already hides the nav link, so this is a stale state. We
      // bounce to Everything rather than show a confusing empty.
      if (e instanceof Error && /404/.test(e.message)) {
        navigate('/app');
        return;
      }
      setError(e instanceof Error ? e.message : 'Unable to update groups right now.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Track when the corpus was last refreshed so the UI can render
  // "Updated recently" without a second API call.
  useEffect(() => {
    if (clusters.length === 0) return;
    const latest = clusters.reduce((acc, c) =>
      acc.updatedAt > c.updatedAt ? acc : c
    );
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const parsed: PersistedState = raw ? JSON.parse(raw) : {};
      if (parsed.lastSeenUpdatedAt !== latest.updatedAt) {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ lastSeenUpdatedAt: latest.updatedAt })
        );
      }
    } catch {
      // localStorage is best-effort; the timestamp is only for UX.
    }
  }, [clusters]);

  const onRefresh = async () => {
    try {
      setRefreshing(true);
      setError(null);
      await api.refreshClusters(accessToken);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update groups right now.');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="mnx-everything">
        <div className="mnx-everything__loading">Loading groups…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mnx-everything">
        <EmptyState
          title="We can't update groups right now"
          text="Search, capture and Spaces continue to work. Try refreshing in a moment."
          action={{ label: 'Try again', onClick: () => void load() }}
        />
      </div>
    );
  }

  // Below the threshold: spec §24 says render an empty hint instead
  // of inventing clusters. The threshold is "fewer than
  // minSize eligible items" — but the API does not return the
  // eligible count, so we approximate with the union of cluster
  // members + unclustered memories.
  const totalMemories = clusters.reduce((s, c) => s + c.itemCount, 0) + unclusteredCount;
  if (totalMemories < 3) {
    return (
      <div className="mnx-everything">
        <EmptyState
          title="Save a few more memories to start seeing related groups"
          text="Groups appear automatically once a few similar memories share enough in common."
        />
      </div>
    );
  }

  return (
    <div className="mnx-everything">
      <header className="mnx-everything__header">
        <h1 className="mnx-everything__title">Groups</h1>
        <p className="mnx-everything__subtitle">
          Memories that share a topic. Save a group as a Space to keep it your way.
        </p>
        <div className="mnx-clusters__actions">
          <button
            type="button"
            className="mnx-button mnx-button--ghost"
            onClick={() => void onRefresh()}
            disabled={refreshing}
            data-testid="cluster-refresh"
          >
            {refreshing ? 'Updating groups…' : 'Refresh groups'}
          </button>
        </div>
      </header>

      {clusters.length === 0 ? (
        <EmptyState
          title="No groups yet"
          text="Save more memories on a similar topic to see them cluster here."
        />
      ) : (
        <ul className="mnx-clusters" data-testid="clusters-list">
          {clusters.map((c) => (
            <li
              key={c.id}
              className="mnx-clusters__card"
              onClick={() => navigate(`/app/clusters/${encodeURIComponent(c.id)}`)}
              data-testid={`cluster-card-${c.id}`}
            >
              <div className="mnx-clusters__card-head">
                <h2 className="mnx-clusters__card-title">{c.title ?? 'Untitled group'}</h2>
                <span className="mnx-clusters__count">{c.itemCount} memories</span>
              </div>
              {c.summary ? (
                <p className="mnx-clusters__card-summary">{c.summary}</p>
              ) : null}
              <div className="mnx-clusters__previews">
                {c.representativeItems.slice(0, 3).map((p) => (
                  <div className="mnx-clusters__preview" key={p.id} title={p.title}>
                    <span className="mnx-clusters__preview-kind">{p.kind}</span>
                    <span className="mnx-clusters__preview-title">{p.title}</span>
                  </div>
                ))}
                {c.representativeItems.length === 0 ? (
                  <div className="mnx-clusters__preview mnx-clusters__preview--empty">
                    Preview unavailable
                  </div>
                ) : null}
              </div>
              <div className="mnx-clusters__card-foot">
                <span className="mnx-clusters__updated">
                  Updated {formatRelative(c.updatedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {unclusteredCount > 0 ? (
        <p className="mnx-clusters__unclustered">
          {unclusteredCount} {unclusteredCount === 1 ? 'memory is' : 'memories are'} not
          in any group yet.
        </p>
      ) : null}
    </div>
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'recently';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / (60 * 60_000))} h ago`;
  return new Date(ts).toLocaleDateString();
}
