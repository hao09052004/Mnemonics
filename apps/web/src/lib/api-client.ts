/**
 * API Client for Web Dashboard
 *
 * One source of truth for the REST contract shared with the Chrome
 * extension. Backed by `specs/api/auth.md` and `specs/api/capture.md`:
 *   - Every auth endpoint returns `{ data: { user, session } }`.
 *   - `session` may be `null` (e.g. signup-with-email-verification).
 *   - `/api/v1/auth/logout` returns 204 with no body — clients MUST NOT
 *     attempt to parse JSON in that case.
 */

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  emailVerified: boolean;
}

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: 'bearer';
}

interface AuthEnvelope {
  data: { user: AuthUser | null; session: AuthSession | null };
}

interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: AuthUser;
}

export type { AuthUser, AuthSession, AuthEnvelope, Session, Item, ListItemsResponse, SearchRequest, SearchResponse, LoginRequest, RegisterRequest, ListItemsParams, RelatedItem, ItemDetail, UpdateItemRequest, TagListItem, TagItemsResponse, TagSuggestion, TagSuggestionResponse, ItemEnrichment, Space, SpaceWithCount, SpaceRule, SpaceType, SpacePreviewItem };

interface LoginRequest {
  email: string;
  password: string;
}

interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

interface ListItemsParams {
  limit?: number;
  offset?: number;
  favorite?: boolean;
}

interface ListItemsResponse {
  items: Item[];
  total: number;
  limit: number;
  offset: number;
}

interface SearchRequest {
  q: string;
  filters?: {
    tags?: string[];
    kind?: string[];
    captured_after?: string;
    captured_before?: string;
  };
  limit?: number;
  offset?: number;
  explain?: boolean;
}

interface SearchResponse {
  hits: Item[];
  total: number;
  took_ms: number;
}

interface Item {
  id: string;
  kind: string;
  title: string;
  snippet?: string;
  score?: number;
  captured_at: string;
  tags?: string[];
  status?: string;
  image_url?: string;
  source_url?: string;
  // The list endpoint (`GET /api/v1/items`) returns the stored body
  // columns; only `/search` returns a pre-built `snippet`. The
  // dashboard must fall back to these or every card renders empty.
  raw_text?: string | null;
  ocr_text?: string | null;
  is_favorite?: boolean;
  /** Populated for `document` items; null for everything else. */
  page_count?: number | null;
}

interface ItemAssetMetadata {
  mime_type: string | null;
  size_bytes: number | null;
  original_filename: string | null;
}

interface ItemDetail extends Item {
  raw_text?: string | null;
  ocr_text?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  client_request_id?: string;
  ocr_engine?: string | null;
  ocr_language?: string | null;
  ocr_confidence?: number | null;
  ocr_processed_at?: string | null;
  ocr_error_code?: string | null;
  /** Present when the item has an asset row (image / screenshot / document). */
  asset?: ItemAssetMetadata | null;
  /** Short-lived signed URL for the original asset. */
  signed_url?: string | null;
}

interface ItemEnrichment {
  itemId: string;
  caption: string | null;
  captionProvider: string | null;
  captionModel: string | null;
  captionStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
  captionErrorCode: string | null;
  tldr: string | null;
  tldrSource: 'pending' | 'local_ai' | 'cloud_ai' | 'heuristic' | 'user';
  tldrProvider: string | null;
  tldrModel: string | null;
  tldrPromptVersion: string | null;
  tldrStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'disabled';
  tldrErrorCode: string | null;
  summary: string | null;
  updatedAt: string;
}

/**
 * A Space is either `manual` (the user picked the memories) or `smart`
 * (the user saved criteria and membership is derived). The two behave
 * differently enough that the distinction is load-bearing in the UI:
 * a manual Space offers "remove from Space", a smart one does not.
 */
type SpaceType = 'manual' | 'smart';

/** Curated identity palette, mirrored from the DB CHECK constraint. */
export const SPACE_COLORS = [
  'violet',
  'blue',
  'teal',
  'sage',
  'amber',
  'rose',
  'slate'
] as const;
export type SpaceColor = (typeof SPACE_COLORS)[number];

