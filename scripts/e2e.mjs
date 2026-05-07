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

// 14. popup: Back ボタンで status が前に戻る
await run('popup: Back ボタンで status が前に戻る', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  // 期限ソートで n2 (packing, 昨日 due) が先頭
  await page.evaluate(() => document.querySelector('.note').click());
  await page.waitForSelector('#detail-view:not(.hidden)', { visible: true });
  await page.evaluate(() => document.querySelector('#btn-prev').click());
  await new Promise(r => setTimeout(r, 300));
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  const updated = stored.notes.find(n => n.id === 'n2');
  if (!updated || updated.status !== 'making') {
    throw new Error(`packing → making に戻っていない: ${updated && updated.status}`);
  }
  await page.close();
});

// 15. popup: 最初のステータス (received) では Back ボタンが disabled
await run('popup: received では Back ボタンが disabled', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => {
    const card = document.querySelector('.note[data-id="n3"]');
    card.click();
  });
  await page.waitForSelector('#detail-view:not(.hidden)', { visible: true });
  const disabled = await page.$eval('#btn-prev', el => el.disabled);
  if (!disabled) throw new Error('received で Back が有効になっている');
  await page.close();
});

// 16. popup: upgrade-modal が Escape キーで閉じる
await run('popup: upgrade-modal が Escape で閉じる', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((today) => {
    const notes = [];
    for (let i = 0; i < 10; i++) notes.push({
      id: 'x' + i, platform: 'manual', orderNo: 'A' + (1000 + i),
      customer: 'B' + i, request: 'r', dueDate: today, status: 'received',
      archived: false, checklist: [], createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z'
    });
    return new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r));
  }, today);
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await new Promise(r => setTimeout(r, 200));
  let visible = await page.$eval('#upgrade-modal', el => !el.classList.contains('hidden'));
  if (!visible) throw new Error('upgrade-modal が表示されていない');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 200));
  visible = await page.$eval('#upgrade-modal', el => !el.classList.contains('hidden'));
  if (visible) throw new Error('Escape で upgrade-modal が閉じない');
  await page.close();
});

// 17. popup: note カードが Enter キーで開ける (a11y)
await run('popup: note カードが Enter キーで開ける', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => {
    const card = document.querySelector('.note');
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));
  const detailVisible = await page.$eval('#detail-view', el => !el.classList.contains('hidden'));
  if (!detailVisible) throw new Error('Enter で detail-view が開かない');
  await page.close();
});

// 18. popup: Shopify ショートカット URL からも注文番号が抽出される
await run('popup: Shopify ショートカット URL で注文番号自動入力', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.click('#btn-add');
  await page.waitForSelector('#f-url', { visible: true });
  await page.evaluate(() => {
    const f = document.querySelector('#f-url');
    f.value = 'https://admin.shopify.com/orders/5123456789';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));
  const orderNo = await page.$eval('#f-orderNo', el => el.value);
  if (orderNo !== '5123456789') throw new Error(`Shopify ショートカット抽出失敗: "${orderNo}"`);
  await page.close();
});

// 19. popup: Etsy transaction: プレフィックス URL
await run('popup: Etsy transaction: URL で注文番号自動入力', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.click('#btn-add');
  await page.waitForSelector('#f-url', { visible: true });
  await page.evaluate(() => {
    const f = document.querySelector('#f-url');
    f.value = 'https://www.etsy.com/your/shops/MyShop/orders/sold/transaction:3987654321';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));
  const orderNo = await page.$eval('#f-orderNo', el => el.value);
  if (orderNo !== '3987654321') throw new Error(`transaction: パース失敗: "${orderNo}"`);
  await page.close();
});

// 20. options: Free でも all CSV エクスポートできる
await run('options: Free でも all CSV エクスポートできる', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  const downloaded = await page.evaluate(() => new Promise(resolve => {
    const orig = HTMLAnchorElement.prototype.click;
    let captured = '';
    HTMLAnchorElement.prototype.click = function() { captured = this.download || ''; };
    document.querySelector('#export-filter').value = 'all';
    document.querySelector('#export-filter').dispatchEvent(new Event('change'));
    document.querySelector('#btn-csv-export').click();
    setTimeout(() => { HTMLAnchorElement.prototype.click = orig; resolve(captured); }, 800);
  }));
  if (!downloaded.includes('custom-order-notes-') || !downloaded.endsWith('.csv')) {
    throw new Error(`CSV ダウンロードが起きていない: "${downloaded}"`);
  }
  await page.close();
});

