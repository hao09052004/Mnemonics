# Tích hợp VietQR — EMVCo NAPAS-247 (M3)

> **Phạm vi:** Mô tả kỹ thuật cách tạo mã QR động cho từng đơn hàng, dùng chuẩn
> EMVCo NAPAS-247 của Vietcombank. Phù hợp cho kỹ sư backend tích hợp thêm ngân
> hàng hoặc kỹ sư vận hành xác minh mã QR trên sao kê.

---

## 1. Thông tin ngân hàng thụ hưởng

| Thuộc tính | Giá trị |
|---|---|
| Ngân hàng | Vietcombank |
| BIN | `970436` |
| Số tài khoản | `9912780019` |
| Chủ tài khoản | `DAO QUYNH LE` |
| Mạng | VietQR / NAPAS 247 |

> ⚠️ **Trước khi go-live, admin phải xác minh chủ tài khoản trùng với tên đăng ký
> kinh doanh thực tế.** Không tự động suy ra quyền sở hữu từ ảnh QR.

Cấu hình qua env (`apps/api/.env`):

```env
PAYMENT_BANK_BIN=970436
PAYMENT_BANK_CODE=VCB
PAYMENT_BANK_ACCOUNT=9912780019
PAYMENT_BANK_HOLDER=DAO QUYNH LE
```

---

## 2. Tại sao dùng QR động, không phải tĩnh?

Ảnh QR được cung cấp ban đầu là **QR tĩnh** (chỉ chứa STK). Nó **không** chứa
mã đơn hàng, không chứa số tiền → không phân biệt được:

- Ai đã chuyển.
- Cho đơn hàng nào.
- Số tiền bao nhiêu.

QR động sinh mới mỗi lần user bấm "Nâng cấp", chứa đầy đủ 4 thông tin trên.
Đây là cách duy nhất để tự động đối chiếu khoản chuyển với đơn hàng.

---

## 3. Cấu trúc payload EMVCo NAPAS-247

Một chuỗi EMVCo là dãy các **TLV** (Tag-Length-Value) nối tiếp nhau:

```
<id><len><value> ...
```

Trong đó `<len>` là 2 chữ số thập phân (không phải hex), trừ khi là template thì dùng
`"99"`. Mã QR cuối cùng phải kết thúc bằng TLV `6304` chứa **CRC-16/CCITT-FALSE**
tính trên toàn bộ chuỗi **trước khi** append `6304…`.

### 3.1 Các tag bắt buộc

| Tag | Tên | Giá trị (Mnemonics) |
|---|---|---|
| `00` | Payload Format | `01` (QRIBFTTC) |
| `01` | Initiation Method | `12` (dynamic) |
| `38` | Merchant Account Information | Template NAPAS-247 (xem §3.2) |
| `53` | Transaction Currency | `704` (VND) |
| `54` | Transaction Amount | `29000` hoặc `249000` |
| `58` | Country Code | `VN` |
| `59` | Merchant Name | `DAO QUYNH LE` (không dấu) |
| `60` | Merchant City | `HANOI` |
| `62` | Additional Data Field | Template chứa reference (xem §3.3) |
| `63` | CRC | `6304` + 4 hex char |

### 3.2 Merchant Account Information (`38`)

Template lồng nhau:

| Tag con | Tên | Giá trị |
|---|---|---|
| `00` | GUID | `A000000727` (NAPAS) |
| `01` | Bank BIN | `970436` |
| `02` | Số tài khoản | `9912780019` |

Encode:

```
38015600 09A000000727 01 06 970436 02 10 9912780019
```

Tổng chiều dài 56 byte → `38` + `0056` + data.

### 3.3 Additional Data Field (`62`)

Template này chứa mã tham chiếu (bill number) — đây là chìa khóa để server match
webhook về đúng order:

| Tag con | Tên | Giá trị |
|---|---|---|
| `01` | Bill Number | reference 8 ký tự ASCII (vd `MNX8K4P2Q`) |

Encode:

```
62 05 01 03 MNX8K4P2Q  ← tổng length 5
```

### 3.4 Tính CRC

