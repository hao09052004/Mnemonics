/**
 * Cluster detail view.
 *
 * Shows the cluster's title, summary, item count, and a memory
 * canvas (reusing the same MemoryCard grid the Spaces view uses).
 * The two actions are:
 *   - Refresh groups (rarely needed; mostly for support cases)
 *   - Save as Space (the spec §31 path — creates a Manual Space
 *     containing the CURRENT members)
 *
 * The detail view is read-only: editing membership is the role of
 * a Space, not a cluster (spec §50).
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type ClusterSummary, type Item, type ApiClient } from '../../lib/api-client';
import { MemoryCard } from './MemoryCard';
import { EmptyState } from './EmptyState';
import '../spaces/spaces.css';

interface ClusterDetailViewProps {
  api: ApiClient;
  accessToken: string;
  items: Item[];
  loadingItems: boolean;
  onOpenItem: (id: string) => void;
}

export function ClusterDetailView({
  api,
  accessToken,
  items,
  loadingItems,
  onOpenItem
}: ClusterDetailViewProps) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ClusterSummary | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingAsSpace, setSavingAsSpace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const detail = await api.getCluster(id, accessToken, { limit: 200, offset: 0 });
      setSummary(null); // we don't need the full summary here, just member ids
      setMemberIds(detail.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load this group right now.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberItems = useMemo(() => {
    const set = new Set(memberIds);
    return items.filter((i) => set.has(i.id));
  }, [items, memberIds]);

  const onSaveAsSpace = async () => {
    if (!summary && !id) return;
    try {
      setSavingAsSpace(true);
      const res = await api.saveClusterAsSpace(id, accessToken, {});
      navigate(`/app/spaces/${encodeURIComponent(res.spaceId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this group as a Space.');
    } finally {
      setSavingAsSpace(false);
    }
  };

  if (loading) {
    return <div className="mnx-everything__loading">Loading group…</div>;
  }

  if (error) {
    return (
      <EmptyState
        title="We can't load this group"
        text="It may have been removed or never existed."
        action={{ label: 'Back to groups', onClick: () => navigate('/app/clusters') }}
      />
    );
  }

  if (memberIds.length === 0) {
    return (
      <EmptyState
        title="This group is empty"
        text="It may have been recomputed. Try refreshing groups."
        action={{ label: 'Back to groups', onClick: () => navigate('/app/clusters') }}
      />
    );
  }

  return (
    <div className="mnx-everything" data-testid="cluster-detail">
      <header className="mnx-everything__header">
        <h1 className="mnx-everything__title">
          {clusterTitleFromIds(memberIds, items) ?? 'Untitled group'}
        </h1>
        <p className="mnx-everything__subtitle">
          {memberIds.length} {memberIds.length === 1 ? 'memory' : 'memories'}
        </p>
        <div className="mnx-clusters__actions">
          <button
            type="button"
            className="mnx-button mnx-button--primary"
            onClick={() => void onSaveAsSpace()}
            disabled={savingAsSpace}
            data-testid="cluster-save-as-space"
          >
            {savingAsSpace ? 'Saving…' : 'Save as Space'}
          </button>
        </div>
      </header>

      <div className="mnx-memory-grid" data-testid="cluster-items">
        {memberItems.map((it) => (
          <MemoryCard
            key={it.id}
            item={{
              id: it.id,
              kind: it.kind,
              title: it.title,
              snippet: it.raw_text ?? it.ocr_text ?? '',
              source_url: it.source_url,
              image_url: it.image_url,
              tags: it.tags,
              captured_at: it.captured_at,
              status: it.status,
              is_favorite: it.is_favorite
            }}
            onOpen={() => onOpenItem(it.id)}
          />
        ))}
        {loadingItems ? (
          <div className="mnx-everything__loading">Loading more…</div>
        ) : null}
      </div>
    </div>
  );
}

function clusterTitleFromIds(ids: string[], items: Item[]): string | null {
  // The detail endpoint doesn't return the cluster's title (the
  // overview endpoint does and that's where the title lives in the
  // UI). We pull it from the first matching item's tags so the
  // header still has something. If the dashboard later needs a
  // guaranteed cluster title here, extend the detail endpoint to
  // return the summary too.
  const first = items.find((i) => i.id === ids[0]);
  if (!first) return null;
  return first.title || null;
}