/**
 * The criteria a Smart Space stores. This is the same shape
 * `POST /api/v1/search` accepts, which is what makes "save this search
 * as a Space" a straight serialise with no translation layer.
 */
interface SpaceRule {
  q?: string;
  filters?: {
    tags?: string[];
    kind?: Array<'link' | 'text' | 'image' | 'screenshot' | 'document'>;
    captured_after?: string;
    captured_before?: string;
    favorite?: boolean;
  };
}

/** A representative memory on a Space card. No bodies, no image bytes. */
interface SpacePreviewItem {
  id: string;
  kind: string;
  title: string;
  thumbnailUrl: string | null;
  isFavorite: boolean;
}

interface Space {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: SpaceColor | null;
  spaceType: SpaceType;
  coverItemId: string | null;
  /** Present on a smart Space only. */
  rule: SpaceRule | null;
  ruleVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface SpaceWithCount extends Space {
  /**
   * `null` for a smart Space whose count has not been resolved yet —
   * computing it means running the search. The UI shows "Auto" rather
   * than a misleading 0.
   */
  itemCount: number | null;
  previewItems: SpacePreviewItem[];
}

interface UpdateItemRequest {
  title?: string;
  notes?: string;
  /** Toggles `items.is_favorite`. Backed by `PATCH /api/v1/items/:id`. */
  isFavorite?: boolean;
  tags?: string[];
}

interface TagListItem {
  id: string;
  name: string;
  normalized_name?: string;
  item_count: number;
  last_used_at?: string | null;
}

interface TagItemsResponse {
  tag: string;
  items: Item[];
  total: number;
}

interface TagSuggestion {
  tag: string;
  score: number;
  isExisting: boolean;
}

interface TagSuggestionResponse {
  suggestions: TagSuggestion[];
  existing_tags?: string[];
}

interface RelatedItem {
  id: string;
  type: string;
  title: string;
  captured_at?: string;
  similarity: number;
}

interface ApiErrorPayload {
  error?: { code?: string; message?: string; requestId?: string };
}

/**
 * Content Cluster DTOs.
 *
 * The web dashboard's view of the cluster feature. The DTO shape
 * follows the wire format produced by `apps/api/src/routes/clusters.ts`
 * so the dashboard never invents a parallel client-side model.
 */
export interface ClusterPreviewItem {
  id: string;
  kind: string;
  title: string;
  thumbnailUrl: string | null;
  isFavorite: boolean;
}

export interface ClusterSummary {
  id: string;
  title: string | null;
  summary: string | null;
  itemCount: number;
  representativeItemId: string | null;
  algorithmVersion: string;
  embeddingModel: string;
  similarityThreshold: number;
  minSize: number;
  createdAt: string;
  updatedAt: string;
  representativeItems: ClusterPreviewItem[];
}

export interface ClusterListResponse {
  data: {
    clusters: ClusterSummary[];
    unclusteredCount: number;
  };
}

export interface ClusterDetailResponse {
  data: {
    cluster: {
      id: string;
      title: string | null;
      summary: string | null;
      itemCount: number;
      representativeItemId: string | null;
      algorithmVersion: string;
      embeddingModel: string;
      similarityThreshold: number;
      minSize: number;
      createdAt: string;
      updatedAt: string;
    };
    items: string[];
    limit: number;
    offset: number;
  };
}

export interface ClusterRefreshResponse {
  data: {
    algorithmVersion: string;
    embeddingModel: string;
    similarityThreshold: number;
    minSize: number;
    eligibleItemCount: number;
    clusterCount: number;
    unclusteredCount: number;
    durationMs: number;
  };
}

export interface SaveClusterAsSpaceResponse {
  data: {
    spaceId: string;
    memberCount: number;
  };
}

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  isNetwork: boolean;

  constructor(status: number, message: string, code?: string, requestId?: string, isNetwork = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.isNetwork = isNetwork;
  }
}

const SESSION_STORAGE_KEY = 'mnemonics_session';
const REFRESH_LEEWAY_MS = 60_000;

