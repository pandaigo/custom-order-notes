import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });

// Custom Order Notes アイコン: クリップボード + チェックリスト
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#5FA3E8"/>
      <stop offset="100%" style="stop-color:#3A7BC8"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="26" fill="url(#bg)"/>

  <!-- clipboard board -->
  <rect x="34" y="32" width="60" height="68" rx="6" fill="#ffffff"/>
  <!-- clip top -->
  <rect x="50" y="22" width="28" height="14" rx="3" fill="#ffffff" stroke="#3A7BC8" stroke-width="3"/>

  <!-- checklist rows -->
  <circle cx="44" cy="54" r="4" fill="#3A7BC8"/>
  <path d="M41.5 54 L43.5 56 L46.5 52" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="52" y="51" width="34" height="6" rx="2" fill="#cfdde9"/>

  <circle cx="44" cy="70" r="4" fill="#3A7BC8"/>
  <path d="M41.5 70 L43.5 72 L46.5 68" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="52" y="67" width="28" height="6" rx="2" fill="#cfdde9"/>

  <circle cx="44" cy="86" r="4" fill="none" stroke="#cfdde9" stroke-width="2"/>
  <rect x="52" y="83" width="32" height="6" rx="2" fill="#e6edf4"/>
</svg>`;

for (const size of [16, 48, 128]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon${size}.png`));
  console.log(`Generated icon${size}.png`);
}
