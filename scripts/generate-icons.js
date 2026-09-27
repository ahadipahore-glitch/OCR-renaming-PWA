import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Create clean SVG brand icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
  </defs>
  <!-- Background Rounded Rect -->
  <rect width="512" height="512" rx="112" fill="url(#blueGrad)" />
  <!-- CAD Grid lines -->
  <path d="M64 160h384M64 256h384M64 352h384M160 64v384M256 64v384M352 64v384" stroke="rgba(255,255,255,0.08)" stroke-width="2" />
  <!-- Document Sheet -->
  <rect x="110" y="90" width="292" height="332" rx="16" fill="#ffffff" filter="drop-shadow(0 12px 24px rgba(0,0,0,0.3))" />
  <!-- Sheet header -->
  <rect x="140" y="125" width="130" height="14" rx="4" fill="#94a3b8" />
  <rect x="140" y="150" width="232" height="8" rx="3" fill="#cbd5e1" />
  <rect x="140" y="168" width="190" height="8" rx="3" fill="#cbd5e1" />
  <!-- OCR Zone Bounding Box Highlight -->
  <rect x="140" y="210" width="232" height="90" rx="8" fill="rgba(37,99,235,0.08)" stroke="#2563eb" stroke-width="3" stroke-dasharray="8 4" />
  <!-- OCR Brackets -->
  <path d="M135 225v-20h20 M357 205h20v20 M135 285v20h20 M357 305h20v-20" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" />
  <!-- OCR Text inside box -->
  <rect x="160" y="235" width="100" height="12" rx="3" fill="#2563eb" />
  <rect x="160" y="258" width="180" height="10" rx="3" fill="#64748b" />
  <!-- Bottom Title Block -->
  <rect x="230" y="325" width="142" height="70" rx="4" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2" />
  <rect x="242" y="340" width="70" height="8" rx="2" fill="#64748b" />
  <rect x="242" y="356" width="118" height="12" rx="3" fill="#1e293b" />
  <rect x="242" y="376" width="50" height="6" rx="2" fill="#94a3b8" />
  <!-- Checkmark / Scan Badge -->
  <circle cx="395" cy="115" r="26" fill="#10b981" />
  <path d="M386 115l6 6 12-12" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent);
console.log('Created icon.svg');

// Helper to create uncompressed standard PNG
function createPngBuffer(width, height, isMaskable = false) {
  // Simple solid blue PNG with white sheet and text
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: 6 (RGBA)
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Generate image data (width * height * 4 + height filter bytes)
  const rawBytes = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;

  const bgR = 37, bgG = 99, bgB = 235; // #2563eb
  const sheetR = 255, sheetG = 255, sheetB = 255;
  const darkR = 15, darkG = 23, darkB = 42;
  const cyanR = 56, cyanG = 189, cyanB = 248;

  // Safe margin for maskable icon
  const margin = isMaskable ? Math.round(width * 0.15) : Math.round(width * 0.1);

  for (let y = 0; y < height; y++) {
    rawBytes[offset++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      let r = bgR, g = bgG, b = bgB, a = 255;

      // Draw document sheet in center
      if (x >= margin && x < width - margin && y >= margin && y < height - margin) {
        // Inside sheet
        r = sheetR; g = sheetG; b = sheetB;

        // Inner header bar
        if (y >= margin + 15 && y <= margin + 35 && x >= margin + 20 && x <= margin + 140) {
          r = bgR; g = bgG; b = bgB;
        }

        // Title block in bottom right
        if (y >= height - margin - 80 && y <= height - margin - 20 && x >= width - margin - 140 && x <= width - margin - 20) {
          r = 241; g = 245; b = 249;
          if (y >= height - margin - 60 && y <= height - margin - 45 && x >= width - margin - 120 && x <= width - margin - 30) {
            r = darkR; g = darkG; b = darkB;
          }
        }

        // Center OCR zone border
        const zLeft = margin + 30, zRight = width - margin - 30;
        const zTop = Math.round(height * 0.4), zBottom = Math.round(height * 0.65);
        if (
          ((x >= zLeft && x <= zRight) && (y === zTop || y === zBottom || y === zTop + 1 || y === zBottom - 1)) ||
          ((y >= zTop && y <= zBottom) && (x === zLeft || x === zRight || x === zLeft + 1 || x === zRight - 1))
        ) {
          r = bgR; g = bgG; b = bgB;
        } else if (x > zLeft && x < zRight && y > zTop && y < zBottom) {
          // Inside OCR zone
          if (y >= zTop + 15 && y <= zTop + 30 && x >= zLeft + 20 && x <= zLeft + 120) {
            r = cyanR; g = cyanG; b = cyanB;
          } else {
            r = 239; g = 246; b = 255;
          }
        }
      }

      rawBytes[offset++] = r;
      rawBytes[offset++] = g;
      rawBytes[offset++] = b;
      rawBytes[offset++] = a;
    }
  }

  const idatCompressed = zlib.deflateSync(rawBytes);
  const idatChunk = makeChunk('IDAT', idatCompressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeInt32BE(crc, 8 + len);
  return chunk;
}

// Standard CRC32 table
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ -1;
}

// Generate PNGs
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPngBuffer(192, 192, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPngBuffer(512, 512, false));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPngBuffer(512, 512, true));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPngBuffer(180, 180, false));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), createPngBuffer(32, 32, false));

console.log('Generated all PWA compliant PNG icons and favicon in public/');
