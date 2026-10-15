const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are', 'was', 'were',
  'this', 'that', 'with', 'from', 'have', 'will', 'your', 'page', 'home', 'http', 'https',
  'www', 'com', 'net', 'org',
  'và', 'hoặc', 'là', 'của', 'trong', 'trên', 'cho', 'với', 'từ', 'có', 'được',
  'những', 'các', 'một', 'này', 'đó', 'khi', 'bởi', 'về', 'như', 'tôi', 'bạn', 'người'
]);

/**
 * Extracts smart tags from title, note, or content.
 * Mirrors the Chrome extension's `autoTagsFromContent` procedure.
 */
export function extractSmartTags(content: string, fallbackDefault = 'ghi chú'): string[] {
  if (!content || content.trim().length < 3) return [fallbackDefault];
  const words = content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }
  const tags = Object.keys(freq)
    .sort((a, b) => freq[b] - freq[a])
    .slice(0, 4);

  return tags.length > 0 ? tags : [fallbackDefault];
}
