import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DashboardTopNav } from '../DashboardTopNav';

afterEach(() => cleanup());

function renderInRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('DashboardTopNav', () => {
  it('highlights the active page', () => {
    renderInRouter(
      <DashboardTopNav
        active="Spaces"
        onNavigate={() => {}}
        onCapture={() => {}}
        initials="AC"
      />
    );
    expect(screen.getByRole('button', { name: 'Spaces' }).className).toContain('active');
  });

  it('fires onNavigate when a tab is clicked', async () => {
    const onNavigate = vi.fn();
    renderInRouter(
      <DashboardTopNav
        active="Everything"
        onNavigate={onNavigate}
        onCapture={() => {}}
        initials="AC"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Rediscover' }));
    expect(onNavigate).toHaveBeenCalledWith('Rediscover');
  });

  it('fires onCapture when the Capture button is clicked', async () => {
    const onCapture = vi.fn();
    renderInRouter(
      <DashboardTopNav
        active="Everything"
        onNavigate={() => {}}
        onCapture={onCapture}
        initials="AC"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /capture/i }));
    expect(onCapture).toHaveBeenCalledOnce();
  });

  it('toggles account dropdown and displays user email when avatar is clicked', async () => {
    const onLogout = vi.fn();
    renderInRouter(
      <DashboardTopNav
        active="Everything"
        onNavigate={() => {}}
        onCapture={() => {}}
        initials="HN"
        user={{
          id: 'u1',
          email: 'hao.nguyen@example.com',
          name: 'Hao Nguyen',
          role: 'user',
          createdAt: new Date().toISOString(),
        } as any}
        onLogout={onLogout}
      />
    );

    // Initial state: dropdown is closed
    expect(screen.queryByTestId('account-dropdown')).toBeNull();

    // Click avatar
    await userEvent.click(screen.getByTestId('avatar-btn'));
    expect(screen.getByTestId('account-dropdown')).toBeInTheDocument();
    expect(screen.getByText('hao.nguyen@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hao Nguyen')).toBeInTheDocument();

    // Click logout
    await userEvent.click(screen.getByTestId('dropdown-logout'));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});

