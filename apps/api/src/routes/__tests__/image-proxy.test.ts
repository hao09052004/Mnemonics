import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageProxyHandler,
  isAllowedHost,
  isPrivateOrBlockedIp,
  isValidImageBytes
} from '../image-proxy.js';

describe('image-proxy security unit tests', () => {
  describe('isAllowedHost', () => {
    it('accepts exact allowed domains and subdomains', () => {
      expect(isAllowedHost('images.unsplash.com')).toBe(true);
      expect(isAllowedHost('unsplash.com')).toBe(true);
      expect(isAllowedHost('upload.wikimedia.org')).toBe(true);
      expect(isAllowedHost('facebook.com')).toBe(true);
      expect(isAllowedHost('sub.facebook.com')).toBe(true);
    });

    it('rejects domains outside allow-list', () => {
      expect(isAllowedHost('evil.com')).toBe(false);
      expect(isAllowedHost('localhost')).toBe(false);
      expect(isAllowedHost('attacker-unsplash.com')).toBe(false);
      expect(isAllowedHost('169.254.169.254')).toBe(false);
    });
  });

  describe('isPrivateOrBlockedIp', () => {
    it('blocks loopback IPv4 and IPv6', () => {
      expect(isPrivateOrBlockedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIp('127.10.0.1')).toBe(true);
      expect(isPrivateOrBlockedIp('::1')).toBe(true);
      expect(isPrivateOrBlockedIp('::ffff:127.0.0.1')).toBe(true);
    });

    it('blocks AWS / Cloud metadata link-local 169.254.169.254', () => {
      expect(isPrivateOrBlockedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrBlockedIp('169.254.1.1')).toBe(true);
    });

    it('blocks RFC 1918 private subnets', () => {
      expect(isPrivateOrBlockedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrBlockedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrBlockedIp('192.168.1.1')).toBe(true);
    });

    it('blocks Carrier-grade NAT 100.64.0.0/10', () => {
      expect(isPrivateOrBlockedIp('100.64.0.1')).toBe(true);
      expect(isPrivateOrBlockedIp('100.127.255.255')).toBe(true);
    });

    it('blocks IPv6 private / link-local / multicast', () => {
      expect(isPrivateOrBlockedIp('fc00::1')).toBe(true);
      expect(isPrivateOrBlockedIp('fd12:3456::1')).toBe(true);
      expect(isPrivateOrBlockedIp('fe80::1')).toBe(true);
      expect(isPrivateOrBlockedIp('ff02::1')).toBe(true);
    });

    it('allows legitimate public IPs', () => {
      expect(isPrivateOrBlockedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrBlockedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrBlockedIp('151.101.1.140')).toBe(false);
    });
  });

  describe('isValidImageBytes', () => {
    it('validates JPEG magic bytes (FF D8 FF)', () => {
      const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const invalid = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(isValidImageBytes(validJpeg, 'image/jpeg')).toBe(true);
      expect(isValidImageBytes(invalid, 'image/jpeg')).toBe(false);
    });

    it('validates PNG magic bytes', () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(isValidImageBytes(validPng, 'image/png')).toBe(true);
      expect(isValidImageBytes(validPng, 'image/jpeg')).toBe(false);
    });

    it('validates WebP magic bytes (RIFF....WEBP)', () => {
      const validWebp = Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'ascii')
      ]);
      expect(isValidImageBytes(validWebp, 'image/webp')).toBe(true);
      const invalidWebp = Buffer.from('RIFF1234TEXT', 'ascii');
      expect(isValidImageBytes(invalidWebp, 'image/webp')).toBe(false);
    });
  });
});

describe('imageProxyHandler route integration', () => {
  function createTestApp(deps: {
    validateHost?: (hostname: string) => Promise<boolean>;
    fetchFn?: typeof fetch;
  } = {}) {
    const app = express();
    app.get('/api/v1/proxy/image', createImageProxyHandler(deps));
    return app;
  }

  it('rejects missing url with 400', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/v1/proxy/image');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROXY_URL_REQUIRED');
  });

  it('rejects invalid protocol with 400', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/v1/proxy/image?url=file:///etc/passwd');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROXY_URL_PROTOCOL');
  });

  it('rejects non-allowlisted host with 403', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/v1/proxy/image?url=https://evil.com/image.png');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROXY_HOST_NOT_ALLOWED');
  });

  it('rejects host resolving to internal / loopback IP with 403', async () => {
    const app = createTestApp({
      validateHost: vi.fn(async () => false) // indicates DNS resolved to blocked private/internal IP
    });

    const res = await request(app).get('/api/v1/proxy/image?url=https://images.unsplash.com/test.jpg');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROXY_DESTINATION_BLOCKED');
  });

  it('rejects redirect to blocked destination', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Headers({
        location: 'http://169.254.169.254/latest/meta-data'
      })
    } as any);

    const app = createTestApp({
      validateHost: vi.fn(async (host: string) => host === 'images.unsplash.com'),
      fetchFn: mockFetch
    });

    const res = await request(app).get('/api/v1/proxy/image?url=https://images.unsplash.com/photo.jpg');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROXY_HOST_NOT_ALLOWED');
  });

  it('rejects oversized responses over 10 MB', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({
        'content-type': 'image/jpeg',
        'content-length': String(11 * 1024 * 1024)
      })
    } as any);

    const app = createTestApp({
      validateHost: vi.fn(async () => true),
      fetchFn: mockFetch
    });

    const res = await request(app).get('/api/v1/proxy/image?url=https://images.unsplash.com/giant.jpg');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PROXY_TOO_LARGE');
  });

  it('rejects non-image content-type with 415', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({
        'content-type': 'text/html'
      })
    } as any);

    const app = createTestApp({
      validateHost: vi.fn(async () => true),
      fetchFn: mockFetch
    });

    const res = await request(app).get('/api/v1/proxy/image?url=https://images.unsplash.com/index.html');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('PROXY_UNSUPPORTED_MEDIA');
  });

  it('rejects image with invalid magic bytes with 415', async () => {
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('<html><body>not an image</body></html>'));
        controller.close();
      }
    });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({
        'content-type': 'image/jpeg'
      }),
      body: fakeStream
    } as any);

    const app = createTestApp({
      validateHost: vi.fn(async () => true),
      fetchFn: mockFetch
    });

    const res = await request(app).get('/api/v1/proxy/image?url=https://images.unsplash.com/spoofed.jpg');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('PROXY_INVALID_IMAGE_CONTENT');
  });

  it('successfully proxies valid image with correct magic bytes and headers', async () => {
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(validJpeg);
        controller.close();
      }
    });

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({
        'content-type': 'image/jpeg',
        'content-length': String(validJpeg.length)
      }),
      body: fakeStream
    } as any);

    const app = createTestApp({
      validateHost: vi.fn(async () => true),
      fetchFn: mockFetch
    });

    const res = await request(app).get('/api/v1/proxy/image?url=https://images.unsplash.com/valid.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-mnemonics-proxy']).toBe('image');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.body).toEqual(validJpeg);
  });
});
