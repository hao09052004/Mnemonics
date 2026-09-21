/**
 * Tag Job Handler
 *
 * Processes auto-tagging jobs for all item types.
 * Generates tags based on item content (OCR text, raw text, title).
 */

import type { JobQueue } from '../queue.js';
import type { ItemRepository } from '@mnemonics/database';

export class TagHandler {
  private queue: JobQueue;
  private repository: ItemRepository;
  private openAiKey?: string;

  constructor(queue: JobQueue, repository: ItemRepository, openAiKey?: string) {
    this.queue = queue;
    this.repository = repository;
    this.openAiKey = openAiKey;
  }

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }): Promise<void> {
    console.log(`[TagHandler] Processing tag job ${job.id} for item ${job.itemId}`);

    try {
      // 1. Get the item
      const item = await this.repository.findById(job.itemId);
      if (!item) {
        await this.queue.markFailed(job.id, 'Item not found');
        return;
      }

      // 2. Generate tags
      const tags = await this.generateTags(item);

      // 3. Save tags to item
      await this.repository.updateTags(job.itemId, tags);

      // 4. Mark job as completed
      await this.queue.markCompleted(job.id);

      // 5. Enqueue embed job (always, for all item types)
      await this.queue.create({
        type: 'embed',
        itemId: job.itemId,
        userId: job.userId,
        payload: { afterTag: true }
      });

      console.log(`[TagHandler] Tags generated for item ${job.itemId}:`, tags);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[TagHandler] Error processing job ${job.id}:`, errorMessage);
      await this.queue.markFailed(job.id, errorMessage);
    }
  }

  private async generateTags(item: {
    id: string;
    type: string;
    title: string;
    rawText?: string | null;
    ocrText?: string | null;
  }): Promise<string[]> {
    const textToTag = [
      item.title,
      item.ocrText || '',
      item.rawText || ''
    ].filter(Boolean).join(' ');

    if (!textToTag.trim()) {
      return [];
    }

    // Try OpenAI for smart tagging
    if (this.openAiKey) {
      try {
        const tags = await this.generateTagsWithOpenAI(textToTag);
        if (tags.length > 0) return tags;
      } catch (error) {
        console.log('[TagHandler] OpenAI tagging failed, using heuristics...');
      }
    }

    // Fallback: keyword extraction heuristic
    return this.extractKeywordsHeuristic(textToTag);
  }

  private async generateTagsWithOpenAI(text: string): Promise<string[]> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openAiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{
          role: 'system',
          content: `You are a tag generator. Generate up to 5 relevant tags (lowercase, kebab-case, max 32 chars) for this content. Return as JSON array.`
        }, {
          role: 'user',
          content: text.slice(0, 2000)
        }],
        max_tokens: 100,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '[]';

    try {
      const tags = JSON.parse(content) as string[];
      return tags
        .map(tag => tag.toLowerCase().replace(/\s+/g, '-').slice(0, 32))
        .filter(tag => tag.length > 0 && tag.length <= 32);
    } catch {
      return [];
    }
  }

  private extractKeywordsHeuristic(text: string): string[] {
    // Common stop words to exclude
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
      'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how'
    ]);

    // Extract words and filter
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(word =>
        word.length >= 3 &&
        word.length <= 32 &&
        !stopWords.has(word) &&
        !/^\d+$/.test(word)
      );

    // Count frequency
    const frequency: Record<string, number> = {};
    for (const word of words) {
      frequency[word] = (frequency[word] || 0) + 1;
    }

    // Sort by frequency and take top 5
    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}
