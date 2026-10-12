# Bảo mật RBAC — Role-Based Access Control (M1)

> **Phạm vi:** Mô tả mô hình role/permission, nguồn dữ liệu nào là nguồn chính
> thức, cách admin được bootstrap, các quy tắc bảo mật áp dụng cho mọi thao tác
> nhạy cảm. Dành cho kỹ sư backend, kỹ sư bảo mật, và auditor.

---

## 1. Tại sao cần RBAC thống nhất?

Trước M1, codebase có **hai nguồn role chạy song song**:

1. `profiles.role` trong database (PostgreSQL).
2. `auth.users.app_metadata.role` trong Supabase Auth.

Hệ quả:
- Một số endpoint đọc từ metadata, số khác đọc từ `profiles`.
- Trong một số flow, role của user mới tạo bị hardcode thành `user` thay vì lấy
  từ DB.
- LocalStorage có thể bị sửa → frontend check role sai.

Sau M1, `profiles.role` là **canonical source of truth**. Metadata chỉ là cache
không đáng tin. Mọi quyết định phân quyền **phải** đi qua server.

---

## 2. Mô hình role & permission

### 2.1 Vai trò

| Role | Mô tả |
|---|---|
| `user` | Tài khoản bình thường. Mọi user mới đều là `user`. |
| `admin` | Quản trị viên. Phải qua bootstrap an toàn. |

Một user có thể vừa là `admin` vừa dùng Memory/Mastery — **hai khái niệm độc lập**:

- **Role** = quyền quản trị.
- **Plan** = gói dịch vụ trả phí.

Một `admin` mặc định vẫn ở plan `memory` (giới hạn 50 captures/tháng) trừ khi mua
Mastery riêng. Đây là chủ ý: admin role không tự động cấp quyền sản phẩm.

### 2.2 Permission keys

```ts
// apps/api/src/auth/permissions.ts
export const PERMISSIONS = {
  DASHBOARD_USER_READ:      'dashboard.user.read',
  BILLING_SELF_READ:        'billing.self.read',
  BILLING_SELF_CHECKOUT:    'billing.self.checkout',
  ANALYTICS_SELF_READ:      'analytics.self.read',
  ADMIN_ANALYTICS_READ:     'admin.analytics.read',
  ADMIN_USERS_READ:         'admin.users.read',
  ADMIN_USERS_MANAGE:       'admin.users.manage',
  ADMIN_PAYMENTS_READ:      'admin.payments.read',
  ADMIN_PAYMENTS_REVIEW:    'admin.payments.review',
  ADMIN_SUBS_READ:          'admin.subscriptions.read',
  ADMIN_SUBS_MANAGE:        'admin.subscriptions.manage',
  ADMIN_SYSTEM_READ:        'admin.system.read',
  ADMIN_AUDIT_READ:         'admin.audit.read',
  ADMIN_ROLES_MANAGE:       'admin.roles.manage'
} as const;
```

### 2.3 Mapping role → permissions

| Role | Permissions |
|---|---|
| `user` | `dashboard.user.read`, `billing.self.read`, `billing.self.checkout`, `analytics.self.read` |
| `admin` | Tất cả trên + tất cả `admin.*` |

Lưu trong bảng `role_permissions` (DB):

| role | permission |
|---|---|
| `user` | `dashboard.user.read` |
| `user` | `billing.self.read` |
| ... | ... |
| `admin` | `admin.users.read` |
| ... | ... |

Đây là thiết kế **allow-list**, không phải deny-list. Khi thêm permission mới,
admin sẽ tự động có — nhưng ta có thể từ chối từng permission riêng nếu cần
(bằng cách tạo role mới, ví dụ `admin_readonly`).

### 2.4 Bảng `profiles`

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | uuid PK | = `auth.users.id` |
| `email` | text | mirror từ auth |
| `role` | text | `user` \| `admin` |
| `is_suspended` | boolean | Tạm khóa (do admin) |
| `suspended_reason` | text | |
| `suspended_at` | timestamptz | |
| `suspended_by` | uuid | admin đã khóa |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

## 3. Bootstrap admin an toàn

> ⚠️ **Không có endpoint `POST /become-admin`.** Không có cách nào từ web/extension
> để tự phong admin.

### 3.1 Công cụ: `pnpm --filter @mnemonics/api bootstrap:admin`

Script Node đọc từ stdin hoặc flag:

```bash
pnpm --filter @mnemonics/api bootstrap:admin \
  -- --user-uuid=<uuid> --reason="Co-founder"
```

Script chạy với `SUPABASE_SERVICE_ROLE_KEY` (server-side, **không bao giờ** đưa
key này vào frontend). Script:

1. Kết nối DB với service role.
2. Tìm user theo UUID. Nếu không tồn tại → fail.
3. Bắt buộc nhập lý do (`--reason`).
4. Bắt buộc xác nhận tương tác (y/N) trên terminal.
5. Transaction:
   - `UPDATE profiles SET role='admin' WHERE id=:uuid`.
   - INSERT `role_audit_log` (actor=NULL — system, target, old_role, new_role, reason).
6. In kết quả. Nếu thất bại → không thay đổi DB.

### 3.2 Audit log

Mọi thay đổi role đều ghi vào `role_audit_log`:

| Cột | Mô tả |
|---|---|
| `id` | uuid PK |
| `actor_user_id` | uuid — admin thực hiện (NULL = hệ thống) |
| `target_user_id` | uuid — user bị thay đổi |
| `old_role` | text \| null |
| `new_role` | text |
| `reason` | text — bắt buộc, do operator nhập |
| `created_at` | timestamptz |

