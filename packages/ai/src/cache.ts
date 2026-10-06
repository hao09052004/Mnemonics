/**
 * Simple in-memory LRU-ish cache keyed by sha256 of provider-relevant
 * content. Used to avoid sending the same content to external AI
 * providers twice.
 *
 * Why in-memory only: this runs inside a single Node process and the
 * product is single-user per server instance in the demo. A future
 * Redis-backed implementation can keep the same interface and be
 * swapped in via ai-service.ts.
 *
 * Thread-safety: Node is single-threaded for JS callbacks, so no
 * locking is required.
 */

export interface CacheStore<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  size(): number;
  clear(): void;
}

interface Entry<V> {
  value: V;
  expiresAt: number; // ms since epoch
}

export class MemoryCache<V> implements CacheStore<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  constructor(opts: { defaultTtlMs?: number; maxEntries?: number } = {}) {
    this.defaultTtlMs = opts.defaultTtlMs ?? 60 * 60 * 1000; // 1 hour
    this.maxEntries = opts.maxEntries ?? 1000;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU order on read
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
    this.evictIfNeeded();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

/**
 * Test helper. Most callers should use a shared cache via ai-service.
 */
export function createMemoryCache<V>(opts?: { defaultTtlMs?: number; maxEntries?: number }): MemoryCache<V> {
  return new MemoryCache<V>(opts);
}
