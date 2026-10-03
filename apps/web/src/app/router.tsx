import { Routes, Route, useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { ApiClient } from '../lib/api-client';
import { productConfig } from '../config/product';
import { Header } from '../components/marketing/Header';
import { Footer } from '../components/marketing/Footer';
import { HomePage } from '../pages/HomePage';
import { BrowserExtensionPage } from '../pages/BrowserExtensionPage';
import { LoginPage } from '../pages/LoginPage';
import { SignupPage } from '../pages/SignupPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { DashboardPage } from '../pages/DashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';

interface AppRouterProps {
  api: ApiClient;
}

/**
 * Top-level router. Renders the marketing chrome (header + footer)
 * on public pages and a bare shell on the authenticated dashboard.
 *
 * The ApiClient is created once with the env-aware base URL and
 * passed down — this is the only place that knows about
 * `VITE_API_URL` end-to-end.
 */
export function AppRouter({ api }: AppRouterProps) {
  const location = useLocation();
  const isDashboard = location.pathname.startsWith('/app');

  return (
    <div className="mnemonics-app-root">
      {!isDashboard && <Header />}
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/browser-extension" element={<BrowserExtensionPage />} />
          <Route path="/login" element={<LoginPage api={api} />} />
          <Route path="/signup" element={<SignupPage api={api} />} />
          <Route path="/reset-password" element={<ResetPasswordPage api={api} />} />
          <Route path="/app" element={<DashboardPage api={api} />} />
          <Route path="/app/*" element={<DashboardPage api={api} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      {!isDashboard && <Footer />}
    </div>
  );
}

/**
 * Single ApiClient instance shared across the router. Reads
 * VITE_API_URL through productConfig; if the var is empty AND we're
 * not in vite-dev-on-:3000, we fall back to a relative path so the
 * same bundle can sit behind a reverse proxy in production.
 */
export function useApiClient(): ApiClient {
  return useMemo(() => {
    const base = productConfig.apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    return new ApiClient(base);
  }, []);
}
