/**
 * Inline icon set for the authenticated dashboard.
 *
 * Each icon renders with `currentColor` so it inherits the parent's
 * color. Sizes are controlled by the parent via `font-size`.
 *
 * Use:
 *   <Icon name="search" size={18} />
 */

export type IconName =
  | 'search'
  | 'sparkle'
  | 'star'
  | 'star-filled'
  | 'layers'
  | 'compass'
  | 'capture'
  | 'settings'
  | 'close'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-up'
  | 'plus'
  | 'more'
  | 'image'
  | 'screenshot'
  | 'note'
  | 'link'
  | 'article'
  | 'highlight'
  | 'doc'
  | 'tag'
  | 'globe'
  | 'home'
  | 'pin'
  | 'edit'
  | 'copy'
  | 'trash'
  | 'external'
  | 'menu'
  | 'grid'
  | 'list'
  | 'clock'
  | 'eye'
  | 'eye-off'
  | 'sort'
  | 'filter'
  | 'refresh'
  | 'arrow-right';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

const PATHS: Record<IconName, JSX.Element> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />
    </>
  ),
  star: (
    <path d="M12 4.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.7-5.2 2.7 1-5.9L3.5 10.7l5.9-.9z" />
  ),
  'star-filled': (
    <path d="M12 4.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.7-5.2 2.7 1-5.9L3.5 10.7l5.9-.9z" fill="currentColor" stroke="none" />
  ),
  layers: (
    <>
      <path d="M12 4l8 4-8 4-8-4 8-4z" />
      <path d="M4 12l8 4 8-4" />
      <path d="M4 16l8 4 8-4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5L13 13l-4.5 2.5L11 11z" />
    </>
  ),
  capture: (
    <>
      <circle cx="12" cy="13" r="4" />
      <path d="M5 8h3l2-2h4l2 2h3v11H5z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  check: (
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  ),
  'chevron-down': (
    <path d="M6 9l6 6 6-6" />
  ),
  'chevron-up': (
    <path d="M6 15l6-6 6 6" />
  ),
  'chevron-right': (
    <path d="M9 6l6 6-6 6" />
  ),
  'chevron-left': (
    <path d="M15 6l-6 6 6 6" />
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M20 16l-5-5-7 7" />
    </>
  ),
  screenshot: (
    <>
      <path d="M5 9V6a1 1 0 0 1 1-1h3" />
      <path d="M15 5h3a1 1 0 0 1 1 1v3" />
      <path d="M19 15v3a1 1 0 0 1-1 1h-3" />
      <path d="M9 19H6a1 1 0 0 1-1-1v-3" />
      <path d="M9 12h6" />
    </>
  ),
  note: (
    <>
      <path d="M5 4h11l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v4h4" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    </>
  ),
  article: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </>
  ),
  highlight: (
    <>
      <path d="M5 18l3-3 9-9-3-3-9 9-3 3z" />
      <path d="M14 6l3 3" />
      <line x1="4" y1="21" x2="9" y2="21" />
    </>
  ),
  doc: (
    <>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h4" />
    </>
  ),
  tag: (
    <>
      <path d="M20 12L12 4H5v7l8 8z" />
      <circle cx="9" cy="9" r="1.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13 13 0 0 1 0 18a13 13 0 0 1 0-18z" />
    </>
  ),
  home: (
    <>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M8 3h8l-1 7 3 3H6l3-3-1-7z" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16v4z" />
      <line x1="14" y1="6" x2="18" y2="10" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </>
  ),
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.7 3.5" />
      <path d="M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.5-1.1" />
    </>
  ),
  sort: (
    <>
      <line x1="4" y1="7" x2="14" y2="7" />
      <line x1="4" y1="12" x2="10" y2="12" />
      <line x1="4" y1="17" x2="7" y2="17" />
      <path d="M18 5v14M15 16l3 3 3-3" />
    </>
  ),
  filter: (
    <>
      <path d="M4 5h16l-6 8v6l-4-2v-4z" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  'arrow-right': (
    <>
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M14 6l6 6-6 6" />
    </>
  )
};

export function Icon({ name, size = 18, strokeWidth = 1.6, className, title }: IconProps) {
  const isFilled = name === 'star-filled';
  const path = PATHS[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  );
}