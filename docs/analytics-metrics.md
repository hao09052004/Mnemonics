# Analytics — Định nghĩa chỉ số & đường ống sự kiện (M5)

> **Phạm vi:** Mô tả taxonomy sự kiện, các truy vấn SQL tổng hợp, cách tính
> từng KPI, định nghĩa DAU/MAU, retention, revenue. Dành cho kỹ sư backend,
> analyst, và admin vận hành dashboard.

---

## 1. Nguyên tắc

- **Server-authoritative**: sự kiện quan trọng (purchase, subscription change)
  được emit từ backend. Frontend chỉ emit sự kiện UX phụ trợ.
- **Privacy-first**: KHÔNG lưu raw memory content, raw search query, AI prompts.
- **Idempotent**: event có `event_id` (UUID) để tránh double-count khi retry.
- **Tách biệt user/admin**: `analytics_events` user_id = NULL nếu là event hệ thống
  (vd. system alert). Admin dashboard aggregate mà KHÔNG lộ dữ liệu cá nhân.

---

## 2. Bảng `analytics_events`

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | uuid PK | |
| `event_name` | text | `memory_created`, `search_performed`, ... |
| `user_id` | uuid \| null | NULL = hệ thống / anonymous |
| `entity_type` | text \| null | `item`, `order`, ... |
| `entity_id` | text \| null | |
| `metadata` | jsonb | Cấu trúc phụ thuộc event (xem §3) |
| `source` | text | `web`, `extension`, `api`, `system` |
| `schema_version` | integer | 1 |
| `occurred_at` | timestamptz | Khi xảy ra |
| `created_at` | timestamptz | Khi insert |

Index: `(event_name, occurred_at)`, `(user_id, occurred_at)`.

### 2.1 Privacy constraints

- Cột `metadata` được validate trước khi insert: KHÔNG cho phép key `raw_text`,
  `ocr_text`, `raw_prompt`, `access_token`, `password`, `bank_account`.
- `search_performed` chỉ lưu `query_length` và `result_count`, không lưu `query`.
- App-level code không được include PII vào metadata.

---

## 3. Taxonomy sự kiện

| `event_name` | Khi nào | Metadata | Ai emit |
|---|---|---|---|
| `user_registered` | Sau signup thành công | `{ referrer? }` | Server |
| `user_logged_in` | Sau login thành công | `{ method: 'password' }` | Server |
| `memory_created` | Sau capture thành công | `{ kind, source }` | Server |
| `memory_deleted` | Sau delete | `{ kind }` | Server |
| `capture_failed` | Khi capture fail | `{ kind, error_code }` | Server |
| `search_performed` | Mỗi `/search` | `{ mode, result_count }` | Server |
| `semantic_search_performed` | Khi mode=semantic | `{ result_count, latency_ms }` | Server |
| `space_created` | Khi tạo Space | `{ space_type }` | Server |
| `checkout_started` | Vào `/app/billing/checkout` | `{ plan_id }` | Server |
| `payment_confirmed` | Khi webhook xác minh thành công | `{ plan_id, amount_vnd }` | Server |
| `subscription_activated` | Sau payment_confirmed | `{ plan_id, valid_until }` | Server |
| `subscription_expired` | Lazy expiration | `{ plan_id }` | Server |
| `subscription_renewed` | Khi valid_until được extend | `{ plan_id }` | Server |
| `admin_login` | Login từ admin | `{ user_id }` | Server |
| `admin_payment_reconciled` | Manual reconcile | `{ order_id, amount_vnd }` | Server |

Mỗi event có schema version cố định; nếu sau này mở rộng, bump version.

---

## 4. Bảng `ai_usage_events`

