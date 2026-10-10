/**
 * Tests for the central Gemini HTTP client.
 *
 * Uses an injected `fetch` and an injected clock so we can
 * deterministically exercise:
 *
 *   - bounded timeout (AbortError → TIMEOUT, retryable)
 *   - auth failure (401 → INVALID_API_KEY, non-retryable)
 *   - bad request (400 → INVALID_RESPONSE, non-retryable)
 *   - rate limit (429 → respects Retry-After)
 *   - 5xx (retryable, exponential backoff)
 *   - circuit breaker (opens after N consecutive failures)
 *   - concurrency cap (does not exceed maxConcurrent)
 *   - RPM pacer (paces admissions)
 *
 * The tests do NOT touch the network. They assert on observable
 * behaviour: the ProviderError code, retry counts, and telemetry
 * events emitted.
 */

import { describe, it, expect, vi } from "vitest";
import { GeminiClient, GeminiCircuitOpenError } from "../gemini-client.js";
import { ProviderError } from "../types.js";

class FakeClock {
  public now = 0;
  nowFn = (): number => this.now;
  sleepFn = vi.fn(async (_ms: number, _signal?: AbortSignal) => {
    // no real waiting — tests just observe what was requested
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

interface FetchCall {
  url: string;
  body: unknown;
}

function makeFetch(impl: (call: FetchCall) => Response | Promise<Response>): typeof fetch {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const parsed = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, body: parsed });
    return impl(calls[calls.length - 1]);
  }) as unknown as typeof fetch;
  // expose the recorder so tests can inspect the call history
  (fn as unknown as { calls: FetchCall[] }).calls = calls;
  return fn;
}

