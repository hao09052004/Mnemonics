import { useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Header } from '../components/marketing/Header';
import { Footer } from '../components/marketing/Footer';
import { HomePage } from '../pages/HomePage';
import { BrowserExtensionPage } from '../pages/BrowserExtensionPage';
import { LoginPage } from '../pages/LoginPage';
import { SignupPage } from '../pages/SignupPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { DashboardPage } from '../pages/DashboardPage';
import { SpacesPage } from '../pages/SpacesPage';
import { SpaceDetailPage } from '../pages/SpaceDetailPage';
import { RediscoverPage } from '../pages/RediscoverPage';
import { RemindersStubPage } from '../pages/RemindersStubPage';
import { FavoritesPage } from '../pages/FavoritesPage';
import { ClustersPage } from '../pages/ClustersPage';
import { ClusterDetailPage } from '../pages/ClusterDetailPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ApiClient } from '../lib/api-client';
import { productConfig } from '../config/product';

interface AppRouterProps {
  api: ApiClient;
}

/**
 * Top-level router.
 *
 * Public routes (marketing + auth) keep the marketing chrome.
 * Authenticated dashboard routes are now bare (no Header/Footer);
 * their own DashboardShell renders the top nav.
 */
export function AppRouter({ api }: AppRouterProps) {
  return (
    <div className="mnemonics-app-root">
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Header />
              <HomePage />
              <Footer />
            </>
          }
        />
        <Route
          path="/browser-extension"
          element={
            <>
              <Header />
              <BrowserExtensionPage />
              <Footer />
            </>
          }
        />
        <Route path="/login" element={<LoginPage api={api} />} />
        <Route path="/signup" element={<SignupPage api={api} />} />
        <Route path="/reset-password" element={<ResetPasswordPage api={api} />} />
        <Route path="/app" element={<DashboardPage api={api} />} />
        <Route path="/app/favorites" element={<FavoritesPage api={api} />} />
        <Route path="/app/spaces" element={<SpacesPage api={api} />} />
        <Route path="/app/spaces/:id" element={<SpaceDetailPage api={api} />} />
        <Route path="/app/clusters" element={<ClustersPage api={api} />} />
        <Route path="/app/clusters/:id" element={<ClusterDetailPage api={api} />} />
        <Route path="/app/rediscover" element={<RediscoverPage api={api} />} />
        <Route path="/app/reminders" element={<RemindersStubPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
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