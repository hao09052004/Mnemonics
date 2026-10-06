/**
 * Image pre-processor for OCR.
 *
 * Runs Sharp on the raw bytes we pull out of object storage so we
 * hand the OCR provider the smallest image that still preserves the
 * text we want to read:
 *   - auto-rotate (EXIF orientation)
 *   - clamp the longest side to MAX_DIMENSION (default 2000px)
 *   - re-encode at quality=82 jpeg unless the file is a PNG (png is
 *     lossless and is preserved)
 *   - strip metadata that isn't useful to OCR
 *
 * Sharp is loaded lazily so unit tests that don't exercise this path
 * don't pay the binary cost. If sharp is not installed, we return the
 * original bytes — the OCR provider can still try.
 *
 * The original high-quality asset is left untouched in storage. We
 * never overwrite it.
 */

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 82;

export interface PrepOptions {
  /** Force this mime type on the result. Defaults to input mimeType. */
  mimeType?: string;
}

export interface PrepResult {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}

// Minimal structural type for the Sharp function. We avoid pulling
// in @types/sharp so the build stays decoupled from the optional
// dependency. Only the chain we actually use is typed.
type SharpPipeline = {
  rotate: () => {
    resize: (opts: {
      width: number;
      height: number;
      fit: string;
      withoutEnlargement: boolean;
    }) => {
      jpeg: (opts: { quality: number; mozjpeg: boolean }) => { toBuffer: () => Promise<Buffer> };
      png: (opts: { compressionLevel: number }) => { toBuffer: () => Promise<Buffer> };
      webp: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> };
    };
  };
  metadata: () => Promise<{ width?: number; height?: number }>;
};

type SharpFn = {
  (input?: Buffer | Uint8Array): SharpPipeline;
};

async function loadSharp(): Promise<SharpFn | null> {
  try {
    // Optional peer-style dep, may be absent in some test envs.
    // sharp exports the function as the default ESM module AND as
    // the namespace itself under CJS interop. Both shapes are
    // handled here.
    const mod = (await import("sharp")) as unknown as {
      default?: SharpFn;
    } & Record<string, unknown>;
    if (typeof mod.default === "function") return mod.default;
    const fnCandidate = mod as unknown as SharpFn;
    if (typeof (fnCandidate as unknown as (...args: unknown[]) => unknown) === "function") {
      return fnCandidate;
    }
    return null;
  } catch {
    return null;
  }
}

export async function prepareForOcr(
  input: Uint8Array,
  inputMime: string,
  _opts?: PrepOptions
): Promise<PrepResult> {
  const sharp = await loadSharp();
  if (!sharp) {
    return { bytes: input, mimeType: inputMime };
  }
  try {
    const pipeline = sharp(Buffer.from(input))
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    let out: Buffer;
    let outMime = inputMime;
    if (inputMime === "image/png") {
      out = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      outMime = "image/png";
    } else if (inputMime === "image/webp") {
      out = await pipeline.webp({ quality: JPEG_QUALITY }).toBuffer();
      outMime = "image/webp";
    } else {
      // Default to jpeg for jpeg + everything else.
      out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: false }).toBuffer();
      outMime = "image/jpeg";
    }
    const meta = await sharp(out).metadata();
    return {
      bytes: new Uint8Array(out),
      mimeType: outMime,
      width: meta.width,
      height: meta.height,
    };
  } catch {
    // Sharp failed (e.g. unsupported image format). Hand the original
    // bytes back rather than losing the capture.
    return { bytes: input, mimeType: inputMime };
  }
}