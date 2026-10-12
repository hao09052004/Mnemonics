import type { Plugin } from 'vite';

interface MockItem {
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
  raw_text?: string | null;
  ocr_text?: string | null;
  is_favorite?: boolean;
  page_count?: number | null;
}

const initialItems: MockItem[] = [
  {
    id: 'mem-001',
    kind: 'link',
    title: 'Building Reliable Distributed Systems with Event Sourcing',
    snippet: 'Comprehensive guide covering event store architecture, optimistic concurrency control, idempotency, and projection rebuilding strategies.',
    raw_text: 'Event sourcing guarantees complete auditability by persisting state changes as an immutable sequence of events. When designing projections...',
    captured_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    tags: ['architecture', 'distributed-systems', 'event-sourcing'],
    status: 'ready',
    source_url: 'https://martinfowler.com/articles/event-sourcing.html',
    is_favorite: true
  },
  {
    id: 'mem-002',
    kind: 'text',
    title: 'Note: Karpathy Heuristics for LLM Application Engineering',
    snippet: 'Think before coding. Make surgical changes. Simplify first. Define verifiable goals before touching production systems.',
    raw_text: 'Core principles: 1. Don\'t assume, surface tradeoffs. 2. Minimum code that solves the problem. 3. Touch only what you must. 4. Loop until verified.',
    captured_at: new Date(Date.now() - 3600000 * 12).toISOString(),
    tags: ['ai', 'best-practices', 'heuristics'],
    status: 'ready',
    is_favorite: true
  },
  {
    id: 'mem-003',
    kind: 'link',
    title: 'PostgreSQL pgvector: Performance Tuning and Indexing Guidelines',
    snippet: 'Choosing between HNSW and IVFFlat index types, tuning m and ef_construction parameters, and memory considerations for high-dimensional embeddings.',
    raw_text: 'HNSW provides faster query latency at the expense of longer index build times and higher RAM usage. For 1024-dimensional embeddings...',
    captured_at: new Date(Date.now() - 3600000 * 28).toISOString(),
    tags: ['database', 'pgvector', 'postgres'],
    status: 'ready',
    source_url: 'https://github.com/pgvector/pgvector'
  },
  {
    id: 'mem-004',
    kind: 'image',
    title: 'Screenshot: System Architecture & Knowledge Graph Schema',
    snippet: 'High-level diagram illustrating the browser capture pipeline, OCR processing, semantic vectorization, and cluster refresh triggers.',
    raw_text: 'Architecture overview: Browser Extension -> Fastify Capture Endpoint -> Job Queue Worker -> pgvector database + Web Dashboard UI.',
    captured_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    tags: ['architecture', 'knowledge-graph', 'diagram'],
    status: 'ready',
    image_url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80',
    is_favorite: false
  },
  {
    id: 'mem-005',
    kind: 'text',
    title: 'Quick Idea: Local-first Sync with SQLite CRDTs',
    snippet: 'Exploration of Yjs and cr-sqlite for offline-capable knowledge bases that merge cleanly across browser tabs and mobile devices.',
    raw_text: 'Conflict-free replicated data types provide mathematical guarantees for converging edits without a central coordinator...',
    captured_at: new Date(Date.now() - 3600000 * 72).toISOString(),
    tags: ['crdt', 'local-first', 'ideas'],
    status: 'ready',
    is_favorite: false
  }
];

let itemsStore = [...initialItems];

const demoUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@mnemonics.local',
  name: 'Mnemonics Demo User',
  role: 'admin',
  emailVerified: true
};

const demoSession = {
  accessToken: 'mnemonics-demo-token',
  refreshToken: 'mnemonics-demo-refresh-token',
  expiresAt: Math.floor(Date.now() / 1000) + 86400 * 7,
  tokenType: 'bearer' as const
};

