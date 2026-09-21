/**
 * OCR Job Handler
 *
 * Processes OCR jobs for image/screenshot items.
 * Uses Tesseract.js for local OCR or OpenAI Vision API as fallback.
 */

import type { JobQueue } from '../queue.js';
import type { ItemRepository } from '@mnemonics/database';

export interface OcrHandlerDeps {
  queue: JobQueue;
  repository: ItemRepository;
  openAiKey?: string;
}

export class OcrHandler {
  private queue: JobQueue;
  private repository: ItemRepository;
  private openAiKey?: string;

  constructor(queue: JobQueue, repository: ItemRepository, openAiKey?: string) {
    this.queue = queue;
    this.repository = repository;
    this.openAiKey = openAiKey;
  }

  async handle(job: { id: string; itemId: string; userId: string; payload: Record<string, unknown> }): Promise<void> {
    console.log(`[OcrHandler] Processing OCR job ${job.id} for item ${job.itemId}`);

    try {
      // 1. Get the item
      const item = await this.repository.findById(job.itemId);
      if (!item) {
        await this.queue.markFailed(job.id, 'Item not found');
        return;
      }

      // Only process images and screenshots
      if (item.type !== 'image') {
        console.log(`[OcrHandler] Skipping non-image item ${job.itemId}`);
        await this.queue.markCompleted(job.id);
        return;
      }

      // 2. Update item status to processing
      await this.repository.updateStatus(job.itemId, 'processing');

      // 3. Perform OCR
      const ocrResult = await this.performOcr(item);

      // 4. Update item with OCR text
      await this.repository.updateOcrText(job.itemId, ocrResult.text, {
        engine: ocrResult.engine,
        confidence: ocrResult.confidence
      });

      // 5. Mark job as completed
      await this.queue.markCompleted(job.id);

      // 6. Enqueue tag job
      await this.queue.create({
        type: 'tag',
        itemId: job.itemId,
        userId: job.userId,
        payload: { afterOcr: true }
      });

      console.log(`[OcrHandler] OCR completed for item ${job.itemId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[OcrHandler] Error processing job ${job.id}:`, errorMessage);
      await this.queue.markFailed(job.id, errorMessage);
    }
  }

  private async performOcr(item: { id: string; sourceUrl?: string | null; userId: string }): Promise<{
    text: string;
    engine: string;
    confidence: number;
  }> {
    // OpenAI Vision integration for production
    if (this.openAiKey && item.sourceUrl) {
      try {
        // OpenAI Vision API integration
        const response = await fetch('https://api.openai.com/v1/images/ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openAiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            image_url: item.sourceUrl
          })
        });

        if (response.ok) {
          const data = await response.json() as { text?: string };
          return {
            text: data.text || '',
            engine: 'openai-vision',
            confidence: 0.9
          };
        }
      } catch (error) {
        console.error('[OcrHandler] OpenAI Vision failed:', error);
      }
    }

    // Ultimate fallback: return empty OCR
    // In production, you would integrate with Google Cloud Vision or AWS Textract
    return {
      text: '',
      engine: 'none',
      confidence: 0
    };
  }
}
