import type { SearchRequest, SpaceRule } from './api-client';
import { labelToKinds, type MemoryLabel } from './memory-kind';

/**
 * The single definition of "this search has criteria worth saving".
 *
 * Both the Save-as-Space affordance and the rule we send to the server
 * go through here. Deriving them separately is how a Space ends up
 * storing a rule the search endpoint would reject — the button appears,
 * the save 400s, and the user has no idea why.
 *
 * Mirrors `hasMeaningfulCriteria` in @mnemonics/database. Kept on the
 * client as well because the affordance must be hidden *before* the
 * user clicks, not reported as an error after.
 */
export function hasActiveCriteria(rule: SpaceRule | null | undefined): boolean {
  if (!rule) return false;
  if (rule.q && rule.q.trim().length > 0) return true;
  const f = rule.filters;
  if (!f) return false;
  return Boolean(
    (f.tags && f.tags.length > 0) ||
    (f.kind && f.kind.length > 0) ||
    f.captured_after ||
    f.captured_before ||
    f.favorite === true
  );
}

/**
 * Build the rule for the current Everything view.
 *
 * The type chip is part of the criteria: if the user narrowed to
 * "Images", a Space built from the same state must keep that filter,
 * otherwise "Save as Space" quietly widens the result set instead of
 * freezing it. A chip that is not a real content kind is dropped
 * rather than sent as an unknown type.
 */
export function ruleFromView(query: string, filter: MemoryLabel | 'all'): SpaceRule {
  const q = query.trim();
  const rule: SpaceRule = { q };

  if (filter !== 'all') {
    const kind = filterToKind(filter);
    if (kind) rule.filters = { kind: [kind] };
  }
  return rule;
}

/**
 * Map a chip to the stored `items.type` value.
 *
 * The chip vocabulary is display-oriented (`article`, `note`,
 * `highlight`) while the column holds `link | text | image |
 * screenshot`, so several chips collapse onto the same type. Null
 * means "not a type filter" — `document` has no backend kind, so
 * asking for it would produce a Space that can never match anything.
 */
export function filterToKind(
  filter: MemoryLabel | 'all'
): 'link' | 'text' | 'image' | 'screenshot' | null {
  if (filter === 'all') return null;
  const [kind] = labelToKinds(filter);
  return (kind as 'link' | 'text' | 'image' | 'screenshot' | undefined) ?? null;
}

/** The server-facing request shape, for reference at call sites. */
export function toSearchRequest(rule: SpaceRule): SearchRequest {
  return { q: rule.q ?? '', filters: rule.filters };
}
