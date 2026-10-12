# Subscription & Entitlements — Quyền sản phẩm (M2)

> **Phạm vi:** Mô tả cách `subscriptions` map sang quyền sản phẩm (Memory/Mastery),
> cách kiểm tra atomic 50 captures/tháng, kích hoạt/extension Mastery, hết hạn.
> Dành cho kỹ sư backend tích hợp feature mới cần check quyền.

---

## 1. Hai trục tách biệt

| Trục | Nguồn | Mục đích |
|---|---|---|
| **Role** | `profiles.role` | Quyền quản trị (M1) |
| **Plan / Family** | `subscriptions.family` | Quyền sản phẩm (M2) |

Một user có thể là:
- `user` role + `memory` plan (mặc định).
- `user` role + `mastery` plan (sau khi trả tiền).
- `admin` role + `memory` plan (admin không tự động được Mastery).
- `admin` role + `mastery` plan (admin mua riêng).

Đây là chủ ý: admin role **không** cấp quyền sản phẩm. Admin phải dùng tài khoản
cá nhân nếu muốn test Mastery.

---

## 2. Memory — Free tier

| Thuộc tính | Giá trị |
|---|---|
| `plan_id` | `memory` |
| `amount_vnd` | 0 |
| `monthly_capture_limit` | 50 |
| `semantic_search_enabled` | false |
| Hết hạn | Không (`valid_until = null`) |

### 2.1 Hành vi

- Tạo capture đếm vào `captures_this_month` (theo UTC).
- Khi vượt 50 → trả 402 `MEMORY_LIMIT_REACHED` kèm CTA "Nâng cấp Mastery".
- Old memories **luôn** đọc được, không bị xóa.

### 2.2 Công thức "tháng này"

```ts
const monthStart = new Date();
monthStart.setUTCDate(1);
monthStart.setUTCHours(0, 0, 0, 0);
```

Đếm số capture có `created_at >= monthStart`. Đếm theo **UTC** để mọi user
có cùng milestone rollover; tránh bias theo timezone.

### 2.3 Atomicity

Check + insert phải trong cùng transaction SQL. Nếu không, hai request
đồng thời có thể cùng pass check rồi cùng insert.

```sql
BEGIN;
  SELECT count(*) INTO :n
  FROM items
  WHERE user_id = :uid
    AND created_at >= date_trunc('month', now());
  IF :n >= 50 THEN
    ROLLBACK;
    return 402 MEMORY_LIMIT_REACHED;
  END IF;
  INSERT INTO items (...) VALUES (...);
COMMIT;
```

Nếu DB lock conflict (Postgres `SERIALIZATION FAILURE`) → retry 1 lần.

---

## 3. Mastery — Paid tier

| Thuộc tính | `mastery-monthly` | `mastery-yearly` |
|---|---|---|
| `amount_vnd` | 29.000 | 249.000 |
| `interval` | `month` | `year` |
| `monthly_capture_limit` | NULL (không giới hạn) | NULL |
| `semantic_search_enabled` | true | true |

### 3.1 Kích hoạt

Khi payment verified (xem `docs/billing-system.md` §3.2):
- Nếu user **chưa** có `subscriptions` row → tạo mới.
- Nếu row tồn tại nhưng `valid_until < now()` (đã hết hạn) → set `valid_from=now()`,
  `valid_until=now() + interval`.
- Nếu row tồn tại và còn hiệu lực → **cộng dồn** `valid_until += interval`.

Cộng dồn đảm bảo user gia hạn sớm không bị mất thời gian.

### 3.2 Hết hạn

Lazy expiration (xem `billing-system.md` §3.4):
- Mỗi request `requireAuth` đọc `subscriptions`.
- Nếu `valid_until < now()` → set `status='expired'`, trả về
  `family='memory'`, `valid_until=null` cho phần còn lại của request.
- Old memories vẫn đọc được, nhưng không tạo mới vượt 50 nếu còn trong tháng.

### 3.3 Semantic Search

Khi `family='mastery' && valid_until > now()`:
- `/search` chấp nhận `mode=semantic`.
- Pipeline tạo embedding cho query, gọi `pgvector` để tìm top-K.
- Mỗi lượt tính vào `ai_usage_events.task_type='semantic_search'`.

