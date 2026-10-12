/**
 * Deterministic query parser (spec 0005 §7.3).
 *
 * Pure function: takes a free-text string and an optional
 * reference `now` (defaults to `new Date()`), returns a
 * `ParsedQuery` that the search route can merge with an
 * existing `SearchRequest`.
 *
 * Three extraction passes:
 *   1. Date phrases → `captured_after` / `captured_before`
 *      expressed in UTC ISO strings.
 *   2. Type hints → `structured.detectedType[]` via a
 *      controlled vocabulary map.
 *   3. Structured tokens (`brand:foo`, `material:bar`, …) →
 *      `structured.{brand,material,color,merchant,author}[]`.
 *
 * The residual `q` (everything unmatched) is what the
 * semantic leg embeds and ranks against.
 *
 * Confidence gate: a token matched twice with different
 * values (e.g. `brand:foo brand:bar`) is dropped, not
 * silently AND-ed into an empty result.
 *
 * No I/O. No network. ~150 lines.
 */
import type { SearchFiltersStructured, DetectedType } from './search-service.js';

/** Date phrase windows are UTC. */
export interface DateWindow {
  after: string;  // ISO 8601 UTC
  before: string; // ISO 8601 UTC
}

export interface ParsedQuery {
  residualQ: string;
  /** Set when the query contained a date phrase. */
  captured_after?: string;
  captured_before?: string;
  /** Set when the query contained a type hint or a structured token. */
  structured?: SearchFiltersStructured;
  /** Diagnostic: which phrases matched which bucket. Useful in tests. */
  trace: Array<{ kind: string; value: string }>;
}

/**
 * Closed vocabulary for type hints. Both singular and plural
 * English forms are listed so the parser does not need a
 * stemmer; Vietnamese type hints (`công thức` for recipe,
 * `bài viết` for article) are listed at full length because
 * whitespace splits them into multi-word tokens otherwise.
 */
const TYPE_HINTS: Record<string, string> = {
  article: 'article',
  articles: 'article',
  blog: 'article',
  blogpost: 'article',
  product: 'product',
  products: 'product',
  recipe: 'recipe',
  recipes: 'recipe',
  video: 'video',
  videos: 'video',
  quote: 'quote',
  quotes: 'quote',
  highlight: 'highlight',
  highlights: 'highlight',
  note: 'note',
  notes: 'note',
  image: 'image',
  images: 'image',
  document: 'document',
  documents: 'document',
  webpage: 'webpage',
  webpages: 'webpage',
  'bài viết': 'article',
  'công thức': 'recipe'
};

const STRUCTURED_KEYS = [
  'brand', 'material', 'color', 'merchant', 'author'
] as const;
type StructuredKey = (typeof STRUCTURED_KEYS)[number];

const DATE_PHRASE_TOKENS = new Set([
  'today', 'yesterday', 'tomorrow',
  'this week', 'this month', 'this year',
  'last week', 'last month', 'last year'
]);

/** Strip a leading or trailing punctuation that the splitter would leave. */
function cleanToken(t: string): string {
  return t.replace(/^["'`(\[]+|["'`)\],!?;:.]+$/g, '').toLowerCase();
}

/** Build a `[after, before]` window in UTC. */
function windowFor(phrase: string, now: Date): DateWindow | null {
  const startOfTodayUtc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0
  ));
  const endOfTodayUtc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59
  ));
  switch (phrase) {
    case 'today':
      return { after: startOfTodayUtc.toISOString(), before: endOfTodayUtc.toISOString() };
    case 'yesterday': {
      const y = new Date(startOfTodayUtc.getTime() - 86_400_000);
      const yEnd = new Date(y.getTime() + 86_400_000 - 1);
      return { after: y.toISOString(), before: yEnd.toISOString() };
    }
    case 'this week': {
      const after = new Date(startOfTodayUtc.getTime() - 6 * 86_400_000);
      return { after: after.toISOString(), before: endOfTodayUtc.toISOString() };
    }
    case 'last week': {
      // Last Sunday's 00:00:00.000 (now - today_start - 7d)
      // through last Sunday's 23:59:59.999 (now - today_start - 1ms).
      const after = new Date(startOfTodayUtc.getTime() - 7 * 86_400_000);
      const before = new Date(startOfTodayUtc.getTime() - 1);
      return { after: after.toISOString(), before: before.toISOString() };
    }
    case 'this month': {
      const after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { after: after.toISOString(), before: endOfTodayUtc.toISOString() };
    }
    case 'last month': {
      const after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
      return { after: after.toISOString(), before: before.toISOString() };
    }
    case 'this year': {
      const after = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { after: after.toISOString(), before: endOfTodayUtc.toISOString() };
    }
    case 'last year': {
      const after = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      const before = new Date(Date.UTC(now.getUTCFullYear(), 0, 1) - 1);
      return { after: after.toISOString(), before: before.toISOString() };
    }
  }
  return null;
}

/**
 * Match `N <unit> ago` (e.g. "2 days ago", "3 weeks ago",
 * "1 month ago"). Returns null when the phrase doesn't fit.
 */
function relativeAgo(match: RegExpMatchArray, now: Date): DateWindow | null {
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = match[2];
  let ms: number;
  switch (unit) {
    case 'day':
    case 'days':
      ms = n * 86_400_000;
      break;
    case 'week':
    case 'weeks':
      ms = n * 7 * 86_400_000;
      break;
    case 'month':
    case 'months':
      ms = n * 30 * 86_400_000;
      break;
    default:
      return null;
  }
  const after = new Date(now.getTime() - ms);
  return { after: after.toISOString(), before: now.toISOString() };
}