export class ApiClient {
  private baseUrl: string;
  private refreshing: Promise<Session | null> | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** Returns the current access token if still valid, else null. */
  async getValidAccessToken(): Promise<string | null> {
    const session = await this.loadStoredSession();
    if (!session) return null;
    if (this.isAccessTokenExpired(session)) {
      // Best-effort refresh; never throws — caller decides what to do.
      const refreshed = await this.refreshSession(session);
      return refreshed ? refreshed.accessToken : null;
    }
    return session.accessToken;
  }

  isAccessTokenExpired(session: Session): boolean {
    if (!session.expiresAt) return false;
    return session.expiresAt * 1000 - Date.now() < REFRESH_LEEWAY_MS;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; accessToken?: string | null; parseJson?: boolean } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      throw new ApiError(0, `Không thể kết nối tới máy chủ: ${message}`, 'NETWORK_ERROR', undefined, true);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: { message: text } };
      }
    }

    if (!response.ok) {
      const errPayload = payload as ApiErrorPayload;
      const message = errPayload?.error?.message || `HTTP ${response.status}`;
      throw new ApiError(
        response.status,
        message,
        errPayload?.error?.code,
        errPayload?.error?.requestId
      );
    }

    return payload as T;
  }

  /** Auth envelope → normalized Session. Returns null when there's no session. */
  private envelopeToSession(envelope: AuthEnvelope | null | undefined, fallbackUser?: AuthUser | null): Session | null {
    const env = envelope && envelope.data ? envelope.data : null;
    if (!env || !env.session) return null;
    return {
      accessToken: env.session.accessToken,
      refreshToken: env.session.refreshToken,
      expiresAt: env.session.expiresAt,
      user: env.user || fallbackUser || { id: '', email: '', role: 'user', emailVerified: false }
    };
  }

  async login(request: LoginRequest): Promise<{ session: Session | null; user: AuthUser | null }> {
    const envelope = await this.request<AuthEnvelope>('/api/v1/auth/login', {
      method: 'POST',
      body: request
    });
    return {
      session: this.envelopeToSession(envelope),
      user: envelope?.data?.user ?? null
    };
  }

  async register(request: RegisterRequest): Promise<{ session: Session | null; user: AuthUser | null }> {
    const envelope = await this.request<AuthEnvelope>('/api/v1/auth/register', {
      method: 'POST',
      body: request
    });
    return {
      session: this.envelopeToSession(envelope),
      user: envelope?.data?.user ?? null
    };
  }

  async logout(accessToken: string): Promise<void> {
    await this.request<void>('/api/v1/auth/logout', {
      method: 'POST',
      accessToken,
      parseJson: false
    });
  }

  async refreshWithToken(refreshToken: string): Promise<Session | null> {
    const envelope = await this.request<AuthEnvelope>('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken }
    });
    return this.envelopeToSession(envelope);
  }

  /** Refresh the supplied session. Cached while in-flight to avoid stampede. */
  async refreshSession(currentSession: Session): Promise<Session | null> {
    if (!currentSession.refreshToken) return null;
    if (this.refreshing) return this.refreshing;
    const promise = this.refreshWithToken(currentSession.refreshToken)
      .then((session) => {
        if (session) this.saveSession(session);
        return session;
      })
      .catch(() => null)
      .finally(() => {
        this.refreshing = null;
      });
    this.refreshing = promise;
    return promise;
  }

  async listItems(accessToken: string, params: ListItemsParams = {}): Promise<ListItemsResponse> {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.offset !== undefined) search.set('offset', String(params.offset));
    if (params.favorite !== undefined) search.set('favorite', String(params.favorite));
    const query = search.toString();
    const response = await this.request<{ data: ListItemsResponse }>(
      `/api/v1/items${query ? `?${query}` : ''}`,
      { accessToken }
    );
    return response.data;
  }

  async search(request: SearchRequest, accessToken: string): Promise<SearchResponse> {
    const search = new URLSearchParams();
    search.set('q', request.q);
    if (request.limit !== undefined) search.set('limit', String(request.limit));
    if (request.offset !== undefined) search.set('offset', String(request.offset));
    if (request.explain) search.set('explain', '1');
    if (request.filters?.tags) search.set('tags', request.filters.tags.join(','));
    if (request.filters?.kind) search.set('kind', request.filters.kind.join(','));
    if (request.filters?.captured_after) search.set('captured_after', request.filters.captured_after);
    if (request.filters?.captured_before) search.set('captured_before', request.filters.captured_before);
    return this.request<SearchResponse>(`/api/v1/search?${search.toString()}`, { accessToken });
  }

  async getRelatedItems(id: string, accessToken: string, limit = 5): Promise<RelatedItem[]> {
    const response = await this.request<{ related_items: RelatedItem[] }>(
      `/api/v1/items/${encodeURIComponent(id)}/related?limit=${limit}`,
      { accessToken }
    );
    return Array.isArray(response.related_items) ? response.related_items : [];
  }

  async deleteItem(id: string, accessToken: string): Promise<void> {
    await this.request<void>(`/api/v1/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      accessToken,
      parseJson: false
    });
  }

  async getItem(id: string, accessToken: string): Promise<ItemDetail> {
    const response = await this.request<{ item: ItemDetail }>(
      `/api/v1/items/${encodeURIComponent(id)}`,
      { accessToken }
    );
    return response.item;
  }

  async updateItem(id: string, updates: UpdateItemRequest, accessToken: string): Promise<void> {
    await this.request<{ success: true }>(
      `/api/v1/items/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        accessToken,
        body: updates
      }
    );
  }

  async listTags(accessToken: string): Promise<TagListItem[]> {
    const response = await this.request<{ tags: TagListItem[]; total: number }>(
      '/api/v1/tags',
      { accessToken }
    );
    return Array.isArray(response.tags) ? response.tags : [];
  }

  async itemsByTag(name: string, accessToken: string): Promise<TagItemsResponse> {
    return this.request<TagItemsResponse>(
      `/api/v1/tags/${encodeURIComponent(name)}/items`,
      { accessToken }
    );
  }

  async suggestTags(text: string, accessToken: string, max = 5): Promise<TagSuggestionResponse> {
    return this.request<TagSuggestionResponse>('/api/v1/tags/suggest', {
      method: 'POST',
      accessToken,
      body: { text, max }
    });
  }

  // ----- Memory Understanding -----

  async getEnrichment(itemId: string, accessToken: string): Promise<ItemEnrichment | null> {
    const response = await this.request<{ data: { enrichment: ItemEnrichment | null } }>(
      `/api/v1/items/${encodeURIComponent(itemId)}/enrichment`,
      { accessToken }
    );
    return response.data?.enrichment ?? null;
  }

  async setUserTldr(itemId: string, tldr: string, accessToken: string): Promise<ItemEnrichment | null> {
    const response = await this.request<{ data: { enrichment: ItemEnrichment | null } }>(
      `/api/v1/items/${encodeURIComponent(itemId)}/tldr`,
      {
        method: 'PATCH',
        accessToken,
        body: { tldr }
      }
    );
    return response.data?.enrichment ?? null;
  }

  async regenerateTldr(itemId: string, accessToken: string): Promise<void> {
    await this.request<{ data: { regenerating: boolean } }>(
      `/api/v1/items/${encodeURIComponent(itemId)}/tldr`,
      {
        method: 'PATCH',
        accessToken,
        body: { tldr: ' ', regenerate: true }
      }
    );
  }

  // ----- Spaces -----

  /**
   * `withCounts` resolves smart counts (and their live previews) in one
   * extra server-side pass. Off by default because each smart Space
   * costs a search; the All Spaces page opts in so its cards can show a
   * real number instead of "Auto".
   */
  async listSpaces(
    accessToken: string,
    options: { withCounts?: boolean } = {}
  ): Promise<SpaceWithCount[]> {
    const query = options.withCounts ? '?withCounts=1' : '';
    const response = await this.request<{ data: { spaces: SpaceWithCount[] } }>(
      `/api/v1/spaces${query}`,
      { accessToken }
    );
    return response.data?.spaces ?? [];
  }

  async getSpace(id: string, accessToken: string): Promise<SpaceWithCount | null> {
    const response = await this.request<{ data: { space: SpaceWithCount | null } }>(
      `/api/v1/spaces/${encodeURIComponent(id)}`,
      { accessToken }
    );
    return response.data?.space ?? null;
  }

  async createSpace(
    payload: {
      name: string;
      description?: string;
      color?: SpaceColor;
      spaceType: SpaceType;
      coverItemId?: string;
      /** Required for, and only accepted on, a smart Space. */
      rule?: SpaceRule;
    },
    accessToken: string
  ): Promise<Space> {
    const response = await this.request<{ data: { space: Space } }>(
      '/api/v1/spaces',
      { method: 'POST', accessToken, body: payload }
    );
    return response.data.space;
  }

  /**
   * Dedicated "save this search as a Space" call. Server-side it is
   * the same handler with `spaceType` pinned to `smart`, which stops
   * the client from ever sending a mismatched { spaceType, rule } pair.
   */
  async createSmartSpace(
    payload: {
      name: string;
      description?: string;
      color?: SpaceColor;
      rule: SpaceRule;
    },
    accessToken: string
  ): Promise<Space> {
    const response = await this.request<{ data: { space: Space } }>(
      '/api/v1/spaces/from-search',
      { method: 'POST', accessToken, body: payload }
    );
    return response.data.space;
  }

  async updateSpace(
    id: string,
    patch: Partial<Pick<Space, 'name' | 'description' | 'color' | 'coverItemId' | 'rule'>>,
    accessToken: string
  ): Promise<Space | null> {
    const response = await this.request<{ data: { space: Space | null } }>(
      `/api/v1/spaces/${encodeURIComponent(id)}`,
      { method: 'PATCH', accessToken, body: patch }
    );
    return response.data.space;
  }

  async deleteSpace(id: string, accessToken: string): Promise<void> {
    await this.request<void>(`/api/v1/spaces/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      accessToken,
      parseJson: false
    });
  }

  /**
   * Members of a Space. For a manual Space these are the persisted
   * membership rows; for a smart Space the server re-runs the stored
   * criteria, so the result reflects memories captured since the Space
   * was created.
   */
  async listSpaceItems(
    id: string,
    accessToken: string
  ): Promise<{ ids: string[]; items: SpacePreviewItem[]; source: SpaceType; total?: number }> {
    const response = await this.request<{
      data: { ids: string[]; items: SpacePreviewItem[]; source: SpaceType; total?: number };
    }>(`/api/v1/spaces/${encodeURIComponent(id)}/items`, { accessToken });
    return response.data;
  }

  /**
   * Add memories to a manual Space. Idempotent: an id that is already
   * a member comes back under `skipped` rather than failing the call.
   */
  async addItemsToSpace(
    spaceId: string,
    itemIds: string[],
    accessToken: string
  ): Promise<{ added: string[]; skipped: string[] }> {
    const response = await this.request<{ data: { added: string[]; skipped: string[] } }>(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/items`,
      { method: 'POST', accessToken, body: { itemIds } }
    );
    return response.data;
  }

  async removeItemFromSpace(spaceId: string, itemId: string, accessToken: string): Promise<void> {
    await this.request<void>(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE', accessToken, parseJson: false }
    );
  }

  async forgotPassword(email: string): Promise<void> {
    // Always 200 — anti-enumeration. We deliberately swallow the body.
    await this.request<unknown>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: { email }
    });
  }

  async resetPassword(payload: { accessToken: string; refreshToken: string; newPassword: string }): Promise<Session> {
    const envelope = await this.request<AuthEnvelope>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: payload
    });
    const session = this.envelopeToSession(envelope);
    if (!session) {
      throw new ApiError(500, 'Không nhận được session sau khi đặt lại mật khẩu', 'AUTH_RESET_NO_SESSION');
    }
    return session;
  }

  async resendVerification(accessToken: string): Promise<void> {
    await this.request<void>('/api/v1/auth/resend-verification', {
      method: 'POST',
      accessToken,
      parseJson: false
    });
  }

  async captureText(payload: {
    type: 'text' | 'link';
    title: string;
    sourceUrl?: string;
    selectedText?: string;
    capturedAt?: string;
    clientRequestId: string;
  }, accessToken: string): Promise<{ id: string; status: string }> {
    const response = await this.request<{ data: { id: string; status: string } }>('/api/v1/captures', {
      method: 'POST',
      body: payload,
      accessToken
    });
    return response.data;
  }

  /**
   * Multipart document upload. The web dashboard hands the picked file
   * straight to the API; the server is the save boundary so the
   * dashboard never has to base64 the bytes or stash them in localStorage.
   *
   * `onProgress` is optional. The browser's `fetch` doesn't expose
   * upload progress, so we report phases (`uploading` -> `finalizing`)
   * rather than a byte count. Errors are mapped to a small set of
   * user-facing categories so the UI can render a specific message
   * instead of the raw server stack.
   */
  async uploadDocumentCapture(
    payload: {
      file: File;
      title: string;
      sourceUrl?: string;
      capturedAt?: string;
      clientRequestId: string;
    },
    accessToken: string,
    onProgress?: (phase: 'uploading' | 'finalizing') => void
  ): Promise<{ id: string; status: string; signedUrl?: string }> {
    const form = new FormData();
    form.append('file', payload.file, payload.file.name);
    form.append('title', payload.title);
    if (payload.sourceUrl) form.append('sourceUrl', payload.sourceUrl);
    if (payload.capturedAt) form.append('capturedAt', payload.capturedAt);
    form.append('clientRequestId', payload.clientRequestId);

    onProgress?.('uploading');
    const response = await fetch(this.baseUrl + '/api/v1/captures/document', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form
    });
    onProgress?.('finalizing');

    const text = await response.text();
    let payload2: unknown = null;
    if (text.length > 0) {
      try {
        payload2 = JSON.parse(text);
      } catch {
        payload2 = { error: { message: text } };
      }
    }

    if (!response.ok) {
      const errPayload = payload2 as ApiErrorPayload;
      const message = errPayload?.error?.message || `HTTP ${response.status}`;
      throw new ApiError(
        response.status,
        message,
        errPayload?.error?.code,
        errPayload?.error?.requestId
      );
    }

    const data = (payload2 as { data?: { id: string; status: string; signedUrl?: string } })?.data;
    if (!data) {
      throw new ApiError(response.status, 'Unexpected empty response', 'EMPTY_RESPONSE');
    }
    return data;
  }

