// 軽量スモークテスト: 拡張機能の整合性を機械的に検査
// HTML/JS の ID 整合性、CSP適合、manifest妥当性、CommonJS で完結
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function ok(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { errors.push(msg); console.log(`  ✗ ${msg}`); }

console.log('\n=== Smoke Test ===\n');

// 1. manifest.json 妥当性
console.log('[1] manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));
  ok('JSON parse OK');
  if (manifest.manifest_version !== 3) fail('manifest_version is not 3');
  else ok('manifest_version: 3');
  if (!manifest.name || !manifest.version || !manifest.description) fail('name/version/description missing');
  else ok('name / version / description present');
  if (manifest.description.length > 132) fail(`description too long: ${manifest.description.length} chars (max 132)`);
  else ok(`description length: ${manifest.description.length} chars`);
  if (manifest.name.length > 75) fail(`name too long: ${manifest.name.length} chars (max 75 for CWS title)`);
  else ok(`name length: ${manifest.name.length} chars`);
  const hostPerms = manifest.host_permissions;
  if (hostPerms && hostPerms.includes('<all_urls>')) fail('host_permissions contains <all_urls>');
  else ok('no <all_urls> in host_permissions');
  if (Array.isArray(manifest.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      if (Array.isArray(cs.matches) && cs.matches.includes('<all_urls>')) {
        fail(`content_scripts matches contains <all_urls>`);
      }
    }
    ok('no <all_urls> in content_scripts');
  }
  // Trademark check: "Etsy" or "Shopify" must not appear in the extension name
  if (/\b(etsy|shopify)\b/i.test(manifest.name)) {
    fail(`extension name contains a third-party trademark: "${manifest.name}"`);
  } else {
    ok('extension name has no third-party trademarks');
  }
} catch (e) {
  fail(`manifest.json parse error: ${e.message}`);
}

// 2. HTML/JS の ID 整合性（popup.html / options.html）
console.log('\n[2] HTML <-> JS ID 整合性');
function checkPair(htmlFile, jsFile) {
  const htmlPath = join(root, htmlFile);
  const jsPath = join(root, jsFile);
  if (!existsSync(htmlPath) || !existsSync(jsPath)) return;
  const html = readFileSync(htmlPath, 'utf-8');
  const js = readFileSync(jsPath, 'utf-8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const jsRefs = new Set(
    [...js.matchAll(/\$\(['"]#([^'"\s)]+)['"]\)/g)].map(m => m[1])
  );
  [...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].forEach(m => jsRefs.add(m[1]));
  const missing = [...jsRefs].filter(id => !htmlIds.has(id));
  if (missing.length > 0) fail(`${jsFile} 参照IDが ${htmlFile} にない: ${missing.join(', ')}`);
  else ok(`${jsFile} <-> ${htmlFile} 参照ID整合 (${jsRefs.size}件)`);
}
checkPair('popup.html', 'popup.js');
checkPair('options.html', 'options.js');

// 3. CSP 違反検出
console.log('\n[3] CSP適合チェック');
const htmlFiles = ['popup.html', 'options.html', 'welcome.html'].filter(f => existsSync(join(root, f)));
for (const file of htmlFiles) {
  const content = readFileSync(join(root, file), 'utf-8');
  const inlineScripts = [...content.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter(m => m[1].trim().length > 0);
  if (inlineScripts.length > 0) fail(`${file}: inline script (CSP違反)`);
  else ok(`${file}: no inline scripts`);
  const inlineHandlers = [...content.matchAll(/\son(click|change|input|submit|load|error|focus|blur)=/gi)];
  if (inlineHandlers.length > 0) fail(`${file}: inline event handler (CSP違反)`);
  else ok(`${file}: no inline event handlers`);
  if (/javascript:/i.test(content)) fail(`${file}: javascript: URL`);
  else ok(`${file}: no javascript: URLs`);
}

// 4. JS 文法チェック
console.log('\n[4] JS 文法チェック');
const jsFiles = ['popup.js', 'options.js', 'background.js', 'lib/order-utils.js', 'lib/csv-utils.js']
  .filter(f => existsSync(join(root, f)));
for (const file of jsFiles) {
  const content = readFileSync(join(root, file), 'utf-8');
  try {
    new Function(content);
    ok(`${file}: 文法OK`);
  } catch (e) {
    if (e instanceof SyntaxError) fail(`${file}: SyntaxError: ${e.message}`);
    else ok(`${file}: 文法OK (実行時例外は無視)`);
  }
}

// 5. 必須ファイル存在
console.log('\n[5] 必須ファイル存在');
const required = [
  'manifest.json', 'background.js', 'ExtPay.js',
  'popup.html', 'popup.css', 'popup.js',
  'options.html', 'options.css', 'options.js',
  'lib/order-utils.js', 'lib/csv-utils.js',
  'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
  'store/description.txt', 'store/privacy-policy.html'
];
for (const f of required) {
  if (existsSync(join(root, f))) ok(f);
  else fail(`MISSING: ${f}`);
}

// 6. ExtPay ID consistency
console.log('\n[6] ExtPay ID consistency');
const extpayId = 'custom-order-notes';
for (const f of ['background.js', 'popup.js', 'options.js']) {
  const c = readFileSync(join(root, f), 'utf-8');
  const m = c.match(/ExtPay\(['"]([^'"]+)['"]\)/);
  if (!m) fail(`${f}: ExtPay() not found`);
  else if (m[1] !== extpayId) fail(`${f}: ExtPay ID is "${m[1]}", expected "${extpayId}"`);
  else ok(`${f}: ExtPay ID = "${extpayId}"`);
}

console.log(`\n=== Result ===`);
console.log(`OK: ${errors.length === 0 ? 'PASS' : 'FAIL'}`);
console.log(`Errors: ${errors.length}`);
if (errors.length > 0) {
  errors.forEach(e => console.log(`  - ${e}`));
  process.exit(1);
}
process.exit(0);
