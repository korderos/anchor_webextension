// Renders the extension icons (an anchor on a rounded square) to PNG with no
// dependencies: shapes are signed-distance functions, supersampled for AA.
// Usage: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const SIZES = [16, 32, 48, 128];
const BG = [204, 95, 45]; // Anchor accent (#cc5f2d)
const FG = [255, 255, 255];

const len = (x, y) => Math.hypot(x, y);
function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return len(px - ax - dx * t, py - ay - dy * t);
}
function roundedBox(px, py, half, r) {
  const qx = Math.abs(px) - half + r, qy = Math.abs(py) - half + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Coordinates in [-1, 1], y down. Returns true when inside the anchor glyph.
function anchor(x, y) {
  const w = 0.085; // stroke half-width
  const ring = Math.abs(len(x, y + 0.56) - 0.14) < w;
  const shaft = segment(x, y, 0, -0.42, 0, 0.62) < w;
  const bar = segment(x, y, -0.3, -0.18, 0.3, -0.18) < w;
  // Lower arc: circle centred above the base, only its bottom half.
  const arc = Math.abs(len(x, y - 0.08) - 0.54) < w && y > 0.08;
  // Arrow-like flukes at the arc ends.
  const fl = segment(x, y, -0.54, 0.08, -0.66, -0.06) < w || segment(x, y, -0.54, 0.08, -0.38, 0.0) < w;
  const fr = segment(x, y, 0.54, 0.08, 0.66, -0.06) < w || segment(x, y, 0.54, 0.08, 0.38, 0.0) < w;
  return ring || shaft || bar || arc || fl || fr;
}

function render(size) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bgCov = 0, fgCov = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = ((i + (si + 0.5) / ss) / size) * 2 - 1;
          const y = ((j + (sj + 0.5) / ss) / size) * 2 - 1;
          if (roundedBox(x, y, 1, 0.42) <= 0) {
            bgCov++;
            // Slightly shrink the glyph on tiny icons so strokes stay legible.
            const k = size <= 16 ? 1.12 : 1.22;
            if (anchor(x * k, y * k)) fgCov++;
          }
        }
      }
      const n = ss * ss, o = (j * size + i) * 4;
      const a = bgCov / n, f = bgCov ? fgCov / bgCov : 0;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      px[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, px);
}

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
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const s of SIZES) writeFileSync(join(OUT, `icon-${s}.png`), render(s));
console.log(`Wrote ${SIZES.length} icons to ${OUT}`);