Khi hết hạn:
- `/search` trả 402 `MASTERY_REQUIRED` cho `mode=semantic`.
- Lexical search vẫn hoạt động (free).
- Captures cũ vẫn có embedding, vẫn đọc được.

### 3.4 Không giới hạn capture

`monthly_capture_limit IS NULL` cho `mastery*`. Tuy nhiên:

- **Gemini quota** vẫn áp dụng (xem `docs/analytics-metrics.md` §5.7).
- **Storage quota** có thể áp dụng (chưa có ở M2, dự phòng).
- **Anti-abuse** cần monitoring — nếu user tạo 10k captures/ngày, có thể
  rate-limit theo `ai_usage_events`.

---

## 4. Áp dụng vào code

### 4.1 Helper `getEntitlement`

```ts
// apps/api/src/billing/entitlement.ts
export async function getEntitlement(userId: string) {
  const sub = await loadSubscription(userId);
  if (!sub) return defaultMemoryEntitlement();
  if (sub.valid_until && sub.valid_until < new Date()) {
    return defaultMemoryEntitlement();
  }
  return {
    planId: sub.plan_id,
    family: sub.family,
    validUntil: sub.valid_until,
    semanticSearchEnabled: sub.family === 'mastery',
    monthlyCaptureLimit: sub.family === 'mastery' ? null : 50
  };
}
```

### 4.2 Capture endpoint

```ts
// apps/api/src/routes/capture.ts
router.post('/captures', {
  preHandler: requireAuth
}, async (req, reply) => {
  const ent = await getEntitlement(req.userId);
  if (ent.monthlyCaptureLimit !== null) {
    const used = await countThisMonthCaptures(req.userId);
    if (used >= ent.monthlyCaptureLimit) {
      return reply.code(402).send({
        error: {
          code: 'MEMORY_LIMIT_REACHED',
          message: `Bạn đã dùng ${used}/${ent.monthlyCaptureLimit} captures tháng này. Nâng cấp Mastery để tiếp tục.`
        }
      });
    }
  }
  // tiếp tục insert...
});
```

### 4.3 Search endpoint

```ts
// apps/api/src/routes/search.ts
if (request.mode === 'semantic') {
  const ent = await getEntitlement(req.userId);
  if (!ent.semanticSearchEnabled) {
    return reply.code(402).send({
      error: { code: 'MASTERY_REQUIRED', message: 'Semantic Search yêu cầu gói Mastery.' }
    });
  }
}
```

---

## 5. Test coverage

| Test | Kỳ vọng |
|---|---|
| Memory user tạo capture thứ 50 | OK |
| Memory user tạo capture thứ 51 | 402 MEMORY_LIMIT_REACHED |
| Mastery user tạo capture thứ 100 | OK (không giới hạn) |
| Mastery user semantic search | OK |
| Mastery expired user semantic search | 402 MASTERY_REQUIRED |
| Mastery expired user lexical search | OK |
| Mastery user mất quyền semantic | Sau khi set valid_until=now()-1day |
| Admin role + memory plan | Vẫn bị giới hạn 50 capture |
| Race: 2 capture đồng thời ở user thứ 50 | Chỉ 1 thành công |
| Renewal: valid_until +30d | Đúng |
| Renewal sớm: cộng dồn | OK |

---

## 6. Edge cases

- **User đổi từ monthly sang yearly**: tạo order mới, payment verified → extend
  `valid_until += 365 days`. KHÔNG reset `valid_from`.
- **User refund**: gọi `POST /admin/payments/:id/refund` (chưa có ở M2, dự phòng
  cho M7). Set `subscriptions.status='cancelled'`, `valid_until=now()`.
- **Payment fail 3 lần liên tiếp**: KHÔNG tự động flag user. Operator xử lý qua
  admin dashboard.
- **Subscription gia hạn khi đang dùng Mastery**: KHÔNG reset quota Gemini trong
  ngày — quota reset theo lịch server.

---

## 7. Liên kết

- `docs/billing-system.md`
- `docs/rbac-security.md`
- `docs/analytics-metrics.md`