Sau khi ghép tất cả TLV (trừ tag `63`), thêm `6304`, rồi tính **CRC-16/CCITT-FALSE**
(polynomial 0x1021, init 0xFFFF, no reflection, no XOR-out) trên toàn bộ chuỗi **bao
gồm cả `6304`**. Kết quả là 4 ký tự hex viết hoa, ví dụ `1A2B`.

Tham chiếu code: `apps/api/src/billing/vietqr.ts`.

### 3.5 Ví dụ đầy đủ (mastery-monthly, reference `MNX8K4P2Q`)

```
00020101021238560010A00000072701069704360210991278001953037045405290005802VN5910DAO QUYNH LE6006HANOI62050303MNX8K4P2Q6304 1A2B
```

(Khoảng trắng chỉ để dễ đọc — chuỗi thực tế nối liền.)

---

## 4. Sinh QR trong server

```ts
// apps/api/src/billing/vietqr.ts
export function buildVietQrPayload(args: {
  bin: string;
  account: string;
  merchantName: string;
  amountVnd: number;
  reference: string;
}): string {
  // 1. TLV ghép như §3.
  // 2. Append "6304".
  // 3. CRC-16/CCITT-FALSE.
  return finalString;
}
```

`apps/api/src/billing/qr-image.ts` dùng thư viện `qrcode` để chuyển payload
thành PNG data URL trả cho frontend.

---

## 5. Sinh mã tham chiếu (`reference`)

Mã này phải:
- ASCII in hoa A–Z và chữ số 2–9 (loại bỏ 0, 1, O, I để tránh nhầm lẫn).
- Độ dài 8 ký tự.
- **Unique** trong `payment_orders.reference` (UNIQUE constraint).

Cách sinh (Node):

```ts
import { randomBytes } from 'node:crypto';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newReference(): string {
  let out = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
```

Server phải retry với reference mới nếu insert fail do trùng unique key.

---

## 6. Verify phía nhận (Webhook)

Khi ngân hàng / SePay gửi webhook, server phải kiểm tra:

1. **`accountNumber`** khớp `PAYMENT_BANK_ACCOUNT` (so sánh string, bỏ khoảng trắng).
2. **`amount`** khớp `order.amount_vnd` (so sánh số nguyên).
3. **`description`** chứa 8 ký tự reference (regex `/[A-HJ-NP-Z2-9]{8}/`).
4. Currency mặc định VND; nếu provider trả currency khác → từ chối.

Bất kỳ check nào fail → set `status='rejected'`, ghi event, **không** kích hoạt subscription.

---

## 7. Edge cases & giới hạn

- **Số tiền lớn**: 249000 VND nằm gọn trong int32. Nếu thêm gói lớn hơn, dùng
  `bigint` hoặc string trong DB. Migration 023 đã chuyển cột `amount_vnd` thành
  `bigint` để dự phòng.
- **Tên có dấu**: chuẩn NAPAS-247 cho phép nhưng một số app ngân hàng cũ hiển thị
  sai. Hiện tại `merchantName` đã bỏ dấu (`DAO QUYNH LE`).
- **Encoding**: chuỗi TLV là ASCII thuần. Nếu cần Unicode phải theo quy tắc riêng
  của NAPAS-247 (mục 5.4 của spec).

---

## 8. Test & verify

Unit test (M3) bao gồm:
- QR với mastery-monthly 29000 VND và reference `MNX8K4P2Q` → payload đúng, CRC đúng.
- QR với mastery-yearly 249000 VND → payload đúng.
- Sinh 100 reference liên tiếp → không trùng.
- Parse lại payload → trích xuất được amount, account, reference.

Manual test trên app thật:
1. Mở `/app/billing/checkout?plan=mastery-monthly` → quét QR bằng Vietcombank.
2. App hiển thị đúng STK, tên, số tiền, nội dung `MNX8K4P2Q`.
3. Chuyển khoản thành công → sau ≤ 60 giây, subscription tự kích hoạt.

---

## 9. Tham chiếu

- EMVCo QR Code Specification (Merchant-Presented Mode)
- NAPAS 247 — Quick Response Code for Consumer Payments
- SePay API docs: <https://docs.sepay.vn>
