/**
 * PayOS-compatible payment provider adapter.
 *
 * PayOS is a Vietnamese payment aggregator that fronts a much
 * larger set of banks than SePay's Vietcombank-only pipeline.
 * We implement the documented v2 API surface:
 *
 *   POST /v2/payment-requests
 *     Body (the signature field is computed by us):
 *       {
 *         "orderCode":   <integer>,   // unique per merchant
 *         "amount":      <integer>,   // VND
 *         "description": "<= 25 chars",
 *         "returnUrl":   "<frontend>",
 *         "cancelUrl":   "<frontend>",
 *         "signature":   "<hex>"
 *       }
 *     Signature: HMAC-SHA256(checksum_key,
 *       "amount=$amount&cancelUrl=$cancelUrl&description=$description&orderCode=$orderCode&returnUrl=$returnUrl")
 *     (fields are sorted alphabetically and joined with "&".)
 *
 *   POST /v2/confirm-webhook
 *     Body: { "webhookUrl": "<our-public-url>" }
 *     PayOS responds with { "data": { "webhookUrl": "..." } }
 *     and also fires a *test* event to that URL. The test
 *     event must pass our signature verification to be
 *     considered "registered".
 *
 * Webhook payload (POSTed to /api/v1/billing/webhooks/payos):
 *   {
 *     "code": "00",
 *     "desc": "success",
 *     "data": {
 *       "orderCode":           <integer>,
 *       "amount":              <integer>,
 *       "description":         "...",
 *       "accountNumber":       "...",
 *       "reference":           "<MNX...>",
 *       "transactionDateTime":  "2026-10-12 13:45:00",
 *       "currency":            "VND",
 *       "paymentLinkId":       "...",
 *       "code":                "00",        // "00" = success
 *       "desc":                "success",
 *       "counterAccountBankId":    "...",
 *       "counterAccountBankName":  "...",
 *       "counterAccountName":      "...",
 *       "counterAccountNumber":    "...",
 *       "virtualAccountName":      "...",
 *       "virtualAccountNumber":    "..."
 *     },
 *     "signature": "<hex>"
 *   }
 *
 * Webhook signature: HMAC-SHA256(checksum_key, sorted_data_fields)
 *   - Take the `data` object (camelCase, as sent by PayOS).
 *   - For each key/value, sort by key alphabetically.
 *   - Build the query string: "k1=v1&k2=v2&..." (no URL-encoding;
 *     PayOS signs the raw values as they appear in the JSON).
 *   - Sign with HMAC-SHA256 and hex-encode.
 *   - Compare against the top-level `signature` field with
 *     `crypto.timingSafeEqual`.
 *
 * References:
 *   - https://payos.vn/docs/api/
 *   - https://docs.payos.vn/  (mirror)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PayosConfig {
  clientId: string;          // PAYOS_CLIENT_ID
  apiKey: string;            // PAYOS_API_KEY
  checksumKey: string;       // PAYOS_CHECKSUM_KEY
  returnUrl: string;         // PAYMENT_RETURN_URL
  cancelUrl: string;         // PAYMENT_CANCEL_URL
  /** Optional override for tests; defaults to the PayOS production host. */
  baseUrl?: string;
}

export interface PayosCreateLinkArgs {
  orderCode: number;
  amount: number;
  description: string;
}

export interface PayosCreateLinkResult {
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode: string;
  orderCode: number;
  amount: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'CANCELLED' | 'EXPIRED';
  raw: unknown;
}

export interface PayosWebhookEvent {
  orderCode: number;
  amount: number;
  reference: string;             // our MNX-... tag (from description)
  code: string;                  // "00" = success
  desc: string;
  paidAt: Date;
  counterAccountNumber: string | null;
  counterAccountName: string | null;
  paymentLinkId: string | null;
  raw: unknown;
}

