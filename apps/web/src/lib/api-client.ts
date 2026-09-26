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

export type { AuthUser, AuthSession, AuthEnvelope, Session, Item, ListItemsResponse, SearchRequest, SearchResponse, LoginRequest, RegisterRequest, ListItemsParams, RelatedItem };

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

  /** Session storage helpers (web localStorage). */

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
