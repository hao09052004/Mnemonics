/**
<<<<<<< HEAD
 * Deterministic natural-language query parser.
 *
 * Splits a free-text `q` into a structured shape the search route
 * already accepts:
 *
 *   - `structured.detectedType` (and friends) — chip-style filters
 *     the dashboard can render directly.
 *   - `captured_after` / `captured_before` — relative date hints
 *     resolved to ISO-8601 strings (the search-service writes the
 *     same format into the items table).
 *   - `residualQ` — the leftover text after the parser has lifted
 *     all the type / brand / date tokens. The search route appends
 *     this to the user's `q` so the semantic + lexical legs still
 *     see the meaningful words.
 *
 * The parser is pure, deterministic, and synchronous: there is no
 * LLM call, no network IO, and no observable state. The output is
 * an object with all fields optional; an input that contains no
 * recognised tokens yields `{ residualQ: q }`.
 *
 * Why a separate module:
 *   - `packages/database` is the single owner of "what the
 *     dashboard chips mean". Putting the parser here lets the
 *     Smart Spaces resolution path (which goes through
 *     `runSearch`) parse its own text rules the same way the
 *     search route does.
 *   - Unit tests in `__tests__/query-parser.test.ts` pin the
 *     token recognition (recipe / article / brand / ...) so a
 *     later change to the chip vocabulary breaks loudly.
 */

export const DETECTED_TYPES = [
  'article', 'product', 'recipe', 'video', 'quote', 'highlight',
  'webpage', 'image', 'note', 'document', 'other'
] as const;
export type DetectedType = (typeof DETECTED_TYPES)[number];

export interface ParsedQuery {
  residualQ?: string;
  captured_after?: string;
  captured_before?: string;
  structured?: {
    detectedType?: DetectedType[];
    category?: string[];
    brand?: string[];
    material?: string[];
    color?: string[];
    merchant?: string[];
    author?: string[];
  };
}

/**
 * Singular noun → controlled-vocabulary mapping. Keys are
 * lower-case so we can match case-insensitively. Each entry is
 * `{ vi?: string[]; en?: string[]; type: DetectedType }` so a
 * later locale only adds rows; existing rows do not change.
 */
const TYPE_HINTS: ReadonlyArray<{ vi?: string[]; en?: string[]; type: DetectedType }> = [
  { en: ['recipe', 'recipes'], vi: ['công thức'], type: 'recipe' },
  { en: ['article', 'articles', 'blog post', 'blog posts'], vi: ['bài viết'], type: 'article' },
  { en: ['product', 'products', 'item', 'items'], type: 'product' },
  { en: ['video', 'videos'], type: 'video' },
  { en: ['quote', 'quotes'], type: 'quote' },
  { en: ['highlight', 'highlights'], type: 'highlight' },
  { en: ['webpage', 'page', 'pages'], type: 'webpage' },
  { en: ['image', 'images', 'photo', 'photos', 'picture', 'pictures'], type: 'image' },
  { en: ['note', 'notes', 'memo', 'memos'], type: 'note' },
  { en: ['document', 'documents', 'doc', 'docs', 'pdf'], type: 'document' }
];

const RELATIVE_DATE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  apply: (ref: Date) => { after?: string; before?: string };
}> = [
  {
    // `today` / `hôm nay`
    pattern: /\b(today|hôm nay)\b/i,
    apply: (ref) => {
      const d = startOfDay(ref);
      return { after: d.toISOString(), before: endOfDay(ref).toISOString() };
    }
  },
  {
    // `yesterday` / `hôm qua`
    pattern: /\b(yesterday|hôm qua)\b/i,
    apply: (ref) => {
      const d = startOfDay(ref);
      d.setUTCDate(d.getUTCDate() - 1);
      const e = new Date(d);
      e.setUTCDate(e.getUTCDate() + 1);
      e.setUTCMilliseconds(e.getUTCMilliseconds() - 1);
      return { after: d.toISOString(), before: e.toISOString() };
    }
  },
  {
    // `last week` / `tuần trước`
    pattern: /\b(last week|tuần trước)\b/i,
    apply: (ref) => {
      const after = startOfDay(ref);
      after.setUTCDate(after.getUTCDate() - 7);
      return { after: after.toISOString() };
    }
  },
  {
    // `last month` / `tháng trước`
    pattern: /\b(last month|tháng trước)\b/i,
    apply: (ref) => {
      const after = startOfDay(ref);
      after.setUTCMonth(after.getUTCMonth() - 1);
      return { after: after.toISOString() };
    }
  }
];

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}

/**
 * Parse a free-text search query.
 *
 * Deterministic; never throws; always returns a ParsedQuery
 * (possibly empty other than `residualQ`).
 */