// 21. options: Free が filtered CSV を選ぶとブロックされる
await run('options: Free が filtered CSV を選ぶとブロックされる', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  const result = await page.evaluate(() => new Promise(resolve => {
    let downloadFired = false;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { downloadFired = true; };
    document.querySelector('#export-filter').value = 'active';
    document.querySelector('#export-filter').dispatchEvent(new Event('change'));
    document.querySelector('#btn-csv-export').click();
    setTimeout(() => {
      HTMLAnchorElement.prototype.click = orig;
      const toast = (document.querySelector('#toast') || {}).textContent || '';
      resolve({ downloadFired, toast });
    }, 600);
  }));
  if (result.downloadFired) throw new Error('Free で filtered CSV がダウンロードされてしまった');
  if (!/Pro/i.test(result.toast)) throw new Error(`Pro ゲート toast が出ていない: "${result.toast}"`);
  await page.close();
});

// 22. options: CSV import が Free でも実行できる
await run('options: CSV import が Free で実行できる', async () => {
  const page = await freshOptions(browser, extensionId);
  await page.evaluate(() => new Promise(r => chrome.storage.local.set({ notes: [], isPaid: false }, r)));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(async () => {
    const csv = 'Order Number,Buyer,Item\n9999000001,Alice,Custom mug\n9999000002,Bob,Tee';
    const blob = new Blob([csv], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#csv-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#import-modal:not(.hidden)', { timeout: 3000 });
  const summary = await page.$eval('#import-summary', el => el.textContent);
  if (!/2 new orders/.test(summary)) throw new Error(`サマリ不正: "${summary}"`);
  await page.close();
});

// 23. options: CSV 重複判定は platform+orderNo 複合キー
await run('options: CSV 重複判定は platform+orderNo 複合', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), sampleNotes(today));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  // n1 (etsy/3987654321) 既存 + Shopify CSV (Name=#3987654321) → 別キー、新規1
  await page.evaluate(async () => {
    const csv = 'Name,Customer,Notes\n#3987654321,Mr. Cross,Shopify same number';
    const blob = new Blob([csv], { type: 'text/csv' });
    const file = new File([blob], 'shopify.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#csv-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#import-modal:not(.hidden)', { timeout: 3000 });
  const summary = await page.$eval('#import-summary', el => el.textContent);
  if (!/Will import 1 new orders/i.test(summary) && !/import 1 /i.test(summary)) {
    throw new Error(`複合キー判定失敗: "${summary}"`);
  }
  await page.close();
});

// 24. options: import-modal が Escape で閉じる
await run('options: import-modal が Escape で閉じる', async () => {
  const page = await freshOptions(browser, extensionId);
  await page.evaluate(() => new Promise(r => chrome.storage.local.set({ notes: [], isPaid: false }, r)));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(async () => {
    const csv = 'Order,Buyer\n9999000099,Eve';
    const blob = new Blob([csv], { type: 'text/csv' });
    const file = new File([blob], 't.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#csv-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#import-modal:not(.hidden)');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 200));
  const hidden = await page.$eval('#import-modal', el => el.classList.contains('hidden'));
  if (!hidden) throw new Error('Escape で import-modal が閉じない');
  await page.close();
});

// 25. popup: 上限到達時の quota-badge が full クラスとテキスト
await run('popup: 上限到達で quota-badge が full', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((today) => {
    const notes = [];
    for (let i = 0; i < 10; i++) notes.push({
      id: 'q' + i, platform: 'manual', orderNo: 'Q' + (i + 1),
      customer: 'C' + i, request: '', dueDate: today, status: 'received',
      archived: false, checklist: [], createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z'
    });
    return new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r));
  }, today);
  await page.reload();
  await page.waitForSelector('.note');
  const text = await page.$eval('#quota-badge', el => el.textContent);
  const isFull = await page.$eval('#quota-badge', el => el.classList.contains('full'));
  if (!/10\s*\/\s*10/.test(text)) throw new Error(`quota text 不正: "${text}"`);
  if (!isFull) throw new Error('full クラスが付かない');
  await page.close();
});

