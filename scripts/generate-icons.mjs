// Generates the extension icon set (public/icon/{16,32,48,128}.png) without
// external dependencies. Run with: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + radius, Math.min(right - radius, x));
  const cy = Math.max(top + radius, Math.min(bottom - radius, y));
  return Math.hypot(x - cx, y - cy) <= radius;
}

// Icon: blue rounded square, two white "form field" bars, and a green-circled check.
function samplePixel(u, v) {
  if (!insideRoundedRect(u, v, 0.02, 0.02, 0.98, 0.98, 0.22)) return [0, 0, 0, 0];
  const topColor = [59, 130, 246];
  const bottomColor = [29, 78, 216];
  let r = topColor[0] + (bottomColor[0] - topColor[0]) * v;
  let g = topColor[1] + (bottomColor[1] - topColor[1]) * v;
  let b = topColor[2] + (bottomColor[2] - topColor[2]) * v;

  const bars = [
    { left: 0.2, top: 0.24, right: 0.8, bottom: 0.36 },
    { left: 0.2, top: 0.46, right: 0.62, bottom: 0.58 }
  ];
  for (const bar of bars) {
    if (insideRoundedRect(u, v, bar.left, bar.top, bar.right, bar.bottom, 0.05)) {
      r = 255;
      g = 255;
      b = 255;
    }
  }

  const badge = { cx: 0.68, cy: 0.72, radius: 0.21 };
  if (Math.hypot(u - badge.cx, v - badge.cy) <= badge.radius) {
    r = 22;
    g = 163;
    b = 74;
    const check =
      distanceToSegment(u, v, 0.585, 0.725, 0.655, 0.795) < 0.035 ||
      distanceToSegment(u, v, 0.655, 0.795, 0.775, 0.645) < 0.035;
    if (check) {
      r = 255;
      g = 255;
      b = 255;
    }
  }
  return [r, g, b, 255];
}

function renderIcon(size) {
  const grid = size * SUPERSAMPLE;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const u = (x * SUPERSAMPLE + sx + 0.5) / grid;
          const v = (y * SUPERSAMPLE + sy + 0.5) / grid;
          const [pr, pg, pb, pa] = samplePixel(u, v);
          r += pr * (pa / 255);
          g += pg * (pa / 255);
          b += pb * (pa / 255);
          a += pa;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      const offset = (y * size + x) * 4;
      rgba[offset] = alpha > 0 ? Math.round(r / samples / (alpha / 255)) : 0;
      rgba[offset + 1] = alpha > 0 ? Math.round(g / samples / (alpha / 255)) : 0;
      rgba[offset + 2] = alpha > 0 ? Math.round(b / samples / (alpha / 255)) : 0;
      rgba[offset + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, renderIcon(size));
  console.log(`Wrote ${file}`);
}
