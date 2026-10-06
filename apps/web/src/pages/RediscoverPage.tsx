import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardShell } from '../components/dashboard/DashboardShell';
import { ApiClient, type Session } from '../lib/api-client';

interface RediscoverPageProps {
  api: ApiClient;
}

export function RediscoverPage({ api }: RediscoverPageProps) {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const stored = api.loadStoredSession();
    if (stored) setSession(stored);
  }, [api]);

  if (!session) return null;

  return (
    <DashboardShell
      user={session.user}
      active="Rediscover"
      onNavigate={(p) => {
        if (p === 'Everything') navigate('/app');
        else if (p === 'Spaces') navigate('/app/spaces');
      }}
      onCapture={() => undefined}
      onLogout={() => {
        api.saveSession(null);
        setSession(null);
        navigate('/');
      }}
      demoMode={false}
    >
      <main className="main standard">
        <header className="page-header">
          <div>
            <span className="eyebrow">A QUIET RETURN</span>
            <h1>Rediscover</h1>
            <p>Things worth remembering again.</p>
          </div>
        </header>
        <section className="empty" aria-label="Rediscover stub">
          <div className="empty-inner">
            <div className="empty-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <h1>Coming soon</h1>
            <p>
              Mnemonics Rediscover is on the roadmap. It will resurface
              memories you saved a long time ago.
            </p>
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}