// CWS プロモタイル（440x280）と スクリーンショット5枚（1280x800）を生成
// SVG で作成 → sharp で PNG 化、Figma で微調整可能
import sharp from 'sharp';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'store');
mkdirSync(outDir, { recursive: true });

// プロモタイル 440x280
// メモリ「CWSスクショに価格を見せるのは信頼ブースター」を踏まえ、プロモタイルには値段は載せない
// （CWS 検索結果一覧では 220x140 縮小、値上げ時の差し替え回避）
// 主見出し 46pt 以上、サブ 20pt 以上、差し色1点（"No" 赤）。フォントは Arial 系（sharp/libvips 互換）
const promoSmallSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a8a"/>
      <stop offset="55%" style="stop-color:#3a4ca8"/>
      <stop offset="100%" style="stop-color:#4a5ad9"/>
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="440" height="280" fill="url(#bg)"/>

  <!-- 左下: クリップボード装飾 -->
  <g opacity="0.92">
    <rect x="22" y="178" width="80" height="76" rx="6" fill="#fff"/>
    <rect x="50" y="172" width="24" height="10" rx="2" fill="#fff" stroke="#1e3a8a" stroke-width="1.5"/>
    <circle cx="36" cy="200" r="4" fill="#4a90d9"/>
    <path d="M33.5 200 L35.5 202 L38.5 197" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <rect x="44" y="197" width="46" height="4" rx="2" fill="#cfdde9"/>
    <circle cx="36" cy="218" r="4" fill="#4a90d9"/>
    <path d="M33.5 218 L35.5 220 L38.5 215" stroke="#fff" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <rect x="44" y="215" width="40" height="4" rx="2" fill="#cfdde9"/>
    <circle cx="36" cy="236" r="4" fill="none" stroke="#cfdde9" stroke-width="1.5"/>
    <rect x="44" y="233" width="44" height="4" rx="2" fill="#e6edf4"/>
  </g>

  <!-- 主見出し -->
  <text x="220" y="92" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="900" fill="#fff" letter-spacing="-1">Save Every</text>
  <text x="220" y="138" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="900" fill="#fff" letter-spacing="-1">Custom Order</text>

  <!-- 差し色1点: "No" だけ赤、Subscription は白 -->
  <text x="220" y="186" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="900" letter-spacing="-0.5" xml:space="preserve"><tspan fill="#FF6B4A">No </tspan><tspan fill="#fff">Subscription</tspan></text>

  <!-- 補助コピー -->
  <text x="220" y="224" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#cbd5e1" letter-spacing="0.3">Buy once  ·  Yours forever</text>
</svg>`;

writeFileSync(join(outDir, 'promo-small-440x280.svg'), promoSmallSvg);
await sharp(Buffer.from(promoSmallSvg))
  .png()
  .toFile(join(outDir, 'promo-small-440x280.png'));
console.log('Generated store/promo-small-440x280.png + .svg');

// スクリーンショット 1280x800 × 5
const screenshotsDir = join(__dirname, '..', 'screenshots');
const cwsScreensDir = join(outDir, 'screenshots');
mkdirSync(cwsScreensDir, { recursive: true });

// 順序: 機能 → 課金（メモリ準拠）。5枚目に課金モーダル+"Yours forever" 訴求が最強。
// キャプションは句読点なしで統一（メモリ準拠）。
const targets = [
  { src: '05-list-with-orders.png', caption: 'One dashboard for every custom order',                     mode: 'popup' },
  { src: '08-detail-view.png',      caption: 'Per-order checklists so nothing ships half-done',          mode: 'popup' },
  { src: '04-url-parsed.png',       caption: 'Paste an order URL — buyer details auto-fill',             mode: 'popup' },
  { src: '09-dark-mode.png',        caption: 'Dark mode included — your data stays on your device',      mode: 'popup' },
  { src: '10-upgrade-modal.png',    caption: '$12.99 once  ·  Yours forever  ·  No subscription',        mode: 'popup' }
];

if (!existsSync(screenshotsDir)) {
  console.log('\n⚠ screenshots/ がありません。先に `npm run e2e` を WSL2 で実行してください。');
} else {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const srcPath = join(screenshotsDir, t.src);
    if (!existsSync(srcPath)) {
      console.log(`  ✗ skip: ${t.src} not found`);
      continue;
    }

    let popupBuffer;
    if (t.mode === 'fullscreen') {
      popupBuffer = await sharp(srcPath)
        .resize(1100, 770, { fit: 'inside', background: '#fff' })
        .png()
        .toBuffer();
    } else {
      // popup mode: 左上 380x600 抽出 → 1.3倍拡大
      const meta = await sharp(srcPath).metadata();
      const cropWidth = Math.min(380, meta.width || 380);
      const cropHeight = Math.min(600, meta.height || 700);
      popupBuffer = await sharp(srcPath)
        .extract({ left: 0, top: 0, width: cropWidth, height: cropHeight })
        .resize({ width: Math.round(cropWidth * 1.3) })
        .png()
        .toBuffer();
    }
    const popupMeta = await sharp(popupBuffer).metadata();

    const captionEsc = t.caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const compositeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a8a"/>
      <stop offset="100%" style="stop-color:#4a5ad9"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1280" height="800" fill="url(#bg)"/>
  <rect x="0" y="0" width="1280" height="110" fill="#000" opacity="0.28"/>
  <text x="640" y="68" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" fill="#fff">${captionEsc}</text>
</svg>`;

    const bgBuffer = await sharp(Buffer.from(compositeSvg)).png().toBuffer();

    const availTop = 120;
    const availBottom = 790;
    const availHeight = availBottom - availTop;
    const popupTop = availTop + Math.max(0, (availHeight - (popupMeta.height || 0)) / 2);
    const popupLeft = (1280 - (popupMeta.width || 380)) / 2;

    const outBaseName = `screenshot-${i + 1}-1280x800`;
    const popupOutPath = join(cwsScreensDir, `${outBaseName}-popup.png`);

    await sharp(popupBuffer).toFile(popupOutPath);
    await sharp(bgBuffer)
      .composite([{ input: popupBuffer, top: Math.round(popupTop), left: Math.round(popupLeft) }])
      .png()
      .toFile(join(cwsScreensDir, `${outBaseName}.png`));

    const svgVersion = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="bg-${i + 1}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a8a"/>
      <stop offset="100%" style="stop-color:#4a5ad9"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1280" height="800" fill="url(#bg-${i + 1})"/>
  <rect x="0" y="0" width="1280" height="110" fill="#000" opacity="0.28"/>
  <text x="640" y="68" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" fill="#fff">${captionEsc}</text>
  <image xlink:href="${outBaseName}-popup.png" x="${Math.round(popupLeft)}" y="${Math.round(popupTop)}" width="${popupMeta.width}" height="${popupMeta.height}"/>
</svg>`;
    writeFileSync(join(cwsScreensDir, `${outBaseName}.svg`), svgVersion);

    console.log(`Generated store/screenshots/${outBaseName}.png + .svg`);
  }
}

console.log('\nTip: 微調整は Figma で SVG をインポートして編集してください。');
