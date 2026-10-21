import type { Request, Response } from 'express';
import { URL } from 'node:url';
import * as net from 'node:net';
import * as dns from 'node:dns/promises';

// Allow-list host suffixes for the image proxy. Anything outside this list
// is rejected to prevent SSRF (the proxy can reach internal infra from the
// API process, so we must not trust arbitrary client input).
export const ALLOWED_HOST_SUFFIXES = [
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

export function isAllowedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith('.' + suffix));
}

export function isPrivateOrBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 0) return true; // invalid IP

  if (version === 4) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b, c, d] = parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private network RFC 1918)
    if (a === 10) return true;
    // 100.64.0.0/10 (Carrier-grade NAT RFC 6598)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback RFC 1122)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud Instance Metadata RFC 3927)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private network RFC 1918)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments RFC 6890)
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
    if (a === 192 && b === 0 && c === 2) return true;
    // 192.168.0.0/16 (Private network RFC 1918)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Network benchmark RFC 2544)
    if (a === 198 && b >= 18 && b <= 19) return true;
    // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 (Multicast RFC 5771)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved RFC 1112)
    if (a >= 240) return true;
    // 255.255.255.255 (Broadcast RFC 919)
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;

    return false;
  }

  if (version === 6) {
    const lower = ip.toLowerCase();

    // Check for IPv4-mapped IPv6: ::ffff:192.0.2.128
    if (lower.startsWith('::ffff:')) {
      const rest = lower.slice(7);
      if (net.isIPv4(rest)) {
        return isPrivateOrBlockedIp(rest);
      }
    }

    // Loopback ::1
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // Unique Local Address fc00::/7
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local Unicast fe80::/10
    if (/^fe[89ab]/i.test(lower)) return true;
    // Multicast ff00::/8
    if (lower.startsWith('ff')) return true;

    return false;
  }

  return true;
}

export async function validateHostResolution(hostname: string): Promise<boolean> {
  // If the hostname itself is an IP literal
  if (net.isIP(hostname)) {
    return !isPrivateOrBlockedIp(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return false;
    }
    for (const record of records) {
      if (isPrivateOrBlockedIp(record.address)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function isValidImageBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 8) return false;
  const cleanMime = mimeType.toLowerCase();

  // JPEG: FF D8 FF
  if (cleanMime === 'image/jpeg' || cleanMime === 'image/jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (cleanMime === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  // WebP: RIFF .... WEBP
  if (cleanMime === 'image/webp') {
    if (buffer.length < 12) return false;
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }
  return false;
}

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — same as the capture upload limit
export const MAX_REDIRECTS = 3;
export const UPSTREAM_TIMEOUT_MS = 8000;

export interface ImageProxyDeps {
  validateHost?: (hostname: string) => Promise<boolean>;
  fetchFn?: typeof fetch;
}

export function createImageProxyHandler(deps: ImageProxyDeps = {}) {
  const validateHost = deps.validateHost ?? validateHostResolution;
  const doFetch = deps.fetchFn ?? globalThis.fetch;

  return async function imageProxyHandler(request: Request, response: Response): Promise<void> {
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

    let currentUrl = parsed;
    let redirectCount = 0;
    let upstream: globalThis.Response | null = null;

    try {
      while (redirectCount <= MAX_REDIRECTS) {
        if (!isAllowedHost(currentUrl.hostname)) {
          response.status(403).json({
            error: { code: 'PROXY_HOST_NOT_ALLOWED', message: 'Host không nằm trong allow-list của proxy' }
          });
          return;
        }

        const isSafe = await validateHost(currentUrl.hostname);
        if (!isSafe) {
          response.status(403).json({
            error: { code: 'PROXY_DESTINATION_BLOCKED', message: 'Địa chỉ đích bị chặn (internal / private IP)' }
          });
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

        try {
          upstream = await doFetch(currentUrl.toString(), {
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
          });
        } finally {
          clearTimeout(timeoutId);
        }

        // Handle HTTP redirects (301, 302, 303, 307, 308)
        if (upstream.status >= 300 && upstream.status < 400) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            response.status(502).json({
              error: { code: 'PROXY_TOO_MANY_REDIRECTS', message: 'Vượt quá số lần chuyển hướng cho phép' }
            });
            return;
          }

          const location = upstream.headers.get('location');
          if (!location) {
            response.status(502).json({
              error: { code: 'PROXY_UPSTREAM_ERROR', message: 'Chuyển hướng thiếu Location header' }
            });
            return;
          }

          try {
            currentUrl = new URL(location, currentUrl);
          } catch {
            response.status(502).json({
              error: { code: 'PROXY_URL_INVALID', message: 'Location chuyển hướng không hợp lệ' }
            });
            return;
          }

          if (currentUrl.protocol !== 'https:' && currentUrl.protocol !== 'http:') {
            response.status(400).json({
              error: { code: 'PROXY_URL_PROTOCOL', message: 'Chỉ hỗ trợ http(s)' }
            });
            return;
          }

          continue;
        }

        break;
      }

      if (!upstream) {
        response.status(502).json({
          error: { code: 'PROXY_UPSTREAM_ERROR', message: 'Không thể kết nối tới trang nguồn' }
        });
        return;
      }

      if (!upstream.ok) {
        response.status(upstream.status).json({
          error: { code: 'PROXY_UPSTREAM_ERROR', message: `Trang nguồn trả ${upstream.status}` }
        });
        return;
      }

      const mimeType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
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

      if (!upstream.body) {
        response.status(502).json({
          error: { code: 'PROXY_EMPTY_BODY', message: 'Trang nguồn không trả dữ liệu' }
        });
        return;
      }

      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > MAX_BYTES) {
              await reader.cancel();
              response.status(413).json({ error: { code: 'PROXY_TOO_LARGE', message: 'Ảnh vượt quá 10 MB' } });
              return;
            }
            chunks.push(value);
          }
        }
      } catch {
        response.status(502).json({
          error: { code: 'PROXY_STREAM_ERROR', message: 'Lỗi khi đọc luồng dữ liệu ảnh từ trang nguồn' }
        });
        return;
      }

      const buffer = Buffer.concat(chunks);

      if (!isValidImageBytes(buffer, mimeType)) {
        response.status(415).json({
          error: { code: 'PROXY_INVALID_IMAGE_CONTENT', message: 'Dữ liệu không khớp với định dạng ảnh yêu cầu' }
        });
        return;
      }

      response.setHeader('Content-Type', mimeType);
      response.setHeader('Cache-Control', 'private, max-age=300');
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
  };
}

export const imageProxyHandler = createImageProxyHandler();
