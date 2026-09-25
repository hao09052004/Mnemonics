import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function loadPolicy() {
  const source = await readFile(new URL('./pending-sync-policy.js', import.meta.url), 'utf8');
  const module = { exports: {} };
  const factory = new Function('module', 'exports', source);
  factory(module, module.exports);
  return module.exports;
}

describe('pending sync retry policy', () => {
  it('backs off exponentially and caps at one hour', async () => {
    const policy = await loadPolicy();

    expect(policy.nextDelayMs(0)).toBe(30 * 1000);
    expect(policy.nextDelayMs(1)).toBe(60 * 1000);
    expect(policy.nextDelayMs(5)).toBe(32 * 60 * 1000);
    expect(policy.nextDelayMs(8)).toBe(60 * 60 * 1000);
  });

  it('schedules the next retry from the completed attempt', async () => {
    const policy = await loadPolicy();
    const now = Date.parse('2026-09-25T13:00:00.000Z');

    expect(policy.nextRetryAt(now, 0)).toBe('2026-09-25T13:00:30.000Z');
    expect(policy.nextRetryAt(now, 2)).toBe('2026-09-25T13:02:00.000Z');
  });

  it('stops automatic retries after the maximum attempts', async () => {
    const policy = await loadPolicy();

    expect(policy.shouldRetry({
      pendingUpload: true,
      syncAttempts: 7,
      nextRetryAt: '2026-09-25T12:00:00.000Z'
    }, Date.parse('2026-09-25T13:00:00.000Z'))).toBe(true);

    expect(policy.shouldRetry({
      pendingUpload: true,
      syncAttempts: 8,
      nextRetryAt: '2026-09-25T12:00:00.000Z'
    }, Date.parse('2026-09-25T13:00:00.000Z'))).toBe(false);
  });

  it('does not retry before nextRetryAt or for already synced items', async () => {
    const policy = await loadPolicy();
    const now = Date.parse('2026-09-25T13:00:00.000Z');

    expect(policy.shouldRetry({
      pendingUpload: true,
      syncAttempts: 1,
      nextRetryAt: '2026-09-25T13:01:00.000Z'
    }, now)).toBe(false);

    expect(policy.shouldRetry({
      pendingUpload: false,
      syncAttempts: 1
    }, now)).toBe(false);
  });
});
