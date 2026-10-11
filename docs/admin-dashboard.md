# Admin Dashboard — Tổng quan, Users, Payments, Audit (M4/M5)

> **Phạm vi:** Mô tả khu vực quản trị tại `/admin/*`. Cấu trúc navigation, các
> trang chính, dữ liệu hiển thị, và cách truy cập. Dành cho operator/owner đã
> được bootstrap thành admin.

---

## 1. Truy cập khu vực `/admin`

### 1.1 Yêu cầu

- User phải có role `admin` trong `profiles.role`.
- Token Bearer phải còn hiệu lực.
- Mỗi endpoint admin kiểm tra `requirePermission(...)` — thiếu permission → 403.

### 1.2 Frontend

- Tất cả route `/admin/*` được bọc bởi `AdminLayout` (`apps/web/src/components/admin/AdminLayout.tsx`).
- Layout gọi `GET /api/v1/auth/me` để check role.
- Nếu không phải admin → hiển thị thông báo "Bạn không có quyền" + redirect về `/app`.

### 1.3 Backend

- `apps/api/src/routes/admin.ts` export router áp dụng `requireAuth` + `requirePermission`.
- Mỗi endpoint khai báo permission cụ thể; `requireAuth` chung chỉ check login.

---

## 2. Navigation

Sidebar gồm các mục (M4+M5):

| Mục | Path | Permission | Mục đích |
|---|---|---|---|
| Tổng quan | `/admin` | `admin.analytics.read` | KPI tổng |
| Người dùng | `/admin/users` | `admin.users.read` | Thư mục user |
| Đơn hàng | `/admin/payments` | `admin.payments.read` | Payment orders |
| Nhật ký | `/admin/audit-logs` | `admin.audit.read` | Role & action audit |

Trên mobile, sidebar thu thành một hàng cuộn ngang.

---

## 3. Tổng quan (`/admin`)

Hiển thị KPI cards tổng hợp từ `apps/api/src/routes/analytics-admin.ts`:

### 3.1 Users
- Tổng số user
- Đăng ký mới hôm nay
- Đăng ký mới 30 ngày
- User đang dùng Memory
- User đang dùng Mastery

### 3.2 Revenue
- Doanh thu đã xác minh (sum `payment_orders.amount_vnd` where `status='paid'`)
- Đang chờ thanh toán
- Đã hoàn
- Doanh thu 30 ngày

### 3.3 Product
- Tổng memory
- Memory mới trong 30 ngày
- Tỉ lệ capture thành công
- Lượt semantic search 30 ngày

**Quan trọng:** Tất cả số liệu là **real DB metrics**. Không có số liệu mẫu.

---

## 4. Người dùng (`/admin/users`)

### 4.1 Cột hiển thị

| Cột | Nguồn |
|---|---|
| Email | `profiles.email` |
| Role | `profiles.role` |
| Trạng thái | `is_suspended` (badge) |
| Plan | `subscriptions.plan_id` |
| Hết hạn | `subscriptions.valid_until` |
| Tổng memory | `count(items where user_id=…)` |
| Ngày tạo | `profiles.created_at` |

### 4.2 Hành động

- **Tìm kiếm**: theo email (LIKE).
- **Suspend / Unsuspend**: gọi `POST /admin/users/:id/suspend` với
  `{ suspend: boolean, reason: string }`. Lý do **bắt buộc**.
- **Phân trang**: 50 users / trang.

### 4.3 Hạn chế

- Admin **không** xem được nội dung memory của user (RLS + backend guard).
- Admin **không** xóa tài khoản — chỉ suspend.
- Mọi thao tác ghi `role_audit_log` với `actor_user_id` = admin hiện tại.

---

## 5. Đơn hàng (`/admin/payments`)

### 5.1 Cột hiển thị

| Cột | Nguồn |
|---|---|
| Mã đơn | `payment_orders.id` |
| User | `profiles.email` (join) |
| Plan | `plan_id` |
| Số tiền | `amount_vnd` (format VND) |
| Mã tham chiếu | `reference` (mono font) |
| Trạng thái | `status` (badge màu) |
| Ngày tạo | `created_at` |
| Ngày paid | `paid_at` |

### 5.2 Filter

- Theo status: `pending` / `paid` / `expired` / `cancelled` / `rejected`.
- Phân trang: 50 / trang.
- Tìm kiếm theo `reference` hoặc email.

### 5.3 Đối soát thủ công

Với order `pending` quá hạn → admin có thể mở modal reconcile:

1. Nhập `amount_vnd` (mặc định = `order.amount_vnd`).
2. Nhập `note` (bắt buộc, tối thiểu 8 ký tự).
3. Confirm → gọi `POST /admin/payments/:id/reconcile`.

Backend:
- Transaction SQL: lock order, set `paid`, kích hoạt subscription.
- Insert `billing_audit_logs`.
- Idempotent: nếu đã `paid` thì 409.

### 5.4 An toàn

- Endpoint yêu cầu `admin.payments.review` — không phải admin nào cũng có thể
  đối soát (chỉ admin được cấp quyền này).
- Không chấp nhận screenshot upload làm bằng chứng.
- Mọi reconcile đều ghi log với `actor_user_id` + `note`.

---

## 6. Nhật ký (`/admin/audit-logs`)

Bảng read-only, hiển thị tất cả row trong `role_audit_log`:

| Cột | Mô tả |
|---|---|
| Thời gian | `created_at` |
| Người thực hiện | `actor_user_id` (UUID — click để copy) |
| Đối tượng | `target_user_id` |
| Vai trò mới | `old_role` → `new_role` |
| Lý do | `reason` |

Phân trang: 100 rows / trang.

---

## 7. Phân quyền trong Admin

Một admin có thể có quyền hạn chế:

| Permission | Cho phép |
|---|---|
| `admin.analytics.read` | Xem `/admin` |
| `admin.users.read` | Xem `/admin/users` (read-only) |
| `admin.users.manage` | Suspend / unsuspend |
| `admin.payments.read` | Xem `/admin/payments` |
| `admin.payments.review` | Reconcile |
| `admin.audit.read` | Xem `/admin/audit-logs` |
| `admin.system.read` | Xem system health (M5) |
| `admin.roles.manage` | Bootstrap / đổi role (CLI) |

Để tạo "admin chỉ đọc" không có quyền reconcile, tạo role mới trong DB và
assign vào `role_permissions` (xem `docs/rbac-security.md` §2.3).

---

## 8. Security checklist cho operator

- [ ] Bật MFA cho tài khoản admin.
- [ ] Không share credential admin.
- [ ] Mỗi hành động reconcile đều có `note` có ý nghĩa.
- [ ] Review audit log mỗi tuần.
- [ ] Không truy cập `/admin` từ thiết bị công cộng.
- [ ] Không hard-code URL admin trong bookmark chia sẻ.

---

## 9. Liên kết

- `docs/rbac-security.md`
- `docs/billing-system.md`
- `docs/payment-reconciliation.md`
- `docs/analytics-metrics.md`
