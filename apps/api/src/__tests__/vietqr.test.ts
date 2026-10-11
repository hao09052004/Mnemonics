/**
 * VietQR builder tests.
 *
 * Round-trip a known-good payload and verify the structure.
 */
import { describe, it, expect } from 'vitest';
import { buildVietQrPayload, crc16Ccitt, VietQrError } from '../payments/vietqr.js';

const RECIPIENT = {
  bankBin: '970436',
  bankAccount: '9912780019',
  bankHolder: 'DAO QUYNH LE'
};

describe('vietqr builder', () => {
  it('rejects non-positive amounts', () => {
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: 0,
      reference: 'MNX12345'
    })).toThrow(VietQrError);
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: -1,
      reference: 'MNX12345'
    })).toThrow(VietQrError);
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: 1.5,
      reference: 'MNX12345'
    })).toThrow(VietQrError);
  });

  it('rejects malformed references', () => {
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: 29_000,
      reference: 'lower'
    })).toThrow(VietQrError);
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: 29_000,
      reference: 'TOOLONGREFERENCEXX'
    })).toThrow(VietQrError);
  });

  it('rejects empty / oversized bank holder', () => {
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      bankHolder: '',
      amountVnd: 29_000,
      reference: 'MNX12345'
    })).toThrow(VietQrError);
    expect(() => buildVietQrPayload({
      ...RECIPIENT,
      bankHolder: 'A'.repeat(30),
      amountVnd: 29_000,
      reference: 'MNX12345'
    })).toThrow(VietQrError);
  });

  it('produces a payload that ends with a valid CRC', () => {
    const payload = buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: 29_000,
      reference: 'MNX8K4P2'
    });
    // The CRC is the last 4 hex characters, prefixed by "6304".
    expect(payload.length).toBeGreaterThan(40);
    // Recomputing the CRC over the prefix (everything except
    // the last 4 chars) must yield the same value.
    const tail = payload.slice(-4);
    expect(tail).toMatch(/^[0-9A-F]{4}$/);
    const prefix = payload.slice(0, -4);
    expect(crc16Ccitt(prefix).toString(16).padStart(4, '0').toUpperCase()).toBe(tail);
  });

  it('embeds the amount, BIN, account, and reference in the payload', () => {
    const ref = 'MNX8K4P2';
    const payload = buildVietQrPayload({
      ...RECIPIENT,
      amountVnd: 29_000,
      reference: ref
    });
    // The payload is a TLV string. We can grep for the
    // ASCII values directly. Tags are 2-digit numbers
    // (e.g. "01" for BIN, "02" for account).
    expect(payload).toContain('970436');
    expect(payload).toContain('9912780019');
    expect(payload).toContain('704');    // VND currency (tag 53)
    expect(payload).toContain('VN');     // country (tag 58)
    expect(payload).toContain(ref);
    expect(payload).toContain('29000');  // amount (tag 54)
  });
});
