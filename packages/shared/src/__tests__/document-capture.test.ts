import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  captureInputSchema,
  captureTypes,
  documentMimeTypes,
  documentReferenceSchema,
  normalizeCapture
} from '../index.js';

const validUuid = '11111111-1111-4111-8111-111111111111';
const pdfBase = (overrides?: Record<string, unknown>) => ({
  storageKey: 'pending-upload',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  originalFilename: 'paper.pdf',
  ...overrides
});
const txtBase = (overrides?: Record<string, unknown>) => ({
  storageKey: 'pending-upload',
  mimeType: 'text/plain',
  sizeBytes: 1024,
  originalFilename: 'notes.txt',
  ...overrides
});
const mdBase = (overrides?: Record<string, unknown>) => ({
  storageKey: 'pending-upload',
  mimeType: 'text/markdown',
  sizeBytes: 1024,
  originalFilename: 'notes.md',
  ...overrides
});

const validPdfPayload = (overrides?: Record<string, unknown>) => ({
  type: 'document',
  title: 'A research paper',
  document: pdfBase((overrides?.document ?? {}) as Record<string, unknown>),
  clientRequestId: validUuid,
  ...overrides
});

describe('documentReferenceSchema', () => {
  it('accepts application/pdf', () => {
    expect(() => documentReferenceSchema.parse(pdfBase())).not.toThrow();
  });

  it('accepts text/plain', () => {
    expect(() => documentReferenceSchema.parse(txtBase())).not.toThrow();
  });

  it('accepts text/markdown', () => {
    expect(() => documentReferenceSchema.parse(mdBase())).not.toThrow();
  });

  it('rejects an unsupported MIME', () => {
    const result = documentReferenceSchema.safeParse({
      storageKey: 'k',
      mimeType: 'application/zip',
      sizeBytes: 1024
    });
    expect(result.success).toBe(false);
  });

  it('rejects an oversized document', () => {
    const result = documentReferenceSchema.safeParse({
      storageKey: 'k',
      mimeType: 'application/pdf',
      sizeBytes: 30 * 1024 * 1024
    });
    expect(result.success).toBe(false);
  });

  it('rejects a zero-byte document', () => {
    const result = documentReferenceSchema.safeParse({
      storageKey: 'k',
      mimeType: 'application/pdf',
      sizeBytes: 0
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty storage key', () => {
    const result = documentReferenceSchema.safeParse({
      storageKey: '',
      mimeType: 'application/pdf',
      sizeBytes: 1
    });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long original filename', () => {
    const result = documentReferenceSchema.safeParse(pdfBase({
      originalFilename: 'x'.repeat(300)
    }));
    expect(result.success).toBe(false);
  });
});

describe('captureInputSchema with document variants', () => {
  it('accepts a valid PDF payload', () => {
    expect(() => captureInputSchema.parse(validPdfPayload())).not.toThrow();
  });

  it('accepts a valid TXT payload', () => {
    expect(() => captureInputSchema.parse(validPdfPayload({ document: txtBase() }))).not.toThrow();
  });

  it('accepts a valid Markdown payload', () => {
    expect(() => captureInputSchema.parse(validPdfPayload({ document: mdBase() }))).not.toThrow();
  });

  it('rejects an unsupported MIME', () => {
    const result = captureInputSchema.safeParse(validPdfPayload({
      document: { ...pdfBase(), mimeType: 'application/zip' as unknown as 'application/pdf' }
    }));
    expect(result.success).toBe(false);
  });

  it('requires the clientRequestId', () => {
    const payload = validPdfPayload();
    delete (payload as Record<string, unknown>).clientRequestId;
    const result = captureInputSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts optional selectedText for a document', () => {
    const result = captureInputSchema.parse(validPdfPayload({ selectedText: 'a short annotation' }));
    expect(result.type).toBe('document');
  });

  it('rejects a non-uuid clientRequestId', () => {
    const result = captureInputSchema.safeParse(validPdfPayload({
      clientRequestId: 'not-a-uuid'
    }));
    expect(result.success).toBe(false);
  });
});

describe('captureTypes registry', () => {
  it('includes document as a capture type', () => {
    expect(captureTypes).toContain('document');
  });

  it('documentMimeTypes has exactly the supported set', () => {
    expect([...documentMimeTypes].sort()).toEqual(
      ['application/pdf', 'text/markdown', 'text/plain'].sort()
    );
  });
});

describe('normalizeCapture with document', () => {
  it('preserves the document kind and clientRequestId', () => {
    const parsed = captureInputSchema.parse(validPdfPayload());
    const normalized = normalizeCapture(parsed);
    expect(normalized.type).toBe('document');
    expect(normalized.clientRequestId).toBe(parsed.clientRequestId);
    expect(normalized.rawText).toBeNull();
  });
});

describe('regression — existing kinds still validate', () => {
  it('link payload still validates', () => {
    const result = captureInputSchema.safeParse({
      type: 'link',
      title: 'Example',
      sourceUrl: 'https://example.com',
      clientRequestId: '22222222-2222-4222-8222-222222222222'
    });
    expect(result.success).toBe(true);
  });

  it('image payload still validates', () => {
    const result = captureInputSchema.safeParse({
      type: 'image',
      title: 'Image',
      image: { storageKey: 'pending', mimeType: 'image/png', sizeBytes: 3 },
      clientRequestId: '55555555-5555-4555-8555-555555555555'
    });
    expect(result.success).toBe(true);
  });

  it('screenshot payload still validates', () => {
    const result = captureInputSchema.safeParse({
      type: 'screenshot',
      title: 'Screenshot',
      image: { storageKey: 'pending', mimeType: 'image/jpeg', sizeBytes: 3 },
      clientRequestId: '66666666-6666-4666-8666-666666666666'
    });
    expect(result.success).toBe(true);
  });

  it('text payload still validates', () => {
    const result = captureInputSchema.safeParse({
      type: 'text',
      title: 'Note',
      selectedText: 'hello world',
      clientRequestId: '77777777-7777-4777-8777-777777777777'
    });
    expect(result.success).toBe(true);
  });
});

// `z` is re-exported so downstream packages can write their own
// refinements against the document contract without pulling zod
// twice from two paths.
it('z is available for downstream refinements', () => {
  expect(typeof z.string).toBe('function');
});