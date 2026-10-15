/**
 * Pricing page (M2/M5).
 *
 * Public page: `/pricing`. Shows the Memory (free) and Mastery
 * (paid) plans. The "current plan" indicator + renewal CTA read
 * the caller's entitlement when a session exists. The upgrade
 * button opens the VietQR checkout flow (M3) which lives at
 * `/app/billing/checkout`.
 *
 * Visual language follows the supplied reference:
 *   - white background
 *   - bold black headings
 *   - purple accent
 *   - rounded borders, no decorative icons
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiClient, type Session, type Plan } from '../lib/api-client';

interface PricingPageProps {
  api: ApiClient;
}

interface PlanView {
  id: string;
  displayName: string;
  family: 'memory' | 'mastery';
  interval: 'forever' | 'month' | 'year';
  amountVnd: number;
  monthlyCaptureLimit: number | null;
  semanticSearchEnabled: boolean;
}

interface EntitlementView {
  planId: string;
  family: 'memory' | 'mastery';
  validUntil: string | null;
  semanticSearchEnabled: boolean;
  monthlyCaptureLimit: number | null;
}

function formatVnd(amountVnd: number): string {
  return new Intl.NumberFormat('vi-VN').format(amountVnd) + ' VND';
}

export function PricingPage({ api }: PricingPageProps) {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Bảng giá — Mnemonics';
    const session = api.loadStoredSession();
    (async () => {
      try {
        const r = await api.listPlans();
        const mapped: PlanView[] = r.data.plans.map((p: Plan) => ({
          id: p.id,
          displayName: p.displayName,
          family: p.family,
          interval: p.interval,
          amountVnd: p.amountVnd,
          monthlyCaptureLimit: p.monthlyCaptureLimit,
          semanticSearchEnabled: p.semanticSearchEnabled
        }));
        setPlans(mapped);
        if (session?.accessToken) {
          try {
            const me = await api.getMyEntitlement(session.accessToken);
            setEntitlement(me.data.entitlement);
          } catch {/* not signed in enough; ignore */}
        }
      } catch (e) {
        setError('Không thể tải bảng giá. Vui lòng thử lại sau.');
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  const memory = plans.find((p) => p.id === 'memory');
  const monthly = plans.find((p) => p.id === 'mastery-monthly');
  const yearly = plans.find((p) => p.id === 'mastery-yearly');
  const isOnMastery = entitlement?.family === 'mastery';
  const isOnMemory = entitlement?.family === 'memory';

  return (
    <div className="pricing-page" data-theme="marketing">
      <header className="pricing-header">
        <Link to="/" className="pricing-back">← Trang chủ</Link>
        <h1>Chọn gói phù hợp với bạn</h1>
        <p className="pricing-tagline">
          Lưu giữ tri thức không giới hạn &amp; mở khóa toàn bộ tính năng AI với Mastery, hoặc bắt đầu miễn phí với Memory.
        </p>
      </header>

      {error && <div className="pricing-error">{error}</div>}

      {loading ? (
        <div className="pricing-skeleton">Đang tải bảng giá…</div>
      ) : (
        <div className="pricing-cards">
          <article className={`pricing-card ${isOnMemory ? 'is-current' : ''}`}>
            <h2>{memory?.displayName ?? 'Memory'}</h2>
            <p className="pricing-price">
              <strong>0 VND</strong>
              <span> / mãi mãi</span>
            </p>
            {isOnMemory && <p className="pricing-current">Gói hiện tại của bạn</p>}
            <ul className="pricing-features">
              <li>✓ Lưu tối đa 50 memory mỗi tháng</li>
              <li>✓ Tổ chức bằng Spaces &amp; tags thủ công</li>
              <li>✓ Tìm kiếm từ khoá cơ bản</li>
              <li>✗ Chưa mở khóa các tính năng AI của Mnemonics</li>
            </ul>
            {!isOnMemory && entitlement && (
              <button type="button" className="pricing-cta" disabled>
                Đang sử dụng Mastery
              </button>
            )}
          </article>

          <article className={`pricing-card pricing-card--highlight ${isOnMastery ? 'is-current' : ''}`}>
            <h2>{monthly?.displayName ?? 'Mastery (Monthly)'}</h2>
            <p className="pricing-price">
              <strong>{monthly ? formatVnd(monthly.amountVnd) : '29.000 VND'}</strong>
              <span> / tháng</span>
            </p>
            {isOnMastery && entitlement?.planId === 'mastery-monthly' && (
              <p className="pricing-current">Gói hiện tại của bạn</p>
            )}
            <ul className="pricing-features">
              <li>✓ Lưu không giới hạn mỗi tháng</li>
              <li>✓ <b>Mở khóa toàn bộ tính năng AI</b> có của Mnemonics:</li>
              <li style={{ paddingLeft: '1rem', fontSize: '0.88rem' }}>
                • <b>Semantic Search</b> bằng AI (Tìm theo ý niệm)
              </li>
              <li style={{ paddingLeft: '1rem', fontSize: '0.88rem' }}>
                • <b>Tóm tắt thông minh (AI TL;DR)</b> &amp; trích xuất
              </li>
              <li style={{ paddingLeft: '1rem', fontSize: '0.88rem' }}>
                • <b>Auto Smart Tags</b> tự động phân tích &amp; gắn thẻ
              </li>
              <li style={{ paddingLeft: '1rem', fontSize: '0.88rem' }}>
                • <b>AI Groups</b> gom cụm tri thức &amp; Related Memories
              </li>
              <li>✓ Mọi tính năng của Memory</li>
              <li>✓ Hỗ trợ ưu tiên qua email</li>
            </ul>
            <button
              type="button"
              className="pricing-cta"
              disabled={isOnMastery}
              onClick={() => navigate('/app/billing/checkout?plan=mastery-monthly')}
            >
              {isOnMastery ? 'Đang sử dụng' : 'Nâng cấp Mastery'}
            </button>
          </article>

          <article className={`pricing-card ${isOnMastery && entitlement?.planId === 'mastery-yearly' ? 'is-current' : ''}`}>
            <h2>{yearly?.displayName ?? 'Mastery (Yearly)'}</h2>
            <p className="pricing-price">
              <strong>{yearly ? formatVnd(yearly.amountVnd) : '249.000 VND'}</strong>
              <span> / năm</span>
            </p>
            {isOnMastery && entitlement?.planId === 'mastery-yearly' && (
              <p className="pricing-current">Gói hiện tại của bạn</p>
            )}
            <ul className="pricing-features">
              <li>✓ Tiết kiệm ~28% so với gói tháng</li>
              <li>✓ Lưu không giới hạn mỗi tháng</li>
              <li>✓ <b>Mở khóa toàn bộ tính năng AI</b> trọn năm:</li>
              <li style={{ paddingLeft: '1rem', fontSize: '0.88rem' }}>
                • <b>Semantic Search</b> &amp; Tóm tắt AI TL;DR
              </li>
              <li style={{ paddingLeft: '1rem', fontSize: '0.88rem' }}>
                • <b>Auto Smart Tags</b>, AI Groups &amp; tri thức liên quan
              </li>
              <li>✓ Mọi tính năng cao cấp &amp; cập nhật AI mới</li>
              <li>✓ Hỗ trợ ưu tiên 24/7</li>
            </ul>
            <button
              type="button"
              className="pricing-cta"
              disabled={isOnMastery}
              onClick={() => navigate('/app/billing/checkout?plan=mastery-yearly')}
            >
              {isOnMastery ? 'Đang sử dụng' : 'Nâng cấp theo năm'}
            </button>
          </article>
        </div>
      )}

      <section className="pricing-faq">
        <h2>Câu hỏi thường gặp</h2>
        <details>
          <summary>Gói Mastery mở khóa những tính năng AI nào?</summary>
          <p>
            Mastery mở khóa toàn bộ các tính năng AI có của Mnemonics, bao gồm:
            Tìm kiếm ngữ nghĩa (Semantic Search) theo ý hiểu thay vì chỉ từ khóa, Tóm tắt AI (TL;DR) nhanh chóng,
            Gợi ý và gắn thẻ thông minh (Smart Tags), Tự động phân cụm liên kết tri thức (AI Groups),
            và Khám phá các ghi chú/tri thức liên quan (Related Memories).
          </p>
        </details>
        <details>
          <summary>Tôi có bị tính phí tự động không?</summary>
          <p>Không. Sau khi thanh toán chuyển khoản thành công, bạn sẽ được kích hoạt Mastery trong đúng thời hạn đã mua (1 tháng hoặc 1 năm). Khi hết hạn, hệ thống sẽ tự động chuyển về Memory — không có khoản phí nào được tự động trừ.</p>
        </details>
        <details>
          <summary>Làm sao để gia hạn Mastery?</summary>
          <p>Bạn có thể mua gói mới trước ngày hết hạn; thời gian sẽ được cộng dồn từ ngày hết hạn hiện tại, không làm mất thời gian đã trả.</p>
        </details>
        <details>
          <summary>Memory 50 captures/tháng hoạt động thế nào?</summary>
          <p>Giới hạn đếm số memory mới tạo trong tháng dương lịch (UTC). Memory cũ vẫn đọc được bình thường. Khi đạt 50, hệ thống sẽ chặn lưu và hiển thị nút nâng cấp Mastery.</p>
        </details>
        <details>
          <summary>Tôi có được hoàn tiền không?</summary>
          <p>Liên hệ support@mnemonics.app kèm mã đơn hàng. Mỗi yêu cầu sẽ được xét duyệt thủ công bởi quản trị viên.</p>
        </details>
      </section>
    </div>
  );
}
