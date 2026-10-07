// Minimal type stub for `pdf-parse`. The package has no published
// typings and only exposes a single async function that takes a
// Buffer and returns a structured result. We declare only the fields
// we actually consume so the surface is small and audit-friendly.

declare module 'pdf-parse/lib/pdf-parse.js' {
  import type { Buffer } from 'node:buffer';
  export interface PdfParseResult {
    numpages: number;
    info: Record<string, unknown> | null;
    metadata: unknown;
    text: string;
  }
  const fn: (buffer: Buffer, options?: Record<string, unknown>) => Promise<PdfParseResult>;
  export default fn;
}