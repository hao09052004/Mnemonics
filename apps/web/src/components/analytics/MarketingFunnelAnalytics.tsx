import React, { useEffect, useState } from 'react';
import { ApiClient } from '../../lib/api-client';
import { productConfig } from '../../config/product';

interface MarketingFunnelAnalyticsProps {
  api?: ApiClient;
}

export function MarketingFunnelAnalytics({ api }: MarketingFunnelAnalyticsProps = {}) {
  const [realData, setRealData] = useState<{
    registered: number;
    activated: number;
    engaged: number;
    paying: number;
    totalItems: number;
    activationRate: number;
    engagementRate: number;
    conversionRate: number;
  } | null>(null);

  useEffect(() => {
    try {
      const client = api || new ApiClient(productConfig.apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : ''));
      const session = client.loadStoredSession();
      if (!session?.accessToken) return;

      client.adminAnalyticsOverview(session.accessToken).then((res) => {
        if (res?.data?.funnel) {
          setRealData(res.data.funnel);
        }
      }).catch(() => {});
    } catch (e) {}
  }, [api]);

  const isReal = Boolean(realData);
  const registered = realData?.registered ?? 38;
  const activated = realData?.activated ?? 15;
  const engaged = realData?.engaged ?? 6;
  const paying = realData?.paying ?? 0;
  const totalItems = realData?.totalItems ?? 204;

  const activationRate = isReal ? (realData?.activationRate ?? 0) : 39.47;
  const engagementRate = isReal ? (realData?.engagementRate ?? 0) : 40.0;
  const conversionRate = isReal ? (realData?.conversionRate ?? 0) : 15.79;

  const dropOff1 = Math.max(0, registered - activated);
  const dropOff1Rate = registered > 0 ? Number(((dropOff1 / registered) * 100).toFixed(1)) : 0;

  const dropOff2 = Math.max(0, activated - engaged);
  const dropOff2Rate = activated > 0 ? Number(((dropOff2 / activated) * 100).toFixed(1)) : 0;

  return (
    <div className="marketing-funnel-analytics" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Header Card */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(124, 92, 252, 0.22) 0%, rgba(22, 25, 35, 0.98) 100%)',
          border: '1px solid rgba(124, 92, 252, 0.45)',
          borderRadius: 16,
          padding: '24px 28px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                background: isReal ? 'rgba(52, 211, 153, 0.2)' : 'rgba(124, 92, 252, 0.35)',
                color: isReal ? '#6ee7b7' : '#e0d7fe',
                padding: '4px 10px',
                borderRadius: 20,
                border: isReal ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid rgba(124, 92, 252, 0.6)'
              }}
            >
              {isReal ? '🟢 Dữ liệu hệ thống thực tế' : 'Báo cáo hiệu suất'}
            </span>
            <span style={{ fontSize: 13, color: '#9da5b5', fontWeight: 500 }}>
              {isReal ? `Tổng hợp: ${registered} tài khoản • ${totalItems} ký ức` : 'Phạm vi: 11-18/10'}
            </span>
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px 0', color: '#ffffff', letterSpacing: '-0.02em' }}>
            Chỉ số Funnel & Hoạt động Marketing
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: '#9da5b5', lineHeight: 1.55, maxWidth: 640 }}>
            {isReal
              ? `Phân tích dữ liệu thực tế từ ${registered} tài khoản người dùng trong cơ sở dữ liệu: tỷ lệ kích hoạt lưu ký ức, mức độ gắn bó không gian học tập và tỷ lệ chuyển đổi trả phí.`
              : 'Phân tích hành vi từ nhóm 38 người truy cập website làm mốc gốc: tỷ lệ chuyển đổi, điểm rơi trong phễu trải nghiệm học tập trung và bảng đối chiếu KPI mục tiêu.'}
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '14px 22px',
            background: 'rgba(10, 12, 18, 0.75)',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)'
          }}
        >
          <span style={{ fontSize: 12, color: '#9da5b5', fontWeight: 500 }}>Tỷ lệ chuyển đổi</span>
          <span style={{ fontSize: 28, fontWeight: 800, color: '#34d399', letterSpacing: '-0.5px' }}>
            {conversionRate}%
          </span>
          <span style={{ fontSize: 11.5, color: '#9da5b5' }}>
            {isReal ? 'Đăng ký → Trả phí' : 'Truy cập → Hoàn thành'}
          </span>
        </div>
      </div>

      {/* Top 5 Metric Highlights */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14
        }}
      >
        <MetricCard
          label={isReal ? 'Người dùng đăng ký' : 'Truy cập website'}
          value={String(registered)}
          sub={isReal ? 'Tài khoản thật trong database' : 'Nhóm mốc gốc (11-18/10)'}
          badge="100%"
          badgeColor="#7457e8"
        />
        <MetricCard
          label={isReal ? 'Tổng ký ức lưu trữ' : 'Lượt xem trang'}
          value={String(totalItems)}
          sub={isReal ? 'Ghi chú, link, ảnh thực tế' : '~5,37 lượt / người'}
          badge="Tương tác"
          badgeColor="#3b82f6"
        />
        <MetricCard
          label={isReal ? 'Đã kích hoạt lưu trữ' : 'Bắt đầu tập trung'}
          value={String(activated)}
          sub={isReal ? 'Đã lưu ≥ 1 ký ức' : 'Dùng thử tính năng học'}
          badge={`${activationRate}%`}
          badgeColor="#8b5cf6"
        />
        <MetricCard
          label={isReal ? 'Người dùng tạo Space' : 'Hoàn thành phiên'}
          value={String(engaged)}
          sub={isReal ? 'Tổ chức không gian tri thức' : '9 tổng phiên hoàn thành'}
          badge={`${engagementRate}%`}
          badgeColor="#10b981"
        />
        <MetricCard
          label={isReal ? 'Gói trả phí Mastery' : 'Phản hồi Google Forms'}
          value={String(paying)}
          sub={isReal ? 'Tài khoản Pro/Mastery' : 'Tích lũy từ 01-18/10'}
          badge={isReal ? `${conversionRate}%` : 'Khảo sát'}
          badgeColor="#f59e0b"
        />
      </div>

      {/* Visual Funnel Card */}
      <div
        className="admin-card"
        style={{
          background: 'var(--mn-surface, #191c25)',
          border: '1px solid var(--mn-border, rgba(255, 255, 255, 0.06))',
          borderRadius: 16,
          padding: 24
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#ffffff' }}>
            Sơ đồ dòng chảy Funnel ({isReal ? 'Dữ liệu người dùng thực tế' : 'Cửa sổ đo 24 giờ'})
          </h3>
          <span style={{ fontSize: 12.5, color: 'var(--mn-text-2, #a2a9b8)' }}>
            {isReal
              ? `${registered} đăng ký → ${activated} kích hoạt → ${engaged} tạo Space → ${paying} trả phí`
              : '38 truy cập → 15 bắt đầu học → 6 hoàn thành phiên'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Step 1 */}
          <div
            style={{
              background: 'rgba(116, 87, 232, 0.08)',
              border: '1px solid rgba(116, 87, 232, 0.25)',
              borderRadius: 12,
              padding: '16px 20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: '#7457e8',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 700
                  }}
                >
                  1
                </span>
                <strong style={{ fontSize: 15, color: '#ffffff' }}>
                  {isReal ? 'Tài khoản người dùng đăng ký (Mốc gốc)' : 'Người truy cập website thành công (Nhóm mốc)'}
                </strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#ffffff' }}>{registered}</span>
                <span style={{ fontSize: 12, color: '#a78bfa' }}>(100%)</span>
              </div>
            </div>
            <div
              style={{
                height: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 4,
                overflow: 'hidden'
              }}
            >
              <div style={{ width: '100%', height: '100%', background: '#7457e8', borderRadius: 4 }} />
            </div>
          </div>

          {/* Drop-off connector 1 */}
          <div
            style={{
              margin: '-4px 0 -4px 34px',
              paddingLeft: 16,
              borderLeft: '2px dashed rgba(248, 113, 113, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12.5,
              color: '#fca5a5'
            }}
          >
            <span>🔻 Điểm rơi 1: <strong>{dropOff1} người</strong> {isReal ? 'chưa lưu ký ức đầu tiên' : 'chưa bắt đầu học'}</span>
            <span
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                padding: '2px 8px',
                borderRadius: 12,
                fontWeight: 600
              }}
            >
              {dropOff1Rate}% rơi rụng
            </span>
          </div>

          {/* Step 2 */}
          <div
            style={{
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              borderRadius: 12,
              padding: '16px 20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: '#6366f1',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 700
                  }}
                >
                  2
                </span>
                <strong style={{ fontSize: 15, color: '#ffffff' }}>
                  {isReal ? 'Người dùng kích hoạt (Đã lưu ít nhất 1 ký ức)' : 'Người bắt đầu dùng thử - chế độ tập trung'}
                </strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#ffffff' }}>{activated}</span>
                <span style={{ fontSize: 12, color: '#818cf8' }}>({activationRate}% so với mốc gốc)</span>
              </div>
            </div>
            <div
              style={{
                height: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 4,
                overflow: 'hidden'
              }}
            >
              <div style={{ width: `${Math.min(100, Math.max(5, activationRate))}%`, height: '100%', background: '#6366f1', borderRadius: 4 }} />
            </div>
          </div>

          {/* Drop-off connector 2 */}
          <div
            style={{
              margin: '-4px 0 -4px 34px',
              paddingLeft: 16,
              borderLeft: '2px dashed rgba(248, 113, 113, 0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12.5,
              color: '#fca5a5'
            }}
          >
            <span>🔻 Điểm rơi 2: <strong>{dropOff2} người</strong> {isReal ? 'chưa tạo Space hoặc phiên học' : 'chưa hoàn thành trong cửa sổ đo'}</span>
            <span
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                padding: '2px 8px',
                borderRadius: 12,
                fontWeight: 600
              }}
            >
              {dropOff2Rate}% rơi rụng
            </span>
          </div>

          {/* Step 3 */}
          <div
            style={{
              background: 'rgba(52, 211, 153, 0.08)',
              border: '1px solid rgba(52, 211, 153, 0.25)',
              borderRadius: 12,
              padding: '16px 20px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: '#10b981',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 700
                  }}
                >
                  3
                </span>
                <strong style={{ fontSize: 15, color: '#ffffff' }}>
                  {isReal ? 'Người dùng tương tác sâu (Tạo không gian Space)' : 'Người hoàn thành phiên học (9 tổng phiên)'}
                </strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#ffffff' }}>{engaged}</span>
                <span style={{ fontSize: 12, color: '#6ee7b7' }}>
                  ({isReal ? `${engagementRate}% từ bước 2` : '40% từ bước 2 • 15,79% toàn phễu'})
                </span>
              </div>
            </div>
            <div
              style={{
                height: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 4,
                overflow: 'hidden'
              }}
            >
              <div style={{ width: `${Math.min(100, Math.max(5, (engaged / Math.max(1, registered)) * 100))}%`, height: '100%', background: '#10b981', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      </div>

      {/* Two Columns: Section 1 & Section 3 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Section 1: Hoạt động marketing */}
        <div
          className="admin-card"
          style={{
            background: 'var(--mn-surface, #191c25)',
            border: '1px solid var(--mn-border, rgba(255, 255, 255, 0.06))',
            borderRadius: 16,
            padding: 22
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#ffffff' }}>
              1. Hoạt động marketing
            </h3>
            <span style={{ fontSize: 12, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 8px', borderRadius: 6, color: '#e2e8f0' }}>
              Tuần 11-18/10
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--mn-text-2, #a2a9b8)', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Chỉ số theo tuần</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>11-18/10</th>
              </tr>
            </thead>
            <tbody>
              <TableRow label="Người truy cập website" value="38" />
              <TableRow label="Lượt xem trang" value="204" />
              <TableRow label="Người bắt đầu học tập trung" value="15" />
              <TableRow label="Người hoàn thành phiên" value="6" />
              <TableRow label="Phản hồi Google Forms nhận trong tuần" value="7" isLast />
            </tbody>
          </table>
        </div>

        {/* Section 3: Điểm rơi trong funnel */}
        <div
          className="admin-card"
          style={{
            background: 'var(--mn-surface, #191c25)',
            border: '1px solid var(--mn-border, rgba(255, 255, 255, 0.06))',
            borderRadius: 16,
            padding: 22
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#ffffff' }}>
              Điểm rơi trong funnel
            </h3>
            <span style={{ fontSize: 12, background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
              Tỷ lệ drop-off
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--mn-text-2, #a2a9b8)', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Điểm rơi trong funnel</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'center' }}>Số người</th>
                <th style={{ padding: '8px 10px', fontWeight: 600, textAlign: 'right' }}>Tỷ lệ</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 10px', color: '#f1f5f9' }}>
                  Truy cập nhưng chưa bắt đầu học
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'center', color: '#cbd5e1' }}>
                  23/38
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#f87171' }}>
                  60,53%
                </td>
              </tr>
              <tr>
                <td style={{ padding: '10px 10px', color: '#f1f5f9' }}>
                  Bắt đầu nhưng chưa hoàn thành trong cửa sổ đo
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'center', color: '#cbd5e1' }}>
                  9/15
                </td>
                <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#f87171' }}>
                  60%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Tiếp cận, dùng thử và feedback */}
      <div
        className="admin-card"
        style={{
          background: 'var(--mn-surface, #191c25)',
          border: '1px solid var(--mn-border, rgba(255, 255, 255, 0.06))',
          borderRadius: 16,
          padding: 22
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#ffffff' }}>
            2. Tiếp cận, dùng thử và feedback
          </h3>
          <span style={{ fontSize: 12, color: 'var(--mn-text-2, #a2a9b8)' }}>
            Theo dõi tương tác người dùng
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--mn-text-2, #a2a9b8)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Chỉ số</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'center' }}>Kết quả</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Phạm vi</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Người truy cập website thành công</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#ffffff' }}>38</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mn-text-2, #a2a9b8)' }}>11-18/10</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Người bắt đầu dùng thử - chế độ tập trung</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#a78bfa' }}>15</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mn-text-2, #a2a9b8)' }}>11-18/10</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Người hoàn thành phiên học</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#34d399' }}>6</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mn-text-2, #a2a9b8)' }}>11-18/10</td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Tổng phiên học hoàn thành</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#34d399' }}>9</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mn-text-2, #a2a9b8)' }}>11-18/10</td>
              </tr>
              <tr>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Phản hồi khảo sát tích lũy</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#fbbf24' }}>7</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--mn-text-2, #a2a9b8)' }}>01-18/10</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 4: Tỷ lệ chuyển đổi và cách tính */}
      <div
        className="admin-card"
        style={{
          background: 'var(--mn-surface, #191c25)',
          border: '1px solid var(--mn-border, rgba(255, 255, 255, 0.06))',
          borderRadius: 16,
          padding: 22
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px 0', color: '#ffffff' }}>
            4. Tỷ lệ chuyển đổi và cách tính
          </h3>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mn-text-2, #a2a9b8)', lineHeight: 1.6 }}>
            Lấy <strong>38 người truy cập thành công</strong> làm nhóm gốc — 100%. Funnel đếm người dùng duy nhất,
            thực hiện các bước theo thứ tự trong 24 giờ:
          </p>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'rgba(116, 87, 232, 0.12)',
              border: '1px solid rgba(116, 87, 232, 0.25)',
              borderRadius: 8,
              margin: '10px 0',
              fontWeight: 600,
              fontSize: 13.5,
              color: '#c4b5fd'
            }}
          >
            <span>38 truy cập</span>
            <span>→</span>
            <span>15 bắt đầu học</span>
            <span>→</span>
            <span>6 hoàn thành phiên</span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
            Công thức: Tỷ lệ chuyển đổi = (Số người đạt bước tiếp theo / Số người ở bước gốc) × 100%
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--mn-text-2, #a2a9b8)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Chỉ số</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'center' }}>Cách tính</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Kết quả</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Nhóm truy cập làm mốc</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-2, #a2a9b8)', fontFamily: 'monospace' }}>
                  38/38 × 100
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#ffffff' }}>
                  100%
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Truy cập → bắt đầu dùng thử</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-2, #a2a9b8)', fontFamily: 'monospace' }}>
                  15/38 × 100
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#818cf8' }}>
                  39,47%
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Bắt đầu → hoàn thành phiên</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-2, #a2a9b8)', fontFamily: 'monospace' }}>
                  6/15 × 100
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#34d399' }}>
                  40%
                </td>
              </tr>
              <tr>
                <td style={{ padding: '10px 12px', color: '#f1f5f9' }}>Truy cập → hoàn thành phiên</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-2, #a2a9b8)', fontFamily: 'monospace' }}>
                  6/38 × 100
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#34d399' }}>
                  15,79%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ margin: '12px 0 0 0', fontSize: 12, color: 'var(--mn-text-3, #707888)' }}>
          * 100% ở dòng đầu là tỷ trọng của nhóm gốc, không phải tỷ lệ đăng ký đã được đo.
        </p>
      </div>

      {/* Section 5: KPI và kết quả hiện tại */}
      <div
        className="admin-card"
        style={{
          background: 'var(--mn-surface, #191c25)',
          border: '1px solid var(--mn-border, rgba(255, 255, 255, 0.06))',
          borderRadius: 16,
          padding: 22
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#ffffff' }}>
            5. KPI và kết quả hiện tại
          </h3>
          <span style={{ fontSize: 12, background: 'rgba(52, 211, 153, 0.12)', color: '#6ee7b7', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>
            Đối chiếu mục tiêu
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'var(--mn-text-2, #a2a9b8)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>KPI</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'center' }}>Kết quả hiện tại</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'center' }}>Mục tiêu tiếp theo</th>
                <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Đánh giá</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>Người truy cập/tuần</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#ffffff' }}>38</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#c4b5fd', fontWeight: 600 }}>≥50</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="warning" label="Đạt 76% mục tiêu" />
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>Truy cập → bắt đầu học</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#818cf8' }}>39,47%</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#c4b5fd', fontWeight: 600 }}>≥45%</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="warning" label="Tiệm cận mục tiêu" />
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>Bắt đầu → hoàn thành</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#34d399' }}>40%</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#c4b5fd', fontWeight: 600 }}>≥50%</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="warning" label="Tiệm cận mục tiêu" />
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>Truy cập → hoàn thành</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#34d399' }}>15,79%</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#c4b5fd', fontWeight: 600 }}>≥22%</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="warning" label="Cần tối ưu funnel" />
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>
                  Phản hồi hợp lệ mới trong vòng thử nghiệm
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-3, #707888)' }}>Chưa đo</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#c4b5fd', fontWeight: 600 }}>≥10</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="neutral" label="Chưa bắt đầu đo" />
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>
                  Người quay lại hoàn thành ở ngày khác
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-3, #707888)' }}>Chưa đo</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-2, #a2a9b8)' }}>Thiết lập baseline</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="neutral" label="Thiết lập baseline" />
                </td>
              </tr>
              <tr>
                <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 500 }}>
                  Tracking tài khoản, gồm Google
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-3, #707888)' }}>Chưa đo</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--mn-text-2, #a2a9b8)' }}>Bao phủ các phương thức đăng nhập</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <StatusBadge status="neutral" label="Kế hoạch tiếp theo" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  badge,
  badgeColor
}: {
  label: string;
  value: string;
  sub: string;
  badge: string;
  badgeColor: string;
}) {
  return (
    <div
      style={{
        background: '#161923',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 10,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        transition: 'all 120ms ease'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#9da5b5', fontWeight: 600 }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            background: `${badgeColor}22`,
            color: badgeColor,
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${badgeColor}44`
          }}
        >
          {badge}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>{value}</div>
        <div style={{ fontSize: 11.5, color: '#6b7385', marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

function TableRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <tr style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255, 255, 255, 0.05)' }}>
      <td style={{ padding: '10px 10px', color: '#f1f5f9' }}>{label}</td>
      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: '#ffffff' }}>{value}</td>
    </tr>
  );
}

function StatusBadge({ status, label }: { status: 'success' | 'warning' | 'neutral'; label: string }) {
  const styles = {
    success: { bg: 'rgba(52, 211, 153, 0.15)', text: '#6ee7b7' },
    warning: { bg: 'rgba(251, 191, 36, 0.15)', text: '#fde68a' },
    neutral: { bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1' }
  }[status];

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11.5,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 6,
        background: styles.bg,
        color: styles.text
      }}
    >
      {label}
    </span>
  );
}
