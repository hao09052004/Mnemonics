# Hệ thống thanh toán & gói dịch vụ (M2/M3)

> **Phạm vi:** Tài liệu này mô tả kiến trúc billing Memory/Mastery, schema cơ sở dữ liệu,
> luồng tạo đơn hàng, xác minh thanh toán, kích hoạt gói, đối soát thủ công, và các
> chính sách vận hành. Phù hợp cho kỹ sư backend, kỹ sư vận hành, và đội ngũ hỗ trợ.

---

## 1. Tổng quan

Mnemonics cung cấp **hai gói** cho người dùng cuối:

| Plan ID | Tên hiển thị | Giá | Chu kỳ | Quota | Semantic Search |
|---|---|---|---|---|---|
| `memory` | Memory | 0 VND | mãi mãi | 50 captures/tháng | Không |
| `mastery-monthly` | Mastery (Tháng) | 29.000 VND | 30 ngày | không giới hạn | Có |
| `mastery-yearly` | Mastery (Năm) | 249.000 VND | 365 ngày | không giới hạn | Có |

Hai gói Mastery có ID khác nhau nhưng `family='mastery'`. Khi xét quyền ở backend, luôn
kiểm tra `family`, không phải `id` cụ thể — điều này giúp bạn thêm gói mới mà không phải
sửa logic quyền.

**Không tự động gia hạn.** Đây là chuyển khoản thủ công. Khi hết hạn, hệ thống tự
chuyển về `memory`; thời gian đã mua không bị mất (cộng dồn từ ngày hết hạn hiện tại).

---

## 2. Kiến trúc dữ liệu

### 2.1 `billing_plans`

Bảng danh mục gói do server quản lý — frontend **không** được phép tạo/sửa gói.

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | text PK | `memory`, `mastery-monthly`, `mastery-yearly` |
| `display_name` | text | Tên hiển thị |
| `family` | text | `memory` \| `mastery` |
| `interval` | text | `forever` \| `month` \| `year` |
| `amount_vnd` | integer | Giá VND, kiểu `int` (không dùng `numeric` để tránh FP) |
| `monthly_capture_limit` | integer \| null | Null = không giới hạn |
| `semantic_search_enabled` | boolean | Quyền dùng semantic search |
| `is_active` | boolean | Tạm ẩn gói mà không xóa |

### 2.2 `subscriptions`

Bảng ghi trạng thái gói hiện tại của user. **Một user có đúng một row** (unique trên
`user_id`). Khi gia hạn, server cập nhật row hiện tại thay vì tạo row mới.

| Cột | Kiểu | Mô tả |
|---|---|---|
| `user_id` | uuid PK | Khóa ngoại tới `auth.users` |
| `plan_id` | text | FK tới `billing_plans.id` |
| `family` | text | `memory` \| `mastery` |
| `status` | text | `active` \| `expired` \| `cancelled` |
| `valid_from` | timestamptz | Bắt đầu hiệu lực |
| `valid_until` | timestamptz \| null | `null` = mãi mãi (gói Memory) |
| `source` | text | `default`, `purchase`, `manual_grant`, `comp` |
| `updated_at` | timestamptz | Cập nhật lần cuối |

### 2.3 `payment_orders`

Mỗi lần người dùng nhấn "Nâng cấp" tạo ra một order. Order có vòng đời rõ ràng:

```
pending → paid → (subscription activated)
   │
   ├─→ expired   (timeout, chưa nhận tiền)
   ├─→ cancelled (user tự hủy)
   └─→ rejected  (sai số tiền / sai nội dung)
```

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | FK auth.users |
| `plan_id` | text | |
| `interval` | text | `month` \| `year` |
| `amount_vnd` | integer | Snapshot giá tại thời điểm tạo |
| `reference` | text UNIQUE | Mã tham chiếu chuyển khoản, ASCII, 8–12 ký tự |
| `status` | text | `pending` \| `paid` \| `expired` \| `cancelled` \| `rejected` |
| `provider` | text \| null | `sepay` \| `manual` |
| `provider_tx_id` | text \| null | Idempotency key từ provider |
| `created_at` | timestamptz | |
| `paid_at` | timestamptz \| null | |
| `expires_at` | timestamptz | Mặc định 30 phút sau khi tạo |

### 2.4 `payment_events`

Mọi sự kiện liên quan đến đơn hàng đều ghi vào bảng này. Dùng cho audit và debug.