// 26. options: CSV import を確定すると notes に反映される
await run('options: CSV import を Import ボタンで確定すると notes に反映される', async () => {
  const page = await freshOptions(browser, extensionId);
  await page.evaluate(() => new Promise(r => chrome.storage.local.set({ notes: [], isPaid: false }, r)));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(async () => {
    const csv = 'Order Number,Buyer,Item\n8888000001,Alice,Custom mug\n8888000002,Bob,Tee';
    const blob = new Blob([csv], { type: 'text/csv' });
    const file = new File([blob], 'test.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#csv-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#import-modal:not(.hidden)', { timeout: 3000 });
  await page.evaluate(() => document.querySelector('#import-confirm').click());
  await new Promise(r => setTimeout(r, 400));
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  const orderNos = (stored.notes || []).map(n => n.orderNo);
  if (!orderNos.includes('8888000001') || !orderNos.includes('8888000002')) {
    throw new Error(`Import 後の notes に反映されていない: ${JSON.stringify(orderNos)}`);
  }
  await page.close();
});

// 27. options: CSV export の中身がフィルタ通りで実データを含む
await run('options: CSV export の中身がフィルタ通りで実データを含む', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  const csv = await page.evaluate(() => new Promise(resolve => {
    const origCreate = URL.createObjectURL;
    let captured = '';
    URL.createObjectURL = function(blob) {
      // Blob.text() で中身を読む
      blob.text().then(t => { captured = t; });
      return origCreate.call(this, blob);
    };
    document.querySelector('#export-filter').value = 'all';
    document.querySelector('#export-filter').dispatchEvent(new Event('change'));
    document.querySelector('#btn-csv-export').click();
    setTimeout(() => { URL.createObjectURL = origCreate; resolve(captured); }, 800);
  }));
  if (!csv.startsWith('orderNo,platform,customer,request')) {
    throw new Error(`CSV ヘッダー不正: "${csv.slice(0, 80)}"`);
  }
  if (!csv.includes('3987654321') || !csv.includes('Sarah K.')) {
    throw new Error(`CSV にサンプルデータが含まれていない`);
  }
  // 4件すべて含まれている (active 3 + shipped/review 1 = sampleNotes は全 active なので 4件)
  const dataLines = csv.split(/\r?\n/).filter(l => l.trim()).slice(1);
  if (dataLines.length !== 4) throw new Error(`データ行数が4ではない: ${dataLines.length}`);
  await page.close();
});

// 28. options: JSON full backup ダウンロードが起動する
await run('options: JSON backup ボタンでダウンロードが起動する', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  const result = await page.evaluate(() => new Promise(resolve => {
    const origClick = HTMLAnchorElement.prototype.click;
    const origCreate = URL.createObjectURL;
    let captured = { name: '', body: '' };
    URL.createObjectURL = function(blob) {
      blob.text().then(t => { captured.body = t; });
      return origCreate.call(this, blob);
    };
    HTMLAnchorElement.prototype.click = function() { captured.name = this.download || ''; };
    document.querySelector('#btn-json-export').click();
    setTimeout(() => {
      HTMLAnchorElement.prototype.click = origClick;
      URL.createObjectURL = origCreate;
      resolve(captured);
    }, 800);
  }));
  if (!result.name.startsWith('custom-order-notes-backup-')) {
    throw new Error(`JSON ダウンロードファイル名が不正: "${result.name}"`);
  }
  let payload;
  try { payload = JSON.parse(result.body); } catch (_) {
    throw new Error('JSON が parse できない');
  }
  if (payload.schemaVersion !== 1) throw new Error(`schemaVersion が 1 ではない: ${payload.schemaVersion}`);
  if (!Array.isArray(payload.notes) || payload.notes.length !== 4) {
    throw new Error(`notes 配列が期待値と不一致: ${payload.notes && payload.notes.length}`);
  }
  await page.close();
});

