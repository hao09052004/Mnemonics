/**
 * SePay adapter unit tests.
 *
 * Verifies the signature scheme, payload parsing, and
 * beneficiary check. No DB is required.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createSepayAdapter, SepayError } from '../payments/providers/sepay.js';

const SECRET = 'super-secret-shared-key';
const ACCOUNT = '9912780019';

const adapter = createSepayAdapter({ secret: SECRET, expectedAccount: ACCOUNT });

function sign(raw: string) {
  return createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');
}

describe('sepay adapter', () => {
  it('reports configured when both secret and account are set', () => {
    expect(adapter.isConfigured()).toBe(true);
  });

  it('reports unconfigured when secret is empty', () => {
    const a = createSepayAdapter({ secret: '', expectedAccount: ACCOUNT });
    expect(a.isConfigured()).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const raw = '{"id":"1","amount":29000}';
    expect(adapter.verifySignature(raw, undefined)).toBe(false);
  });

  it('rejects when the signature is invalid', () => {
    const raw = '{"id":"1","amount":29000}';
    expect(adapter.verifySignature(raw, 'not-a-real-signature')).toBe(false);
  });

  it('accepts a correct HMAC-SHA256 signature', () => {
    const raw = '{"id":"1","amount":29000}';
    expect(adapter.verifySignature(raw, sign(raw))).toBe(true);
  });

  it('produces a signature equal to its own sign()', () => {
    const raw = '{"id":"abc","amount":249000}';
    expect(adapter.verifySignature(raw, adapter.sign(raw))).toBe(true);
  });

  it('rejects on malformed JSON', () => {
    expect(() => adapter.parse('not json')).toThrow(SepayError);
  });

  it('rejects when amount is missing or non-positive', () => {
    expect(() => adapter.parse('{"id":"x","amount":0}')).toThrow(SepayError);
    expect(() => adapter.parse('{"id":"x","amount":-1}')).toThrow(SepayError);
  });

  it('rejects when the transfer reference is not found', () => {
    expect(() => adapter.parse('{"id":"x","amount":1000,"content":"random"}')).toThrow(SepayError);
  });

  it('parses a valid payload and extracts the reference from content', () => {
    const raw = JSON.stringify({
      id: 'tx-1',
      accountNumber: ACCOUNT,
      content: 'Mnemonics mastery-monthly MNX8K4P2 (8 chars: MNX + 5)',
      amount: 29000,
      transferType: 'in',
      transactionDate: '2026-10-12 13:45:00'
    });
    const event = adapter.parse(raw);
    expect(event.reference).toBe('MNX8K4P2');
    expect(event.amountVnd).toBe(29000);
    expect(event.bankAccount).toBe(ACCOUNT);
    expect(event.transferType).toBe('in');
    expect(event.paidAt.toISOString()).toContain('2026-10-12');
  });

  it('parses a payload with the reference in `code`', () => {
    const raw = JSON.stringify({
      id: 'tx-2',
      accountNumber: ACCOUNT,
      code: 'MNX7Y3K9',
      content: 'no reference here',
      amount: 249000,
      transferType: 'in'
    });
    const event = adapter.parse(raw);
    expect(event.reference).toBe('MNX7Y3K9');
    expect(event.amountVnd).toBe(249000);
  });

  it('rejects a payload with a mismatched beneficiary account', () => {
    const raw = JSON.stringify({
      id: 'tx-3',
      accountNumber: '1111111111',
      content: 'MNX8K4P2 (8 chars: MNX + 5)',
      amount: 29000,
      transferType: 'in'
    });
    const event = adapter.parse(raw);
    expect(() => adapter.checkBeneficiary(event)).toThrow(SepayError);
  });

  it('accepts a payload that omits the account number', () => {
    // Some banks redacted the recipient in the webhook. The
    // adapter must not block those — the verification falls
    // back to the configured recipient at activation time.
    const raw = JSON.stringify({
      id: 'tx-4',
      content: 'MNX8K4P2 (8 chars: MNX + 5)',
      amount: 29000,
      transferType: 'in'
    });
    const event = adapter.parse(raw);
    expect(event.bankAccount).toBeNull();
    expect(() => adapter.checkBeneficiary(event)).not.toThrow();
  });
});