/**
 * Content Cluster API.
 *
 * Mirrors the spec at `specs/api/clusters.md` (this file is its
 * reference implementation). All three endpoints are
 * user-scoped — the token is the only source of user identity,
 * the body is never read for it.
 */
  async listClusters(accessToken: string): Promise<ClusterListResponse['data']> {
    const r = await this.request<ClusterListResponse>('/api/v1/clusters', {
      method: 'GET',
      accessToken
    });
    return r.data;
  }

  async getCluster(
    id: string,
    accessToken: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ClusterDetailResponse['data']> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    const r = await this.request<ClusterDetailResponse>(
      `/api/v1/clusters/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`,
      { method: 'GET', accessToken }
    );
    return r.data;
  }

  async refreshClusters(
    accessToken: string
  ): Promise<ClusterRefreshResponse['data']> {
    const r = await this.request<ClusterRefreshResponse>('/api/v1/clusters/refresh', {
      method: 'POST',
      accessToken
    });
    return r.data;
  }

  async saveClusterAsSpace(
    id: string,
    accessToken: string,
    body: { name?: string; description?: string | null; color?: string } = {}
  ): Promise<SaveClusterAsSpaceResponse['data']> {
    const r = await this.request<SaveClusterAsSpaceResponse>(
      `/api/v1/clusters/${encodeURIComponent(id)}/save-as-space`,
      { method: 'POST', body, accessToken }
    );
    return r.data;
  }

  loadStoredSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Session;
      if (!parsed || !parsed.accessToken || !parsed.user) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  saveSession(session: Session | null): void {
    if (!session) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
}
