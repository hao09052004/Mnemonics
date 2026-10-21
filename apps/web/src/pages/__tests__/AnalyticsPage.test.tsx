import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AnalyticsPage } from '../AnalyticsPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function createMockApi(overrides?: Partial<any>) {
  return {
    loadStoredSession: vi.fn(),
    saveSession: vi.fn(),
    getAnalyticsOverview: vi.fn().mockResolvedValue({
      data: {
        totalCaptures: 42,
        thisMonth: 12,
        capturesThisPeriod: 30,
        daysWindow: 30,
        plan: {
          planId: 'mastery',
          validUntil: '2027-01-01T00:00:00Z',
          monthlyCaptureLimit: null,
          semanticSearchEnabled: true,
          remainingCaptures: null,
        },
        spaces: 5,
        distinctTags: 18,
        aiCallsThisPeriod: 64,
        byType: [
          { type: 'note', count: 20 },
          { type: 'link', count: 15 },
          { type: 'image', count: 7 },
        ],
      },
    }),
    getAnalyticsCaptures: vi.fn().mockResolvedValue({
      data: {
        days: 30,
        series: [
          { day: '2026-10-18', count: 4 },
          { day: '2026-10-19', count: 6 },
          { day: '2026-10-20', count: 5 },
        ],
      },
    }),
    ...overrides,
  } as any;
}

describe('AnalyticsPage', () => {
  it('allows unauthenticated users to switch to Funnel & Marketing tab', async () => {
    const api = createMockApi({
      loadStoredSession: vi.fn().mockReturnValue(null),
    });

    render(
      <MemoryRouter initialEntries={['/app/analytics']}>
        <AnalyticsPage api={api} />
      </MemoryRouter>
    );

    // Initial state: unauthenticated overview prompt
    expect(screen.getByText('Chưa đăng nhập')).toBeInTheDocument();

    // Click tab "Chỉ số Funnel & Marketing"
    const funnelTab = screen.getByTestId('unauth-tab-funnel');
    await userEvent.click(funnelTab);

    // Funnel content should be displayed
    expect(screen.getByText('Chỉ số Funnel & Hoạt động Marketing')).toBeInTheDocument();
    expect(screen.getByText('1. Hoạt động marketing')).toBeInTheDocument();
    expect(screen.getByText('2. Tiếp cận, dùng thử và feedback')).toBeInTheDocument();
    expect(screen.getByText('4. Tỷ lệ chuyển đổi và cách tính')).toBeInTheDocument();
    expect(screen.getByText('5. KPI và kết quả hiện tại')).toBeInTheDocument();
  });

  it('renders marketing & funnel metrics directly when ?tab=funnel URL is accessed', () => {
    const api = createMockApi({
      loadStoredSession: vi.fn().mockReturnValue(null),
    });

    render(
      <MemoryRouter initialEntries={['/app/analytics?tab=funnel']}>
        <AnalyticsPage api={api} />
      </MemoryRouter>
    );

    expect(screen.getByText('Chỉ số Funnel & Hoạt động Marketing')).toBeInTheDocument();
    expect(screen.getByText('38 truy cập → 15 bắt đầu học → 6 hoàn thành phiên')).toBeInTheDocument();
    expect(screen.getAllByText('15,79%').length).toBeGreaterThanOrEqual(1);
  });

  it('renders authenticated dashboard with tabs and switches between them', async () => {
    const api = createMockApi({
      loadStoredSession: vi.fn().mockReturnValue({
        accessToken: 'valid-token',
        user: { id: 'usr-1', email: 'test@example.com', name: 'Tester', role: 'user', emailVerified: true },
      }),
    });

    render(
      <MemoryRouter initialEntries={['/app/analytics']}>
        <AnalyticsPage api={api} />
      </MemoryRouter>
    );

    // Overview tab is active by default
    expect(screen.getByText('Phân tích & Thống kê')).toBeInTheDocument();
    expect(await screen.findByText('Tổng memory')).toBeInTheDocument();

    // Switch to Funnel tab
    const funnelTab = screen.getByTestId('tab-funnel');
    await userEvent.click(funnelTab);

    expect(screen.getByText('Chỉ số Funnel & Hoạt động Marketing')).toBeInTheDocument();
    expect(screen.getByText('Truy cập nhưng chưa bắt đầu học')).toBeInTheDocument();
    expect(screen.getByText('60,53%')).toBeInTheDocument();
  });
});
