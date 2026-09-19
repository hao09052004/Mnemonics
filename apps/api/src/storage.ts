import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ImageUpload = {
  storageKey: string;
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
};

export interface ImageStorage {
  upload(input: ImageUpload): Promise<void>;
  remove(storageKey: string): Promise<void>;
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
    }
  };
}