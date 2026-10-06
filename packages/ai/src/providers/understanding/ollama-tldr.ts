/**
 * Optional Ollama-backed TLDR provider.
 *
 * Calls `POST {OLLAMA_BASE_URL}/api/generate` with a small prompt.
 * This is OPT-IN: the deterministic provider is always wired in
 * first. Only enable this when the user has Ollama running locally.
 *
 * The choice of model comes from the `OLLAMA_TLDR_MODEL` env var;
 * the default `llama3.2:1b` runs on CPU and fits inside 4GB RAM.
 */

import type { TldrInput, TldrProvider, TldrResult } from '../../understanding/types.js';
import { ProviderError } from '../../types.js';

const DEFAULT_MODEL = 'llama3.2:1b';
const PROMPT_VERSION = 'ollama-tldr-v1';

export interface OllamaTldrProviderOptions {
  baseUrl?: string;
  model?: string;
  /** Hard ceiling for the prompt context we send. */
  maxContextChars?: number;
  /** Force CPU execution (num_gpu: 0) when CUDA is broken. */
  forceCpu?: boolean;
}

export class OllamaTldrProvider implements TldrProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxContextChars: number;
  private readonly forceCpu: boolean;

  constructor(opts: OllamaTldrProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = opts.model ?? process.env.OLLAMA_TLDR_MODEL ?? DEFAULT_MODEL;
    this.maxContextChars = opts.maxContextChars ?? 1500;
    this.forceCpu = opts.forceCpu ?? false;
  }

  info() {
    return {
      name: 'ollama',
      model: this.model,
      promptVersion: PROMPT_VERSION
    };
  }

  async summarize(input: TldrInput): Promise<TldrResult> {
    const prompt = buildPrompt(input, this.maxContextChars);
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 160,
          ...(this.forceCpu ? { num_gpu: 0 } : {}),
        }
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderError({
        message: `Ollama TLDR error ${res.status}: ${body.slice(0, 200)}`,
        code: res.status === 404 ? 'MODEL_NOT_FOUND' : 'PROVIDER_UNAVAILABLE',
        provider: 'ollama',
        retryable: res.status >= 500
      });
    }
    const json = (await res.json()) as { response?: string };
    const tldr = (json.response ?? '').trim();
    if (!tldr) {
      throw new ProviderError({
        message: 'Ollama TLDR returned empty response',
        code: 'EMPTY_RESPONSE',
        provider: 'ollama',
        retryable: true
      });
    }
    return {
      tldr: tldr.slice(0, 240),
      provider: 'ollama',
      model: this.model,
      promptVersion: PROMPT_VERSION,
      source: 'local_ai',
      confidence: 0.7
    };
  }
}

function buildPrompt(input: TldrInput, maxContextChars: number): string {
  const lines: string[] = [
    'Bạn là trợ lý TLDR. Hãy viết một câu tóm tắt ngắn (≤ 30 từ) bằng tiếng Việt,',
    'trung thành với nội dung memory. Không thêm nhận định cá nhân, không bịa.',
    ''
  ];
  if (input.title) lines.push(`Tiêu đề: ${clip(input.title, 200)}`);
  if (input.caption) lines.push(`Mô tả ảnh: ${clip(input.caption, 400)}`);
  if (input.ocrText) lines.push(`Văn bản nhận diện: ${clip(input.ocrText, 400)}`);
  if (input.rawText) lines.push(`Nội dung: ${clip(input.rawText, 600)}`);
  if (input.sourceUrl) lines.push(`Nguồn: ${clip(input.sourceUrl, 120)}`);
  lines.push('TLDR:');
  const prompt = lines.join('\n');
  return prompt.slice(0, maxContextChars * 4);
}

function clip(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}