const demoSpaces = [
  {
    id: 'space-arch',
    userId: demoUser.id,
    name: 'Architecture & Systems',
    description: 'Core reading list and diagrams for distributed systems and storage design.',
    color: 'violet' as const,
    spaceType: 'manual' as const,
    coverItemId: 'mem-001',
    rule: null,
    ruleVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    itemCount: 3,
    previewItems: [
      { id: 'mem-001', kind: 'link', title: 'Building Reliable Distributed Systems', thumbnailUrl: null, isFavorite: true },
      { id: 'mem-003', kind: 'link', title: 'PostgreSQL pgvector', thumbnailUrl: null, isFavorite: false },
      { id: 'mem-004', kind: 'image', title: 'System Architecture Diagram', thumbnailUrl: null, isFavorite: false }
    ]
  },
  {
    id: 'space-ai',
    userId: demoUser.id,
    name: 'AI Engineering & Search',
    description: 'LLM best practices, vector search techniques, and prompt heuristics.',
    color: 'teal' as const,
    spaceType: 'smart' as const,
    coverItemId: null,
    rule: { q: 'ai OR heuristics OR vector' },
    ruleVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    itemCount: 2,
    previewItems: [
      { id: 'mem-002', kind: 'text', title: 'Karpathy Heuristics', thumbnailUrl: null, isFavorite: true },
      { id: 'mem-003', kind: 'link', title: 'pgvector Guidelines', thumbnailUrl: null, isFavorite: false }
    ]
  }
];

const demoClusters = [
  {
    id: 'cluster-sys',
    title: 'Distributed Systems & Vector Databases',
    summary: 'A dense cluster of 3 memories centered around infrastructure scaling and similarity indexing.',
    itemCount: 3,
    representativeItemId: 'mem-001',
    algorithmVersion: 'v1.0-kmeans',
    embeddingModel: 'text-embedding-004',
    similarityThreshold: 0.82,
    minSize: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    representativeItems: [
      { id: 'mem-001', kind: 'link', title: 'Building Reliable Distributed Systems', thumbnailUrl: null, isFavorite: true },
      { id: 'mem-003', kind: 'link', title: 'PostgreSQL pgvector', thumbnailUrl: null, isFavorite: false }
    ]
  }
];

const demoPlans = [
  {
    id: 'memory-free',
    displayName: 'Memory Free',
    family: 'memory' as const,
    interval: 'forever' as const,
    amountVnd: 0,
    monthlyCaptureLimit: 100,
    semanticSearchEnabled: true,
    isActive: true
  },
  {
    id: 'mastery-monthly',
    displayName: 'Mastery Monthly',
    family: 'mastery' as const,
    interval: 'month' as const,
    amountVnd: 149000,
    monthlyCaptureLimit: null,
    semanticSearchEnabled: true,
    isActive: true
  },
  {
    id: 'mastery-yearly',
    displayName: 'Mastery Yearly',
    family: 'mastery' as const,
    interval: 'year' as const,
    amountVnd: 1490000,
    monthlyCaptureLimit: null,
    semanticSearchEnabled: true,
    isActive: true
  }
];

