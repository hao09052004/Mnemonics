import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ImageUpload = {
  storageKey: string;
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

export interface ImageStorage {
  upload(input: ImageUpload): Promise<void>;
  remove(storageKey: string): Promise<void>;
  createSignedUrl(storageKey: string, expiresInSeconds: number): Promise<string | null>;
  // Public URL works without a signed token when the bucket is public.
  // Returned as a plain path so callers can decide how to compose the
  // origin (`https://<project>.supabase.co/...`). Returns null when the
  // bucket isn't public.
  createPublicUrl(storageKey: string): Promise<string | null>;
}

export function normalizeSupabaseUrl(value: string): string {
  const raw = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('SUPABASE_URL phải là URL project, ví dụ https://your-project.supabase.co');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SUPABASE_URL phải bắt đầu bằng http:// hoặc https://');
  }

  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function createSupabaseImageStorage(url: string, serviceRoleKey: string, bucket = 'mnemonics-assets'): ImageStorage {
  const client = createClient(normalizeSupabaseUrl(url), serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return createImageStorage(client, bucket);
}

function createImageStorage(client: SupabaseClient, bucket: string): ImageStorage {
  // Cache the bucket's public flag so we don't issue a metadata request
  // on every signed-URL call. `undefined` = not yet checked, `null` =
  // bucket not found, `true`/`false` = public status.
  let publicBucketCache: boolean | null | undefined = undefined;

  async function isBucketPublic(): Promise<boolean> {
    if (publicBucketCache !== undefined) return publicBucketCache === true;
    try {
      // The Storage client doesn't expose a "getBucket" method, but
      // listBuckets + name lookup is cheap enough to cache.
      const { data } = await client.storage.listBuckets();
      const found = (data || []).find(b => b.name === bucket);
      publicBucketCache = found ? Boolean(found.public) : false;
    } catch {
      publicBucketCache = false;
    }
    return publicBucketCache === true;
  }

  return {
    async upload({ storageKey, buffer, mimeType }) {
      const { error } = await client.storage.from(bucket).upload(storageKey, buffer, {
        contentType: mimeType,
        upsert: false
      });
      if (error) throw new Error(`IMAGE_UPLOAD_FAILED: ${error.message}`);
    },
    async remove(storageKey) {
      await client.storage.from(bucket).remove([storageKey]);
    },
    async createSignedUrl(storageKey, expiresInSeconds) {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(storageKey, expiresInSeconds);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },
    async createPublicUrl(storageKey) {
      // Don't hand back a public URL when the bucket is private — the
      // browser would just receive a 400 and the user would think the
      // image is broken. Returning null lets the caller fall back to
      // the placeholder path.
      if (!(await isBucketPublic())) return null;
      const { data } = client.storage.from(bucket).getPublicUrl(storageKey);
      return data?.publicUrl || null;
    }
  };
}