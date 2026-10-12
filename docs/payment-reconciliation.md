# Đối soát Thanh toán — Quy trình thủ công (M3/M4)

> **Phạm vi:** Hướng dẫn cho operator xử lý các tình huống cần đối soát thủ
> công: sai số tiền, sai nội dung, chuyển trễ, dispute. Áp dụng khi webhook
> không tự xử lý được.

---

## 1. Nguyên tắc

1. **Không cấp quyền thủ công nếu không có bằng chứng từ ngân hàng.**
2. **Mọi hành động đều ghi audit log** với lý do có nghĩa.
3. **Chỉ admin có `admin.payments.review` mới được reconcile.** Admin chỉ đọc
   không có quyền này.
4. **Tất cả actions là idempotent.** Re-clicking nút "Đối soát" không gây
   side-effect phụ.

---

## 2. Các trạng thái order

```
pending  ──(webhook OK)──▶  paid     ──▶  subscription activated
   │
   ├─(timeout 30 phút)──▶  expired
   ├─(user tự hủy)─────▶  cancelled
   └─(webhook sai)─────▶  rejected
```

Order đã `paid` không thể chuyển về `pending`. Nếu cần "đối soát lại", tạo
một row manual adjust trong `subscription_events` (xem §4).

---

## 3. Quy trình đối soát

### 3.1 Khi nào cần đối soát thủ công?

| Tình huống | Xử lý |
|---|---|
| User nói "đã chuyển" nhưng vẫn Memory | Mở `/admin/payments`, tìm order `pending` của user |
| Order `pending` quá 30 phút | Có thể user chuyển nhầm STK hoặc app ngân hàng lỗi |
| Số tiền lệch | `rejected`, cần user chuyển lại đúng số |
| Nội dung sai | `rejected`, cần user chuyển lại với reference đúng |
| Webhook SePay không tới | Đợi hoặc đối soát thủ công từ sao kê Vietcombank |

### 3.2 Các bước

1. **Vào `/admin/payments`**, filter `status=pending` hoặc `rejected`.
2. Tìm order của user (theo email hoặc reference).
3. Click "Đối soát" → modal hiện ra.
4. Verify với **ngân hàng trực tiếp** (không phải screenshot user gửi):
   - Vào Vietcombank Business (hoặc app Vietcombank).
   - Tìm giao dịch theo STK `9912780019`.
   - Xác nhận số tiền, nội dung `MNX8K4P2Q`.
5. Nếu khớp:
   - Nhập `amount_vnd` (mặc định = order amount).
   - Nhập `note` tối thiểu 8 ký tự mô tả bằng chứng.
     VD: "Đã verify qua sao kê VCB ngày 2026-10-11, mã GD FT26101..XYZ"
   - Click "Xác nhận".
6. Server:
   - Set order `status=paid`, `paid_at=now()`.
   - Activate/extend subscription.
   - Insert `billing_audit_logs`.
   - Trả về OK.
7. User nhận được Mastery trong vòng vài giây.

### 3.3 Khi KHÔNG nên đối soát

| Tình huống | Hành động đúng |
|---|---|
| User gửi screenshot nhưng chưa xác minh ngân hàng | Yêu cầu user cung cấp số GD; admin tự verify trên VCB |
| Số tiền lệch nhưng user từ chối chuyển thêm | Set `rejected`, không cấp quyền |
| Order `cancelled` (user tự hủy) | Không thể reopen; user phải tạo order mới |
| User yêu cầu refund | Tạo ticket riêng, xử lý ngoài scope M2/M3 |

---

## 4. Điều chỉnh subscription thủ công

Ngoài reconcile, có những tình huống admin cần sửa subscription trực tiếp
(vd. comp user, fix bug, support khách hàng).

```
POST /api/v1/admin/subscriptions/:id/adjust
Body: {
  action: "extend" | "cancel" | "set_plan" | "set_valid_until",
  value: "2026-12-31" | null,
  reason: "string ≥ 8 chars"
}
```

Permission: `admin.subscriptions.manage`.

Mọi lần adjust ghi `subscription_events` với:
- `actor_user_id` (admin)
- `old_*` (trạng thái cũ)
- `new_*` (trạng thái mới)
- `reason` (bắt buộc)

---

## 5. Refund & reversal (chưa implement M2)

M3 chỉ có manual reconcile. Refund flow dự kiến ở milestone sau:

```
paid ──▶ refund_requested ──▶ refund_reviewing ──▶ refunded (or rejected)
                                       │
                                       └─▶ bank_reversal
```

Để hỗ trợ tạm thời:
- Set `payment_orders.status='rejected'`.
- Set `subscriptions.status='cancelled'`, `valid_until=now()`.
- Ghi `billing_audit_logs` với lý do "manual refund".

User sẽ tự xử lý chuyển khoản ngược qua ngân hàng của họ (admin hỗ trợ hướng dẫn).

---

## 6. Audit trail

Mọi thao tác đều xuất hiện trong:

- `payment_events` (mỗi webhook, mỗi lần tạo/cập nhật order).
- `subscription_events` (mỗi lần thay đổi subscription).
- `billing_audit_logs` (mỗi lần admin thao tác).

Kiểm tra: Vào `/admin/audit-logs` để xem role changes. Vào admin payments detail
để xem toàn bộ history của order.

---

## 7. Checklist hàng ngày cho operator

- [ ] Check `/admin/payments?status=pending` — order nào > 2h → xử lý.
- [ ] Check `/admin/payments?status=rejected` — nếu > 5 hôm → xem lại pattern.
- [ ] So sánh tổng `paid` trong DB với sao kê Vietcombank ngày hôm qua.
- [ ] Review audit log mỗi tuần.

---

## 8. Sự cố thường gặp

### 8.1 Webhook tới trễ

SePay thường gửi webhook trong vài giây. Nếu > 5 phút:
- Kiểm tra SePay dashboard xem webhook URL còn active không.
- Kiểm tra secret còn đúng không (đã rotate chưa).
- Nếu user chuyển từ app ngân hàng không thuộc SePay → không có webhook,
  cần đối soát thủ công.

### 8.2 SePay gửi trùng webhook

Idempotency: server dùng `provider_tx_id` UNIQUE. Webhook thứ 2 trả 200 OK,
không xử lý lại. Nếu thấy log "webhook already processed" → OK.

### 8.3 Reference bị mã hóa sai

Một số app ngân hàng có thể thay đổi chữ hoa/thường hoặc thêm space. Server
đã normalize: loại bỏ ký tự không phải `[A-HJ-NP-Z2-9]{8}` trước khi lookup.
Nếu vẫn không match → log warning + set `rejected` (KHÔNG cấp quyền).

### 8.4 User cố tình gian lận

- Chuyển khoản với nội dung ngẫu nhiên → match không ra reference → `rejected`.
- Chuyển khoản với số tiền nhỏ hơn → `rejected`.
- Spam tạo order để abuse → backend rate-limit `/billing/orders` (10 / 5 phút).

---

## 9. Liên kết

- `docs/billing-system.md`
- `docs/admin-dashboard.md`
- `docs/vietqr-integration.md`
