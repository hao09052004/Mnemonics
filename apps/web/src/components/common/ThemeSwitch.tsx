import { useTheme, type ThemeMode } from '../../lib/theme';
import { Icon } from '../dashboard/Icons';

interface ThemeSwitchProps {
  /** If true, show only icons without text labels */
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  label: string;
  shortLabel: string;
  title: string;
  icon: 'sun' | 'moon' | 'monitor';
}> = [
  {
    id: 'light',
    label: 'Sáng',
    shortLabel: 'Sáng',
    title: 'Giao diện Sáng (Trắng)',
    icon: 'sun',
  },
  {
    id: 'dark',
    label: 'Tối',
    shortLabel: 'Tối',
    title: 'Giao diện Tối (Đen)',
    icon: 'moon',
  },
  {
    id: 'system',
    label: 'Hệ thống',
    shortLabel: 'Tự động',
    title: 'Theo thiết lập của máy tính (Hệ thống)',
    icon: 'monitor',
  },
];

export function ThemeSwitch({ compact = false, className = '', style }: ThemeSwitchProps) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Chọn giao diện"
      className={`theme-segmented-switch ${className}`}
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
      {THEME_OPTIONS.map((opt) => {
        const isSelected = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={opt.title}
            title={opt.title}
            onClick={() => setMode(opt.id)}
            data-testid={`theme-mode-${opt.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: compact ? '5px 7px' : '5px 10px',
              borderRadius: '9999px',
              border: isSelected ? '1px solid var(--border-strong, var(--border))' : '1px solid transparent',
              background: isSelected
                ? 'var(--bg-elevated, var(--surface))'
                : 'transparent',
              color: isSelected
                ? 'var(--text)'
                : 'var(--muted)',
              fontSize: '12px',
              fontWeight: isSelected ? 600 : 500,
              cursor: 'pointer',
              boxShadow: isSelected ? '0 2px 8px rgba(0, 0, 0, 0.16)' : 'none',
              transition: 'all 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)',
              lineHeight: 1,
            }}
          >
            <Icon
              name={opt.icon}
              size={14}
            />
            {!compact && (
              <span className="theme-switch-label" style={{ letterSpacing: '-0.2px' }}>
                {opt.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