const RELATIVE_AGO = /\b(\d+)\s+(day|days|week|weeks|month|months)\s+ago\b/i;
const BEFORE_DATE = /\bbefore\s+(\d{4}-\d{2}-\d{2})\b/i;
const AFTER_DATE = /\bafter\s+(\d{4}-\d{2}-\d{2})\b/i;

/** A token in the form `key:value`. */
function parseStructuredToken(raw: string): { key: StructuredKey; value: string } | null {
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const key = raw.slice(0, idx).toLowerCase() as StructuredKey;
  const value = raw.slice(idx + 1).trim();
  if (!value) return null;
  if (!STRUCTURED_KEYS.includes(key)) return null;
  return { key, value };
}

export function parseQuery(input: string, now: Date = new Date()): ParsedQuery {
  const trace: ParsedQuery['trace'] = [];
  if (!input || !input.trim()) {
    return { residualQ: '', trace };
  }
  const lower = input.toLowerCase();
  let capturedAfter: string | undefined;
  let capturedBefore: string | undefined;
  // Multi-word type hints (e.g. "công thức", "bài viết") must
  // be matched on the raw input before the token splitter
  // tears them into separate words. We also need to strip
  // the consumed phrase from the residual so the semantic
  // leg does not embed "công thức" separately. The map is
  // populated here AND by the single-word token pass below.
  const typeCounts = new Map<string, number>();
  let lowerMut = lower;
  for (const [phrase, kind] of Object.entries(TYPE_HINTS)) {
    if (phrase.includes(' ') && lowerMut.includes(phrase)) {
      trace.push({ kind: 'type-hint', value: phrase });
      typeCounts.set(kind, (typeCounts.get(kind) ?? 0) + 1);
      lowerMut = lowerMut.replace(phrase, ' ');
    }
  }

  // Pass 1: date phrases (in priority order, "this week" must
  // be tried before "week" alone).
  for (const phrase of DATE_PHRASE_TOKENS) {
    if (lower.includes(phrase)) {
      const win = windowFor(phrase, now);
      if (win) {
        capturedAfter = capturedAfter ?? win.after;
        capturedBefore = capturedBefore ?? win.before;
        trace.push({ kind: 'date-phrase', value: phrase });
      }
    }
  }
  const agoMatch = lower.match(RELATIVE_AGO);
  if (agoMatch) {
    const win = relativeAgo(agoMatch, now);
    if (win) {
      capturedAfter = capturedAfter ?? win.after;
      capturedBefore = capturedBefore ?? win.before;
      trace.push({ kind: 'date-relative', value: agoMatch[0] });
    }
  }
  const beforeDate = lower.match(BEFORE_DATE);
  if (beforeDate) {
    const before = new Date(`${beforeDate[1]}T23:59:59.999Z`);
    capturedBefore = capturedBefore ?? before.toISOString();
    trace.push({ kind: 'date-before', value: beforeDate[1] });
  }
  const afterDate = lower.match(AFTER_DATE);
  if (afterDate) {
    const after = new Date(`${afterDate[1]}T00:00:00.000Z`);
    capturedAfter = capturedAfter ?? after.toISOString();
    trace.push({ kind: 'date-after', value: afterDate[1] });
  }

  // Pass 2: type hints and structured tokens. We work on the
  // token list so "brand:ikea" doesn't accidentally leak into
  // the residual. Tokens come from `lowerMut` (not `input`)
  // so any multi-word phrase consumed in pass 0 is also gone
  // from the residual computation.
  const tokens = lowerMut.split(/\s+/).map(cleanToken).filter(Boolean);
  const structured: SearchFiltersStructured = {};
  // Track each structured key with all values it saw. A
  // contradiction (two different values) drops the whole key.
  const structuredByKey: Record<StructuredKey, Set<string>> = {
    brand: new Set(), material: new Set(), color: new Set(),
    merchant: new Set(), author: new Set()
  };

  for (const t of tokens) {
    const typed = parseStructuredToken(t);
    if (typed) {
      structuredByKey[typed.key].add(typed.value);
      trace.push({ kind: 'structured-token', value: `${typed.key}:${typed.value}` });
      continue;
    }
    if (TYPE_HINTS[t]) {
      const kind = TYPE_HINTS[t];
      typeCounts.set(kind, (typeCounts.get(kind) ?? 0) + 1);
      trace.push({ kind: 'type-hint', value: t });
    }
  }

  // Build structured from collected data.
  for (const key of STRUCTURED_KEYS) {
    const values = structuredByKey[key];
    if (values.size === 0) continue;
    if (values.size > 1) {
      // Contradiction — drop the key.
      trace.push({ kind: 'structured-contradiction', value: key });
      continue;
    }
    (structured as Record<string, string[]>)[key] = [Array.from(values)[0]];
  }
  if (typeCounts.size > 0) {
    structured.detectedType = Array.from(typeCounts.keys()) as DetectedType[];
  }

  // Pass 3: residual. Strip everything we consumed. We
  // normalise by lowercasing + trimming. Multi-word date
  // phrases (e.g. "this week") are not single tokens; we
  // already captured them in pass 1, but we also strip them
  // from the residual so the semantic leg doesn't try to
  // embed "this week".
  const residual = tokens
    .filter((t) => {
      if (parseStructuredToken(t)) return false;
      if (TYPE_HINTS[t]) return false;
      return true;
    })
    .join(' ')
    .trim();

  const result: ParsedQuery = {
    residualQ: residual,
    trace
  };
  if (capturedAfter) result.captured_after = capturedAfter;
  if (capturedBefore) result.captured_before = capturedBefore;
  if (Object.keys(structured).length > 0) {
    result.structured = structured;
  }
  return result;
}
