import { useLocale, type Locale } from '../../lib/locale';

interface LanguageSwitchProps {
  /** If true, show compact version suitable for tight headers */
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function LanguageSwitch({ compact = false, className = '', style }: LanguageSwitchProps) {
  const { locale, setLocale, t } = useLocale();

  const handleSelect = (lang: Locale) => {
    setLocale(lang);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Chọn ngôn ngữ / Select language"
      className={`lang-segmented-switch ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px',
        borderRadius: '9999px',
        background: 'var(--theme-switch-bg, rgba(255, 255, 255, 0.05))',
        border: '1px solid var(--border)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        position: 'relative',
        userSelect: 'none',
        ...style,
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={locale === 'en'}
        aria-label="English"
        title={t('lang_title_en')}
        onClick={() => handleSelect('en')}
        data-testid="lang-mode-en"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: compact ? '4px 8px' : '5px 10px',
          borderRadius: '9999px',
          border: locale === 'en' ? '1px solid var(--border-strong, var(--border))' : '1px solid transparent',
          background: locale === 'en' ? 'var(--bg-elevated, var(--surface))' : 'transparent',
          color: locale === 'en' ? 'var(--text)' : 'var(--muted)',
          fontSize: '11px',
          fontWeight: locale === 'en' ? 700 : 500,
          cursor: 'pointer',
          boxShadow: locale === 'en' ? '0 2px 8px rgba(0, 0, 0, 0.16)' : 'none',
          transition: 'all 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)',
          lineHeight: 1,
        }}
      >
        <span>EN</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={locale === 'vi'}
        aria-label="Tiếng Việt"
        title={t('lang_title_vi')}
        onClick={() => handleSelect('vi')}
        data-testid="lang-mode-vi"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          padding: compact ? '4px 8px' : '5px 10px',
          borderRadius: '9999px',
          border: locale === 'vi' ? '1px solid var(--border-strong, var(--border))' : '1px solid transparent',
          background: locale === 'vi' ? 'var(--bg-elevated, var(--surface))' : 'transparent',
          color: locale === 'vi' ? 'var(--text)' : 'var(--muted)',
          fontSize: '11px',
          fontWeight: locale === 'vi' ? 700 : 500,
          cursor: 'pointer',
          boxShadow: locale === 'vi' ? '0 2px 8px rgba(0, 0, 0, 0.16)' : 'none',
          transition: 'all 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)',
          lineHeight: 1,
        }}
      >
        <span>VI</span>
      </button>
    </div>
  );
}