export function parseQuery(q: string, now: Date = new Date()): ParsedQuery {
  const out: ParsedQuery = {};
  const detectedTypes: DetectedType[] = [];
  const stripped: RegExp[] = [];
  const lower = q.toLowerCase();

  // 1. type hints — check English first, then Vietnamese.
  for (const hint of TYPE_HINTS) {    const tokens = [...(hint.en ?? []), ...(hint.vi ?? [])];
    for (const t of tokens) {
      // Word-boundary match. Vietnamese diacritics make `\b` a
      // little fragile but for the curated hint set it is enough.
      const re = new RegExp(`\\b${escapeRegExp(t.toLowerCase())}\\b`, 'i');
      if (re.test(lower)) {
        if (!detectedTypes.includes(hint.type)) detectedTypes.push(hint.type);
        stripped.push(re);
        break;
      }
    }
  }

  // 2. relative date hints.
  for (const { pattern, apply } of RELATIVE_DATE_PATTERNS) {
    if (pattern.test(q)) {
      const { after, before } = apply(now);
      if (after) out.captured_after = after;
      if (before) out.captured_before = before;
      stripped.push(pattern);
    }
  }

  // 3. brand / merchant — the parser is intentionally conservative:
  // it only lifts patterns that look like "by Acme" or "from Acme"
  // where the next word is title-cased AND not a country/region
  // common-noun (Japan, USA, Vietnam, ...). Lower-case words and
  // common regions stay in residualQ so the search legs still get
  // them. This avoids the trap where "spicy ramen recipe from
  // Japan" strips "from Japan" because the regex is too eager.
  const COUNTRY_HINT_STOPWORDS = new Set([
    'Japan', 'Vietnam', 'Thailand', 'Korea', 'China', 'India',
    'France', 'Italy', 'USA', 'UK', 'Germany', 'Spain', 'Mexico',
    'Brazil', 'America', 'Asia', 'Europe', 'Africa'
  ]);
  const brandByRe = /\b(?:by|from|brand[:\s]+)\s+([A-Z][\w&' .-]{1,40})/g;
  let m: RegExpExecArray | null;
  const brands: string[] = [];
  while ((m = brandByRe.exec(q)) !== null) {
    const candidate = m[1].trim();
    // Drop the first word; check whether it's a stopword. The
    // regex above can still match a country/region like "Japan"
    // because the leading letter is capitalised.
    const firstWord = candidate.split(/\s+/)[0] ?? '';
    if (COUNTRY_HINT_STOPWORDS.has(firstWord)) continue;
    brands.push(candidate);
    stripped.push(new RegExp(escapeRegExp(m[0]), 'gi'));
  }
  // 4. build residualQ by removing the stripped tokens.
  let residual = q;
  for (const re of stripped) {
    residual = residual.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }

  if (residual.length > 0) {
    out.residualQ = residual;
  }
  if (detectedTypes.length > 0 || brands.length > 0) {
    out.structured = {
      ...(detectedTypes.length > 0 ? { detectedType: detectedTypes } : {}),
      ...(brands.length > 0 ? { brand: brands } : {})
    };
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
=======
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

/** Closed vocabulary for type hints. */
const TYPE_HINTS: Record<string, string> = {
  articles: 'article',
  videos: 'video',
  recipes: 'recipe',
  products: 'product',
  quotes: 'quote',
  highlights: 'highlight',
  notes: 'note',
  images: 'image',
  documents: 'document',
  webpages: 'webpage',
  // Vietnamese type hints (spec 0005 §20 review focus 4).
  // These are common nouns a Vietnamese-speaking user would
  // type; the parser strips them and routes the residual
  // through the semantic leg.
  'công thức': 'recipe',
  'bài viết': 'article',
  'video': 'video',
  'sản phẩm': 'product',
  'trích dẫn': 'quote',
  'đoạn trích': 'highlight',
  'ghi chú': 'note',
  'hình ảnh': 'image',
  'tài liệu': 'document'
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

  // Pass 2a: multi-word type hints (Vietnamese phrases like
  // "công thức phở bò" or "bài viết về bảo mật"). The
  // per-token pass below would split them apart; this pass
  // matches them first and removes the tokens from the
  // residual.
  const lowerInput = input.toLowerCase();
  const typeCounts = new Map<string, number>();
  const multiWordHints = Object.entries(TYPE_HINTS)
    .filter(([k]) => k.includes(' '))
    .sort((a, b) => b[0].length - a[0].length); // longest first
  for (const [phrase, kind] of multiWordHints) {
    if (lowerInput.includes(phrase)) {
      typeCounts.set(kind, (typeCounts.get(kind) ?? 0) + 1);
      trace.push({ kind: 'type-hint', value: phrase });
    }
  }

  // Pass 2: type hints and structured tokens. We work on the
  // token list so "brand:ikea" doesn't accidentally leak into
  // the residual.
  const tokens = input.split(/\s+/).map(cleanToken).filter(Boolean);
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
>>>>>>> 421dc0c (feat(search): M3 smart search & dynamic smart spaces (parser + structured leg))
}
