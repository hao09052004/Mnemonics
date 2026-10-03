/**
 * Routing smoke tests.
 *
 * The whole point of these is to lock in the IA split:
 *   - /               → marketing homepage
 *   - /browser-extension → extension landing
 *   - /login          → auth surface
 *   - /app            → dashboard (no marketing chrome)
 *   - *               → 404
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppRouter } from '../../app/router';
import { ApiClient } from '../api-client';

function renderAt(initialPath: string) {
  const api = new ApiClient('http://localhost:4000');
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppRouter api={api} />
    </MemoryRouter>
  );
}

describe('AppRouter', () => {
  beforeEach(() => {
    // jsdom reports no "Add to Chrome" CTA on the homepage if the
    // install button's modal path triggers any timer; clean it up.
    vi.useRealTimers();
  });
  afterEach(() => cleanup());

  it('renders the marketing homepage at /', async () => {
    renderAt('/');
    // Hero headline has a unique phrase.
    expect(
      await screen.findByText(/Remember everything/i)
    ).toBeInTheDocument();
  });

  it('renders the extension landing at /browser-extension', async () => {
    renderAt('/browser-extension');
    expect(
      await screen.findByText(/Browser extension/i, { selector: '.eyebrow' })
    ).toBeInTheDocument();
    // And at least one primary install CTA is present.
    const ctas = await screen.findAllByTestId('install-extension-btn');
    expect(ctas.length).toBeGreaterThan(0);
  });

  it('renders the dashboard at /app with no marketing footer', async () => {
    renderAt('/app');
    // The dashboard is gated by session. Without a stored session we
    // expect the LoginForm to render (the existing form has an email
    // input). Footer text should NOT be present.
    const login = await screen.findByPlaceholderText(/Email/i);
    expect(login).toBeInTheDocument();
    // Footer phrase unique to the public site.
    expect(screen.queryByText(/Save once\. Remember anytime\./i)).toBeNull();
  });

  it('renders a 404 for an unknown path', async () => {
    renderAt('/totally-not-a-page');
    expect(
      await screen.findByText(/This page slipped out of your library/i)
    ).toBeInTheDocument();
  });
});
