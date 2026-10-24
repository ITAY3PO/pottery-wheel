import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x + 0.5, y + 0.5, size);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const studio = [0x2a, 0x21, 0x1c, 255];
const clay = [0xc4, 0x62, 0x3a, 255];
const hole = [0xf3, 0xec, 0xdf, 255];

function pot(x, y, size, diameter) {
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  const outer = diameter / 2;
  const inner = outer * 0.34;
  if (d <= inner) return hole;
  if (d <= outer) return clay;
  return studio;
}

mkdirSync('public/icons', { recursive: true });

writeFileSync('public/icons/icon-192.png', png(192, (x, y, size) => pot(x, y, size, size * 0.78)));
writeFileSync('public/icons/icon-512.png', png(512, (x, y, size) => pot(x, y, size, size * 0.78)));
// Maskable icons keep the glyph inside the center 80% safe zone.
writeFileSync('public/icons/icon-maskable-192.png', png(192, (x, y, size) => pot(x, y, size, size * 0.62)));
writeFileSync('public/icons/icon-maskable-512.png', png(512, (x, y, size) => pot(x, y, size, size * 0.62)));