| Cột | Mô tả |
|---|---|
| `order_id` | FK tới order |
| `event_type` | `created`, `qr_generated`, `webhook_received`, `webhook_verified`, `activated`, `failed`, `manual_reconciled` |
| `payload` | jsonb — body webhook, lý do lỗi, v.v. |
| `created_at` | |

### 2.5 `subscription_events`

Ghi lại mọi lần subscription thay đổi (kích hoạt, gia hạn, hết hạn, admin adjust).
Cột `actor_user_id` cho phép theo dõi đó là user tự kích hoạt (qua payment) hay admin
điều chỉnh thủ công.

### 2.6 `billing_audit_logs`

Mọi thao tác nhạy cảm (manual reconcile, admin adjust, refund) đều ghi audit log với
lý do bắt buộc.

---

## 3. Luồng nghiệp vụ

### 3.1 Tạo đơn hàng (M3)

```
POST /api/v1/billing/orders
Body: { planId: "mastery-monthly" | "mastery-yearly" }
```

Server:
1. Xác thực user (Bearer token).
2. Từ chối nếu user đang có subscription `mastery` còn hiệu lực > 7 ngày.
3. Tra `billing_plans` để lấy `amount_vnd` (KHÔNG tin tưởng client gửi giá).
4. Tạo order với status `pending`, snapshot `amount_vnd` từ DB.
5. Tạo `reference` 8 ký tự ASCII (A–Z, 2–9) đảm bảo unique.
6. Tính nội dung QR: EMVCo NAPAS-247 với:
   - bank BIN = 970436
   - account = 9912780019
   - amount = `amount_vnd`
   - description = `reference`
7. Trả `{ order, qr: { payload, dataUrl }, recipient }` về client.
8. Lưu `payment_event` type=`qr_generated`.

### 3.2 Webhook xác minh (M3)

```
POST /api/v1/billing/webhooks/sepay
Headers: X-Sepay-Signature: hmac-sha256(rawBody, SEPAY_WEBHOOK_SECRET)
Body: { id, gateway, transactionDate, accountNumber, amount, description, ... }
```

Server:
1. **Verify HMAC** trên raw body — sai chữ ký → 401.
2. **Idempotency**: nếu `id` (tx id) đã tồn tại trong `payment_events` với `event_type='webhook_verified'` → 200 OK, không xử lý lại.
3. Kiểm tra `accountNumber` khớp với beneficiary cấu hình → sai → 422.
4. Parse `description` tìm order `reference` 8 ký tự → không thấy → 422.
5. Trong một transaction SQL:
   - `SELECT … FOR UPDATE` order với `status='pending'` và `reference=…`.
   - So sánh `amount` với `order.amount_vnd` → sai → set `rejected`.
   - Cập nhật order → `status='paid'`, `paid_at=now()`, `provider_tx_id=…`.
   - Tìm/cập nhật `subscriptions`:
     - Nếu `valid_until < now()` hoặc null → set `valid_from=now()`, `valid_until=now() + interval`.
     - Nếu đang active → cộng dồn: `valid_until = valid_until + interval`.
   - Insert `subscription_events` type=`activated` (hoặc `renewed`).
6. Trả 200 OK.

Nếu có lỗi bất kỳ bước nào: roll back DB, trả 5xx để provider retry.

### 3.3 Đối soát thủ công (M4)

```
POST /api/v1/admin/payments/:id/reconcile
Body: { amount_vnd: 29000, note: "Đã xác nhận qua sao kê ngân hàng" }
Permission: admin.payments.review
```

Server:
1. Kiểm tra user có quyền `admin.payments.review`.
2. Transaction SQL: chuyển order sang `paid`, kích hoạt subscription tương tự webhook.
3. Ghi `billing_audit_logs` với `actor_user_id`, `target_user_id`, `old_status`, `new_status`, `note`.
4. Idempotent: nếu order đã `paid` thì 409 Conflict.

### 3.4 Hết hạn & downgrading

Mỗi request từ user có middleware `requireAuth` → load `subscriptions` → kiểm tra
`valid_until`. Nếu `< now()`:
- Subscription giữ nguyên row, set `status='expired'`.
- Lần truy vấn tiếp theo trả về `family='memory'`, `valid_until=null` (xem §4.3).

Đây là **lazy expiration** — không cần cron job. Đánh đổi: nếu user không truy cập
30 ngày thì row vẫn `active` trong DB, nhưng mọi check quyền đều đúng.

---

## 4. API endpoints

