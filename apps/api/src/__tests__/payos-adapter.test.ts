/**
 * PayOS adapter unit tests.
 *
 * Verifies the create-link signature, webhook signature
 * scheme, payload parsing, and the success/non-success
 * branch on `code`. No network or DB is required.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createPayosAdapter, PayosError } from '../payments/providers/payos.js';

const CHECKSUM = 'test-checksum-key-1234567890';
const CLIENT_ID = 'test-client-id';
const API_KEY = 'test-api-key';
const RETURN_URL = 'https://app.example.com/billing/return';
const CANCEL_URL = 'https://app.example.com/billing/cancel';

const adapter = createPayosAdapter({
  clientId: CLIENT_ID,
  apiKey: API_KEY,
  checksumKey: CHECKSUM,
  returnUrl: RETURN_URL,
  cancelUrl: CANCEL_URL
});

function signWebhookData(data: Record<string, unknown>): string {
  const normalized: Record<string, string> = {};
  for (const k of Object.keys(data).sort()) {
    const v = data[k];
    normalized[k] = v === null || v === undefined ? '' : String(v);
  }
  return createHmac('sha256', CHECKSUM)
    .update(Object.keys(normalized).map((k) => `${k}=${normalized[k]}`).join('&'), 'utf8')
    .digest('hex');
}

describe('payos adapter', () => {
  it('reports configured when clientId, apiKey, checksumKey, returnUrl, cancelUrl are set', () => {
    expect(adapter.isConfigured()).toBe(true);
  });

  it('reports unconfigured when checksumKey is empty', () => {
    const a = createPayosAdapter({
      clientId: CLIENT_ID,
      apiKey: API_KEY,
      checksumKey: '',
      returnUrl: RETURN_URL,
      cancelUrl: CANCEL_URL
    });
    expect(a.isConfigured()).toBe(false);
  });

  it('signCreateLink produces a stable, alphabet-sorted signature', () => {
    const sig = adapter.signCreateLink({
      orderCode: 12345,
      amount: 29000,
      description: 'Mnemonics mastery-monthly MNX8K4P2'
    });
    // Independently compute the expected signature:
    const expected = createHmac('sha256', CHECKSUM)
      .update(
        [
          'amount=29000',
          `cancelUrl=${CANCEL_URL}`,
          'description=Mnemonics mastery-monthly MNX8K4P2',
          'orderCode=12345',
          `returnUrl=${RETURN_URL}`
        ].join('&'),
        'utf8'
      )
      .digest('hex');
    expect(sig).toBe(expected);
  });

  it('buildCreateLinkRequest embeds the signature under the `signature` key', () => {
    const body = adapter.buildCreateLinkRequest({
      orderCode: 99,
      amount: 249_000,
      description: 'Mnemonics mastery-yearly MNX7Y3K9'
    });
    expect(body.orderCode).toBe(99);
    expect(body.amount).toBe(249_000);
    expect(body.description).toBe('Mnemonics mastery-yearly MNX7Y3K9');
    expect(body.returnUrl).toBe(RETURN_URL);
    expect(body.cancelUrl).toBe(CANCEL_URL);
    expect(typeof body.signature).toBe('string');
    expect((body.signature as string).length).toBe(64); // sha256 hex
  });

  it('verifyWebhook accepts a correctly-signed body', () => {
    const data = {
      orderCode: 12345,
      amount: 29000,
      description: 'Mnemonics mastery-monthly MNX8K4P2',
      accountNumber: '9912780019',
      reference: 'MNX8K4P2',
      transactionDateTime: '2026-10-12 13:45:00',
      code: '00',
      desc: 'success'
    };
    const signature = signWebhookData(data);
    const raw = JSON.stringify({ code: '00', desc: 'success', data, signature });
    expect(adapter.verifyWebhook(raw, undefined)).toBe(true);
  });

  it('verifyWebhook rejects a body with a tampered signature', () => {
    const data = { orderCode: 1, amount: 29000, description: 'MNX8K4P2' };
    const raw = JSON.stringify({ data, signature: 'a'.repeat(64) });
    expect(adapter.verifyWebhook(raw, undefined)).toBe(false);
  });

  it('verifyWebhook rejects malformed JSON', () => {
    expect(adapter.verifyWebhook('not json', undefined)).toBe(false);
  });

  it('parseWebhook rejects on malformed JSON', () => {
    expect(() => adapter.parseWebhook('not json')).toThrow(PayosError);
  });

  it('parseWebhook rejects when orderCode is missing or non-positive', () => {
    expect(() => adapter.parseWebhook(JSON.stringify({ data: { amount: 100 } }))).toThrow(PayosError);
    expect(() => adapter.parseWebhook(JSON.stringify({ data: { orderCode: 0, amount: 100 } }))).toThrow(PayosError);
  });

  it('parseWebhook rejects when amount is missing or non-positive', () => {
    expect(() => adapter.parseWebhook(JSON.stringify({ data: { orderCode: 1, amount: 0 } }))).toThrow(PayosError);
    expect(() => adapter.parseWebhook(JSON.stringify({ data: { orderCode: 1, amount: -1 } }))).toThrow(PayosError);
  });

  it('parseWebhook rejects when the MNX reference is not in a success event description', () => {
    // For code='00' (real transfer) the reference MUST be in
    // the description — that's how we match the inbound event
    // back to our order row.
    const raw = JSON.stringify({
      data: { orderCode: 1, amount: 1000, description: 'random text', code: '00' }
    });
    expect(() => adapter.parseWebhook(raw)).toThrow(PayosError);
  });

  it('parseWebhook tolerates a missing MNX reference in a non-success event', () => {
    // For code !== '00' (cancel / expire / etc.) no transfer
    // happened — the description may be empty or arbitrary.
    // The webhook router short-circuits these events before
    // looking the order up, so the parser must not throw.
    const raw = JSON.stringify({
      data: { orderCode: 1, amount: 1000, description: 'random text', code: '01' }
    });
    const event = adapter.parseWebhook(raw);
    expect(event.code).toBe('01');
    expect(event.reference).toBe('');
  });

  it('parseWebhook extracts the MNX reference from the description', () => {
    const data = {
      orderCode: 12345,
      amount: 29000,
      description: 'Mnemonics mastery-monthly MNX8K4P2',
      code: '00',
      desc: 'success',
      transactionDateTime: '2026-10-12 13:45:00',
      counterAccountNumber: '111122223333',
      counterAccountName: 'NGUYEN VAN A',
      paymentLinkId: 'abc123'
    };
    const raw = JSON.stringify({ data, signature: '00' });
    const event = adapter.parseWebhook(raw);
    expect(event.orderCode).toBe(12345);
    expect(event.amount).toBe(29_000);
    expect(event.reference).toBe('MNX8K4P2');
    expect(event.code).toBe('00');
    expect(event.paidAt.toISOString()).toContain('2026-10-12');
    expect(event.counterAccountNumber).toBe('111122223333');
    expect(event.paymentLinkId).toBe('abc123');
  });

  it('extractDataField returns the data object or null', () => {
    expect(adapter.extractDataField('not json')).toBeNull();
    const raw = JSON.stringify({ data: { orderCode: 1 }, signature: 'x' });
    expect(adapter.extractDataField(raw)).toEqual({ orderCode: 1 });
  });
});