export function devApiPlugin(): Plugin {
  return {
    name: 'mnemonics-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) {
          return next();
        }

        const method = req.method || 'GET';
        res.setHeader('Content-Type', 'application/json');

        // Helper to read json body
        const readBody = async (): Promise<Record<string, unknown>> => {
          return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
              try { resolve(JSON.parse(body)); } catch { resolve({}); }
            });
          });
        };

        // 1. Health
        if (url === '/api/v1/health') {
          res.end(JSON.stringify({ data: { status: 'ok', mock: true } }));
          return;
        }

        // 2. Auth Endpoints
        if (url === '/api/v1/auth/login' || url === '/api/v1/auth/register') {
          const body = await readBody();
          const user = {
            ...demoUser,
            email: (body.email as string) || demoUser.email,
            name: (body.name as string) || demoUser.name
          };
          res.end(JSON.stringify({ data: { user, session: demoSession } }));
          return;
        }

        if (url === '/api/v1/auth/me') {
          res.end(JSON.stringify({
            data: {
              user: {
                ...demoUser,
                permissions: ['user', 'admin']
              }
            }
          }));
          return;
        }

        if (url === '/api/v1/auth/refresh') {
          res.end(JSON.stringify({ data: { user: demoUser, session: demoSession } }));
          return;
        }

        if (url === '/api/v1/auth/logout') {
          res.statusCode = 204;
          res.end();
          return;
        }

        // 3. Items Endpoints
        if (url.startsWith('/api/v1/items')) {
          const parsed = new URL(url, 'http://localhost');
          const pathname = parsed.pathname;

          if (pathname === '/api/v1/items' && method === 'GET') {
            const favorite = parsed.searchParams.get('favorite');
            let result = [...itemsStore];
            if (favorite === 'true') {
              result = result.filter(i => i.is_favorite);
            }
            res.end(JSON.stringify({
              data: {
                items: result,
                total: result.length,
                limit: 50,
                offset: 0
              }
            }));
            return;
          }

          // Single item detail / patch / delete
          const itemMatch = pathname.match(/^\/api\/v1\/items\/([^/]+)$/);
          if (itemMatch) {
            const id = itemMatch[1];
            if (method === 'GET') {
              const found = itemsStore.find(i => i.id === id) || itemsStore[0];
              res.end(JSON.stringify({ item: found }));
              return;
            }
            if (method === 'PATCH') {
              const body = await readBody();
              itemsStore = itemsStore.map(i => {
                if (i.id === id) {
                  return {
                    ...i,
                    ...(body.isFavorite !== undefined ? { is_favorite: Boolean(body.isFavorite) } : {}),
                    ...(body.title !== undefined ? { title: String(body.title) } : {}),
                    ...(body.notes !== undefined ? { notes: String(body.notes) } : {})
                  };
                }
                return i;
              });
              res.end(JSON.stringify({ success: true }));
              return;
            }
            if (method === 'DELETE') {
              itemsStore = itemsStore.filter(i => i.id !== id);
              res.statusCode = 204;
              res.end();
              return;
            }
          }

          // Related items
          if (pathname.includes('/related')) {
            const related = itemsStore.slice(0, 3).map(i => ({
              id: i.id,
              type: i.kind,
              title: i.title,
              captured_at: i.captured_at,
              similarity: 0.89
            }));
            res.end(JSON.stringify({ related_items: related }));
            return;
          }

          // Enrichment
          if (pathname.includes('/enrichment')) {
            res.end(JSON.stringify({
              data: {
                enrichment: {
                  itemId: 'mem-001',
                  caption: 'Architecture breakdown and indexing guidelines',
                  captionStatus: 'ready',
                  tldr: 'Key principles and architectural recommendations for distributed systems.',
                  tldrStatus: 'ready',
                  summary: null,
                  updatedAt: new Date().toISOString()
                }
              }
            }));
            return;
          }
        }

        // 4. Captures
        if (url.startsWith('/api/v1/captures')) {
          const body = await readBody();
          const newId = `mem-${Date.now().toString().slice(-4)}`;
          const newItem: MockItem = {
            id: newId,
            kind: (body.type as string) || 'text',
            title: (body.title as string) || (body.sourceUrl as string) || 'Untitled Memory',
            snippet: (body.selectedText as string) || (body.rawText as string) || '',
            raw_text: (body.rawText as string) || (body.selectedText as string) || null,
            captured_at: new Date().toISOString(),
            tags: ['new-capture'],
            status: 'ready',
            source_url: (body.sourceUrl as string) || undefined,
            is_favorite: false
          };
          itemsStore.unshift(newItem);
          res.end(JSON.stringify({ data: { id: newId, status: 'ready' } }));
          return;
        }

        // 5. Search
        if (url.startsWith('/api/v1/search')) {
          const parsed = new URL(url, 'http://localhost');
          const q = (parsed.searchParams.get('q') || '').toLowerCase();
          const hits = q
            ? itemsStore.filter(i => i.title.toLowerCase().includes(q) || (i.snippet && i.snippet.toLowerCase().includes(q)))
            : itemsStore;
          res.end(JSON.stringify({
            hits,
            total: hits.length,
            took_ms: 14
          }));
          return;
        }

        // 6. Spaces
        if (url.startsWith('/api/v1/spaces')) {
          res.end(JSON.stringify({ data: { spaces: demoSpaces } }));
          return;
        }

        // 7. Clusters
        if (url.startsWith('/api/v1/clusters')) {
          res.end(JSON.stringify({
            data: {
              clusters: demoClusters,
              unclusteredCount: 0
            }
          }));
          return;
        }

        // 8. Tags
        if (url.startsWith('/api/v1/tags')) {
          const tags = [
            { id: 'tag-1', name: 'architecture', item_count: 2 },
            { id: 'tag-2', name: 'ai', item_count: 1 },
            { id: 'tag-3', name: 'pgvector', item_count: 1 },
            { id: 'tag-4', name: 'crdt', item_count: 1 }
          ];
          res.end(JSON.stringify({ tags, total: tags.length }));
          return;
        }

        // 9. Billing
        if (url === '/api/v1/billing/plans') {
          res.end(JSON.stringify({ data: { plans: demoPlans } }));
          return;
        }
        if (url === '/api/v1/billing/me') {
          res.end(JSON.stringify({
            data: {
              entitlement: {
                planId: 'mastery-yearly',
                family: 'mastery',
                validUntil: '2028-01-01T00:00:00Z',
                semanticSearchEnabled: true,
                monthlyCaptureLimit: null
              }
            }
          }));
          return;
        }
        if (url.startsWith('/api/v1/billing/orders')) {
          res.end(JSON.stringify({ data: { items: [], limit: 20, offset: 0 } }));
          return;
        }

        // 10. Analytics
        if (url.startsWith('/api/v1/analytics/me/overview')) {
          res.end(JSON.stringify({
            data: {
              totalCaptures: itemsStore.length,
              thisMonth: itemsStore.length,
              capturesThisPeriod: itemsStore.length,
              daysWindow: 30,
              plan: {
                planId: 'mastery-yearly',
                family: 'mastery',
                validUntil: null,
                semanticSearchEnabled: true,
                monthlyCaptureLimit: null,
                remainingCaptures: null
              },
              spaces: demoSpaces.length,
              distinctTags: 4,
              aiCallsThisPeriod: 12,
              byType: [
                { type: 'link', count: 2 },
                { type: 'text', count: 2 },
                { type: 'image', count: 1 }
              ]
            }
          }));
          return;
        }
        if (url.startsWith('/api/v1/analytics/me/captures')) {
          res.end(JSON.stringify({
            data: {
              days: 30,
              series: [
                { day: '2026-10-10', count: 2 },
                { day: '2026-10-11', count: 3 }
              ]
            }
          }));
          return;
        }

        // 11. Admin Endpoints
        if (url.startsWith('/api/v1/admin/overview')) {
          res.end(JSON.stringify({
            data: {
              users: { total: 1, newToday: 1, new30d: 1, memoryPlan: 0, masteryPlan: 1 },
              revenue: { verifiedVnd: 1490000, refundedVnd: 0, pendingVnd: 0, verifiedOrders: 1, paid30dVnd: 1490000 },
              product: { totalCaptures: itemsStore.length, captures30d: itemsStore.length, successRate: 100, semanticSearch30d: 25 }
            }
          }));
          return;
        }
        if (url.startsWith('/api/v1/admin/users')) {
          res.end(JSON.stringify({
            data: {
              items: [{
                id: demoUser.id,
                email: demoUser.email,
                role: 'admin',
                is_suspended: false,
                created_at: new Date().toISOString(),
                plan_id: 'mastery-yearly',
                family: 'mastery',
                valid_until: null,
                memory_count: String(itemsStore.length),
                subscription_status: 'active'
              }],
              limit: 50,
              offset: 0
            }
          }));
          return;
        }
        if (url.startsWith('/api/v1/admin/payments')) {
          res.end(JSON.stringify({ data: { items: [], limit: 50, offset: 0 } }));
          return;
        }
        if (url.startsWith('/api/v1/admin/audit-logs')) {
          res.end(JSON.stringify({ data: { items: [], limit: 50, offset: 0 } }));
          return;
        }
        if (url.startsWith('/api/v1/admin/analytics')) {
          res.end(JSON.stringify({
            data: {
              range: { from: '2026-09-12', to: '2026-10-12' },
              pending: { count: 0, vnd: 0 },
              paid: { count: 1, vnd: 1490000 },
              refunded: { count: 0, vnd: 0 },
              cancelled: { count: 0, vnd: 0 },
              rejected: { count: 0, vnd: 0 },
              byInterval: [{ interval: 'year', count: 1, vnd: 1490000 }],
              daily: [{ day: '2026-10-10', count: 1, vnd: 1490000 }],
              estimatedMonthlyRunRate: { vnd: 124166, activeSubscribers: 1, caveat: 'Annual amortized' }
            }
          }));
          return;
        }

        // Default mock response for any unhandled GET/POST
        res.end(JSON.stringify({ data: {} }));
      });
    }
  };
}
