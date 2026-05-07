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

// 5枚のストーリー（ペルソナ会議 Marcus / Emily / CWSマーケ 統合結果）:
//   1) 一覧で「これが何の拡張か」を一目で
//   2) URL貼付で時短訴求
//   3) Late フィルタで恐怖訴求 (買い手から不評を受ける前に)
//   4) チェックリストで作り込み感とプロ感
//   5) 課金モーダル + Yours forever
// キャプションは <tspan> でキーワードのみアクセント色を入れる。
// アクセント色: 青 #2563EB / 緑 #16A34A / 赤 #DC2626 (画面内の Late バッジと同色) 。
const targets = [
  {
    src: '05-list-with-orders.png',
    captionParts: [
      { text: 'Track ' },
      { text: 'every custom order', color: '#2563EB' },
      { text: ' in one place' }
    ],
    mode: 'popup'
  },
  {
    src: '04-url-parsed.png',
    captionParts: [
      { text: 'Paste URL. Order # ' },
      { text: 'auto-filled', color: '#16A34A' },
      { text: '.' }
    ],
    mode: 'popup'
  },
  {
    src: '07-filter-late.png',
    captionParts: [
      { text: 'See what’s ' },
      { text: 'late', color: '#DC2626' },
      { text: ' before buyers do.' }
    ],
    mode: 'popup'
  },
  {
    // 4枚目: チェックリストではなく CSV エクスポート画面に差し替え。
    // 「画面だけ見ると有料版しかなく見える / CSV エクスポート機能が伝わらない」
    // というオーナー指摘に対応。Free バッジと Free ピル付きの options 画面で
    // 「Free でデータ持ち出し可能」を一目で示す。
    src: '12-options-data.png',
    captionParts: [
      { text: 'Export your data anytime — ' },
      { text: 'Free', color: '#16A34A' }
    ],
    mode: 'fullscreen'
  },
  {
    src: '10-upgrade-modal.png',
    // "Pro:" の接頭辞で「これは Pro の話」を明示し、
    // 4枚目の Free 訴求と対比を作る。
    captionParts: [
      { text: '' },
      { text: 'Pro:', color: '#2563EB' },
      { text: ' ' },
      { text: '$12.99', color: '#16A34A' },
      { text: ' once · Yours ' },
      { text: 'forever', color: '#2563EB' }
    ],
    mode: 'popup',
    big: true
  }
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

    // キャプション SVG: tspan でキーワード着色。
    // フォントは sharp/libvips 互換のため Arial 系（メモリ準拠）。
    // 上部に白95%透過マスクを敷いてダークネイビーのテキストを乗せる（黒帯はダサい）。
    const fontSize = t.big ? 58 : 52;
    const fontWeight = t.big ? 900 : 800;
    const bandHeight = t.big ? 130 : 110;
    const bandY = bandHeight / 2 + 12;  // 中央寄せ調整
    const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tspans = (t.captionParts || []).map(p => {
      const txt = escText(p.text);
      return p.color
        ? `<tspan fill="${p.color}">${txt}</tspan>`
        : txt;
    }).join('');

    const compositeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a8a"/>
      <stop offset="100%" style="stop-color:#4a5ad9"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1280" height="800" fill="url(#bg)"/>
  <rect x="0" y="0" width="1280" height="${bandHeight}" fill="#ffffff" opacity="0.95"/>
  <rect x="0" y="${bandHeight - 1}" width="1280" height="1" fill="#e5e7eb"/>
  <text x="640" y="${bandY}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="#0F172A">${tspans}</text>
</svg>`;

    const bgBuffer = await sharp(Buffer.from(compositeSvg)).png().toBuffer();

    const availTop = bandHeight + 20;
    const availBottom = 790;
    const availHeight = availBottom - availTop;
    const popupTop = availTop + Math.max(0, (availHeight - (popupMeta.height || 0)) / 2);
    const popupLeft = (1280 - (popupMeta.width || 380)) / 2;

    const outBaseName = `screenshot-${i + 1}-1280x800`;
    const popupOutPath = join(cwsScreensDir, `${outBaseName}-popup.png`);

    // popup を角丸 + ドロップシャドウ付きで合成（プロ感、Emily指摘）
    const w = popupMeta.width || 380;
    const h = popupMeta.height || 700;
    const radius = 12;
    const roundedMaskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`;
    const roundedPopup = await sharp(popupBuffer)
      .composite([{ input: Buffer.from(roundedMaskSvg), blend: 'dest-in' }])
      .png()
      .toBuffer();

    await sharp(roundedPopup).toFile(popupOutPath);

    // 影は背景より大きくなるとsharpが composite エラーを出すため、
    // 角丸のみで素直に配置する（背景グラデーションが既に立体感を作る）。
    await sharp(bgBuffer)
      .composite([
        { input: roundedPopup, top: Math.round(popupTop), left: Math.round(popupLeft) }
      ])
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
  <rect x="0" y="0" width="1280" height="${bandHeight}" fill="#ffffff" opacity="0.95"/>
  <rect x="0" y="${bandHeight - 1}" width="1280" height="1" fill="#e5e7eb"/>
  <text x="640" y="${bandY}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}" fill="#0F172A">${tspans}</text>
  <image xlink:href="${outBaseName}-popup.png" x="${Math.round(popupLeft)}" y="${Math.round(popupTop)}" width="${popupMeta.width}" height="${popupMeta.height}"/>
</svg>`;
    writeFileSync(join(cwsScreensDir, `${outBaseName}.svg`), svgVersion);

    console.log(`Generated store/screenshots/${outBaseName}.png + .svg`);
  }
}

console.log('\nTip: 微調整は Figma で SVG をインポートして編集してください。');
