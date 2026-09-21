/**
 * API Client for Web Dashboard
 */

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
  hits: Array<{
    id: string;
    kind: string;
    title: string;
    snippet?: string;
    score?: number;
    captured_at: string;
    tags?: string[];
  }>;
  total: number;
  took_ms: number;
}

interface LoginRequest {
  email: string;
  password: string;
}

interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: {
    id: string;
    email: string;
    name?: string;
    role: string;
  };
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = this.baseUrl + path;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.error?.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async login(request: LoginRequest): Promise<{ data: Session }> {
    return this.request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  async register(request: RegisterRequest): Promise<{ data: Session }> {
    return this.request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  async logout(accessToken: string): Promise<number> {
    const response = await fetch(this.baseUrl + '/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });
    return response.status;
  }

  async search(request: SearchRequest, accessToken: string): Promise<SearchResponse> {
    const url = new URL(this.baseUrl + '/api/v1/search');
    url.searchParams.set('q', request.q);
    if (request.limit) url.searchParams.set('limit', request.limit.toString());
    if (request.offset) url.searchParams.set('offset', request.offset.toString());

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`);
    }

    return response.json();
  }

  async deleteItem(id: string, accessToken: string): Promise<void> {
    await this.request(`/api/v1/items/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  }

  async listItems(
    accessToken: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ items: unknown[]; total: number }> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.offset) params.set('offset', options.offset.toString());

    return this.request(`/api/v1/items?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  }
}
