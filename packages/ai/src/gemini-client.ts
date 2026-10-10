/**
 * Centralised Gemini HTTP client.
 *
 * Every Gemini call in this package — text generation, embeddings,
 * multimodal OCR, image description, TLDR, and visual embeddings —
 * goes through `callGemini()`. Centralising the request/response
 * lifecycle gives us one place to enforce:
 *
 *   - bounded timeout (AbortController, default 20 s; production
 *     overrides via GEMINI_REQUEST_TIMEOUT_MS to 45 s)
 *   - exponential backoff with jitter, capped at GEMINI_MAX_RETRIES
 *   - respect for the `Retry-After` header on 429
 *   - retryable vs. non-retryable classification of HTTP and
 *     network errors (auth, 400, 404 = never retry; 429, 5xx,
 *     network, timeout = retry)
 *   - per-process concurrency cap (a token bucket) so a burst of
 *     capture jobs does not stampede the Free Tier RPM
 *   - per-process RPM pacing (sliding window)
 *   - circuit breaker: after N consecutive failures, short-circuit
 *     for a cooldown window so we do not hammer a dead provider
 *   - sanitised telemetry: provider/model/task/latency/retry
 *     count/http status are recorded; the API key, prompt, and
 *     image bytes are never logged
 *
 * The client is dependency-free (Node 18+ global `fetch` and
 * `crypto`). It does NOT pull a logger, a metrics client, or an
 * event emitter; callers may subscribe to telemetry via the
 * `onTelemetry` constructor option.
 */

import { ProviderError } from "./types.js";

export type GeminiTask = "text" | "embedding" | "multimodal" | "visual-embedding";

export interface GeminiCallRequest {
  apiKey: string;
  model: string;
  task: GeminiTask;
  /**
   * URL path under `https://generativelanguage.googleapis.com/v1beta/`.
   * The client appends `?key=…` for you. Example: `models/gemini-3.8-flash:generateContent`.
   */
  path: string;
  /** JSON body to POST. */
  body: unknown;
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /**
   * Total wall-clock budget across all attempts. When the budget
   * would be exceeded the loop short-circuits with TIMEOUT. Default
   * unbounded (i.e. just retry + per-attempt timeout).
   */
  totalBudgetMs?: number;
  /**
   * Abort signal from the caller. The client propagates AbortError
   * as a non-retryable ProviderError so the worker's cancellation
   * is honoured.
   */
  signal?: AbortSignal;
}

export interface GeminiCallTelemetry {
  provider: "gemini";
  task: GeminiTask;
  model: string;
  latencyMs: number;
  attempts: number;
  httpStatus: number | null;
  outcome: "success" | "error" | "aborted";
  errorCode?: string;
  retryAfterMs?: number;
}

export type GeminiTelemetryListener = (event: GeminiCallTelemetry) => void;

/** Defaults; all overridable via the `GeminiClientOptions` below. */
const DEFAULTS = {
  timeoutMs: 20_000,
  maxRetries: 3, // total attempts; 1 retry = 2 attempts
  maxConcurrent: 4,
  rateLimitRpm: 30,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 60_000,
  queueWaitTimeoutMs: 30_000
};

export interface GeminiClientOptions {
  /**
   * Per-attempt timeout. Default 20 000 ms.
   * Production override: GEMINI_REQUEST_TIMEOUT_MS (45 000 ms).
   */
  timeoutMs?: number;
  /** Total attempts. Default 3. Production override: GEMINI_MAX_RETRIES. */
  maxRetries?: number;
  /** Concurrent in-flight requests. Default 4. Override: GEMINI_MAX_CONCURRENT_REQUESTS. */
  maxConcurrent?: number;
  /** Soft RPM cap. Default 30. Override: GEMINI_RATE_LIMIT_RPM. */
  rateLimitRpm?: number;
  /**
   * Hard cap on how long `pace()` may sleep before admitting a
   * request. 0 disables the cap. Default 30 000 ms. Override:
   * GEMINI_QUEUE_WAIT_TIMEOUT_MS.
   */
  queueWaitTimeoutMs?: number;
  /**
   * After this many CONSECUTIVE failures the breaker opens and
   * short-circuits new requests for `circuitBreakerCooldownMs`.
   * Default 5.
   */
  circuitBreakerThreshold?: number;
  /**
   * How long the breaker stays open before a single probe is
   * allowed. Default 60 000 ms.
   */
  circuitBreakerCooldownMs?: number;
  /** Optional listener for sanitised telemetry. */
  onTelemetry?: GeminiTelemetryListener;
  /** Injectable clock + sleep for tests. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable fetch for tests. Default: globalThis.fetch. */
  fetch?: typeof fetch;
}

