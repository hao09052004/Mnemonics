/**
 * Smoke tests for the AuthLayout used on /login, /signup, and
 * /reset-password. We only assert on the high-level UX contract:
 *   - Primary CTA matches the browser label and points at the Web
 *     Store when one is configured.
 *   - The "Continue with email" link flips to the email panel.
 *   - Forgot-password inline form is reachable from the email panel.
 *   - The "switch mode" toggle is hidden when the form is inside
 *     the auth shell (no duplicate "Đăng ký"/"Đăng nhập" button).
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthLayout } from '../../components/auth/AuthLayout';
import { ApiClient } from '../api-client';

function renderAt(path: string, mode: 'login' | 'signup') {
  const api = new ApiClient('http://localhost:4000');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={<AuthLayout api={api} mode={mode} onAuthenticated={() => undefined} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => cleanup());

describe('AuthLayout', () => {
  it('renders a large editorial headline and the primary install CTA on /login', () => {
    renderAt('/login', 'login');
    // Headline copy — multi-line, so we match a fragment.
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    // Primary CTA is the browser label.
    const cta = screen.getByTestId('auth-primary-cta');
    expect(cta).toBeInTheDocument();
    // Default jsdom UA is chrome → label is "Add to Chrome".
    expect(cta.textContent).toMatch(/Add to Chrome/i);
  });

  it('renders the "Get started" eyebrow on /signup', () => {
    renderAt('/signup', 'signup');
    expect(screen.getByText(/Get started/i)).toBeInTheDocument();
    expect(screen.getByText(/Save once/i)).toBeInTheDocument();
  });

  it('flips to the email panel when "Continue with email" is clicked', () => {
    renderAt('/login', 'login');
    fireEvent.click(screen.getByText(/Continue with email/i));
    // The email panel reuses the LoginForm which has an email input.
    expect(screen.getByPlaceholderText(/Email/i)).toBeInTheDocument();
  });

  it('hides the LoginForm in-form mode toggle (no duplicate cross-link)', () => {
    renderAt('/login', 'login');
    fireEvent.click(screen.getByText(/Continue with email/i));
    // The internal "Đăng ký"/"Đăng nhập" button in LoginForm is hidden.
    expect(screen.queryByText(/Chưa có tài khoản\? Đăng ký/i)).toBeNull();
    // The auth shell's own cross-link is shown instead.
    expect(screen.getByText(/Create an account/i)).toBeInTheDocument();
  });

  it('opens the forgot-password step from the email panel', () => {
    renderAt('/login', 'login');
    fireEvent.click(screen.getByText(/Continue with email/i));
    fireEvent.click(screen.getByTestId('forgot-password-link'));
    expect(screen.getByText(/Reset your password/i)).toBeInTheDocument();
  });
});
