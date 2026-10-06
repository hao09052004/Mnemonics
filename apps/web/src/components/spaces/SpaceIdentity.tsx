import { SPACE_COLORS, type SpaceColor } from '../../lib/api-client';
import './spaces.css';

/**
 * The curated Space palette, expressed as CSS custom properties.
 *
 * The hexes are deliberately muted: they read as a 6px dot or a 2px
 * accent against the `--mn-bg` surface instead of competing with it.
 * Nothing exceeds roughly 60% lightness, so a Space can never become a
 * saturated slab of colour.
 *
 * Kept as a local map rather than inline styles so the whole palette is
 * greppable and a designer can retune it in one place.
 */
const SPACE_COLOR_VARS: Record<SpaceColor, { dot: string; accent: string; text: string }> = {
  violet: { dot: '#8b7ff0', accent: 'rgba(139, 127, 240, 0.22)', text: '#b3a9f7' },
  blue: { dot: '#5b8dd6', accent: 'rgba(91, 141, 214, 0.20)', text: '#93b6e8' },
  teal: { dot: '#4fa39b', accent: 'rgba(79, 163, 155, 0.20)', text: '#87c9c2' },
  sage: { dot: '#7fa06a', accent: 'rgba(127, 160, 106, 0.20)', text: '#a8c396' },
  amber: { dot: '#c2924a', accent: 'rgba(194, 146, 74, 0.20)', text: '#e0b877' },
  rose: { dot: '#c26a7d', accent: 'rgba(194, 106, 125, 0.20)', text: '#e399a8' },
  slate: { dot: '#7a8290', accent: 'rgba(122, 130, 144, 0.20)', text: '#a8b0be' }
};

export function spaceColorVars(color: SpaceColor | null | undefined) {
  return SPACE_COLOR_VARS[color ?? 'slate'] ?? SPACE_COLOR_VARS.slate;
}

interface SpaceDotProps {
  color: SpaceColor | null | undefined;
  size?: number;
  className?: string;
}

/**
 * The Space identity mark.
 *
 * Decoration only: it repeats what the adjacent name already says, so
 * it is hidden from assistive tech.
 */
export function SpaceDot({ color, size = 8, className }: SpaceDotProps) {
  const vars = spaceColorVars(color);
  return (
    <span
      aria-hidden="true"
      className={className ? `space-dot ${className}` : 'space-dot'}
      style={{ width: size, height: size, background: vars.dot }}
    />
  );
}

interface SpaceColorPickerProps {
  value: SpaceColor | null;
  onChange: (color: SpaceColor) => void;
  label?: string;
}

/**
 * Colour choice for a Space.
 *
 * A radio group rather than a swatch grid: seven options fit on one
 * line, and the radio semantics mean arrow keys and screen-reader
 * announcements work with no extra wiring.
 */
export function SpaceColorPicker({ value, onChange, label }: SpaceColorPickerProps) {
  return (
    <div className="space-color-picker">
      {label ? <span className="field-label">{label}</span> : null}
      <div className="space-color-picker__row" role="radiogroup" aria-label={label ?? 'Space colour'}>
        {SPACE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value === color}
            aria-label={color}
            title={color}
            data-testid={`space-color-${color}`}
            onClick={() => onChange(color)}
            style={{ background: SPACE_COLOR_VARS[color].dot }}
            className={
              value === color
                ? 'space-color-picker__dot is-active'
                : 'space-color-picker__dot'
            }
          />
        ))}
      </div>
    </div>
  );
}

interface SpaceKindBadgeProps {
  kind: 'manual' | 'smart';
}

/**
 * MANUAL / SMART label.
 *
 * Smart is not an AI feature — it means "decided by saved criteria" —
 * so this is plain text with no sparkle icon and no branding. An icon
 * here would imply intelligence the product does not use.
 */
export function SpaceKindBadge({ kind }: SpaceKindBadgeProps) {
  return (
    <span className={`space-kind space-kind--${kind}`} data-testid={`space-kind-${kind}`}>
      {kind}
    </span>
  );
}
