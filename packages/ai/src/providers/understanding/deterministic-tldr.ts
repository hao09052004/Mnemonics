/**
 * Deterministic TLDR provider.
 *
 * Composes the TLDR from the inputs the pipeline already has:
 *   - title (always)
 *   - caption (image description)
 *   - OCR text
 *   - selection / raw text
 *   - source URL host (for page captures)
 *
 * The composition is intentionally boring — Vietnamese-first because
 * the rest of the product is Vietnamese-first, but a fixed
 * English fallback is emitted for the LTR cases.
 *
 * The point: this provider works WITHOUT any model, network, or
 * configuration. It is the floor of the TLDR pipeline.
 *
 * A future `OllamaTldrProvider` may improve the wording when an
 * Ollama daemon is available; this one is always wired in.
 */

import type { TldrInput, TldrProvider, TldrResult } from '../../understanding/types.js';

const PROMPT_VERSION = 'deterministic-v1';

const MAX_CHARS = 240;
const MAX_SENTENCES = 2;

const NOISE_PHRASES = new Set([
  'a screenshot of',
  'an image of',
  'this image',
  'this screenshot',
  'hình ảnh',
  'ảnh',
  'một hình ảnh'
]);

const URL_NOISE_HOSTS = new Set([
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
  'reddit.com', 'youtube.com', 'youtu.be', 'tiktok.com',
  'localhost', '127.0.0.1'
]);

const VI_FOLLOWUPS = new Set([
  'đây là', 'là một', 'một', 'cái', 'bức', 'tấm',
  'the following', 'this is', 'this'
]);

export class DeterministicTldrProvider implements TldrProvider {
  info() {
    return {
      name: 'deterministic',
      model: 'keyword-fusion-v1',
      promptVersion: PROMPT_VERSION
    };
  }

  summarize(input: TldrInput): Promise<TldrResult> {
    const locale = input.locale ?? 'vi';
    const tldr = locale.startsWith('vi')
      ? buildVietnamese(input)
      : buildEnglish(input);
    return Promise.resolve({
      tldr: cap(tldr, MAX_CHARS),
      provider: 'deterministic',
      model: 'keyword-fusion-v1',
      promptVersion: PROMPT_VERSION,
      source: 'heuristic',
      confidence: 0.4
    });
  }
}

function buildVietnamese(input: TldrInput): string {
  const parts: string[] = [];
  const caption = cleanNoise(input.caption);
  const ocr = cleanNoise(input.ocrText);
  const raw = cleanNoise(input.rawText);
  const title = cleanNoise(input.title);
  const host = hostFromUrl(input.sourceUrl);

  if (input.type === 'image' || input.type === 'screenshot') {
    if (caption) {
      parts.push(sentenceCase(caption));
    } else if (ocr) {
      parts.push(`Hình ảnh chứa nội dung: ${firstClause(ocr)}`);
    } else if (title) {
      parts.push(`Hình ảnh: ${firstClause(title)}`);
    } else {
      parts.push('Một hình ảnh đã được lưu.');
    }
    if (ocr && caption) {
      parts.push(`Văn bản nhận diện: ${firstClause(ocr)}.`);
    }
  } else if (input.type === 'link') {
    if (raw) {
      parts.push(`Trang lưu từ ${host ?? 'web'} với nội dung chính: ${firstClause(raw)}.`);
    } else if (title) {
      parts.push(`Trang lưu từ ${host ?? 'web'}: ${firstClause(title)}.`);
    } else {
      parts.push(`Một liên kết đã được lưu.`);
    }
  } else if (input.type === 'text') {
    if (raw) {
      parts.push(`${firstClause(raw)}.`);
    } else if (title) {
      parts.push(firstClause(title));
    } else {
      parts.push('Một đoạn ghi chú ngắn.');
    }
  } else if (input.type === 'note') {
    if (raw) {
      parts.push(`${firstClause(raw)}.`);
    } else {
      parts.push(firstClause(title || 'Ghi chú nhanh.'));
    }
  }

  return joinSentences(parts, MAX_SENTENCES);
}

function buildEnglish(input: TldrInput): string {
  const caption = cleanNoise(input.caption);
  const ocr = cleanNoise(input.ocrText);
  const raw = cleanNoise(input.rawText);
  const title = cleanNoise(input.title);
  const host = hostFromUrl(input.sourceUrl);

  if (input.type === 'image' || input.type === 'screenshot') {
    const subject = caption || (ocr ? `text reading “${firstClause(ocr)}”` : title || 'saved image');
    return cap(`Saved image showing ${subject}.`, MAX_CHARS);
  }
  if (input.type === 'link') {
    const subject = raw || title || 'a page';
    return cap(`Page from ${host ?? 'web'}: ${firstClause(subject)}.`, MAX_CHARS);
  }
  if (raw) return cap(`${firstClause(raw)}.`, MAX_CHARS);
  return cap(firstClause(title || 'A short note.'), MAX_CHARS);
}

function joinSentences(parts: string[], max: number): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function cap(s: string, max: number): string {
  if (s.length <= max) return s;
  // try to cut on a sentence boundary
  const slice = s.slice(0, max);
  const lastDot = slice.lastIndexOf('. ');
  if (lastDot > max * 0.6) return slice.slice(0, lastDot + 1);
  return slice.replace(/[\s,;:]+$/, '') + '…';
}

function firstClause(text: string, max = 160): string {
  const t = text.trim();
  // Prefer sentence boundary
  const dot = t.search(/[.!?]\s/);
  if (dot > 8 && dot < max) return t.slice(0, dot + 1);
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

function cleanNoise(value: string | null | undefined): string {
  if (!value) return '';
  let v = value.trim();
  // Drop everything after the placeholder prefix
  for (const phrase of NOISE_PHRASES) {
    if (v.toLowerCase().startsWith(phrase + ' ')) v = v.slice(phrase.length + 1).trim();
  }
  // Vietnamese filler
  for (const phrase of VI_FOLLOWUPS) {
    const re = new RegExp(`^${phrase}\\s+`, 'i');
    if (re.test(v)) v = v.replace(re, '').trim();
  }
  return v;
}

function sentenceCase(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (URL_NOISE_HOSTS.has(u.hostname)) return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}