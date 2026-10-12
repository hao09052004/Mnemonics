# Production Release Checklist — SaaS Mnemonics

> **Phạm vi:** Checklist cần hoàn thành trước khi đưa hệ thống billing/admin/analytics
> lên production. Mỗi mục ghi rõ owner, bằng chứng hoàn thành, và blockers nếu chưa xong.

---

## 0. Trước khi bắt đầu

- [ ] Branch `feat/saas-billing-admin-analytics` đã merge vào `main`.
- [ ] `pnpm install` không có peer-dep warning nghiêm trọng.
- [ ] Mọi test pass (xem §1).

---

## 1. Tests & Quality gates

### 1.1 Backend

```bash
pnpm --filter @mnemonics/api test
pnpm --filter @mnemonics/api typecheck
```

Kết quả kỳ vọng: **0 fail, 0 skip** (ngoại trừ test bị skip chủ động).

### 1.2 Frontend

```bash
pnpm --filter @mnemonics/web test
pnpm --filter @mnemonics/web build
```

Kết quả kỳ vọng: typecheck pass, build pass, all 138 tests pass.

### 1.3 Database

```bash
pnpm --filter @mnemonics/database test
```

Kết quả kỳ vọng: 75/75 pass.

### 1.4 RBAC tests

- [ ] User mới đăng ký nhận role `user`.
- [ ] User gọi `/admin/*` → 403.
- [ ] Admin gọi `/admin/*` (có permission) → 200.
- [ ] Sửa `localStorage.role` rồi gọi API → 403.
- [ ] Webhook với sai HMAC → 401.
- [ ] Webhook trùng `provider_tx_id` → 200 idempotent.
- [ ] Memory user tạo capture thứ 51 → 402.

### 1.5 Concurrency

- [ ] 2 capture đồng thời ở user thứ 50 → chỉ 1 thành công.
- [ ] 2 webhook cùng lúc cho cùng order → 1 thắng, 1 idempotent.
- [ ] Admin reconcile + webhook race → 1 trong 2 thắng (không 2 lần activation).

---

## 2. Environment variables

### 2.1 Server

| Var | Bắt buộc | Mô tả |
|---|---|---|
| `SUPABASE_URL` | ✓ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | server-only |
| `SUPABASE_JWT_SECRET` | ✓ | verify JWT |
| `DATABASE_URL` | ✓ | Postgres + pgvector |
| `BILLING_ENABLED` | ✓ | mặc định `false` cho go-live lần đầu |
| `PAYMENT_PROVIDER` | ✓ | `sepay` |
| `PAYMENT_BANK_BIN` | ✓ | `970436` |
| `PAYMENT_BANK_ACCOUNT` | ✓ | `9912780019` |
| `PAYMENT_BANK_HOLDER` | ✓ | `DAO QUYNH LE` |
| `SEPAY_WEBHOOK_SECRET` | ✓ | random 32 bytes |
| `SEPAY_API_KEY` | optional | cho SePay dashboard |
| `MEMORY_MONTHLY_CAPTURE_LIMIT` | ✓ | `50` |
| `ADMIN_DASHBOARD_ENABLED` | ✓ | `true` |
| `ANALYTICS_ENABLED` | ✓ | `true` |
| `ANALYTICS_TIMEZONE` | ✓ | `Asia/Ho_Chi_Minh` |
| `AI_USER_DAILY_LIMIT` | ✓ | theo quota Gemini |
| `GEMINI_API_KEY` | ✓ | server-only |
| `GEMINI_RATE_LIMIT_RPM` | ✓ | |
| `GEMINI_MAX_CONCURRENT_REQUESTS` | ✓ | |
| `CORS_ALLOW_ORIGINS` | ✓ | danh sách domain production |

### 2.2 Frontend

| Var | Bắt buộc | Mô tả |
|---|---|---|
| `VITE_API_URL` | ✓ | URL của API |
| `VITE_DEMO_MODE` | optional | `true` chỉ cho demo |

> ⚠️ KHÔNG BAO GIỜ expose `SUPABASE_SERVICE_ROLE_KEY`, `SEPAY_WEBHOOK_SECRET`,
> `GEMINI_API_KEY` qua biến `VITE_*` — chúng sẽ bị bundle vào JS gửi cho browser.

---

## 3. Database migration

```bash
psql $DATABASE_URL -f packages/database/migrations/0001_init.sql
psql $DATABASE_URL -f packages/database/migrations/... # mọi migration M1–M5
```

Checklist:

- [ ] Tất cả migrations chạy thành công trên DB staging.
- [ ] Roll forward an toàn (không drop data cũ).
- [ ] Roll back script có sẵn cho mỗi migration quan trọng.
- [ ] `role_permissions` đã seed với mapping user/admin.
- [ ] RLS đã enable trên `items`, `item_tags`, `subscriptions`, `payment_orders`.
- [ ] Index cho analytics events đã tạo.

---

## 4. SePay setup (provider)

### 4.1 Tạo tài khoản SePay

- [ ] Đăng ký tài khoản merchant tại <https://sepay.vn>.
- [ ] Kết nối Vietcombank `9912780019` (cùng chủ tài khoản `DAO QUYNH LE`).
- [ ] Verify merchant (theo quy trình SePay, có thể mất 1–3 ngày).

### 4.2 Cấu hình webhook

Trong SePay dashboard:
- [ ] Webhook URL: `https://<api-domain>/api/v1/billing/webhooks/sepay`
- [ ] Copy webhook secret, paste vào env `SEPAY_WEBHOOK_SECRET`.
- [ ] Bật event: `transaction.created` (hoặc tương đương).
- [ ] Test gửi một giao dịch giả để verify endpoint.

### 4.3 Cấu hình QR động

- [ ] Mở app ngân hàng → quét QR từ `/app/billing/checkout?plan=mastery-monthly`.
- [ ] Verify hiển thị đúng STK, tên, số tiền, nội dung.
- [ ] Gửi 29.000 VND test → sau 5–10s, subscription active.

---

## 5. Admin bootstrap

### 5.1 Tạo admin đầu tiên

```bash
# Đăng ký user bình thường trước (qua /signup)
# Lấy user_id từ Supabase dashboard
pnpm --filter @mnemonics/api bootstrap:admin \
  -- --user-uuid=<uuid> --reason="Founder"
```

- [ ] Confirm command yêu cầu gõ "y" trước khi apply.
- [ ] Verify trong DB: `SELECT role FROM profiles WHERE id = '<uuid>';` → `admin`.
- [ ] Verify trong `role_audit_log` có row.
- [ ] Login với user đó → truy cập `/admin` thành công.

### 5.2 MFA (khuyến nghị)

- [ ] Bật MFA cho tài khoản admin trong Supabase dashboard.
- [ ] Lưu recovery codes ở nơi an toàn (1Password, Bitwarden, ...).

---

## 6. Security review

- [ ] Không có secret nào trong source code (`grep -r "SEPAY\|GEMINI\|SUPABASE_SERVICE" apps/`).
- [ ] Build web không chứa secret (kiểm tra file `dist/assets/*.js`).
- [ ] CORS chỉ allow origin production.
- [ ] Rate limit đã bật cho `/auth/login`, `/auth/register`, `/billing/orders`.
- [ ] HTTPS bắt buộc cho tất cả traffic.
- [ ] Webhook URL chỉ chấp nhận POST, không GET.
- [ ] Audit log ghi đầy đủ (test thử 1 action rồi check log).

---

## 7. Documentation

- [ ] `docs/billing-system.md` đã publish.
- [ ] `docs/vietqr-integration.md` đã publish.
- [ ] `docs/rbac-security.md` đã publish.
- [ ] `docs/admin-dashboard.md` đã publish.
- [ ] `docs/analytics-metrics.md` đã publish.
- [ ] `docs/subscription-entitlements.md` đã publish.
- [ ] `docs/payment-reconciliation.md` đã publish.
- [ ] `docs/saas-production-checklist.md` (file này) đã publish.

---

## 8. Staging verification

Trước khi go-live, chạy toàn bộ journey trên staging:

### 8.1 Journey A — Free user

- [ ] Đăng ký user mới.
- [ ] Lưu 5 memories.
- [ ] Mở `/app/analytics` → thấy đúng số liệu.
- [ ] Lưu đến 50 → capture thứ 51 bị reject với CTA upgrade.
- [ ] Mở `/pricing` → thấy Memory + Mastery cards.

### 8.2 Journey B — Upgrade

- [ ] Mở `/app/billing/checkout?plan=mastery-monthly`.
- [ ] QR hiển thị đúng STK, tên, số tiền 29.000 VND, reference.
- [ ] Chuyển khoản thật từ Vietcombank.
- [ ] Sau < 60s, subscription active.
- [ ] `/app/analytics` hiển thị `mastery` plan.
- [ ] Search với `mode=semantic` → trả kết quả.
- [ ] Logout, login lại → vẫn Mastery.

### 8.3 Journey C — Admin