// 29. options: JSON restore で notes が置換 + 上書き前の自動バックアップが先行DLされる
await run('options: JSON restore で notes 置換 + 自動バックアップ先行', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  // 既存に sampleNotes (4件) を入れておく
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  const downloads = await page.evaluate(() => new Promise(resolve => {
    const origClick = HTMLAnchorElement.prototype.click;
    const captured = [];
    HTMLAnchorElement.prototype.click = function() { captured.push(this.download || ''); };
    // 直接 importJSON のロジックに乗せるため、File を json-file input に流す
    const restorePayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: 'custom-order-notes',
      notes: [
        { id: 'r1', platform: 'manual', orderNo: 'RESTORED1', customer: 'Restore A', request: 'r', dueDate: null, status: 'received', archived: false, checklist: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
      ]
    };
    const blob = new Blob([JSON.stringify(restorePayload)], { type: 'application/json' });
    const file = new File([blob], 'restore.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#json-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => {
      // confirm モーダルで yes を押す
      const yes = document.querySelector('#confirm-yes');
      if (yes) yes.click();
      setTimeout(() => {
        HTMLAnchorElement.prototype.click = origClick;
        resolve(captured);
      }, 600);
    }, 400);
  }));
  // 自動バックアップが pre-restore-... という名前で先行DLされているはず
  if (!downloads.some(n => n.startsWith('custom-order-notes-pre-restore-'))) {
    throw new Error(`自動バックアップが先行DLされていない: ${JSON.stringify(downloads)}`);
  }
  // notes が置換されている
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  if (stored.notes.length !== 1 || stored.notes[0].orderNo !== 'RESTORED1') {
    throw new Error(`Restore 後の notes が期待値と不一致: ${JSON.stringify(stored.notes.map(n => n.orderNo))}`);
  }
  await page.close();
});

// 30. options All orders: Back ボタンで status が前に戻る
await run('options: All orders の Back ボタンで status が戻る', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  // n2 (packing) の行で Back ボタンクリック
  await page.evaluate(() => {
    const tr = document.querySelector('#orders-tbody tr[data-id="n2"]');
    const btn = tr.querySelector('button[data-act="prev"]');
    btn.click();
  });
  await new Promise(r => setTimeout(r, 300));
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  const updated = stored.notes.find(n => n.id === 'n2');
  if (!updated || updated.status !== 'making') {
    throw new Error(`packing → making に戻っていない: ${updated && updated.status}`);
  }
  await page.close();
});

// 31. options All orders: received 行では Back ボタンが disabled
await run('options: received 行では Back ボタンが disabled', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('#orders-tbody tr');
  // n3 は received
  const disabled = await page.evaluate(() => {
    const tr = document.querySelector('#orders-tbody tr[data-id="n3"]');
    const btn = tr.querySelector('button[data-act="prev"]');
    return btn.disabled;
  });
  if (!disabled) throw new Error('received 行で Back が有効になっている');
  await page.close();
});

// 32. options Archive タブ: Restore で active に戻る
await run('options: Archive タブの Restore ボタンで active 復元', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  // archived: true の note を入れる
  const notes = sampleNotes(today);
  notes[0].archived = true;
  notes[0].status = 'shipped';
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), notes);
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="archive"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.waitForSelector('#archive-tbody tr[data-id="n1"]');
  await page.evaluate(() => {
    const btn = document.querySelector('#archive-tbody tr[data-id="n1"] button[data-act="restore"]');
    btn.click();
  });
  await new Promise(r => setTimeout(r, 300));
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  const restored = stored.notes.find(n => n.id === 'n1');
  if (!restored || restored.archived) throw new Error('archived フラグが落ちていない');
  if (restored.status === 'shipped' || restored.status === 'review') {
    throw new Error(`status が active 状態に戻っていない: ${restored.status}`);
  }
  await page.close();
});