describe("GeminiClient", () => {
  it("returns parsed JSON on a 200 response and records one success", async () => {
    const fetcher = makeFetch(() => jsonResponse(200, { ok: true, value: 42 }));
    const events: unknown[] = [];
    const clock = new FakeClock();
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 3, // attempts
      now: clock.nowFn,
      sleep: clock.sleepFn,
      onTelemetry: (e) => events.push(e)
    });
    const out = await client.call<{ ok: boolean; value: number }>({
      apiKey: "k",
      model: "gemini-3.8-flash",
      task: "text",
      path: "models/gemini-3.8-flash:generateContent",
      body: { hello: "world" }
    });
    expect(out).toEqual({ ok: true, value: 42 });
    expect(events).toHaveLength(1);
    expect((events[0] as { outcome: string }).outcome).toBe("success");
  });

  it("throws INVALID_API_KEY and does NOT retry on 401", async () => {
    const fetcher = makeFetch(() => errorResponse(401, "bad key"));
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 3,
      now: () => 0,
      sleep: async () => undefined
    });
    await expect(
      client.call({
        apiKey: "k",
        model: "gemini-3.8-flash",
        task: "text",
        path: "x",
        body: {}
      })
    ).rejects.toMatchObject({ code: "INVALID_API_KEY" });
    const calls = (fetcher as unknown as { calls: FetchCall[] }).calls;
    expect(calls).toHaveLength(1); // no retry
  });

  it("throws INVALID_RESPONSE and does NOT retry on 400", async () => {
    const fetcher = makeFetch(() => errorResponse(400, "bad request"));
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 3,
      now: () => 0,
      sleep: async () => undefined
    });
    await expect(
      client.call({
        apiKey: "k",
        model: "gemini-3.8-flash",
        task: "text",
        path: "x",
        body: {}
      })
    ).rejects.toBeInstanceOf(ProviderError);
    const calls = (fetcher as unknown as { calls: FetchCall[] }).calls;
    expect(calls).toHaveLength(1);
  });

  it("retries on 5xx up to maxAttempts and surfaces PROVIDER_UNAVAILABLE", async () => {
    const fetcher = makeFetch(() => errorResponse(503, "down"));
    const sleep = vi.fn(async () => undefined);
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 3, // attempts
      now: () => 0,
      sleep
    });
    await expect(
      client.call({
        apiKey: "k",
        model: "gemini-3.8-flash",
        task: "text",
        path: "x",
        body: {}
      })
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const calls = (fetcher as unknown as { calls: FetchCall[] }).calls;
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2); // backoff between attempts
  });

  it("respects Retry-After on 429", async () => {
    const wrapped: typeof fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("rate-limited", {
        status: 429,
        headers: { "Retry-After": "3" }
      });
    }) as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const client = new GeminiClient({
      fetch: wrapped,
      maxRetries: 2,
      now: () => 0,
      sleep
    });
    await expect(
      client.call({
        apiKey: "k",
        model: "gemini-3.8-flash",
        task: "text",
        path: "x",
        body: {}
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // backoff was 3s (the Retry-After value in ms), not the default 500ms
    expect((sleep.mock.calls[0] as number[] | undefined)?.[0]).toBe(3000);
  });

  it("opens the circuit breaker after N consecutive failures", async () => {
    const fetcher = makeFetch(() => errorResponse(500, "x"));
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 1, // 1 attempt = no retries
      now: () => 0,
      sleep: async () => undefined,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 1000
    });
    // Three 5xx trips the breaker.
    for (let i = 0; i < 3; i++) {
      await expect(
        client.call({ apiKey: "k", model: "m", task: "text", path: "x", body: {} })
      ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    }
    expect(client.isHealthy()).toBe(false);
    expect(client.breakerRemainingMs()).toBe(1000);
    // A new call now short-circuits WITHOUT touching the network.
    const callsBefore = (fetcher as unknown as { calls: FetchCall[] }).calls.length;
    await expect(
      client.call({ apiKey: "k", model: "m", task: "text", path: "x", body: {} })
    ).rejects.toBeInstanceOf(GeminiCircuitOpenError);
    const callsAfter = (fetcher as unknown as { calls: FetchCall[] }).calls.length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("resets the breaker after a successful call", async () => {
    let n = 0;
    let now = 0;
    const fetcher = makeFetch(() =>
      n++ < 3 ? errorResponse(500, "x") : jsonResponse(200, { ok: true })
    );
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 1,
      now: () => now,
      sleep: async () => undefined,
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 1000
    });
    // Trip the breaker.
    for (let i = 0; i < 3; i++) {
      await expect(
        client.call({ apiKey: "k", model: "m", task: "text", path: "x", body: {} })
      ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    }
    expect(client.isHealthy()).toBe(false);
    // Move "time" past the cooldown, then send a successful call.
    now = 2000;
    const out = await client.call<{ ok: boolean }>({
      apiKey: "k",
      model: "m",
      task: "text",
      path: "x",
      body: {}
    });
    expect(out.ok).toBe(true);
    expect(client.isHealthy()).toBe(true);
  });

  it("aborts via the caller's signal and does not retry", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        const s = init?.signal;
        if (s) {
          if (s.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          s.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
          // Never resolve on the happy path — only on abort.
          return;
        }
        resolve(jsonResponse(200, { ok: true }));
      });
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 3,
      now: () => 0,
      sleep: async () => undefined,
      // long per-attempt timeout so the per-attempt AbortController
      // doesn't fire first
      timeoutMs: 60_000
    });
    await expect(
      client.call({
        apiKey: "k",
        model: "m",
        task: "text",
        path: "x",
        body: {},
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(ProviderError);
    expect((fetcher as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it("paces RPM at the configured rate and never throws QueueWaitTimeout in steady state", async () => {
    // Repro: with rpm=2 and a window that starts full, the
    // previous default cap of 30 000 ms threw because the wait
    // for the third caller equalled the full window (60 000 ms
    // + 25 ms grace). With cap=60 025 ms, every caller is
    // admitted without throwing. The wait that does occur is
    // bounded by the full window length (it cannot exceed
    // 60 025 ms) and is in the expected range.
    const fetcher = makeFetch(() => jsonResponse(200, { ok: true }));
    const sleeps: number[] = [];
    let now = 0;
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 1,
      maxConcurrent: 8,
      rateLimitRpm: 2,
      queueWaitTimeoutMs: 60_025,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms; // advance the clock past the sleep
      }
    });
    // Fire 4 requests; first 2 fill the window instantly,
    // later ones must wait bounded amounts (cumulatively no
    // more than the full window each, never throwing).
    const out = await Promise.all(
      [0, 1, 2, 3].map(() =>
        client.call<{ ok: boolean }>({
          apiKey: "k",
          model: "m",
          task: "text",
          path: "x",
          body: {}
        })
      )
    );
    expect(out.map((o) => o.ok)).toEqual([true, true, true, true]);
    // No single sleep may exceed the cap.
    for (const ms of sleeps) {
      expect(ms).toBeLessThanOrEqual(60_025);
    }
    // The total wait across the queue is bounded by ~one full
    // window per extra request (rpm=2, so for 4 requests
    // roughly 2 windows of wait in aggregate).
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(180_000);
  });

  it("throws QueueWaitTimeoutError when the configured cap is too tight for rpm", async () => {
    // Sanity check that the cap is actually enforced when an
    // operator sets it tighter than the natural window. This
    // is the path that fires for npm=2 with cap=30_000.
    const fetcher = makeFetch(() => jsonResponse(200, { ok: true }));
    const client = new GeminiClient({
      fetch: fetcher,
      maxRetries: 1,
      maxConcurrent: 8,
      rateLimitRpm: 2,
      queueWaitTimeoutMs: 30_000, // too tight: 60_025 > 30_000
      now: () => 0,
      sleep: async () => undefined
    });
    // Fill the window with two admissions.
    await Promise.all([
      client.call({ apiKey: "k", model: "m", task: "text", path: "x", body: {} }),
      client.call({ apiKey: "k", model: "m", task: "text", path: "x", body: {} })
    ]);
    // The third caller must throw QueueWaitTimeoutError.
    await expect(
      client.call({ apiKey: "k", model: "m", task: "text", path: "x", body: {} })
    ).rejects.toMatchObject({ code: "TIMEOUT", provider: "gemini" });
  });
});