### 4.1 User-facing

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/api/v1/billing/plans` | public | Liệt kê gói đang active |
| GET | `/api/v1/billing/me` | auth | Entitlement hiện tại của user |
| POST | `/api/v1/billing/orders` | auth | Tạo order, nhận QR |
| GET | `/api/v1/billing/orders` | auth | Lịch sử đơn của user |
| GET | `/api/v1/billing/orders/:id` | auth | Chi tiết đơn |
| POST | `/api/v1/billing/orders/:id/cancel` | auth | User tự hủy order pending |

### 4.2 Webhook

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/api/v1/billing/webhooks/sepay` | HMAC | Provider SePay gọi |

### 4.3 Admin

| Method | Path | Permission | Mô tả |
|---|---|---|---|
| GET | `/api/v1/admin/payments` | `admin.payments.read` | Danh sách orders |
| GET | `/api/v1/admin/payments/:id` | `admin.payments.read` | Chi tiết |
| POST | `/api/v1/admin/payments/:id/reconcile` | `admin.payments.review` | Đối soát thủ công |
| GET | `/api/v1/admin/subscriptions` | `admin.subscriptions.read` | |
| POST | `/api/v1/admin/subscriptions/:id/adjust` | `admin.subscriptions.manage` | |
| GET | `/api/v1/admin/audit-logs` | `admin.audit.read` | Audit log |

---

## 5. Atomicity & Concurrency

Cảnh báo: `subscriptions` và `payment_orders` cùng đọc/ghi khi webhook đến. Nếu
**hai webhook cùng lúc** cho cùng `order.id`, một cái sẽ thắng lock, cái còn lại
sẽ thấy `status='paid'` và 200 OK mà không kích hoạt lại (idempotent).

Câu lệnh SQL quan trọng:

```sql
BEGIN;
  SELECT * FROM payment_orders
    WHERE id = $1
    FOR UPDATE;            -- giữ row lock
  UPDATE payment_orders
    SET status='paid', paid_at=now(), provider_tx_id=$2
    WHERE id = $1 AND status='pending';
  -- nếu affected rows = 0, order đã được xử lý: COMMIT và return 200.
  UPDATE subscriptions
    SET valid_until = COALESCE(valid_until, now()) + interval
    WHERE user_id = $3;
COMMIT;
```

Tất cả các tầng throttling/rate-limit đều thực hiện ở **server** — không phụ thuộc
vào client.

---

## 6. Bảo mật

- **Không bao giờ** chấp nhận số tiền từ client. Luôn snapshot từ `billing_plans`.
- **Không bao giờ** tin tưởng callback URL parameter để cấp quyền.
- **Idempotency** ở cả webhook (`provider_tx_id`) lẫn order (`reference`).
- **Audit log** cho mọi thao tác nhạy cảm (reconcile, adjust, refund).
- Webhook endpoint **không** nằm sau `requireAuth` của user — nó xác thực bằng HMAC.
- Không log raw body webhook (chứa thông tin ngân hàng nhạy cảm).

---

## 7. Kế hoạch rollback

- Tắt `BILLING_ENABLED=false` → endpoint `/billing/orders` trả 503, nhưng user đã
  trả tiền vẫn giữ subscription.
- Không xóa cột `valid_until` hoặc row `subscriptions` khi rollback — chỉ tắt
  endpoint tạo mới.
- Webhook có thể tạm dừng nhận bằng cách đổi `SEPAY_WEBHOOK_SECRET` — webhook cũ
  sẽ trả 401, không gây side-effect.

---

## 8. Vận hành

### 8.1 Kiểm tra thường ngày

- Số order `status='pending'` > 2 giờ → truy nguyên nhân (user quên chuyển, network).
- Số order `status='rejected'` hôm qua → tìm pattern (sai STK, sai nội dung).
- Tổng doanh thu `paid` khớp với sao kê Vietcombank.

### 8.2 Sự cố thường gặp

- **Webhook nhận nhưng không kích hoạt**: kiểm tra log `payment_events` type=`webhook_received`
  → nếu có `webhook_verified` thì lỗi ở bước match reference/amount.
- **Order pending quá hạn**: cron job dọn (xem migrations `expire_pending_orders()`).
- **User nói đã chuyển nhưng vẫn Memory**: bắt buộc phải có webhook. Không cấp quyền
  thủ công nếu không có bằng chứng ngân hàng.

---

## 9. Liên kết

- `docs/vietqr-integration.md` — chi tiết EMVCo encoding
- `docs/rbac-security.md` — permission matrix
- `docs/payment-reconciliation.md` — quy trình đối soát thủ công
- `docs/saas-production-checklist.md` — release checklist