// 33. options Danger zone: Delete everything Cancel で残る
await run('options: Delete everything を Cancel すると残る', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => document.querySelector('#btn-clear-all').click());
  await page.waitForSelector('#confirm-modal:not(.hidden)');
  await page.evaluate(() => document.querySelector('#confirm-no').click());
  await new Promise(r => setTimeout(r, 200));
  const stored = await page.evaluate(() => chrome.storage.local.get('notes'));
  if (stored.notes.length !== 4) throw new Error(`Cancel しても削除された: ${stored.notes.length}件`);
  await page.close();
});

// 34. options: Export count バッジが filter 切替で更新される
await run('options: Export count バッジが filter 切替で更新', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: true }, r)), sampleNotes(today));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  // 'all' で 4件
  const allText = await page.$eval('#export-count', el => el.textContent);
  if (!/4\s*orders/.test(allText)) throw new Error(`all 件数表示不正: "${allText}"`);
  // 'shipped' に切替 → 0件
  await page.evaluate(() => {
    const sel = document.querySelector('#export-filter');
    sel.value = 'shipped';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 100));
  const shippedText = await page.$eval('#export-count', el => el.textContent);
  if (!/0\s*orders/.test(shippedText)) throw new Error(`shipped 件数表示不正: "${shippedText}"`);
  await page.close();
});

// 35. popup: 空入力で Save を押すと order# 必須エラー toast
await run('popup: order# 空で Save するとエラー toast', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.click('#btn-add');
  await page.waitForSelector('#f-orderNo', { visible: true });
  await page.evaluate(() => document.querySelector('#btn-save').click());
  await new Promise(r => setTimeout(r, 200));
  const toast = await page.$eval('#toast', el => el.textContent);
  if (!/required/i.test(toast)) throw new Error(`Order# 必須 toast が出ない: "${toast}"`);
  await page.close();
});

// 36. popup: 検索ボックスをクリアすると全件に戻る
await run('popup: 検索クリアで全件表示に戻る', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.waitForSelector('.note');
  await page.type('#search', 'Sarah');
  await new Promise(r => setTimeout(r, 200));
  let cards = await page.$$('.note');
  if (cards.length !== 1) throw new Error(`絞り込み後 1件期待: ${cards.length}`);
  // クリア
  await page.evaluate(() => {
    const s = document.querySelector('#search');
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));
  cards = await page.$$('.note');
  if (cards.length !== 4) throw new Error(`クリア後 4件期待: ${cards.length}`);
  await page.close();
});

// =================================================================
// SPEC-DRIVEN TESTS — 仕様書のみを根拠に作成（実装は読まない）。
// 失敗 = 実装が仕様逸脱の可能性 → 修正対象を判断する。
// =================================================================

// 37. 仕様: フィルタチップ件数バッジが active のみカウント (案C: review も active)
await run('SPEC: フィルタチップ件数バッジが active のみカウント', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  // 案C データ: a/b/c/g が active (received/making/review)、d は shipped (除外)、e/f は archived (除外)
  const seed = [
    { id: 'a', platform: 'etsy', orderNo: '1', customer: 'A', request: '', dueDate: today,              status: 'making',   archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: 'b', platform: 'etsy', orderNo: '2', customer: 'B', request: '', dueDate: today,              status: 'received', archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: 'c', platform: 'etsy', orderNo: '3', customer: 'C', request: '', dueDate: addDays(today, -3), status: 'making',   archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: 'd', platform: 'etsy', orderNo: '4', customer: 'D', request: '', dueDate: addDays(today, 1),  status: 'shipped',  archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: 'e', platform: 'etsy', orderNo: '5', customer: 'E', request: '', dueDate: today,              status: 'review',   archived: true,  checklist: [], createdAt: '', updatedAt: '' },
    { id: 'f', platform: 'etsy', orderNo: '6', customer: 'F', request: '', dueDate: addDays(today, -1), status: 'shipped',  archived: true,  checklist: [], createdAt: '', updatedAt: '' },
    { id: 'g', platform: 'etsy', orderNo: '7', customer: 'G', request: '', dueDate: today,              status: 'review',   archived: false, checklist: [], createdAt: '', updatedAt: '' }
  ];
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), seed);
  await page.reload();
  await page.waitForSelector('.chip');
  const counts = await page.evaluate(() => {
    const get = (k) => +document.querySelector(`.chip-count[data-count="${k}"]`).textContent;
    return { all: get('all'), today: get('today'), late: get('late'), ship: get('ship') };
  });
  // 案C: All=active 4 (a, b, c, g) / Today=本日due active 3 (a, b, g) / Late=1 (c) / Ship=making のみ 2 (a, c)
  if (counts.all !== 4) throw new Error(`All=4 expected, got ${counts.all}`);
  if (counts.today !== 3) throw new Error(`Today=3 expected, got ${counts.today}`);
  if (counts.late !== 1) throw new Error(`Late=1 expected, got ${counts.late}`);
  if (counts.ship !== 2) throw new Error(`Ship=2 expected, got ${counts.ship}`);
  await page.close();
});