export class PayosError extends Error {
  readonly code:
    | 'SIGNATURE_MISSING'
    | 'SIGNATURE_INVALID'
    | 'PAYLOAD_MALFORMED'
    | 'CHANNEL_NOT_CONFIGURED'
    | 'CHECKSUM_NOT_CONFIGURED'
    | 'PROVIDER_REQUEST_FAILED'
    | 'WEBHOOK_DATA_MISSING';
  readonly status: number;
  constructor(code: PayosError['code'], message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface PayosAdapter {
  isConfigured(): boolean;
  /** Sign a create-payment-link request body field. */
  signCreateLink(args: PayosCreateLinkArgs): string;
  /** Verify the signature on an inbound webhook body. */
  verifyWebhook(rawBody: string, headerSignature: string | undefined): boolean;
  /** Parse a verified webhook body. */
  parseWebhook(rawBody: string): PayosWebhookEvent;
  /** Build the create-payment-link request body (caller POSTs it). */
  buildCreateLinkRequest(args: PayosCreateLinkArgs): Record<string, unknown>;
  /** POST /v2/payment-requests. Returns the parsed response. */
  createPaymentLink(args: PayosCreateLinkArgs): Promise<PayosCreateLinkResult>;
  /** POST /v2/confirm-webhook. Registers the public URL. */
  confirmWebhook(webhookUrl: string): Promise<{ webhookUrl: string; raw: unknown }>;
  /** Pull the `data` sub-object out of a raw body for inspection (debug). */
  extractDataField(rawBody: string): Record<string, unknown> | null;
}

const DEFAULT_BASE = 'https://api.payos.vn';

export function createPayosAdapter(cfg: PayosConfig): PayosAdapter {
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE;
  const isConfigured = () =>
    typeof cfg.clientId === 'string' && cfg.clientId.length > 0 &&
    typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0 &&
    typeof cfg.checksumKey === 'string' && cfg.checksumKey.length > 0 &&
    typeof cfg.returnUrl === 'string' && cfg.returnUrl.length > 0 &&
    typeof cfg.cancelUrl === 'string' && cfg.cancelUrl.length > 0;

  /**
   * Build the alphabetical sorted-and-joined string used for
   * `create-payment-link` signatures. The field order is
   * fixed by the PayOS docs (a,c,d,o,r) but the implementation
   * sorts so a future field added by PayOS does not break us.
   */
  const sortedQuery = (parts: Record<string, string | number>): string => {
    return Object.keys(parts)
      .sort()
      .map((k) => `${k}=${parts[k]}`)
      .join('&');
  };

  const signCreateLink = (args: PayosCreateLinkArgs): string => {
    return createHmac('sha256', cfg.checksumKey)
      .update(
        sortedQuery({
          amount: args.amount,
          cancelUrl: cfg.cancelUrl,
          description: args.description,
          orderCode: args.orderCode,
          returnUrl: cfg.returnUrl
        }),
        'utf8'
      )
      .digest('hex');
  };

  /**
   * Webhook signing: same algorithm but the input is a
   * sorted-and-joined `data` object (not the request body).
   * PayOS sends all values as strings (e.g. `"12345"`,
   * `"VND"`) — we must coerce to the same types when
   * computing the expected signature, otherwise the equality
   * check would be brittle. We accept either string or
   * number here.
   */
  const signWebhookData = (data: Record<string, unknown>): string => {
    const normalized: Record<string, string> = {};
    for (const key of Object.keys(data).sort()) {
      const value = data[key];
      if (value === null || value === undefined) {
        normalized[key] = '';
      } else {
        normalized[key] = String(value);
      }
    }
    return createHmac('sha256', cfg.checksumKey)
      .update(
        Object.keys(normalized)
          .map((k) => `${k}=${normalized[k]}`)
          .join('&'),
        'utf8'
      )
      .digest('hex');
  };

  const verifyWebhook = (rawBody: string, headerSignature: string | undefined): boolean => {
    if (!isConfigured()) return false;
    // PayOS signs the payload and embeds the digest in the
    // body under `signature`. We do not require the header
    // (kept for forward compatibility with future
    // `x-payos-signature` headers, but ignored today).
    void headerSignature;
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return false;
    }
    const data = parsed?.data;
    if (!data || typeof data !== 'object') return false;
    const signature = parsed?.signature;
    if (typeof signature !== 'string' || signature.length === 0) return false;
    const expected = signWebhookData(data);
    let a: Buffer;
    let b: Buffer;
    try {
      a = Buffer.from(expected, 'hex');
      b = Buffer.from(signature.trim(), 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };

  const parseWebhook = (rawBody: string): PayosWebhookEvent => {
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new PayosError('PAYLOAD_MALFORMED', 'Webhook body is not valid JSON', 400);
    }
    const data = body?.data;
    if (!data || typeof data !== 'object') {
      throw new PayosError('WEBHOOK_DATA_MISSING', 'Webhook data is missing', 400);
    }
    const orderCodeRaw = data.orderCode ?? body.orderCode;
    const orderCode = Number(orderCodeRaw);
    if (!Number.isInteger(orderCode) || orderCode <= 0) {
      throw new PayosError('PAYLOAD_MALFORMED', 'Missing or invalid orderCode', 400);
    }
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PayosError('PAYLOAD_MALFORMED', 'Missing or invalid amount', 400);
    }
    const description = typeof data.description === 'string' ? data.description : '';
    // Our MNX reference lives in the description (e.g.
    // "Mnemonics mastery-monthly MNX8K4P2"). The description
    // has a 25-char limit at the PayOS side, which we enforce
    // when we build the request. Here we extract the tag.
    const refMatch = description.match(/\bMNX[0-9A-Z]{5}\b/);
    if (!refMatch) {
      throw new PayosError('PAYLOAD_MALFORMED', 'Transfer reference (MNX tag) not found in description', 400);
    }
    const code = typeof data.code === 'string' ? data.code : (typeof body.code === 'string' ? body.code : '');
    const desc = typeof data.desc === 'string' ? data.desc : (typeof body.desc === 'string' ? body.desc : '');
    const paidAtRaw = data.transactionDateTime ?? data.transactionDate ?? body.transactionDateTime;
    const paidAt = paidAtRaw ? new Date(paidAtRaw) : new Date();
    return {
      orderCode,
      amount: Math.round(amount),
      reference: refMatch[0],
      code,
      desc,
      paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
      counterAccountNumber: typeof data.counterAccountNumber === 'string' ? data.counterAccountNumber : null,
      counterAccountName: typeof data.counterAccountName === 'string' ? data.counterAccountName : null,
      paymentLinkId: typeof data.paymentLinkId === 'string' ? data.paymentLinkId : null,
      raw: body
    };
  };

  const buildCreateLinkRequest = (args: PayosCreateLinkArgs): Record<string, unknown> => {
    return {
      orderCode: args.orderCode,
      amount: args.amount,
      description: args.description,
      returnUrl: cfg.returnUrl,
      cancelUrl: cfg.cancelUrl,
      signature: signCreateLink(args)
    };
  };

  const createPaymentLink = async (args: PayosCreateLinkArgs): Promise<PayosCreateLinkResult> => {
    if (!isConfigured()) {
      throw new PayosError('CHANNEL_NOT_CONFIGURED', 'PAYOS_CLIENT_ID / PAYOS_API_KEY / PAYOS_CHECKSUM_KEY chưa cấu hình', 503);
    }
    const body = buildCreateLinkRequest(args);
    const res = await fetch(`${baseUrl}/v2/payment-requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': cfg.clientId,
        'x-api-key': cfg.apiKey
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PayosError('PROVIDER_REQUEST_FAILED', `PayOS trả về body không phải JSON (HTTP ${res.status})`, 502);
    }
    if (!res.ok || parsed?.code !== '00') {
      throw new PayosError(
        'PROVIDER_REQUEST_FAILED',
        `PayOS từ chối tạo link: ${parsed?.desc ?? `HTTP ${res.status}`}`,
        502
      );
    }
    const data = parsed?.data ?? {};
    return {
      paymentLinkId: String(data.paymentLinkId ?? data.id ?? ''),
      checkoutUrl: String(data.checkoutUrl ?? ''),
      qrCode: String(data.qrCode ?? ''),
      orderCode: Number(data.orderCode ?? args.orderCode),
      amount: Number(data.amount ?? args.amount),
      status: (typeof data.status === 'string' ? data.status : 'PENDING') as PayosCreateLinkResult['status'],
      raw: parsed
    };
  };

  const confirmWebhook = async (webhookUrl: string): Promise<{ webhookUrl: string; raw: unknown }> => {
    if (!isConfigured()) {
      throw new PayosError('CHANNEL_NOT_CONFIGURED', 'PAYOS_CLIENT_ID / PAYOS_API_KEY chưa cấu hình', 503);
    }
    const res = await fetch(`${baseUrl}/v2/confirm-webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': cfg.clientId,
        'x-api-key': cfg.apiKey
      },
      body: JSON.stringify({ webhookUrl })
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PayosError('PROVIDER_REQUEST_FAILED', `PayOS trả về body không phải JSON (HTTP ${res.status})`, 502);
    }
    if (!res.ok || parsed?.code !== '00') {
      throw new PayosError(
        'PROVIDER_REQUEST_FAILED',
        `PayOS từ chối confirm webhook: ${parsed?.desc ?? `HTTP ${res.status}`}`,
        502
      );
    }
    return {
      webhookUrl: String(parsed?.data?.webhookUrl ?? webhookUrl),
      raw: parsed
    };
  };

  const extractDataField = (rawBody: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(rawBody);
      const data = parsed?.data;
      if (!data || typeof data !== 'object') return null;
      return data as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  return {
    isConfigured,
    signCreateLink,
    verifyWebhook,
    parseWebhook,
    buildCreateLinkRequest,
    createPaymentLink,
    confirmWebhook,
    extractDataField
  };
}
