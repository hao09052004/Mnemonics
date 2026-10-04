import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardTopNav } from '../DashboardTopNav';

afterEach(() => cleanup());

describe('DashboardTopNav', () => {
  it('highlights the active page', () => {
    render(
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
    render(
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
    render(
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
});