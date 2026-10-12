import type { Request, Response } from 'express';
import { URL } from 'node:url';

// Allow-list host suffixes for the image proxy. Anything outside this list
// is rejected to prevent SSRF (the proxy can reach internal infra from the
// API process, so we must not trust arbitrary client input).
const ALLOWED_HOST_SUFFIXES = [
  'fbcdn.net',
  'fbsbx.com',
  'facebook.com',
  'instagram.com',
  'cdninstagram.com',
  'scontent.xx.fbcdn.net',
  'scontent-',
  'ggpht.com',
  'gstatic.com',
  'googleusercontent.com',
  'redd.it',
  'imgur.com',
  'twimg.com',
  'pbs.twimg.com',
  'pinimg.com',
  'ytimg.com',
  'ggphnt',
  'wikipedia.org',
  'wikimedia.org',
  'upload.wikimedia.org',
  'unsplash.com',
  'images.unsplash.com'
];

function isAllowedHost(hostname: string) {
  const lower = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith('.' + suffix));
}

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same as the capture upload limit

export async function imageProxyHandler(request: Request, response: Response) {
  const rawUrl = typeof request.query.url === 'string' ? request.query.url : '';
  if (!rawUrl) {
    response.status(400).json({ error: { code: 'PROXY_URL_REQUIRED', message: 'Thiếu tham số ?url=' } });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    response.status(400).json({ error: { code: 'PROXY_URL_INVALID', message: 'URL không hợp lệ' } });
    return;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    response.status(400).json({ error: { code: 'PROXY_URL_PROTOCOL', message: 'Chỉ hỗ trợ http(s)' } });
    return;
  }

  if (!isAllowedHost(parsed.hostname)) {
    response.status(403).json({
      error: { code: 'PROXY_HOST_NOT_ALLOWED', message: 'Host không nằm trong allow-list của proxy' }
    });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        // Some CDNs return smaller/cached responses when they think the
        // client is a bot. Pretend to be a normal browser so we get the
        // full-size image.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    if (!upstream.ok) {
      response.status(upstream.status).json({
        error: { code: 'PROXY_UPSTREAM_ERROR', message: `Trang nguồn trả ${upstream.status}` }
      });
      return;
    }

    const mimeType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType.split(';')[0].trim())) {
      response.status(415).json({
        error: { code: 'PROXY_UNSUPPORTED_MEDIA', message: 'Proxy chỉ hỗ trợ jpg/png/webp' }
      });
      return;
    }

    const contentLengthHeader = upstream.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
      response.status(413).json({ error: { code: 'PROXY_TOO_LARGE', message: 'Ảnh vượt quá 10 MB' } });
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      response.status(413).json({ error: { code: 'PROXY_TOO_LARGE', message: 'Ảnh vượt quá 10 MB' } });
      return;
    }

    const buffer = Buffer.from(arrayBuffer);
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Cache-Control', 'private, max-age=300');
    // Allow the extension's dashboard (and any browser tab in the future)
    // to embed the proxied image via <img src>. Without this the browser
    // blocks the response as cross-origin and the card renders blank.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('X-Mnemonics-Proxy', 'image');
    response.status(200).send(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[image-proxy] upstream fetch failed:', message);
    response.status(502).json({
      error: { code: 'PROXY_UPSTREAM_UNREACHABLE', message: 'Proxy không tải được ảnh từ trang nguồn' }
    });
  }
}
