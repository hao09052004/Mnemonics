import { useEffect, useRef, useState } from 'react';
import { SpaceColorPicker } from './SpaceIdentity';
import type { SpaceColor, SpaceRule } from '../../lib/api-client';
import { useLocale } from '../../lib/locale';
import './spaces.css';

interface SpaceRuleSummaryProps {
  rule: SpaceRule;
}

/**
 * Renders saved criteria the way a person would describe them:
 * "Images · #design · Search: logo". Never raw JSON — the point of a
 * smart Space is that its rule is legible without decoding anything.
 */
export function SpaceRuleSummary({ rule }: SpaceRuleSummaryProps) {
  const parts: string[] = [];
  const kinds = rule.filters?.kind ?? [];
  if (kinds.length > 0) {
    parts.push(kinds.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(', '));
  }
  for (const tag of rule.filters?.tags ?? []) parts.push(`#${tag}`);
  if (rule.filters?.favorite) parts.push('Favourites');
  if (rule.filters?.captured_after) {
    parts.push(`since ${rule.filters.captured_after.slice(0, 10)}`);
  }
  if (rule.filters?.captured_before) {
    parts.push(`before ${rule.filters.captured_before.slice(0, 10)}`);
  }
  if (rule.q?.trim()) parts.push(`Search: ${rule.q.trim()}`);

  if (parts.length === 0) {
    return (
      <span className="space-rule-summary is-empty" data-testid="space-rule-summary">
        No criteria
      </span>
    );
  }
  return (
    <span className="space-rule-summary" data-testid="space-rule-summary">
      {parts.join(' · ')}
    </span>
  );
}

interface CreateSpaceDialogProps {
  mode: 'manual' | 'smart';
  /** Present only in smart mode: the criteria being saved. */
  rule?: SpaceRule;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string; color: SpaceColor }) => void;
  busy?: boolean;
  error?: string | null;
}

/**
 * One dialog for both kinds.
 *
 * Manual mode asks for a name and a colour. Smart mode additionally
 * states, in the dialog itself, that the Space stays up to date on its
 * own — otherwise "Save as Space" reads like "save these five results",
 * which is the misconception this whole feature is built to avoid.
 */
export function CreateSpaceDialog({
  mode,
  rule,
  onClose,
  onSubmit,
  busy = false,
  error = null
}: CreateSpaceDialogProps) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<SpaceColor>('violet');
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    onSubmit({ name: trimmed, description: description.trim(), color });
  };

  return (
    <div className="space-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="space-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'smart' ? t('space_dialog_smart_title', 'Create Smart Space') : t('space_dialog_manual_title', 'New Space')}
        data-testid="create-space-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{mode === 'smart' ? t('space_dialog_smart_title', 'Create Smart Space') : t('space_dialog_manual_title', 'New Space')}</h2>

        {mode === 'smart' && rule ? (
          <div className="space-dialog__criteria" data-testid="space-dialog-criteria">
            <p className="space-dialog__explain">
              {t('space_dialog_explain', 'This Space automatically stays up to date using your current search and filters. Memories that match will appear on their own — nothing is copied.')}
            </p>
            <span className="field-label">{t('space_dialog_current_criteria', 'Current criteria')}</span>
            <SpaceRuleSummary rule={rule} />
          </div>
        ) : null}

        <label className="field-label" htmlFor="space-dialog-name">
          {t('space_field_name', 'Name')}
        </label>
        <input
          id="space-dialog-name"
          ref={firstField}
          className="field-input"
          value={name}
          maxLength={120}
          placeholder={mode === 'smart' ? 'Logo Inspiration' : 'M&A Research'}
          data-testid="space-dialog-name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />

        <label className="field-label" htmlFor="space-dialog-description">
          {t('space_field_desc', 'Description')} <span className="field-optional">{t('space_field_optional', 'optional')}</span>
        </label>
        <input
          id="space-dialog-description"
          className="field-input"
          value={description}
          maxLength={1000}
          placeholder={t('space_field_desc_placeholder', 'What belongs in here?')}
          data-testid="space-dialog-description"
          onChange={(e) => setDescription(e.target.value)}
        />

        <SpaceColorPicker value={color} onChange={setColor} label={t('space_field_color', 'Colour')} />

        {error ? (
          <p className="space-picker__error" role="alert" data-testid="space-dialog-error">
            {error}
          </p>
        ) : null}

        <div className="space-dialog__actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            {t('btn_cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!name.trim() || busy}
            data-testid="space-dialog-submit"
            onClick={submit}
          >
            {busy ? t('status_loading', 'Creating…') : mode === 'smart' ? t('space_dialog_smart_title', 'Create Smart Space') : t('space_btn_create', 'Create Space')}
          </button>
        </div>
      </div>
    </div>
  );
}
