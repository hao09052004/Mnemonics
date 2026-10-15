import { Link } from 'react-router-dom';
import { useLocale } from '../lib/locale';

export function NotFoundPage() {
  const { t } = useLocale();

  return (
    <div
      style={{
        minHeight: 'calc(100vh - var(--header-h))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        textAlign: 'center',
        gap: 16
      }}
    >
      <div className="eyebrow">{t('not_found_eyebrow', '404')}</div>
      <h1 className="display h2" style={{ marginTop: 4 }}>
        {t('not_found_title', 'This page slipped out of your library.')}
      </h1>
      <p className="lead" style={{ marginTop: 0 }}>
        {t('not_found_lead', "The URL you followed isn't a Mnemonics page. Try heading back home.")}
      </p>
      <Link to="/" className="btn btn--primary btn--lg" style={{ marginTop: 12 }}>
        {t('not_found_btn', 'Back to homepage')}
      </Link>
    </div>
  );
}
