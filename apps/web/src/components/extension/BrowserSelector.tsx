import { useEffect, useState } from 'react';
import { detectBrowser, installLabelFor, type BrowserKind } from '../../config/browser';

interface BrowserSelectorProps {
  /**
   * Called when the user clicks a browser chip. Use this to scroll to
   * the install CTA or open a per-browser modal.
   */
  onSelect?: (browser: BrowserKind) => void;
}

interface Chip {
  id: BrowserKind;
  label: string;
  status: 'ready' | 'coming-soon';
  hint: string;
}

const CHIPS: Chip[] = [
  { id: 'chrome', label: 'Chrome', status: 'ready', hint: 'Chrome Web Store' },
  { id: 'brave', label: 'Brave', status: 'ready', hint: 'Chrome Web Store' },
  { id: 'edge', label: 'Edge', status: 'ready', hint: 'Chrome Web Store' },
  { id: 'firefox', label: 'Firefox', status: 'coming-soon', hint: 'Coming soon' },
  { id: 'safari', label: 'Safari', status: 'coming-soon', hint: 'Coming soon' }
];

/**
 * Visual browser picker used on the /browser-extension page. Reflects
 * the user's actual browser in the highlighted state on first paint,
 * but lets them switch manually without being blocked.
 */
export function BrowserSelector({ onSelect }: BrowserSelectorProps) {
  const [detected, setDetected] = useState<BrowserKind>('other');
  useEffect(() => setDetected(detectBrowser()), []);

  return (
    <div role="tablist" aria-label="Browser" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
      {CHIPS.map((chip) => {
        const isActive = chip.id === detected;
        const install = installLabelFor(chip.id);
        return (
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`browser-chip-${chip.id}`}
            key={chip.id}
            disabled={chip.status === 'coming-soon'}
            onClick={() => onSelect?.(chip.id)}
            style={{
              padding: '10px 16px',
              borderRadius: 999,
              border: `1px solid ${isActive ? 'var(--brand)' : 'var(--border)'}`,
              background: isActive ? 'var(--brand-tint)' : 'var(--surface)',
              color: chip.status === 'coming-soon' ? 'var(--muted-soft)' : 'var(--ink)',
              fontWeight: 600,
              fontSize: 14,
              cursor: chip.status === 'coming-soon' ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span>{chip.label}</span>
            <span
              style={{
                fontSize: 11,
                color: isActive ? 'var(--brand)' : 'var(--muted)',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              }}
            >
              {chip.status === 'coming-soon' ? 'Soon' : isActive ? 'Detected' : install.webStoreReady ? 'Available' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}
