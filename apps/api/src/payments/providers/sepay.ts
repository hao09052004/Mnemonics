/**
 * SePay-compatible payment provider adapter.
 *
 * SePay is a Vietnamese payment aggregator. The provider's
 * documented webhook shape (subject to change — verify
 * against https://docs.sepay.vn/ before going live) is:
 *
 *   POST /webhooks/sepay
 *   Headers:
 *     Authorization: Bearer <SEPAY_API_KEY>           (alt auth)
 *     X-Sepay-Signature: hex(hmac_sha256(secret, body))
 *   Body (JSON):
 *     {
 *       "id": "<provider txn id>",
 *       "gateway": "Vietcombank",
 *       "transactionDate": "2026-10-12 13:45:00",
 *       "accountNumber": "9912780019",
 *       "subAccount": null,
 *       "code": null,                          // or "MNX8K4P2Q"
 *       "content": "Mnemonics mastery-monthly MNX8K4P2Q",
 *       "transferType": "in",
 *       "description": "...",
 *       "amount": 29000,
 *       "referenceCode": "<unique>",
 *       "accumulated": 0,
 *       "id": 12345
 *     }
 *
 * We use the `X-Sepay-Signature` header (HMAC-SHA-256) for
 * authenticity. The header is optional in some accounts; we
 * REQUIRE it because the alternative is replay-easy.
 *
 * If the SEPAY_WEBHOOK_SECRET is not configured, the
 * adapter REFUSES to verify any signature and the webhook
 * route returns 503. We do not silently accept unsigned
 * webhooks.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SepayWebhookEvent {
  providerTxnId: string;
  amountVnd: number;
  reference: string;             // always present after parse() succeeds
  bankAccount: string | null;
  transferType: 'in' | 'out' | string;
  paidAt: Date;
  raw: unknown;
}

export interface SepayAdapterOptions {
  secret: string;            // SEPAY_WEBHOOK_SECRET
  expectedAccount: string;   // PAYMENT_BANK_ACCOUNT — must match inbound
}

export class SepayError extends Error {
  readonly code: 'SIGNATURE_MISSING' | 'SIGNATURE_INVALID' | 'ACCOUNT_MISMATCH' | 'SECRET_NOT_CONFIGURED' | 'PAYLOAD_MALFORMED';
  readonly status: number;
  constructor(code: SepayError['code'], message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface SepayAdapter {
  /** True when secret + expected account are both configured. */
  isConfigured(): boolean;
  /** Compute the signature the header must contain. */
  sign(rawBody: string): string;
  /** Verify the header against the raw body. */
  verifySignature(rawBody: string, headerValue: string | undefined): boolean;
  /** Parse the JSON body into a normalized event. */
  parse(rawBody: string): SepayWebhookEvent;
  /** Compare the inbound bank account to the configured recipient. */
  checkBeneficiary(event: SepayWebhookEvent): void;
}

export function createSepayAdapter(opts: SepayAdapterOptions): SepayAdapter {
  const isConfigured = () =>
    typeof opts.secret === 'string' && opts.secret.length > 0 &&
    typeof opts.expectedAccount === 'string' && opts.expectedAccount.length > 0;

  const sign = (rawBody: string) =>
    createHmac('sha256', opts.secret).update(rawBody, 'utf8').digest('hex');

  const verifySignature = (rawBody: string, headerValue: string | undefined): boolean => {
    if (!headerValue) return false;
    if (!isConfigured()) return false;
    const expected = sign(rawBody);
    const a = Buffer.from(expected, 'hex');
    let b: Buffer;
    try {
      b = Buffer.from(headerValue.trim(), 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };

  const parse = (rawBody: string): SepayWebhookEvent => {
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch (e) {
      throw new SepayError('PAYLOAD_MALFORMED', 'Webhook body is not valid JSON', 400);
    }
    const id = String(body?.id ?? body?.referenceCode ?? '');
    if (!id) {
      throw new SepayError('PAYLOAD_MALFORMED', 'Missing provider txn id', 400);
    }
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new SepayError('PAYLOAD_MALFORMED', 'Missing or invalid amount', 400);
    }
    // The transfer reference is either in `code` (when set)
    // or extracted from the `content` field. We use a
    // regex that accepts the documented `MNX#####` shape
    // (3 prefix + 5 alphanumeric = 8 chars total).
    const code = typeof body?.code === 'string' ? body.code : null;
    const content = typeof body?.content === 'string' ? body.content : '';
    const refMatch = content.match(/\bMNX[0-9A-Z]{5}\b/);
    const reference: string | null = code ?? (refMatch ? refMatch[0] : null);
    if (!reference) {
      throw new SepayError('PAYLOAD_MALFORMED', 'Transfer reference not found in payload', 400);
    }
    const transferType = String(body?.transferType ?? 'in');
    const paidAtRaw = body?.transactionDate;
    const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date();
    return {
      providerTxnId: id,
      amountVnd: Math.round(amount),
      reference,
      bankAccount: typeof body?.accountNumber === 'string' ? body.accountNumber : null,
      transferType,
      paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
      raw: body
    };
  };

  const checkBeneficiary = (event: SepayWebhookEvent) => {
    if (!isConfigured()) {
      throw new SepayError('SECRET_NOT_CONFIGURED', 'SEPAY_WEBHOOK_SECRET / PAYMENT_BANK_ACCOUNT chưa cấu hình', 503);
    }
    if (event.bankAccount && event.bankAccount !== opts.expectedAccount) {
      throw new SepayError(
        'ACCOUNT_MISMATCH',
        `Event account ${event.bankAccount} does not match the configured ${opts.expectedAccount}`,
        422
      );
    }
  };

  return { isConfigured, sign, verifySignature, parse, checkBeneficiary };
}