| Cột | Kiểu | Mô tả |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | |
| `provider` | text | `gemini` \| `gemini-embedding` |
| `model` | text | `gemini-2.5-flash`, ... |
| `task_type` | text | `tag`, `tldr`, `image_caption`, `embedding`, `ocr` |
| `request_status` | text | `success` \| `error` \| `rate_limited` |
| `error_category` | text \| null | `4xx`, `5xx`, `quota`, `timeout` |
| `input_tokens` | integer \| null | Nếu provider trả |
| `output_tokens` | integer \| null | |
| `latency_ms` | integer | |
| `is_retry` | boolean | |
| `cached` | boolean | Trả về từ cache |
| `occurred_at` | timestamptz | |

Index: `(user_id, occurred_at)`, `(task_type, occurred_at)`.

---

## 5. Định nghĩa chỉ số

### 5.1 DAU / MAU

- **DAU**: số `user_id` distinct có `memory_created` hoặc `search_performed` trong
  1 ngày UTC.
- **MAU**: tương tự trong cửa sổ 30 ngày trượt.

Tooltips trên dashboard giải thích định nghĩa (cố ý **không** đếm user chỉ
mở app — đó là vanity metric).

### 5.2 Free-to-paid conversion

```
conversion_rate = paid_users_30d / new_signups_30d
```

Trong đó:
- `new_signups_30d` = user tạo trong 30 ngày qua.
- `paid_users_30d` = subset đã có `subscription_activated` với `plan_id != 'memory'`.

### 5.3 Revenue (chỉ verified)

```sql
SELECT SUM(amount_vnd)
FROM payment_orders
WHERE status = 'paid'
  AND paid_at >= :from
  AND paid_at < :to;
```

KHÔNG tính:
- `pending` (chưa nhận tiền).
- `cancelled` (user hủy trước khi chuyển).
- `rejected` (sai số tiền hoặc sai nội dung).

### 5.4 Refunded / reversed

```sql
SELECT SUM(amount_vnd)
FROM payment_orders
WHERE status IN ('refunded', 'reversed')
  AND updated_at >= :from
  AND updated_at < :to;
```

### 5.5 MRR / ARR (chỉ là run-rate ước tính)

Đây là sản phẩm **không tự động gia hạn**. MRR/ARR được tính bằng cách
**normalize** doanh thu Mastery:

```
monthly_run_rate_vnd =
  SUM(amount_vnd for mastery-monthly in last 30d) +
  SUM(amount_vnd for mastery-yearly in last 30d) / 12
```

Trên dashboard hiển thị rõ chú thích:
> "Estimated normalized run-rate. Mastery không tự động gia hạn. Số liệu
> phản ánh doanh thu quá khứ, không phải cam kết tương lai."

### 5.6 Tỉ lệ capture thành công

```
success_rate = count(capture_success) / (count(capture_success) + count(capture_failed))
```

Trong 30 ngày.

### 5.7 AI quota utilization

- Tổng `ai_usage_events` theo `task_type` / user.
- Hệ thống so với `AI_USER_DAILY_LIMIT` (env) → phần trăm.

> ⚠️ **Quan trọng**: `AI_USER_DAILY_LIMIT` là giới hạn nội bộ của app. KHÔNG
> phải quota thật của Google. Admin dashboard hiển thị thẳng thắn: "Đây là
> giới hạn do Mnemonics áp dụng, không phải quota Google."

---

## 6. Truy vấn SQL mẫu

### 6.1 Doanh thu verified theo ngày (30 ngày)

```sql
SELECT
  date_trunc('day', paid_at) AS day,
  COUNT(*) AS count,
  SUM(amount_vnd) AS vnd
FROM payment_orders
WHERE status = 'paid'
  AND paid_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

### 6.2 Tổng captures theo ngày (user-level, không có PII)

```sql
SELECT
  date_trunc('day', occurred_at) AS day,
  COUNT(*) AS captures
FROM analytics_events
WHERE event_name = 'memory_created'
  AND occurred_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

### 6.3 Active users 30 ngày (DAU definition)

```sql
SELECT COUNT(DISTINCT user_id) AS active_users
FROM analytics_events
WHERE event_name IN ('memory_created', 'search_performed')
  AND occurred_at >= now() - interval '30 days';
```

### 6.4 Top tags (user-level)