// 38. 仕様: 検索は注文番号 / 買い手名 / 要望テキストで大文字小文字を無視する
await run('SPEC: 検索が大文字小文字を無視', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), [
    { id: '1', platform: 'etsy', orderNo: 'ABC123', customer: 'Jane Doe', request: 'Engrave MOM', dueDate: today, status: 'received', archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: '2', platform: 'etsy', orderNo: 'XYZ999', customer: 'Bob',      request: 'plain',       dueDate: today, status: 'received', archived: false, checklist: [], createdAt: '', updatedAt: '' }
  ]);
  await page.reload();
  await page.waitForSelector('.note');
  // 大文字 "JANE" → 1件
  await page.evaluate(() => { const s = document.querySelector('#search'); s.value = 'JANE'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 200));
  let count = await page.$$eval('.note', els => els.length);
  if (count !== 1) throw new Error(`'JANE' search: 1 expected, got ${count}`);
  // 小文字 "mom" (要望テキスト) → 1件
  await page.evaluate(() => { const s = document.querySelector('#search'); s.value = 'mom'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 200));
  count = await page.$$eval('.note', els => els.length);
  if (count !== 1) throw new Error(`'mom' search request: 1 expected, got ${count}`);
  // 注文番号 abc123 → 1件
  await page.evaluate(() => { const s = document.querySelector('#search'); s.value = 'abc123'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 200));
  count = await page.$$eval('.note', els => els.length);
  if (count !== 1) throw new Error(`'abc123' orderNo search: 1 expected, got ${count}`);
  await page.close();
});

// 39. 仕様: review ステータスで Next を押すと archive 化される
await run('SPEC: review で Next 押下 → archive 化される', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), [
    { id: 'r1', platform: 'etsy', orderNo: '9999', customer: 'Z', request: '', dueDate: today, status: 'review', archived: false, checklist: [], createdAt: '', updatedAt: '' }
  ]);
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => document.querySelector('.note').click());
  await page.waitForSelector('#btn-next', { visible: true });
  await page.evaluate(() => document.querySelector('#btn-next').click());
  await new Promise(r => setTimeout(r, 300));
  const archived = await page.evaluate(() => new Promise(r =>
    chrome.storage.local.get('notes', d => r((d.notes || []).find(n => n.id === 'r1') || {}))
  ));
  if (archived.archived !== true) throw new Error(`review→Next で archived=true 期待, got ${archived.archived}`);
  await page.close();
});

// 40. 仕様: 検索 × Today フィルタの AND 合成
await run('SPEC: 検索 × Today フィルタの AND 合成', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), [
    { id: '1', platform: 'etsy', orderNo: '1', customer: 'Alice', request: '', dueDate: today,              status: 'making', archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: '2', platform: 'etsy', orderNo: '2', customer: 'Alice', request: '', dueDate: addDays(today, 5), status: 'making', archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: '3', platform: 'etsy', orderNo: '3', customer: 'Bob',   request: '', dueDate: today,              status: 'making', archived: false, checklist: [], createdAt: '', updatedAt: '' }
  ]);
  await page.reload();
  await page.waitForSelector('.chip');
  await page.evaluate(() => document.querySelector('.chip[data-filter="today"]').click());
  await page.evaluate(() => { const s = document.querySelector('#search'); s.value = 'alice'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await new Promise(r => setTimeout(r, 200));
  // AND: today かつ alice → id='1' のみ = 1件
  const count = await page.$$eval('.note', els => els.length);
  if (count !== 1) throw new Error(`AND filter expected 1, got ${count}`);
  await page.close();
});

