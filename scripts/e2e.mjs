// E2E テスト: Puppeteer で拡張をロードし、popup/options の主要操作を自動検証する。
// スクリーンショットも生成する（CWS素材として再利用するため popup は viewport 380x600）。
import puppeteer from 'puppeteer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = mkdtempSync(join(tmpdir(), 'con-e2e-'));

const screenshotDir = join(root, 'screenshots');
if (existsSync(screenshotDir)) rmSync(screenshotDir, { recursive: true, force: true });
mkdirSync(screenshotDir, { recursive: true });

let shotCount = 0;
async function shot(page, label) {
  shotCount++;
  const num = String(shotCount).padStart(2, '0');
  const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const path = join(screenshotDir, `${num}-${safeLabel}.png`);
  try { await page.screenshot({ path, fullPage: false }); } catch (_) {}
}

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, err) {
  failed++;
  failures.push(`${name}: ${err.message}`);
  console.log(`  ✗ ${name}`);
  console.log(`     ${err.message}`);
}
async function run(name, fn) {
  try { await fn(); pass(name); } catch (e) { fail(name, e); }
}

// 共通: storage を空にしてpopupをリロード
async function freshPopup(browser, extensionId) {
  const page = await browser.newPage();
  // popup 実寸合わせ（fixed モーダルが viewport 中央に出る問題回避、Prompt Snippets 先例）
  await page.setViewport({ width: 380, height: 600 });
  page.on('pageerror', err => console.log(`  [POPUP ERROR] ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [POPUP CONSOLE error] ${msg.text()}`);
  });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(() => new Promise(r => chrome.storage.local.clear(r)));
  await page.reload();
  await page.waitForSelector('#btn-add', { visible: true });
  return page;
}

async function freshOptions(browser, extensionId) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  page.on('pageerror', err => console.log(`  [OPT ERROR] ${err.message}`));
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(() => new Promise(r => chrome.storage.local.clear(r)));
  await page.reload();
  await page.waitForSelector('.tab.active');
  return page;
}

console.log('\n=== E2E Test: Custom Order Notes ===\n');
console.log('Launching Chromium with extension loaded...');

const isLinux = process.platform === 'linux';
const headless = isLinux || process.env.E2E_HEADLESS === '1';

const browser = await puppeteer.launch({
  headless,
  userDataDir,
  protocolTimeout: 60000,
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ],
  defaultViewport: { width: 800, height: 700 }
});

let extensionId;
const swTarget = await browser.waitForTarget(t => t.type() === 'service_worker', { timeout: 10000 }).catch(() => null);
if (swTarget) {
  extensionId = swTarget.url().split('/')[2];
} else {
  for (const t of browser.targets()) {
    if (t.url().startsWith('chrome-extension://')) {
      extensionId = t.url().split('/')[2];
      break;
    }
  }
}
if (!extensionId) {
  console.error('FAIL: Could not detect extension ID');
  await browser.close();
  process.exit(1);
}
console.log(`Extension ID: ${extensionId}\n`);

