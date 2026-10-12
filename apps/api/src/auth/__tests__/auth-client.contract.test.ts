import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, '../../../../../apps/extension/auth-client.js');
const source = readFileSync(sourcePath, 'utf8');

describe('apps/extension/auth-client.js (contract)', () => {
  it('exports the public symbols the dashboard relies on', () => {
    expect(source).toMatch(/export class AuthError/);
    expect(source).toMatch(/export function normalizeEmail/);
    expect(source).toMatch(/export function validateEmail/);
    expect(source).toMatch(/export function validatePasswordStrength/);
    expect(source).toMatch(/export function createAuthClient/);
    expect(source).toMatch(/export function createSessionStore/);
    expect(source).toMatch(/export function createStorage/);
    expect(source).toMatch(/export function createLocalStorage/);
    expect(source).toMatch(/export function createChromeStorage/);
  });

  it('never logs a token (no console.log containing accessToken/refreshToken)', () => {
    expect(source).not.toMatch(/console\.(log|info|warn)\([^)]*(accessToken|refreshToken)/);
  });

  it('does not put tokens in URL params (uses Authorization header only)', () => {
    expect(source).not.toMatch(/[?&](accessToken|refreshToken)=/);
    expect(source).toContain("headers.Authorization = 'Bearer ' + accessToken");
  });

  it('exposes scheduleRefresh with a clearTimer escape hatch', () => {
    expect(source).toMatch(/function clearRefreshTimer/);
    expect(source).toMatch(/clearTimeout\(tokenRefreshTimer\)/);
  });

  it('forbids the Supabase service-role key on the client', () => {
    // The client auth-client.js must never reference the service-role key
    // or the SUPABASE_SERVICE_ROLE_KEY env var name.
    expect(source).not.toMatch(/SERVICE_ROLE/i);
    expect(source).not.toMatch(/service_role/i);
  });
});
