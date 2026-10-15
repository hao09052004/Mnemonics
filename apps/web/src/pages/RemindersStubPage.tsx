import { Icon } from '../components/dashboard/Icons';
import { useLocale } from '../lib/locale';

export function RemindersStubPage() {
  const { t } = useLocale();

  return (
    <main className="main standard">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t('reminders_eyebrow', 'GENTLE PROMPTS')}</span>
          <h1>{t('reminders_title', 'Reminders')}</h1>
          <p>{t('reminders_sub', 'A few things you asked to revisit.')}</p>
        </div>
      </header>
      <section className="empty" aria-label="Reminders stub">
        <div className="empty-inner">
          <div className="empty-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1>{t('coming_soon', 'Coming soon')}</h1>
          <p>
            {t('reminders_coming_soon', 'Mnemonics Reminders is on the roadmap. The API for this page is not in v1.')}
          </p>
        </div>
      </section>
      <span hidden>
        <Icon name="bell" />
      </span>
    </main>
  );
}