#!/usr/bin/env node
// Generates the pixel-art copper ingot cursors (site/assets/cursor*.png).
// Run once: node scripts/make-cursor.mjs   (no dependencies; tiny PNG encoder below)
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 16x16 sprite, drawn at 2x (32x32 cursor). The ingot lies diagonally,
// its top-left corner (pixel 1,1 → 2,2 at 2x) is the hotspot. Legend:
//   . transparent   K outline   W shine   H highlight   L light   M copper   D shadow
const SPRITE = [
  '.KKKK...........',
  'KWWWWK..........',
  'KLWWWWK.........',
  'KMLWWWHK........',
  'KDMLWHHHK.......',
  '.KDMLHHHHK......',
  '..KDMLHHHHK.....',
  '...KDMLHHHHK....',
  '....KDMLHHHHK...',
  '.....KDMLHHHHK..',
  '......KDMLHHHK..',
  '.......KDMLHHK..',
  '........KDMLHK..',
  '.........KDMLK..',
  '..........KKKK..',
  '................',
];

const PALETTES = {
  cursor: { K: '2a1608', W: 'ffd9bd', H: 'e49a68', L: 'f0b080', M: 'b87333', D: '6a3c17' },
  // Brighter, verdigris-rimmed ingot for links and buttons.
  'cursor-hover': { K: '1f6f6b', W: 'fff1e4', H: 'f3b58c', L: 'ffd0aa', M: 'da8a67', D: '8d5426' },
};

const SCALE = 2;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, pal] of Object.entries(PALETTES)) {
  const size = 16 * SCALE;
  const rgba = Buffer.alloc(size * size * 4);
  SPRITE.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const hex = pal[ch];
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const i = ((y * SCALE + dy) * size + (x * SCALE + dx)) * 4;
          rgba[i] = parseInt(hex.slice(0, 2), 16);
          rgba[i + 1] = parseInt(hex.slice(2, 4), 16);
          rgba[i + 2] = parseInt(hex.slice(4, 6), 16);
          rgba[i + 3] = 255;
        }
      }
    });
  });
  const out = join(root, `site/assets/${name}.png`);
  writeFileSync(out, png(size, size, rgba));
  console.log('wrote', out);
}
