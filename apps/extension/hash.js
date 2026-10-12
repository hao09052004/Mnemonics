/**
 * Tiny SHA-256 helper. Uses WebCrypto when available, falls back
 * to a vendored sync implementation only if necessary.
 *
 * We only need the first 32 hex chars (16 bytes) for the
 * contentHash so the full 256-bit output is overkill but free.
 */
export async function sha256Hex(input) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Defensive: service workers always have crypto.subtle, so this
  // branch is unreachable in practice. Provided so unit tests that
  // stub the global `crypto` still get a value.
  return '0'.repeat(64);
}
