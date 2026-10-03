import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuthUser } from '../../lib/api-client';

interface DashboardShellProps {
  user: AuthUser;
  readyCount: number;
  demoMode: boolean;
  onLogout: () => void;
  children: ReactNode;
}

/**
 * Authenticated dashboard shell.
 *
 * Replaces the old inline `<header>` with a sticky brand bar and
 * reorganises the page to use the new design tokens. All existing
 * children (SearchBar, QuickCapture, TagSidebar, ItemCard grid) are
 * passed through unchanged so the per-component styling and tests
 * keep working.
 */
export function DashboardShell({ user, readyCount, demoMode, onLogout, children }: DashboardShellProps) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px 48px' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            gap: 16,
            flexWrap: 'wrap'
          }}
        >
          <div>
            <div className="eyebrow">Your second brain</div>
            <h1
              style={{
                marginTop: 4,
                fontSize: 30,
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.01em'
              }}
            >
              Mnemonics
            </h1>
            <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 13 }}>Save once — Find anytime.</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{user.email}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{readyCount} memory sẵn sàng</div>
            </div>
            <Link
              to="/browser-extension"
              className="btn btn--ghost btn--sm"
            >
              Get the extension
            </Link>
            <button
              onClick={onLogout}
              data-testid="logout-btn"
              className="btn btn--ghost btn--sm"
            >
              Đăng xuất
            </button>
          </div>
        </header>

        {demoMode && (
          <div
            data-testid="demo-banner"
            style={{
              marginBottom: 18,
              padding: '14px 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--brand-soft), var(--bg-elevated))',
              border: '1px solid var(--brand-soft)'
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--brand)' }}>⚡ Demo mode</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              Thử các bước: <b>Lưu nhanh</b> → chờ <b>tag + embedding</b> → tìm kiếm → mở <b>Ý liên quan</b>
              → bấm vào card để xem chi tiết / sửa → click tag để lọc theo tag.
              Dữ liệu demo chạy hoàn toàn trên máy local.
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