View qua Admin Dashboard → Nhật ký hoạt động.

### 3.3 Bảo vệ admin cuối cùng

- Khi đổi role từ `admin` → `user`, server đếm số admin còn lại.
- Nếu đó là admin cuối cùng (chỉ còn 0 admin), **từ chối** thao tác trừ khi:
  - Cờ `--force` được truyền vào CLI, **và**
  - Có một user khác đã được promote thành admin trong cùng transaction.

Đây là safeguard chống "self-lockout". Lỗi này rất khó recover nếu không có
quy trình rõ ràng.

---

## 4. Middleware phân quyền

### 4.1 `requireAuth`

```ts
// apps/api/src/auth/require-auth.ts
export async function requireAuth(req, reply) {
  const token = extractBearerToken(req);
  if (!token) return reply.code(401).send({ error: { code: 'AUTH_REQUIRED' }});
  const claims = await verifyJwt(token);
  if (!claims.sub) return reply.code(401).send(...);
  const profile = await loadProfile(claims.sub);
  req.userId = profile.id;
  req.userEmail = profile.email;
  req.userRole = profile.role;
  req.userPermissions = new Set(permissionsForRole(profile.role));
  // Mirror tới app_metadata để các dịch vụ downstream có cache.
  await ensureAppMetadataRole(profile.id, profile.role);
}
```

Lưu ý:
- `permissionsForRole()` đọc từ DB mỗi request — đánh đổi chút latency để có
  consistency tuyệt đối (một số hệ thống cache 60s, nhưng ta chọn safety).
- Nếu `profile.is_suspended=true` → 403 `ACCOUNT_SUSPENDED`.

### 4.2 `requirePermission(perm)`

```ts
export function requirePermission(perm: string) {
  return async (req, reply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!req.userPermissions?.has(perm)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED' }});
    }
  };
}
```

### 4.3 Frontend guards

- `RequireAuth` — component bọc route, redirect về `/login` nếu chưa đăng nhập.
- `RequireAdmin` — component bọc route, redirect về `/app` nếu không có `admin.*`.

> ⚠️ **Frontend guard chỉ là UX**, không phải bảo mật. Mọi check quan trọng đều
> phải ở backend. Một user có thể sửa localStorage nhưng server sẽ trả 403.

---

## 5. Tấn công phổ biến & cách phòng chống

| Tấn công | Cách phòng |
|---|---|
| Sửa `localStorage.role` | Server dùng JWT claim `sub` + DB `profiles.role`, không đọc từ client |
| Sửa `app_metadata.role` qua API | Service role key chỉ ở server; client không có quyền |
| Sửa JWT payload | JWT được ký bằng secret server; mọi field không tin tưởng ngoài `sub`/`exp` |
| Đoán `requireAdmin` URL | Mỗi endpoint check lại role; trả 403 thay vì 404 để chống enumeration |
| Brute force login | Supabase rate-limit + cấu hình tự động khóa tài khoản |
| CSRF trên session cookie | API xác thực bằng Bearer token, không dùng cookie cho action nhạy cảm |
| Replay webhook | `provider_tx_id` UNIQUE; cùng id không xử lý lại |
| Privilege escalation qua signup | Signup endpoint **không nhận** `role` từ client, mặc định `user` |
| Race condition khi đổi role | `SELECT … FOR UPDATE` trên `profiles` + audit log |

---

## 6. Cấu hình liên quan

```env
# .env (server)
SUPABASE_SERVICE_ROLE_KEY=...      # server-only, KHÔNG VITE_
SUPABASE_JWT_SECRET=...            # để verify JWT
ADMIN_BOOTSTRAP_USER_IDS=uuid1,uuid2  # optional: danh sách user_id có thể bootstrap admin
```

`ADMIN_BOOTSTRAP_USER_IDS` chỉ áp dụng cho lần bootstrap **đầu tiên** khi DB
chưa có admin nào. Sau khi có admin đầu tiên, danh sách này bị bỏ qua.

---

## 7. Logging & monitoring

- Mỗi lần `requirePermission` trả 403, server ghi log với:
  - user_id
  - endpoint
  - permission yêu cầu
  - request_id
- Tỉ lệ 403/req > 5% trong 1 giờ → alert.
- Mọi `role_audit_log` insert xuất hiện trong admin dashboard "Nhật ký".

---

## 8. Test coverage

| Test | Mô tả |
|---|---|
| Signup trả `role='user'` | Mọi flow signup đều mặc định user |
| User gọi `/admin/users` → 403 | Đã pass |
| User gọi `/admin/payments/reconcile` → 403 | Đã pass |
| Sửa localStorage rồi gọi API → vẫn 403 | Đã pass |
| Admin suspend user → audit log có row | Đã pass |
| Admin cuối cùng tự downgrade → bị từ chối | Đã pass |
| Webhook với sai HMAC → 401, không kích hoạt | Đã pass |

---

## 9. Bảo mật vận hành

- **MFA cho admin** — khuyến nghị bật qua Supabase dashboard cho mọi tài khoản
  admin. Chưa bắt buộc nhưng sẽ là yêu cầu cứng trong production.
- **Review định kỳ** danh sách admin mỗi quý.
- **Rotate secret**: `SUPABASE_SERVICE_ROLE_KEY` mỗi 90 ngày; cần test kỹ vì
  secret cũ không dùng được nữa.
- **Backup DB trước** khi chạy migration RBAC.

---

## 10. Liên kết

- `docs/billing-system.md`
- `docs/admin-dashboard.md`
- `docs/saas-production-checklist.md`
