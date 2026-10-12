/**
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
}