// 41. 仕様: Today フィルタは archive を除外する
await run('SPEC: Today フィルタが archive を除外', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), [
    { id: '1', platform: 'etsy', orderNo: '1', customer: 'A', request: '', dueDate: today, status: 'making', archived: false, checklist: [], createdAt: '', updatedAt: '' },
    { id: '2', platform: 'etsy', orderNo: '2', customer: 'B', request: '', dueDate: today, status: 'review', archived: true,  checklist: [], createdAt: '', updatedAt: '' }
  ]);
  await page.reload();
  await page.waitForSelector('.chip');
  await page.evaluate(() => document.querySelector('.chip[data-filter="today"]').click());
  await new Promise(r => setTimeout(r, 200));
  const count = await page.$$eval('.note', els => els.length);
  if (count !== 1) throw new Error(`Today excludes archived: 1 expected, got ${count}`);
  await page.close();
});

// 42. 仕様: Upgrade モーダルは Maybe later で閉じ、副作用がない
await run('SPEC: Upgrade モーダル → Maybe later で閉じる、データ無傷', async () => {
  const page = await freshPopup(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  const seed = Array.from({ length: 10 }, (_, i) => ({
    id: 'x' + i, platform: 'etsy', orderNo: '100' + i, customer: 'U' + i, request: '', dueDate: today,
    status: 'received', archived: false, checklist: [], createdAt: '', updatedAt: ''
  }));
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), seed);
  await page.reload();
  await page.waitForSelector('.note');
  await page.evaluate(() => document.querySelector('#btn-add').click());
  await page.waitForSelector('#upgrade-modal:not(.hidden)', { timeout: 3000 });
  await page.evaluate(() => document.querySelector('#btn-upgrade-close').click());
  await new Promise(r => setTimeout(r, 200));
  const hidden = await page.$eval('#upgrade-modal', el => el.classList.contains('hidden'));
  if (!hidden) throw new Error('Maybe later で閉じない');
  // データ副作用ゼロ
  const len = await page.evaluate(() => new Promise(r =>
    chrome.storage.local.get('notes', d => r((d.notes || []).length))
  ));
  if (len !== 10) throw new Error(`note count changed: ${len} (expected 10)`);
  await page.close();
});

// 43. 仕様: 不正 URL を貼っても他フィールドを破壊しない
await run('SPEC: 不正 URL ペーストで他フィールドが消えない', async () => {
  const page = await freshPopup(browser, extensionId);
  await page.click('#btn-add');
  await page.waitForSelector('#f-orderNo', { visible: true });
  await page.type('#f-customer', 'Existing Buyer');
  await page.type('#f-request', 'Pre-typed request');
  await page.evaluate(() => {
    const f = document.querySelector('#f-url');
    f.value = 'https://random.example.com/not-an-order/abc?q=1';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 200));
  const customer = await page.$eval('#f-customer', el => el.value);
  const request = await page.$eval('#f-request', el => el.value);
  if (customer !== 'Existing Buyer') throw new Error(`customer wiped: '${customer}'`);
  if (request !== 'Pre-typed request') throw new Error(`request wiped: '${request}'`);
  await page.close();
});

