import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BillingCheckoutPage } from '../BillingCheckoutPage';

afterEach(() => {
  cleanup();
});

describe('BillingCheckoutPage', () => {
  it('calls createOrder only once on mount and does NOT loop on 503 error', async () => {
    const createOrderMock = vi.fn().mockRejectedValue({
      status: 503,
      message: 'Service Unavailable',
    });

    const api = {
      loadStoredSession: vi.fn().mockReturnValue({
        accessToken: 'test_token',
        user: { id: 'u1', email: 'user@example.com' },
      }),
      createOrder: createOrderMock,
    } as any;

    render(
      <MemoryRouter initialEntries={['/app/billing/checkout?plan=mastery-monthly']}>
        <BillingCheckoutPage api={api} />
      </MemoryRouter>
    );

    // Should display the 503 error message
    expect(await screen.findByText(/Máy chủ Render đang thức giấc/i)).toBeInTheDocument();
    
    // Crucial check: createOrder was called exactly once, NOT looped!
    expect(createOrderMock).toHaveBeenCalledTimes(1);

    // Clicking retry calls createOrder a second time
    const retryBtn = screen.getByRole('button', { name: /thử lại ngay/i });
    await userEvent.click(retryBtn);
    expect(createOrderMock).toHaveBeenCalledTimes(2);
  });
});
