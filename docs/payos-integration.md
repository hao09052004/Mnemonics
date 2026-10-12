# Tích hợp PayOS — Hosted Checkout (M3)

> **Phạm vi:** Mô tả kỹ thuật cách Mnemonics tích hợp PayOS
> để tạo đơn hàng thanh toán Mastery (29 000 / 249 000 VND).
> Phù hợp cho kỹ sư backend triển khai, kỹ sư vận hành
> đăng ký webhook với PayOS dashboard, và kỹ sư frontend
> redirect user sang trang PayOS.

> **Lưu ý lịch sử:** Trước đây M3 dùng VietQR tự build
> (NAPAS-247, chỉ hỗ trợ Vietcombank qua SePay). Sau khi
> nhận phản hồi rằng SePay fronts quá ít ngân hàng, M3
> được chuyển sang **PayOS hosted checkout** — PayOS fronts
> tất cả ngân hàng lớn tại Việt Nam (VCB, TCB, MB, ACB,
> BIDV, VPBank, …) và chủ động dựng trang thanh toán + QR.

---

## 1. Tổng quan luồng

```
   user                frontend (apps/web)         backend (apps/api)             PayOS
    │                        │                           │                          │
    │  click "Mastery"       │                           │                          │
    ├───────────────────────▶│  POST /api/v1/billing/     │                          │
    │                        │       orders               │                          │
    │                        ├──────────────────────────▶│  POST /v2/payment-        │
    │                        │                           │     requests              │
    │                        │                           ├─────────────────────────▶│
    │                        │                           │◀─────────────────────────┤
    │                        │                           │  { checkoutUrl, ... }    │
    │                        │◀──────────────────────────┤                          │
    │  window.open(          │                           │                          │
    │   checkoutUrl)         │                           │                          │
    ├───────────────────────▶│                           │                          │
    │                                                        POST /v2/payment-requests/return
    │  (user pays on PayOS)                                  (PayOS redirects to PAYMENT_RETURN_URL)
    │                        │                           │                          │
    │                        │                           │  POST /api/v1/billing/    │
    │                        │                           │     webhooks/payos        │
    │                        │                           │◀─────────────────────────┤
    │                        │                           │  verify HMAC             │
    │                        │                           │  markOrderPaid           │
    │                        │                           │  applyEntitlement        │
    │                        │  GET /api/v1/billing/     │                          │
    │                        │      orders/:id           │                          │
    │                        ├──────────────────────────▶│                          │
    │  redirect to /billing/ │◀──────────────────────────┤                          │
    │  return?status=...     │                           │                          │
    ├◀───────────────────────┤                           │                          │
```

Backend **không** build VietQR / EMV NAPAS-247. Backend
chỉ giữ 3 thứ:

1. Một row `payment_orders` với `order_code` (integer) duy nhất.
2. Một cuộc gọi `POST /v2/payment-requests` để PayOS cấp
   `checkout_url` (URL hosted của PayOS).
3. Một webhook `POST /api/v1/billing/webhooks/payos` để
   nhận event "paid" từ PayOS.

---

## 2. Cấu hình PayOS merchant

