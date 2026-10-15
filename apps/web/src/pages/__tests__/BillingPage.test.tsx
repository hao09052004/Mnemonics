import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BillingPage } from '../BillingPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function createMockApi(overrides?: Partial<any>) {
  return {
    loadStoredSession: vi.fn(),
    saveSession: vi.fn(),
    getMyEntitlement: vi.fn().mockResolvedValue({
      data: {
        entitlement: {
          planId: 'mastery',
          validUntil: '2027-01-01T00:00:00Z',
          monthlyCaptureLimit: null,
          semanticSearchEnabled: true,
        },
      },
    }),
    listMyOrders: vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: 'ord_1',
            createdAt: '2026-10-15T10:00:00Z',
            planId: 'mastery',
            amountVnd: 1200000,
            status: 'paid',
            reference: 'MNM-12345',
          },
        ],
      },
    }),
    ...overrides,
  } as any;
}

describe('BillingPage', () => {
  it('renders friendly unauthenticated card when no session exists', () => {
    const api = createMockApi({
      loadStoredSession: vi.fn().mockReturnValue(null),
    });

    render(
      <MemoryRouter>
        <BillingPage api={api} />
      </MemoryRouter>
    );

    expect(screen.getByText('Chưa đăng nhập')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập ngay' })).toBeInTheDocument();
  });

  it('renders user email and account details when logged in', async () => {
    const mockUser = {
      id: 'usr_abc123',
      email: 'testuser@mnemonics.app',
      name: 'Nguyen Van Test',
      role: 'user',
      createdAt: '2026-01-01T00:00:00Z',
    };

    const api = createMockApi({
      loadStoredSession: vi.fn().mockReturnValue({
        accessToken: 'valid_token',
        user: mockUser,
      }),
    });

    render(
      <MemoryRouter>
        <BillingPage api={api} />
      </MemoryRouter>
    );

    // Email displayed clearly on account card
    expect(await screen.findByTestId('account-email')).toHaveTextContent('testuser@mnemonics.app');
    expect(screen.getByText(/Nguyen Van Test/)).toBeInTheDocument();
    expect(screen.getByText(/usr_abc123/)).toBeInTheDocument();

    // Order and plan details
    expect(await screen.findByText(/MNM-12345/)).toBeInTheDocument();
    expect(screen.getByText(/Toàn bộ tính năng AI/)).toBeInTheDocument();
    expect(screen.getByText('Đã mở khóa toàn bộ')).toBeInTheDocument();

    // Clicking logout calls saveSession(null)
    const logoutBtn = screen.getByTestId('account-logout-btn');
    await userEvent.click(logoutBtn);
    expect(api.saveSession).toHaveBeenCalledWith(null);
  });
});