/**
 * The default sleep implementation. Honours AbortSignal so the
 * worker's overall deadline still wins.
 */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Token-bucket-ish concurrency limiter. `acquire` resolves when a
 * slot is free, `release` returns it. The implementation is
 * deliberately small and dependency-free so it can be shared by
 * every provider call in the package.
 */
class Semaphore {
  private inFlight = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.inFlight < this.capacity) {
      this.inFlight += 1;
      return;
    }
    return new Promise((resolve, reject) => {
      const w = () => {
        this.inFlight += 1;
        resolve();
      };
      const onAbort = () => {
        const idx = this.waiters.indexOf(w);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error("aborted"));
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(w);
    });
  }

  release(): void {
    this.inFlight -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/**
 * Sliding-window RPM pacer. Tracks timestamps of recent successful
 * admissions and, on each `pace()` call, sleeps until the oldest
 * timestamp falls outside the 60-s window.
 */
class RpmPacer {
  private stamps: number[] = [];

  constructor(
    private readonly rpm: number,
    private readonly nowFn: () => number,
    private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>
  ) {}

  async pace(signal?: AbortSignal): Promise<void> {
    const windowMs = 60_000;
    const now = this.nowFn();
    // drop stamps outside the window
    while (this.stamps.length > 0 && this.stamps[0] <= now - windowMs) {
      this.stamps.shift();
    }
    if (this.stamps.length < this.rpm) {
      this.stamps.push(now);
      return;
    }
    const oldest = this.stamps[0];
    const wait = Math.max(0, oldest + windowMs - now) + 25; // 25 ms grace
    await this.sleepFn(wait, signal);
    this.stamps.shift();
    this.stamps.push(this.nowFn());
  }

  /**
   * Like `pace` but throws `QueueWaitTimeoutError` if the pacer would
   * have to sleep more than `capMs` before admitting the next call.
   * Returns immediately when the slot is free.
   */
  async paceWithCap(capMs: number, signal?: AbortSignal): Promise<void> {
    if (capMs <= 0) {
      await this.pace(signal);
      return;
    }
    const windowMs = 60_000;
    const now = this.nowFn();
    while (this.stamps.length > 0 && this.stamps[0] <= now - windowMs) {
      this.stamps.shift();
    }
    if (this.stamps.length < this.rpm) {
      this.stamps.push(now);
      return;
    }
    const oldest = this.stamps[0];
    const wait = Math.max(0, oldest + windowMs - now) + 25;
    if (wait > capMs) {
      throw new QueueWaitTimeoutError(wait, capMs);
    }
    await this.sleepFn(wait, signal);
    this.stamps.shift();
    this.stamps.push(this.nowFn());
  }
}

export class QueueWaitTimeoutError extends ProviderError {
  constructor(waitMs: number, capMs: number) {
    super({
      message: `Gemini queue wait ${waitMs}ms exceeds cap ${capMs}ms`,
      code: "TIMEOUT",
      provider: "gemini",
      retryable: true,
      retryAfterMs: waitMs
    });
  }
}

export class GeminiCircuitOpenError extends ProviderError {
  constructor(retryAfterMs: number) {
    super({
      message: `Gemini circuit breaker open; cool-down ${retryAfterMs}ms`,
      code: "RATE_LIMITED",
      provider: "gemini",
      retryable: true,
      retryAfterMs
    });
  }
}

export class GeminiClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sem: Semaphore;
  private readonly rpm: RpmPacer;
  private readonly queueWaitCapMs: number;
  private readonly cbThreshold: number;
  private readonly cbCooldownMs: number;
  private readonly onTelemetry?: GeminiTelemetryListener;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly fetchFn: typeof fetch;

  // circuit breaker state
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;

  constructor(opts: GeminiClientOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = Math.max(1, opts.maxRetries ?? DEFAULTS.maxRetries);
    this.sem = new Semaphore(Math.max(1, opts.maxConcurrent ?? DEFAULTS.maxConcurrent));
    const rpm = Math.max(1, opts.rateLimitRpm ?? DEFAULTS.rateLimitRpm);
    this.rpm = new RpmPacer(rpm, opts.now ?? Date.now, opts.sleep ?? defaultSleep);
    this.queueWaitCapMs = Math.max(0, opts.queueWaitTimeoutMs ?? DEFAULTS.queueWaitTimeoutMs);
    this.cbThreshold = opts.circuitBreakerThreshold ?? DEFAULTS.circuitBreakerThreshold;
    this.cbCooldownMs = opts.circuitBreakerCooldownMs ?? DEFAULTS.circuitBreakerCooldownMs;
    this.onTelemetry = opts.onTelemetry;
    this.nowFn = opts.now ?? Date.now;
    this.sleepFn = opts.sleep ?? defaultSleep;
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Inspect circuit-breaker state. Used by the readiness probe
   * and by the AI service to surface "Gemini temporarily disabled"
   * to health checks.
   */
  isHealthy(): boolean {
    return this.nowFn() >= this.breakerOpenUntil;
  }

  /**
   * Cooldown remaining in ms; 0 when the breaker is closed.
   */
  breakerRemainingMs(): number {
    return Math.max(0, this.breakerOpenUntil - this.nowFn());
  }

  private openBreaker(): void {
    this.breakerOpenUntil = this.nowFn() + this.cbCooldownMs;
    this.consecutiveFailures = 0; // reset so a probe after cooldown starts fresh
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.cbThreshold) {
      this.openBreaker();
    }
  }

  /**
   * POST a JSON body to the Gemini REST API. Returns the parsed
   * JSON response. Throws ProviderError on every failure mode
   * (timeout, 4xx, 5xx, network, breaker open).
   */
  async call<T>(req: GeminiCallRequest): Promise<T> {
    const startedAt = this.nowFn();
    const totalBudget = req.totalBudgetMs ?? Number.POSITIVE_INFINITY;
    const maxAttempts = Math.max(1, req.maxAttempts ?? this.maxRetries);

    // Circuit breaker short-circuit. We still honour the signal so
    // a shutdown can cancel the wait.
    if (this.nowFn() < this.breakerOpenUntil) {
      const wait = this.breakerOpenUntil - this.nowFn();
      this.emit({
        provider: "gemini",
        task: req.task,
        model: req.model,
        latencyMs: 0,
        attempts: 0,
        httpStatus: null,
        outcome: "error",
        errorCode: "RATE_LIMITED",
        retryAfterMs: wait
      });
      throw new GeminiCircuitOpenError(wait);
    }

    await this.sem.acquire(req.signal);
    let slotReleased = false;
    const releaseOnce = () => {
      if (slotReleased) return;
      slotReleased = true;
      this.sem.release();
    };

    let lastErr: ProviderError | null = null;
    let attempts = 0;
    let lastHttpStatus: number | null = null;
    let lastErrorCode: string | undefined;
    let lastRetryAfterMs: number | undefined;

    try {
      // Pace to the RPM cap BEFORE the first attempt so a burst
      // of capture jobs does not stampede the Free Tier. The
      // pacer wait is bounded by `queueWaitCapMs` so a long
      // queue wait cannot cause a request to time out before it
      // actually fires — and the request-execution budget below
      // starts AFTER the pacer, so the wait is not double-counted.
      await this.rpm.paceWithCap(this.queueWaitCapMs, req.signal);
      // Wall-clock start for the REQUEST EXECUTION budget. The pacer
      // wait above is excluded so a long queue wait cannot cause a
      // request to time out before it actually fires.
      const execStartedAt = this.nowFn();

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        attempts = attempt + 1;
        if (this.nowFn() - execStartedAt > totalBudget) {
          lastErr = new ProviderError({
            message: "Gemini request-execution budget exceeded",
            code: "TIMEOUT",
            provider: "gemini",
            retryable: true
          });
          lastErrorCode = "TIMEOUT";
          break;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        // Chain the caller's signal so an external abort still wins.
        const onCallerAbort = () => controller.abort();
        if (req.signal) req.signal.addEventListener("abort", onCallerAbort, { once: true });

        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/${req.path}?key=${encodeURIComponent(req.apiKey)}`;
          const res = await this.fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(req.body),
            signal: controller.signal
          });
          clearTimeout(timer);
          if (req.signal) req.signal.removeEventListener("abort", onCallerAbort);

          if (res.ok) {
            const data = (await res.json()) as T;
            this.recordSuccess();
            this.emit({
              provider: "gemini",
              task: req.task,
              model: req.model,
              latencyMs: this.nowFn() - startedAt,
              attempts,
              httpStatus: res.status,
              outcome: "success"
            });
            return data;
          }

          lastHttpStatus = res.status;
          const body = await res.text().catch(() => "");
          // Truncate aggressively; never include the request body in
          // an error message (it may contain user content).
          const bodyExcerpt = body.slice(0, 200);

          if (res.status === 401 || res.status === 403) {
            // Auth error is non-retryable and does NOT count toward
            // the circuit breaker (the breaker is for transient
            // outages, not for misconfiguration).
            this.recordSuccess();
            this.emit({
              provider: "gemini",
              task: req.task,
              model: req.model,
              latencyMs: this.nowFn() - startedAt,
              attempts,
              httpStatus: res.status,
              outcome: "error",
              errorCode: "INVALID_API_KEY"
            });
            throw new ProviderError({
              message: `Gemini auth failed (${res.status})`,
              code: "INVALID_API_KEY",
              provider: "gemini",
              retryable: false
            });
          }
          if (res.status === 400 || res.status === 404) {
            // Bad request / model not found — also non-retryable.
            this.recordSuccess();
            this.emit({
              provider: "gemini",
              task: req.task,
              model: req.model,
              latencyMs: this.nowFn() - startedAt,
              attempts,
              httpStatus: res.status,
              outcome: "error",
              errorCode: res.status === 404 ? "MODEL_NOT_FOUND" : "INVALID_RESPONSE"
            });
            throw new ProviderError({
              message: `Gemini rejected (${res.status}): ${bodyExcerpt}`,
              code: res.status === 404 ? "MODEL_NOT_FOUND" : "INVALID_RESPONSE",
              provider: "gemini",
              retryable: false
            });
          }
          if (res.status === 429) {
            const retryAfterHeader = Number.parseFloat(res.headers.get("Retry-After") ?? "");
            const wait = Number.isFinite(retryAfterHeader)
              ? retryAfterHeader * 1000
              : backoffMs(attempt);
            lastErr = new ProviderError({
              message: `Gemini rate-limited (429)`,
              code: "RATE_LIMITED",
              provider: "gemini",
              retryable: true,
              retryAfterMs: wait
            });
            lastErrorCode = "RATE_LIMITED";
            lastRetryAfterMs = wait;
          } else if (res.status >= 500) {
            lastErr = new ProviderError({
              message: `Gemini server error (${res.status})`,
              code: "PROVIDER_UNAVAILABLE",
              provider: "gemini",
              retryable: true
            });
            lastErrorCode = "PROVIDER_UNAVAILABLE";
          } else {
            this.recordSuccess();
            this.emit({
              provider: "gemini",
              task: req.task,
              model: req.model,
              latencyMs: this.nowFn() - startedAt,
              attempts,
              httpStatus: res.status,
              outcome: "error",
              errorCode: "INVALID_RESPONSE"
            });
            throw new ProviderError({
              message: `Gemini unexpected (${res.status}): ${bodyExcerpt}`,
              code: "INVALID_RESPONSE",
              provider: "gemini",
              retryable: false
            });
          }
        } catch (err) {
          clearTimeout(timer);
          if (req.signal) req.signal.removeEventListener("abort", onCallerAbort);
          if (err instanceof ProviderError) {
            // Re-throw auth / 400 / 404 immediately.
            if (!err.retryable) throw err;
            lastErr = err;
            lastErrorCode = err.code;
          } else if (err instanceof Error && err.name === "AbortError") {
            lastErr = new ProviderError({
              message: "Gemini timeout",
              code: "TIMEOUT",
              provider: "gemini",
              retryable: true
            });
            lastErrorCode = "TIMEOUT";
          } else {
            lastErr = new ProviderError({
              message: err instanceof Error ? err.message : String(err),
              code: "UNKNOWN",
              provider: "gemini",
              retryable: true
            });
            lastErrorCode = "UNKNOWN";
          }
        }

        // If the caller aborted, do not retry.
        if (req.signal?.aborted) {
          this.emit({
            provider: "gemini",
            task: req.task,
            model: req.model,
            latencyMs: this.nowFn() - startedAt,
            attempts,
            httpStatus: lastHttpStatus,
            outcome: "aborted",
            errorCode: lastErrorCode
          });
          throw new ProviderError({
            message: "Gemini call aborted by caller",
            code: "UNKNOWN",
            provider: "gemini",
            retryable: false
          });
        }

        if (attempt < maxAttempts - 1) {
          const wait = lastErr?.retryAfterMs ?? backoffMs(attempt);
          try {
            await this.sleepFn(wait, req.signal);
          } catch {
            this.emit({
              provider: "gemini",
              task: req.task,
              model: req.model,
              latencyMs: this.nowFn() - startedAt,
              attempts,
              httpStatus: lastHttpStatus,
              outcome: "aborted"
            });
            throw new ProviderError({
              message: "Gemini call aborted during backoff",
              code: "UNKNOWN",
              provider: "gemini",
              retryable: false
            });
          }
        }
      }

      this.recordFailure();
      this.emit({
        provider: "gemini",
        task: req.task,
        model: req.model,
        latencyMs: this.nowFn() - startedAt,
        attempts,
        httpStatus: lastHttpStatus,
        outcome: "error",
        errorCode: lastErrorCode,
        retryAfterMs: lastRetryAfterMs
      });
      throw (
        lastErr ??
        new ProviderError({
          message: "Gemini call failed after retries",
          code: "UNKNOWN",
          provider: "gemini",
          retryable: false
        })
      );
    } finally {
      releaseOnce();
    }
  }

  private emit(event: GeminiCallTelemetry): void {
    try {
      this.onTelemetry?.(event);
    } catch {
      // The telemetry sink must never bring down the request path.
    }
  }
}

function backoffMs(attempt: number): number {
  const base = [500, 1500, 4000, 8000][attempt] ?? 8000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(base + jitter));
}

/**
 * Build a Gemini client from the env-driven runtime configuration.
 * The env keys match `.env.example` / `GeminiClientOptions` 1:1
 * (GEMINI_REQUEST_TIMEOUT_MS / GEMINI_MAX_RETRIES /
 * GEMINI_MAX_CONCURRENT_REQUESTS / GEMINI_RATE_LIMIT_RPM).
 */
export function buildGeminiClient(
  env: NodeJS.ProcessEnv = process.env,
  listeners?: { onTelemetry?: GeminiTelemetryListener }
): GeminiClient {
  const num = (k: string, dflt: number): number => {
    const v = env[k];
    if (v === undefined || v === "") return dflt;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return new GeminiClient({
    timeoutMs: num("GEMINI_REQUEST_TIMEOUT_MS", 45_000),
    maxRetries: num("GEMINI_MAX_RETRIES", 2) + 1, // env is "retries", we want "attempts"
    maxConcurrent: num("GEMINI_MAX_CONCURRENT_REQUESTS", 2),
    rateLimitRpm: num("GEMINI_RATE_LIMIT_RPM", 2),
    queueWaitTimeoutMs: num("GEMINI_QUEUE_WAIT_TIMEOUT_MS", 30_000),
    onTelemetry: listeners?.onTelemetry
  });
}