Đăng ký tại [my.payos.vn](https://my.payos.vn). Tạo
"kênh thanh toán" (payment channel) cho môi trường
(sandbox / production) và lấy 3 thông tin:

| Biến môi trường | Mô tả |
|---|---|
| `PAYOS_CLIENT_ID` | UUID merchant channel (label `Client-ID`) |
| `PAYOS_API_KEY` | API key (label `API Key`) |
| `PAYOS_CHECKSUM_KEY` | Checksum key dùng để ký request body + verify webhook signature |

> ⚠️ Không paste 3 giá trị trên vào chat AI, file tracked,
> hay commit git. Lưu trong secret manager của hosting
> (Vercel / Railway / Render / Supabase Vault).

### 2.1 Frontend URLs

PayOS redirect user về hai URL này sau khi thanh toán /
huỷ. URL **phải là HTTPS** ở production — PayOS sandbox
chấp nhận `http://localhost` nhưng production sẽ reject
chứng chỉ self-signed.

| Biến môi trường | Mục đích |
|---|---|
| `PAYMENT_RETURN_URL` | Sau khi user thanh toán xong (success hoặc cancel-from-PayOS) |
| `PAYMENT_CANCEL_URL` | Khi user bấm "Huỷ" trên trang PayOS |

Frontend nên đọc query string `?status=...&orderCode=...`
từ `PAYMENT_RETURN_URL` để poll order status (paid /
cancelled / expired).

### 2.2 Đăng ký webhook URL

PayOS yêu cầu backend phải gọi `POST /v2/confirm-webhook`
**một lần** để đăng ký URL webhook. PayOS sẽ POST một
test event tới URL đó để xác minh:

```bash
curl -X POST https://api.payos.vn/v2/confirm-webhook \
  -H "x-client-id: $PAYOS_CLIENT_ID" \
  -H "x-api-key: $PAYOS_API_KEY" \
  -H "content-type: application/json" \
  -d '{"webhookUrl": "https://api.your-domain.com/api/v1/billing/webhooks/payos"}'
```

Backend chưa expose admin endpoint cho việc này; operator
chạy curl một lần khi deploy production (sau khi đã set
DNS / TLS). Có thể dùng ngrok / Cloudflare Tunnel cho dev.

> Backend adapter (`apps/api/src/payments/providers/payos.ts`)
> đã có sẵn method `confirmWebhook(webhookUrl)` — chỉ cần
> expose nó qua một admin route khi có nhu cầu.

---

## 3. Tạo đơn hàng

`POST /api/v1/billing/orders` (auth):

```ts
const order = await createOrder(pool, {
  userId,
  planId: 'mastery-monthly',
  payos: adapter
});
// → { id, orderCode, reference, checkoutUrl, amountVnd, status, ... }
```

Luồng backend:

1. `generateReference()` — sinh 8-char `MNX*****` + integer
   `orderCode` trong `[10⁷, 10⁸)`. Cả hai đều unique.
2. `INSERT payment_orders` với `status='pending'`.
3. `payos.createPaymentLink({ orderCode, amount, description })` —
   nếu PayOS trả lỗi thì mark order `rejected` với note.
4. `UPDATE payment_orders SET checkout_url=...` rồi trả về
   client.

Response shape:

```jsonc
{
  "data": {
    "order": {
      "id": "42",
      "userId": "...",
      "planId": "mastery-monthly",
      "amountVnd": 29000,
      "orderCode": 12345678,
      "reference": "MNX8K4P2",
      "checkoutUrl": "https://pay.payos.vn/web/abc123",
      "status": "pending",
      "expiresAt": "2026-10-12T13:30:00.000Z"
    },
    "checkout": {
      "url": "https://pay.payos.vn/web/abc123",
      "orderCode": 12345678,
      "amount": 29000
    }
  }
}
```

Frontend dùng `data.checkout.url` — redirect user sang đó
(`window.location.assign(url)` hoặc mở tab mới).

---

## 4. Webhook xác minh

`POST /api/v1/billing/webhooks/payos` — public, signature-protected.

### 4.1 PayOS → Backend payload

```jsonc
{
  "code": "00",          // "00" = success
  "desc": "success",
  "data": {
    "orderCode": 12345678,
    "amount": 29000,
    "description": "Mnemonics mastery-monthly MNX8K4P2",
    "accountNumber": "...",
    "reference": "MNX8K4P2",
    "transactionDateTime": "2026-10-12 13:45:00",
    "currency": "VND",
    "paymentLinkId": "abc123",
    "code": "00",
    "desc": "success",
    "counterAccountBankId": "...",
    "counterAccountBankName": "VCB",
    "counterAccountName": "NGUYEN VAN A",
    "counterAccountNumber": "111122223333"
  },
  "signature": "<hex hmac>"
}
```

### 4.2 Backend verify

1. Tính `HMAC-SHA256(checksum_key, sorted_data_fields_concat)`
   trong đó `sorted_data_fields_concat` là các cặp
   `key=value` của object `data` (chỉ field top-level,
   sort alphabet theo key, join bằng `&`). Tất cả value
   được ép sang string (PayOS gửi cả string lẫn number
   trong cùng một payload tuỳ version).
2. So sánh hex digest với `body.signature` bằng
   `crypto.timingSafeEqual` (chống timing attack).
3. Khớp → parse `description` lấy MNX reference.
4. `code !== '00'` → 200 OK, không advance order (chỉ ghi
   event để admin đối soát). PayOS không retry non-success.
5. Tìm order qua `order_code` (integer). Không có → 200 OK,
   mark `unmatched`.
6. Khớp `amount` → mark `paid`, gọi `applyEntitlement`.
7. Sai amount → mark `rejected`, trả 422.

Idempotency: `(provider='payos', provider_txn_id=orderCode)`
unique. Lần gọi thứ hai với cùng `orderCode` trả 200 OK
với `data.idempotent=true`.

---

## 5. Hết hạn đơn hàng

Giống M3 cũ: order có `expires_at`. Khi user GET order,
backend lazy-flip `pending → expired` nếu clock đã quá
`expires_at` (default 30 phút). PayOS tự cancel payment
link sau khi hết hạn (`status=CANCELLED`), nhưng backend
vẫn giữ logic riêng để audit.

---

## 6. Khác biệt với SePay (M3 cũ)

| Khía cạnh | SePay (cũ) | PayOS (mới) |
|---|---|---|
| Số ngân hàng hỗ trợ | ~1 (Vietcombank) | ~40 (VCB, TCB, MB, ACB, BIDV, VPBank, …) |
| Build QR | Backend (NAPAS-247 EMV) | PayOS hosts |
| User flow | Quét QR trong app bank | Vào trang PayOS → chọn bank → quét QR trên PayOS |
| Identifier | `reference` (MNX string) | `orderCode` (integer) + `reference` (MNX trong `description`) |
| Signature | Header `X-Sepay-Signature` | Body field `signature` |
| Test mode | Sandbox riêng | Cùng base URL, phân biệt bằng `x-client-id` |
| Account operator phải có | TK Vietcombank | Không cần (PayOS đứng ra nhận tiền) |

---

## 7. Tham khảo

- [PayOS API docs](https://payos.vn/docs/api/) — tiếng Việt, đầy đủ
- [PayOS Python SDK](https://github.com/payOSHQ/payos-lib-python) — tham khảo thuật toán ký
- [M3 plan (Vietnamese)](2026-10-12-saas-billing-admin-analytics-m3-payos.md) — kế hoạch triển khai
- `apps/api/src/payments/providers/payos.ts` — adapter implementation
- `apps/api/src/routes/payment-webhook.ts` — webhook route
