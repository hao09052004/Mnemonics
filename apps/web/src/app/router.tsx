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
import { NotFoundPage } from '../pages/NotFoundPage';
import type { ApiClient } from '../lib/api-client';

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
        <Route path="/app/spaces" element={<SpacesPage api={api} />} />
        <Route path="/app/spaces/:id" element={<SpaceDetailPage api={api} />} />
        <Route path="/app/rediscover" element={<RediscoverPage api={api} />} />
        <Route path="/app/reminders" element={<RemindersStubPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}