// サンプルデータ生成ヘルパ
function sampleNotes(today) {
  // すべての note に 5項目チェックリストを入れておく（CWS スクショで空白に見えないように）
  const checklist = (...doneFlags) => [
    { text: 'Confirm details with buyer',  done: !!doneFlags[0] },
    { text: 'Source materials',            done: !!doneFlags[1] },
    { text: 'Make / produce',              done: !!doneFlags[2] },
    { text: 'Pack & label',                done: !!doneFlags[3] },
    { text: 'Send tracking link',          done: !!doneFlags[4] }
  ];
  return [
    { id: 'n1', platform: 'etsy', orderNo: '3987654321', customer: 'Sarah K.', request: "Engrave 'Mom 2026' in Script font, gift wrap please", dueDate: today, status: 'making', archived: false, checklist: checklist(1, 1, 0, 0, 0), createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-05T00:00:00Z' },
    { id: 'n2', platform: 'shopify', orderNo: '5123456789', customer: 'M. Chen', request: 'Color: Royal Blue, Size XS, rush delivery', dueDate: addDays(today, -1), status: 'packing', archived: false, checklist: checklist(1, 1, 1, 0, 0), createdAt: '2026-05-02T00:00:00Z', updatedAt: '2026-05-06T00:00:00Z' },
    { id: 'n3', platform: 'etsy', orderNo: '3987654400', customer: 'Emily R.', request: 'Larger size requested, custom packaging', dueDate: addDays(today, 2), status: 'received', archived: false, checklist: checklist(0, 0, 0, 0, 0), createdAt: '2026-05-03T00:00:00Z', updatedAt: '2026-05-03T00:00:00Z' },
    { id: 'n4', platform: 'etsy', orderNo: '3987654401', customer: 'James T.', request: 'Standard order, no rush', dueDate: addDays(today, 5), status: 'received', archived: false, checklist: checklist(1, 0, 0, 0, 0), createdAt: '2026-05-04T00:00:00Z', updatedAt: '2026-05-04T00:00:00Z' }
  ];
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ============== TESTS ==============

// 1. welcome.html
await run('welcome.html: 3ステップが表示される', async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/welcome.html`, { waitUntil: 'domcontentloaded' });
  const stepCount = await page.$$eval('.step', els => els.length);
  if (stepCount !== 3) throw new Error(`steps が3つではない: ${stepCount}`);
  await shot(page, 'welcome');
  await page.close();
});

// 2. popup empty state
await run('popup: 空状態のempty-stateが表示される', async () => {
  const page = await freshPopup(browser, extensionId);
  const emptyVisible = await page.$eval('#empty', el => !el.classList.contains('hidden'));
  if (!emptyVisible) throw new Error('empty が表示されない');
  await shot(page, 'popup-empty');
  await page.close();
});

// 3. popup: 新規注文を手動で追加
await run('popup: 新規注文を追加できる', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.click('#btn-add');
  await page.waitForSelector('#f-orderNo', { visible: true });
  await page.type('#f-orderNo', '1234567890');
  await page.type('#f-customer', 'Test Buyer');
  await page.type('#f-request', 'Engrave name');
  await page.click('#btn-save');
  await page.waitForSelector('.note');
  const orderNoText = await page.evaluate(() => document.querySelector('.note .note-header').textContent);
  if (!orderNoText.includes('1234567890')) throw new Error(`注文番号が表示されない: ${orderNoText}`);
  await shot(page, 'note-added');
  await page.close();
});

// 4. popup: URL貼付パース（ペースト動作をシミュレート）
await run('popup: Etsy URL貼付で注文番号が自動入力される', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.click('#btn-add');
  await page.waitForSelector('#f-url', { visible: true });
  const url = 'https://www.etsy.com/your/orders/sold/3987654321';
  // page.type は1文字ずつ input を発火するので途中の部分マッチで誤抽出される。
  // 実環境のペーストは1回の input イベントで完全URLが入るので、それを再現する。
  await page.evaluate((url) => {
    const f = document.querySelector('#f-url');
    f.value = url;
    f.dispatchEvent(new Event('input', { bubbles: true }));
  }, url);
  await new Promise(r => setTimeout(r, 200));
  const orderNo = await page.$eval('#f-orderNo', el => el.value);
  if (orderNo !== '3987654321') throw new Error(`URL貼付で注文番号が入らない: "${orderNo}"`);
  // CWSスクショ用: 自動入力された後の他フィールドにもサンプル値を入れて訴求を立てる
  await page.type('#f-customer', 'Sarah K.');
  await page.type('#f-request', "Engrave 'Mom 2026' in Script font");
  await page.evaluate(() => {
    const due = document.querySelector('#f-dueDate');
    const d = new Date();
    d.setDate(d.getDate() + 3);
    due.value = d.toISOString().slice(0, 10);
  });
  await new Promise(r => setTimeout(r, 100));
  await shot(page, 'url-parsed');
  await page.close();
});

// 5. popup: サンプルロード後の表示
await run('popup: 4件のnotesがすべて表示される', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  const cards = await page.$$('.note');
  if (cards.length !== 4) throw new Error(`note 件数が不正: ${cards.length}`);
  await shot(page, 'list-with-orders');
  await page.close();
});

// 6. popup: 検索
await run('popup: 検索で絞り込みできる', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  await page.type('#search', 'Sarah');
  await new Promise(r => setTimeout(r, 200));
  const cards = await page.$$('.note');
  if (cards.length !== 1) throw new Error(`検索結果が不正: ${cards.length}`);
  await shot(page, 'search-result');
  await page.close();
});

// 7. popup: Late フィルタ
await run('popup: Late フィルタで遅延orderだけ表示', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => document.querySelector('.chip[data-filter="late"]').click());
  await new Promise(r => setTimeout(r, 200));
  const cards = await page.$$('.note');
  if (cards.length !== 1) throw new Error(`Late件数: ${cards.length} (期待 1)`);
  await shot(page, 'filter-late');
  await page.close();
});

// 8. popup: ステータス遷移 Next
await run('popup: Next ボタンでステータスが進む', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  // 1件目の note (n1: making) をクリック
  await page.evaluate(() => document.querySelector('.note').click());
  await page.waitForSelector('#detail-view:not(.hidden)', { visible: true });
  await shot(page, 'detail-view');
  await page.evaluate(() => document.querySelector('#btn-next').click());
  await new Promise(r => setTimeout(r, 300));
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  // 期限ソートで一番上が n2 (-1日 = late, packing) のはずだが、Late フィルタ前は all で受注順。dueDate ソートで n2 が一番先。
  // 期限昇順なので n2 (yesterday) が先頭、次に n1 (today)
  // n2 packing → shipped に進んでいるはず
  const updated = stored.notes.find(n => n.id === 'n2');
  if (!updated || updated.status !== 'shipped') {
    throw new Error(`status が遷移していない: ${updated && updated.status}`);
  }
  await page.close();
});

// 9. popup: ダークモード
await run('popup: prefers-color-scheme dark で背景が暗くなる', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg === 'rgb(255, 255, 255)') throw new Error(`ダークモードでも白背景: ${bg}`);
  await shot(page, 'dark-mode');
  await page.close();
});

// 10. popup: Free 上限到達で upgrade モーダル
await run('popup: 11件目を追加で upgrade モーダルが出る', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((today) => {
    const notes = [];
    for (let i = 0; i < 10; i++) {
      notes.push({
        id: 'x' + i,
        platform: 'manual',
        orderNo: 'A' + (1000 + i),
        customer: 'Buyer ' + i,
        request: 'request ' + i,
        dueDate: today,
        status: 'received',
        archived: false,
        checklist: [],
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z'
      });
    }
    return new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r));
  }, today);
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await new Promise(r => setTimeout(r, 200));
  const visible = await page.$eval('#upgrade-modal', el => !el.classList.contains('hidden'));
  if (!visible) throw new Error('upgrade-modal が表示されない');
  await shot(page, 'upgrade-modal');
  await page.close();
});

// 11. options.html: 全注文タブ
await run('options: All ordersタブで全notes一覧が出る', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  const rows = await page.$$('#orders-tbody tr');
  if (rows.length < 3) throw new Error(`active行が少ない: ${rows.length}`);
  await shot(page, 'options-orders');
  await page.close();
});

// 12. options.html: タブ切替
await run('options: Import/Export タブに切り替わる', async () => {
  const page = await freshOptions(browser, extensionId);
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  const dataActive = await page.$eval('#tab-data', el => !el.classList.contains('hidden'));
  if (!dataActive) throw new Error('data タブに切り替わらない');
  await shot(page, 'options-data');
  await page.close();
});

// 13. options.html: ダークモード
await run('options: ダークモード対応', async () => {
  const page = await freshOptions(browser, extensionId);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  if (bg === 'rgb(247, 249, 252)' || bg === 'rgb(255, 255, 255)') {
    throw new Error(`ダークでも明色: ${bg}`);
  }
  await shot(page, 'options-dark');
  await page.close();
});

// ============== END ==============

console.log(`\n=== Result ===`);
console.log(`Pass: ${passed} / Fail: ${failed}`);
if (failures.length > 0) failures.forEach(f => console.log(`  - ${f}`));

await browser.close();
rmSync(userDataDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
