// Generate dark-background Mnemonics icons (16, 48, 128) to replace
// the previous white-background icons. Dark icons force Chrome / Edge
// to render the OS notification surface against a darker palette so
// the white notification text stays legible.
//
// Self-contained: only Node built-ins (zlib + fs).
//
// Run:  node apps/extension/scripts/build-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..');
mkdirSync(outDir, { recursive: true });

// Brand palette from apps/extension/styles/tokens.css
const BRAND_TOP   = hex('#9c87f3'); // lighter violet (top)
const BRAND_BOT   = hex('#5e44d1'); // deeper violet (bottom)
const STAR_DOT    = hex('#c5b8fa'); // highlight dot
const GLYPH       = hex('#ffffff'); // M glyph
const OUTLINE     = hex('#ffffff');

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);

  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.46;
  const rStar  = size * 0.18;
  const sCx = size * 0.78;
  const sCy = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const sdist = Math.hypot(x - sCx, y - sCy);

      if (dist <= rOuter) {
        // Vertical brand gradient
        const t = Math.max(0, Math.min(1, y / size));
        px[idx]     = lerp(BRAND_TOP[0], BRAND_BOT[0], t);
        px[idx + 1] = lerp(BRAND_TOP[1], BRAND_BOT[1], t);
        px[idx + 2] = lerp(BRAND_TOP[2], BRAND_BOT[2], t);
        px[idx + 3] = 255;
      } else if (sdist <= rStar) {
        px[idx]     = STAR_DOT[0];
        px[idx + 1] = STAR_DOT[1];
        px[idx + 2] = STAR_DOT[2];
        px[idx + 3] = 255;
      } else {
        // Fully transparent → OS notification surface shows through
        px[idx + 3] = 0;
      }
    }
  }

  // Draw the M glyph: a simple centred letter using a small bitmap.
  drawM(px, size, OUTLINE);

  return encodePng(size, size, px);
}

function drawM(px, size, [r, g, b, a]) {
  // 7-wide stroke bitmap of the letter M, scaled to fit ~70 % of icon.
  // Designed at a 5x7 grid and scaled to icon size.
  // #
  // ##
  // # #
  // #  #
  // #   #
  // #   #
  // #   #
  const bitmap = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
  ];
  // Scale factor: target ~ 50 % width
  const targetW = Math.max(3, Math.floor(size * 0.45));
  const cellW = Math.max(1, Math.floor(targetW / 5));
  const targetH = cellW * 7;
  const startX = Math.floor((size - cellW * 5) / 2);
  const startY = Math.floor((size - targetH) / 2);
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (!bitmap[row][col]) continue;
      for (let py = 0; py < cellW; py++) {
        for (let px2 = 0; px2 < cellW; px2++) {
          const x = startX + col * cellW + px2;
          const y = startY + row * cellW + py;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const idx = (y * size + x) * 4;
          px[idx]     = r;
          px[idx + 1] = g;
          px[idx + 2] = b;
          px[idx + 3] = a;
        }
      }
    }
  }
}

// Minimal RGBA → PNG encoder (8-bit, no filter optimisation, no chunks
// beyond the minimum IHDR + IDAT + IEND). Sufficient for icons.
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type RGBA
  ihdr[10] = 0;    // compression
  ihdr[11] = 0;    // filter
  ihdr[12] = 0;    // interlace

  // Pre-filter: none (0). Insert one filter byte per row.
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy
      ? rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
        .copy(filtered, y * (stride + 1) + 1);
  }
  const idat = deflateSync(filtered);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function hex(h) {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
}
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

for (const size of [16, 48, 128]) {
  const buf = renderIcon(size);
  const dest = join(outDir, `icon${size}.png`);
  writeFileSync(dest, buf);
  console.log(`✓ wrote ${dest} (${buf.length} bytes)`);
}