// 44. 仕様: CSV import 重複判定は platform+orderNo 複合キー (Etsy/Shopify 同番号は衝突しない)
await run('SPEC: CSV import で platform+orderNo 複合キー重複判定', async () => {
  const page = await freshOptions(browser, extensionId);
  // 既存 Etsy orderNo=12345 がある状態で、Shopify (Name=#12345) を import → 衝突しない
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), [
    { id: 'e1', platform: 'etsy', orderNo: '12345', customer: 'Etsy Buyer', request: '', dueDate: '2026-05-20', status: 'received', archived: false, checklist: [], createdAt: '', updatedAt: '' }
  ]);
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(async () => {
    const csv = 'Name,Customer,Notes\n#12345,Shopify Buyer,Wrap blue';
    const blob = new Blob([csv], { type: 'text/csv' });
    const file = new File([blob], 'shopify.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#csv-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForSelector('#import-modal:not(.hidden)', { timeout: 3000 });
  await page.evaluate(() => document.querySelector('#import-confirm').click());
  await new Promise(r => setTimeout(r, 500));
  const result = await page.evaluate(() => new Promise(r =>
    chrome.storage.local.get('notes', d => r(d.notes || []))
  ));
  const same = result.filter(n => n.orderNo === '12345');
  if (same.length !== 2) throw new Error(`expected 2 (etsy+shopify), got ${same.length}`);
  const platforms = new Set(same.map(n => n.platform));
  if (!platforms.has('etsy') || !platforms.has('shopify')) {
    throw new Error(`expected both platforms, got ${[...platforms].join(',')}`);
  }
  await page.close();
});

// 45. 仕様: JSON restore で異なる schemaVersion を渡された時は受け入れない
await run('SPEC: JSON restore で未知 schemaVersion を拒否', async () => {
  const page = await freshOptions(browser, extensionId);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes, isPaid: false }, r)), [
    { id: 'old', platform: 'etsy', orderNo: 'OLD', customer: 'OldOne', request: '', dueDate: '2026-05-20', status: 'received', archived: false, checklist: [], createdAt: '', updatedAt: '' }
  ]);
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(async () => {
    const payload = { schemaVersion: 999, notes: [{ id: 'x', orderNo: 'X' }] };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const file = new File([blob], 'bad.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#json-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  // 拒否された場合: notes は元のまま、confirm モーダルも開かない
  const stored = await page.evaluate(() => new Promise(r =>
    chrome.storage.local.get('notes', d => r(d.notes || []))
  ));
  if (stored.length !== 1 || stored[0].id !== 'old') {
    throw new Error(`未知 schema を受理してしまった: ${JSON.stringify(stored)}`);
  }
  await page.close();
});

// 46. 仕様: 内製 confirm モーダル裏の操作が無効 (Cancel しないと先に進めない)
await run('SPEC: confirm モーダル裏の Click では先に進めない', async () => {
  const page = await freshOptions(browser, extensionId);
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((notes) => new Promise(r => chrome.storage.local.set({ notes }, r)), sampleNotes(today));
  await page.reload();
  await page.evaluate(() => document.querySelector('.tab[data-tab="data"]').click());
  await new Promise(r => setTimeout(r, 100));
  // Delete everything → confirm モーダル
  await page.evaluate(() => document.querySelector('#btn-clear-all').click());
  await page.waitForSelector('#confirm-modal:not(.hidden)');
  // モーダルが開いている間にタブ切替を試みる
  await page.evaluate(() => document.querySelector('.tab[data-tab="orders"]').click());
  await new Promise(r => setTimeout(r, 200));
  // 仕様: モーダルが開いたままでデータも消えていない
  const modalOpen = await page.$eval('#confirm-modal', el => !el.classList.contains('hidden'));
  const stored = await page.evaluate(() => new Promise(r =>
    chrome.storage.local.get('notes', d => r((d.notes || []).length))
  ));
  // モーダル裏が反応した場合タブが切り替わる可能性あり。仕様では「ユーザーは Cancel/Confirm 選択を強制」される
  if (stored !== 4) throw new Error(`モーダル open 中にデータが変化: ${stored}件 (4件期待)`);
  // Cancel で閉じる
  if (modalOpen) {
    await page.evaluate(() => document.querySelector('#confirm-no').click());
  }
  await page.close();
});

// ============== END ==============

console.log(`\n=== Result ===`);
console.log(`Pass: ${passed} / Fail: ${failed}`);
if (failures.length > 0) failures.forEach(f => console.log(`  - ${f}`));

await browser.close();
rmSync(userDataDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