- [ ] Login as admin.
- [ ] Mở `/admin` → thấy KPI tổng.
- [ ] Mở `/admin/users` → thấy danh sách, không có memory content.
- [ ] Mở `/admin/payments` → thấy order vừa tạo.
- [ ] Tạo order `pending` mới → mở modal reconcile → test luồng.
- [ ] Mở `/admin/audit-logs` → thấy log gần đây.

### 8.4 Journey D — RBAC attack

- [ ] Login as user thường.
- [ ] Truy cập `/admin` → 403.
- [ ] Sửa localStorage `role` thành `admin` → vẫn 403.
- [ ] Gọi `GET /api/v1/admin/users` bằng token user → 403.
- [ ] Gọi `POST /api/v1/admin/payments/:id/reconcile` → 403.
- [ ] Thử tạo order với `amount_vnd=100` → server bỏ qua, dùng giá DB.

### 8.5 Journey E — Expiration

- [ ] Mastery active.
- [ ] Manual: `UPDATE subscriptions SET valid_until = now() - interval '1 day' WHERE user_id=...`
- [ ] Search semantic → 402 MASTERY_REQUIRED.
- [ ] Capture mới vẫn tạo được (vì không giới hạn Mastery) nhưng semantic bị tắt.
- [ ] Memory cũ vẫn đọc được.

---

## 9. Production launch (T+0)

### 9.1 Pre-launch (T-1h)

- [ ] Snapshot DB trước khi apply migration (nếu cần).
- [ ] Verify env production đã set đúng (BILLING_ENABLED=false cho soft launch).
- [ ] Verify DNS, TLS, CDN.
- [ ] Monitor: Datadog / Sentry đã hook.
- [ ] Oncall đã được brief.

### 9.2 Soft launch (T+0)

- [ ] `BILLING_ENABLED=true` chỉ bật sau khi SePay verified.
- [ ] Admin test với 1 order thật, số tiền 29.000 VND.
- [ ] Verify webhook, verify activation.
- [ ] Monitor 24h.

### 9.3 Public launch

- [ ] Đăng PR/email announcement.
- [ ] Bật `BILLING_ENABLED=true` cho toàn bộ user.
- [ ] Theo dõi dashboard `/admin` liên tục trong 48h.

---

## 10. Rollback plan

| Tình huống | Hành động |
|---|---|
| Bug nghiêm trọng ở billing | Set `BILLING_ENABLED=false`. User đã trả tiền vẫn giữ subscription. |
| Webhook SePay trục trặc | Disable endpoint bằng cách đổi `SEPAY_WEBHOOK_SECRET` (sai secret → SePay nhận 401, retry). |
| Schema migration fail | Roll forward bằng cách chạy fix migration. KHÔNG xóa bảng đã tạo. |
| Admin bị compromise | Tạm suspend admin qua DB, rotate secret, điều tra. |
| SePay account bị đóng | Tạm tắt `BILLING_ENABLED`, manual reconcile qua sao kê. |
| Data leak | Revoke admin role, rotate tất cả JWT secret, thông báo user. |

---

## 11. Known limitations

- **MRR/ARR là estimated run-rate**, không phải cam kết. Hiển thị rõ disclaimer.
- **Retention cohort** cần ≥ 5 user / cohort để hiển thị số (privacy).
- **AI quota hiển thị là giới hạn nội bộ** của app, không phải Google quota.
- **Webhook SePay** có thể trễ 1–5 phút trong giờ cao điểm. KHÔNG ép user chờ
  real-time.
- **Refunds** chưa có flow tự động (sẽ là M7+).

---

## 12. Operator approvals

Trước khi bật `BILLING_ENABLED=true` cần confirm:

- [ ] Founder/CEO đã duyệt.
- [ ] Kế toán đã xác nhận STK `9912780019` là của công ty.
- [ ] SePay merchant account đã verified.
- [ ] Webhook URL đã test với giao dịch thật.
- [ ] Admin user đã có MFA.
- [ ] Audit log đã monitor.

---

## 13. Post-launch monitoring (T+24h, T+7d, T+30d)

- [ ] T+24h: Check số order, error rate, payment success rate.
- [ ] T+7d: Cohort retention, conversion rate, refund rate.
- [ ] T+30d: First revenue report, MRR run-rate, audit log review.

---

## 14. Liên kết

- `docs/billing-system.md`
- `docs/vietqr-integration.md`
- `docs/rbac-security.md`
- `docs/admin-dashboard.md`
- `docs/analytics-metrics.md`
- `docs/subscription-entitlements.md`
- `docs/payment-reconciliation.md`
