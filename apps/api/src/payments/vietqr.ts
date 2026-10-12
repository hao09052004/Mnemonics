/**
 * VietQR payload builder.
 *
 * The Vietnamese banking apps (Vietcombank, MB Bank, Techcombank,
 * etc.) parse a structured EMVCo-style string that the QR code
 * encodes. The full NAPAS-247 spec uses TLV (tag-length-value)
 * encoding with a CRC-16/CCITT checksum.
 *
 * For Mnemonics we generate a documented subset that real
 * banking apps accept:
 *
 *   1. Tag 38 (Merchant Account Information) — one sub-TLV
 *      block for the "vietqr" template (00 = GUID, 01 = BIN,
 *      02 = account number).
 *   2. Tag 53 (Transaction Currency) = 704 (VND).
 *   3. Tag 54 (Transaction Amount).
 *   4. Tag 58 (Country Code) = VN.
 *   5. Tag 59 (Merchant Name) — the bank account holder.
 *   6. Tag 62 (Additional Data Field Template) — sub-tag 08
 *      holds the transfer reference ("MNX8K4P2Q"-style).
 *   7. Tag 63 (CRC) — "6304" + 4 hex digits of CRC-16/CCITT
 *      over the entire string up to (but not including) tag 63.
 *
 * The function returns the full string, which is the payload
 * the QR encoder renders.
 *
 * References:
 *   - NAPAS 247 — Quick-Response Code Specification for
 *     Payment Services at Points-of-Initiation (Merchant
 *     Presented QR), public version.
 *   - EMVCo Merchant Presented QR Code Specification, v1.0.
 */
import { createHash } from 'node:crypto';

export interface VietQrInput {
  bankBin: string;          // e.g. "970436"
  bankAccount: string;      // e.g. "9912780019"
  bankHolder: string;       // e.g. "DAO QUYNH LE"
  amountVnd: number;        // positive integer
  reference: string;        // 8-char ASCII, e.g. "MNX8K4P2Q"
  description?: string;     // optional human-readable note
}

export class VietQrError extends Error {
  readonly code: 'INVALID_AMOUNT' | 'INVALID_REFERENCE' | 'INVALID_HOLDER';
  constructor(code: VietQrError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** CRC-16/CCITT-FALSE (polynomial 0x1021, init 0xFFFF) per EMVCo spec. */
export function crc16Ccitt(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

/** Encode a TLV field: `id` (2 hex) + `len` (2 hex) + `value` (UTF-8 bytes). */
function tlv(id: string, value: string): string {
  const hexLen = value.length.toString(16).padStart(2, '0');
  return `${id}${hexLen}${value}`;
}

const VIETQR_GUID = 'A000000727';   // NAPAS-247 application identifier

export function buildVietQrPayload(input: VietQrInput): string {
  if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
    throw new VietQrError('INVALID_AMOUNT', `amount must be a positive integer, got ${input.amountVnd}`);
  }
  if (!/^[A-Z0-9]{6,16}$/.test(input.reference)) {
    throw new VietQrError(
      'INVALID_REFERENCE',
      `reference must be 6–16 uppercase ASCII alphanumerics, got "${input.reference}"`
    );
  }
  if (input.bankHolder.length === 0 || input.bankHolder.length > 25) {
    throw new VietQrError(
      'INVALID_HOLDER',
      `bankHolder must be 1–25 chars, got ${input.bankHolder.length}`
    );
  }

  // Tag 38 = Merchant Account Information. We use a single
  // sub-TLV block (id="00") with the NAPAS-247 GUID, then
  // "01" for the BIN and "02" for the account. The rest of
  // the spec ("03"=service, "04"=merchant category) is
  // optional and omitted to keep the payload short.
  const merchantInfo = tlv('00', VIETQR_GUID) + tlv('01', input.bankBin) + tlv('02', input.bankAccount);

  // The reference lives in the "Additional Data" template,
  // sub-tag "08" (purpose of transaction). Banking apps
  // display this as "Ghi chú" and require it to match the
  // transfer description the user types in.
  const additionalData = tlv('08', input.reference);

  // Build everything except the CRC, then compute CRC over
  // the entire string (including the "63" id and "04" length
  // placeholder so the consumer can verify the payload
  // round-trip without re-running the encoder).
  const noCrc =
    tlv('00', '01') +              // Payload Format Indicator
    tlv('01', '11') +              // Point of Initiation Method = 11 (static) or 12 (dynamic). 12 = one-shot.
    tlv('38', merchantInfo) +
    tlv('53', '704') +             // VND
    tlv('54', input.amountVnd.toString()) +
    tlv('58', 'VN') +
    tlv('59', input.bankHolder.toUpperCase().slice(0, 25)) +
    tlv('62', additionalData) +
    '6304';                        // CRC tag id + length

  const crc = crc16Ccitt(noCrc);
  const crcHex = crc.toString(16).padStart(4, '0').toUpperCase();
  return `${noCrc}${crcHex}`;
}

/** Stable hash of the payload for audit / dedupe purposes. */
export function payloadHash(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