```sql
SELECT
  tag,
  COUNT(*) AS uses
FROM item_tags
JOIN items ON items.id = item_tags.item_id
WHERE items.user_id = :user_id
GROUP BY 1
ORDER BY 2 DESC
LIMIT 10;
```

### 6.5 AI error categories

```sql
SELECT
  task_type,
  error_category,
  COUNT(*) AS n
FROM ai_usage_events
WHERE request_status = 'error'
  AND occurred_at >= now() - interval '30 days'
GROUP BY 1, 2
ORDER BY n DESC;
```

---

## 7. Timezone

- **Lưu trữ**: tất cả `timestamptz` ở UTC.
- **Hiển thị**: client format theo `Asia/Ho_Chi_Minh` (env `ANALYTICS_TIMEZONE`).
- **Báo cáo**: aggregate SQL dùng `date_trunc('day', ... AT TIME ZONE 'Asia/Ho_Chi_Minh')`
  nếu cần theo ngày local; mặc định là UTC.

---

## 8. Retention

### 8.1 Cohort table

Cohort = user đăng ký tuần W. Retention W+1 = % cohort có event tuần W+1.

```sql
WITH cohorts AS (
  SELECT
    id AS user_id,
    date_trunc('week', created_at) AS cohort_week
  FROM profiles
),
events AS (
  SELECT user_id, date_trunc('week', occurred_at) AS event_week
  FROM analytics_events
  WHERE event_name IN ('memory_created', 'search_performed')
)
SELECT
  c.cohort_week,
  EXTRACT(WEEK FROM e.event_week) - EXTRACT(WEEK FROM c.cohort_week) AS week_offset,
  COUNT(DISTINCT c.user_id) AS retained
FROM cohorts c
LEFT JOIN events e ON c.user_id = e.user_id
GROUP BY 1, 2
ORDER BY 1, 2;
```

Nếu số user trong cohort < 5 → hiển thị "Not enough historical data" thay vì
phần trăm (privacy: tránh leak count nhỏ).

---

## 9. Personal analytics (user-scoped)

`GET /api/v1/analytics/me/overview` trả về:

```ts
{
  totalCaptures: number;
  thisMonth: number;
  capturesThisPeriod: number;
  daysWindow: number;
  plan: {
    planId: string;
    validUntil: string | null;
    monthlyCaptureLimit: number | null;
    remainingCaptures: number | null;  // chỉ Memory
    semanticSearchEnabled: boolean;
  };
  spaces: number;
  distinctTags: number;
  aiCallsThisPeriod: number;
  byType: Array<{ type: string; count: number }>;
}
```

User **chỉ thấy dữ liệu của mình** — `WHERE user_id = :user_id` trong mọi query.

---

## 10. Admin analytics endpoints

| Endpoint | Permission | Mô tả |
|---|---|---|
| `GET /api/v1/admin/analytics/overview` | `admin.analytics.read` | KPI tổng |
| `GET /api/v1/admin/analytics/users` | `admin.analytics.read` | DAU, MAU, conversion |
| `GET /api/v1/admin/analytics/revenue` | `admin.analytics.read` | Doanh thu theo ngày/plan |
| `GET /api/v1/admin/analytics/product` | `admin.analytics.read` | Captures, search usage |
| `GET /api/v1/admin/analytics/ai` | `admin.system.read` | AI usage + error categories |
| `GET /api/v1/admin/analytics/system` | `admin.system.read` | API health, jobs |

Tất cả đều nhận `?from=YYYY-MM-DD&to=YYYY-MM-DD` (validate: from <= to, range <= 365d).

---

## 11. Performance

- Tất cả aggregate có index covering.
- Dùng `date_trunc` thay vì scan toàn bảng.
- Caching 60s ở server cho các endpoint dashboard (Redis optional, fallback memory).
- Không tính toán aggregate trên browser.

---

## 12. Liên kết

- `docs/rbac-security.md`
- `docs/admin-dashboard.md`
- `docs/saas-production-checklist.md`
