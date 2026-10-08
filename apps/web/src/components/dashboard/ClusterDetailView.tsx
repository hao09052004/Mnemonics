/**
 * Cluster detail view.
 *
 * Renders the cluster's authoritative title, summary, item count,
 * and the paginated list of member cards. The detail page is the
 * single screen that needs ALL members of one cluster, so it asks
 * the backend for hydrated DTOs (no intersection with the
 * dashboard's global items list).
 *
 * Milestone 2 changes:
 *  - Reads the cluster's title/summary from the detail response,
 *    not from a member's title
 *  - Caps the page size at the backend limit (100), not 200
 *  - Implements "Load more" pagination consistent with the
 *    Everything view (Mnemonics UI rule)
 *  - Member cards come from the response, not from `items` prop
 *
 * The two actions are unchanged:
 *  - Save as Space (spec §31 — creates a Manual Space containing
 *    the CURRENT members)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type ClusterSummary, type ClusterMember, type ApiClient } from '../../lib/api-client';
import { MemoryCard } from './MemoryCard';
import { EmptyState } from './EmptyState';
import '../spaces/spaces.css';

interface ClusterDetailViewProps {
  api: ApiClient;
  accessToken: string;
  onOpenItem: (id: string) => void;
}

const PAGE_SIZE = 50;

export function ClusterDetailView({ api, accessToken, onOpenItem }: ClusterDetailViewProps) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<ClusterSummary | null>(null);
  const [members, setMembers] = useState<ClusterMember[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingAsSpace, setSavingAsSpace] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!id) return;
      try {
        if (append) setLoadingMore(true);
        else setError(null);
        const detail = await api.getCluster(id, accessToken, {
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setSummary(detail.cluster);
        setMembers((prev) => (append ? [...prev, ...detail.items] : detail.items));
        setOffset(nextOffset + detail.items.length);
        setHasMore(nextOffset + detail.items.length < detail.cluster.itemCount);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load this group right now.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accessToken, id]
  );

  useEffect(() => {
    setMembers([]);
    setOffset(0);
    setHasMore(false);
    setLoading(true);
    void loadPage(0, false);
  }, [loadPage]);

  const onSaveAsSpace = useCallback(async () => {
    if (!id) return;
    try {
      setSavingAsSpace(true);
      const res = await api.saveClusterAsSpace(id, accessToken, {});
      navigate(`/app/spaces/${encodeURIComponent(res.spaceId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this group as a Space.');
    } finally {
      setSavingAsSpace(false);
    }
  }, [accessToken, id, navigate]);

  const title = useMemo(() => {
    // Authoritative title from the cluster row, NOT derived from a
    // member. If the backend did not compute one (singleton,
    // algorithm-cold start) we keep a stable fallback so the page
    // never shows a blank header.
    return summary?.title?.trim() || 'Untitled group';
  }, [summary]);

  if (loading) {
    return <div className="mnx-everything__loading">Loading group…</div>;
  }

  if (error) {
    return (
      <EmptyState
        title="We can't load this group"
        text={error}
        action={{ label: 'Back to groups', onClick: () => navigate('/app/clusters') }}
      />
    );
  }

  if (members.length === 0) {
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
        <h1 className="mnx-everything__title" data-testid="cluster-title">
          {title}
        </h1>
        {summary?.summary ? (
          <p className="mnx-everything__subtitle" data-testid="cluster-summary">
            {summary.summary}
          </p>
        ) : null}
        <p className="mnx-everything__subtitle" data-testid="cluster-count">
          {summary?.itemCount ?? members.length}{' '}
          {(summary?.itemCount ?? members.length) === 1 ? 'memory' : 'memories'}
          {hasMore ? ' (showing first ' + members.length + ')' : ''}
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
        {members.map((it) => (
          <MemoryCard
            key={it.id}
            item={{
              id: it.id,
              kind: it.kind,
              title: it.title,
              snippet: '',
              source_url: it.sourceUrl,
              image_url: it.thumbnailUrl,
              tags: [],
              captured_at: it.capturedAt,
              status: 'ready',
              is_favorite: it.isFavorite,
            }}
            onOpen={() => onOpenItem(it.id)}
          />
        ))}
      </div>

      {hasMore ? (
        <div className="mnx-everything__more">
          <button
            type="button"
            className="mnx-button mnx-button--ghost"
            disabled={loadingMore}
            onClick={() => void loadPage(offset, true)}
            data-testid="cluster-load-more"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
