// 純粋関数のユニットテスト。
// CSV パース、URL pattern matching、状態遷移などを検証する。
// lib/ は CommonJS で書かれているので require で取り込む。

import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const O = require(join(root, 'lib', 'order-utils.js'));
const C = require(join(root, 'lib', 'csv-utils.js'));

let pass = 0, fail = 0;
function eq(a, b, name) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    expected ${JSON.stringify(b)}\n    got      ${JSON.stringify(a)}`); }
}
function truthy(v, name) {
  if (v) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log('\n=== Unit Tests ===\n');

// ---- order-utils.js ----
console.log('[order-utils] parseOrderUrl');
eq(O.parseOrderUrl('https://www.etsy.com/your/orders/sold/3987654321?ref=top'),
   { platform: 'etsy', orderNo: '3987654321' }, 'Etsy receipt URL with query');
eq(O.parseOrderUrl('https://www.etsy.com/your/orders/sold/3987654321'),
   { platform: 'etsy', orderNo: '3987654321' }, 'Etsy short URL');
eq(O.parseOrderUrl('https://www.etsy.com/your/shops/MyShop/orders/sold/3987654321'),
   { platform: 'etsy', orderNo: '3987654321' }, 'Etsy /your/shops/<shop>/orders/sold/ pattern');
eq(O.parseOrderUrl('https://www.etsy.com/your/orders/sold/transaction:3987654321'),
   { platform: 'etsy', orderNo: '3987654321' }, 'Etsy transaction: prefix');
eq(O.parseOrderUrl('https://admin.shopify.com/store/my-shop/orders/5123456789'),
   { platform: 'shopify', orderNo: '5123456789' }, 'Shopify modern admin URL');
eq(O.parseOrderUrl('https://admin.shopify.com/orders/5123456789'),
   { platform: 'shopify', orderNo: '5123456789' }, 'Shopify shortcut URL (no store path)');
eq(O.parseOrderUrl('https://my-shop.myshopify.com/admin/orders/5123456789'),
   { platform: 'shopify', orderNo: '5123456789' }, 'Shopify legacy admin URL');
eq(O.parseOrderUrl('https://admin.shopify.com/store/my-shop/draft_orders/123456789'),
   null, 'Shopify draft_orders URL is rejected');
eq(O.parseOrderUrl('https://example.com/order/12345'),
   null, 'Unrelated URL returns null');
eq(O.parseOrderUrl(''),
   null, 'Empty input returns null');
eq(O.parseOrderUrl(null),
   null, 'null input returns null');

console.log('\n[order-utils] nextStatus / prevStatus');
eq(O.nextStatus('received'), 'making', 'received -> making');
eq(O.nextStatus('packing'), 'shipped', 'packing -> shipped');
eq(O.nextStatus('review'), 'review', 'review stays at review (terminal)');
eq(O.prevStatus('making'), 'received', 'making -> received');
eq(O.prevStatus('received'), 'received', 'received stays at received (terminal)');

console.log('\n[order-utils] isActive / countActive');
// 案C: review は active、shipped のみ完了扱い (Marcus/Emily 一致)
const sample = [
  { id: 'a', status: 'received', archived: false },
  { id: 'b', status: 'making', archived: false },
  { id: 'c', status: 'shipped', archived: false },     // shipped excluded
  { id: 'd', status: 'review', archived: false },      // review IS active (案C)
  { id: 'e', status: 'making', archived: true },       // archived excluded
];
eq(O.countActive(sample), 3, 'countActive: received/making/review = 3 (案C)');
truthy(O.isActive(sample[0]), 'received is active');
truthy(!O.isActive(sample[2]), 'shipped is NOT active');
truthy(O.isActive(sample[3]), 'review IS active (案C)');
truthy(!O.isActive(sample[4]), 'archived is NOT active');

console.log('\n[order-utils] dueLevel');
const today = '2026-05-07';
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-05' }, today), 'overdue', 'past date is overdue');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: today }, today), 'today', 'same date is today');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-09' }, today), 'soon', '2 days out is soon');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-30' }, today), 'future', 'far future is future');
eq(O.dueLevel({ status: 'shipped', archived: false, dueDate: '2026-05-05' }, today), 'none', 'shipped order has no due level');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: null }, today), 'none', 'no due date returns none');

console.log('\n[order-utils] FREE_ACTIVE_LIMIT');
eq(O.FREE_ACTIVE_LIMIT, 10, 'free limit is 10');

// ---- csv-utils.js ----
console.log('\n[csv-utils] parseCSV');
const csv1 = 'Order ID,Buyer,Variations,Ship by Date\n123456,Sarah K.,"Engrave ""Mom""",2026-06-15\n789012,Marcus R.,Color: Blue,06/30/2026';
const rows = C.parseCSV(csv1);
eq(rows.length, 2, '2 data rows');
eq(rows[0]['order id'], '123456', 'first row order id');
eq(rows[0]['buyer'], 'Sarah K.', 'first row buyer');
eq(rows[0]['variations'], 'Engrave "Mom"', 'first row escaped quotes preserved');

console.log('\n[csv-utils] normalizeOrderRow');
const norm1 = C.normalizeOrderRow(rows[0]);
truthy(norm1, 'normalize returns object');
eq(norm1.orderNo, '123456', 'normalized order no');
eq(norm1.customer, 'Sarah K.', 'normalized customer');
eq(norm1.dueDate, '2026-06-15', 'ISO date pass-through');

const norm2 = C.normalizeOrderRow(rows[1]);
eq(norm2.dueDate, '2026-06-30', 'US m/d/yyyy converted to ISO');

console.log('\n[csv-utils] normalizeDate');
eq(C.normalizeDate('2026-06-15'), '2026-06-15', 'ISO');
eq(C.normalizeDate('06/15/2026'), '2026-06-15', 'US');
eq(C.normalizeDate('15.06.2026'), '2026-06-15', 'EU');
eq(C.normalizeDate(''), null, 'empty');

console.log('\n[csv-utils] notesToCSV roundtrip');
const notes = [
  { orderNo: '111', platform: 'etsy', customer: 'A, B', request: 'a "quoted" word\nnewline', dueDate: '2026-06-01', status: 'making', archived: false, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-02T00:00:00Z' }
];
const out = C.notesToCSV(notes);
truthy(out.includes('"A, B"'), 'comma in customer escaped');
truthy(out.includes('"a ""quoted"" word\nnewline"'), 'quotes and newline escaped');
const parsedBack = C.parseCSV(out);
eq(parsedBack[0].customer, 'A, B', 'roundtrip customer with comma');
eq(parsedBack[0].request, 'a "quoted" word\nnewline', 'roundtrip request with quotes/newline');

console.log('\n[csv-utils] CSV injection prevention');
{
  const evil = [{ orderNo: '=cmd|"calc"!A0', customer: 'foo' }];
  truthy(C.notesToCSV(evil).includes("'=cmd"), 'leading = is escaped');
  truthy(C.notesToCSV([{ orderNo: '+attack' }]).includes("'+attack"), 'leading + is escaped');
  truthy(C.notesToCSV([{ orderNo: '-attack' }]).includes("'-attack"), 'leading - is escaped');
  truthy(C.notesToCSV([{ orderNo: '@attack' }]).includes("'@attack"), 'leading @ is escaped');
  truthy(C.notesToCSV([{ orderNo: '\tattack' }]).includes("'\tattack"), 'leading TAB is escaped');
  truthy(C.notesToCSV([{ orderNo: '\rattack' }]).includes("'\rattack"), 'leading CR is escaped');
  truthy(!C.notesToCSV([{ orderNo: 'safe' }]).includes("'safe"), 'safe value is NOT escaped');
}

// ---------- ここから追加カバレッジ ----------

console.log('\n[order-utils] parseOrderUrl - 追加境界');
eq(O.parseOrderUrl('HTTPS://WWW.ETSY.COM/your/orders/sold/3987654321'),
   { platform: 'etsy', orderNo: '3987654321' }, 'Etsy 大文字混在スキーム');
eq(O.parseOrderUrl('https://www.etsy.com/your/orders/sold/12345'),
   null, 'Etsy 5桁は拒否（最低6桁）');
eq(O.parseOrderUrl('https://www.etsy.com/your/orders/sold/123456'),
   { platform: 'etsy', orderNo: '123456' }, 'Etsy 6桁は受理');
eq(O.parseOrderUrl('   https://www.etsy.com/your/orders/sold/3987654321   '),
   { platform: 'etsy', orderNo: '3987654321' }, '前後空白はトリム');
eq(O.parseOrderUrl(undefined), null, 'undefined入力で null');
eq(O.parseOrderUrl(123), null, '数値入力で null（または string化して照合）'); // 123は文字列化しても URL ではないので null
eq(O.parseOrderUrl('https://www.etsy.com/listing/12345/foo'),
   null, 'Etsy 商品ページURLは拒否（注文ではない）');

console.log('\n[order-utils] nextStatus / prevStatus - 全遷移');
eq(O.nextStatus('received'),  'making',   'received->making');
eq(O.nextStatus('making'),    'packing',  'making->packing');
eq(O.nextStatus('packing'),   'shipped',  'packing->shipped');
eq(O.nextStatus('shipped'),   'review',   'shipped->review');
eq(O.nextStatus('review'),    'review',   'review->review (terminal)');
eq(O.prevStatus('received'),  'received', 'received->received (terminal)');
eq(O.prevStatus('making'),    'received', 'making->received');
eq(O.prevStatus('packing'),   'making',   'packing->making');
eq(O.prevStatus('shipped'),   'packing',  'shipped->packing');
eq(O.prevStatus('review'),    'shipped',  'review->shipped');
eq(O.nextStatus('UNKNOWN'),   'UNKNOWN',  'unknown next stays');
eq(O.prevStatus('UNKNOWN'),   'UNKNOWN',  'unknown prev stays');

console.log('\n[order-utils] STATUSES 順序とラベル');
eq(O.STATUSES, ['received', 'making', 'packing', 'shipped', 'review'], 'STATUSES 5段階の順序');
eq(O.STATUS_LABELS.received, 'Received', 'label received');
eq(O.STATUS_LABELS.review,   'Review',   'label review');

console.log('\n[order-utils] isActive - エッジ');
truthy(!O.isActive(null), 'null は active ではない');
truthy(!O.isActive(undefined), 'undefined は active ではない');
truthy(O.isActive({ status: 'review', archived: false }), 'review は active (案C)');
truthy(!O.isActive({ status: 'shipped', archived: false }), 'shipped は active ではない (案C)');
truthy(O.isActive({ status: 'packing', archived: false }), 'packing は active');
truthy(!O.isActive({ status: 'making', archived: true }), 'archived は active ではない');

console.log('\n[order-utils] countActive - エッジ');
eq(O.countActive([]), 0, '空配列で 0');
eq(O.countActive([{ status: 'shipped', archived: false }]), 0, '全 shipped で 0');
eq(O.countActive([
  { status: 'received', archived: false },
  { status: 'making', archived: false },
  { status: 'packing', archived: false }
]), 3, '全 active で 3');

console.log('\n[order-utils] dueLevel - 境界値');
const D = '2026-05-07';
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-06' }, D), 'overdue', '前日 = overdue');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-08' }, D), 'soon',    '翌日 = soon');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-10' }, D), 'soon',    '+3日 = soon');
eq(O.dueLevel({ status: 'making', archived: false, dueDate: '2026-05-11' }, D), 'future',  '+4日 = future');
eq(O.dueLevel({ archived: true, status: 'making', dueDate: '2026-05-05' }, D),  'none',    'archived は none');
eq(O.dueLevel(null, D), 'none', 'null note は none');

console.log('\n[order-utils] isoDate - ゼロ埋め');
eq(O.isoDate(new Date(2026, 0, 5)),  '2026-01-05', '1月5日 -> ゼロ埋め');
eq(O.isoDate(new Date(2026, 11, 31)), '2026-12-31', '12月31日');

console.log('\n[order-utils] newId - 一意性');
{
  const seen = new Set();
  let collision = 0;
  for (let i = 0; i < 5000; i++) {
    const id = O.newId();
    if (seen.has(id)) collision++;
    seen.add(id);
  }
  eq(collision, 0, '5000回連続生成で衝突なし');
  truthy(O.newId().startsWith('n_'), 'newId プレフィックス n_');
}

console.log('\n[order-utils] defaultChecklist');
{
  const cl = O.defaultChecklist();
  eq(cl.length, 5, 'プリセット5項目');
  truthy(cl.every(x => typeof x.text === 'string' && typeof x.done === 'boolean'),
         '各項目に text と done');
  truthy(cl.every(x => x.done === false), '初期は全 done=false');
  // mutate しても次の呼び出しは独立であること
  cl[0].done = true;
  eq(O.defaultChecklist()[0].done, false, '次の呼出は独立 (深い参照共有なし)');
}

console.log('\n[order-utils] applyExportFilter - 各フィルタ');
{
  const today = new Date(2026, 4, 7); // 2026-05-07 ローカル
  const ds = (y, m, d) => O.isoDate(new Date(y, m, d));
  const data = [
    { id: 'a', status: 'received', archived: false, dueDate: ds(2026, 4, 7),  customer: 'Alice', orderNo: '111', request: 'engrave' }, // this month
    { id: 'b', status: 'making',   archived: false, dueDate: ds(2026, 4, 15), customer: 'Bob',   orderNo: '222', request: 'rush' },     // this month
    { id: 'c', status: 'shipped',  archived: false, dueDate: ds(2026, 3, 20), customer: 'Carol', orderNo: '333', request: 'std' },     // last month
    { id: 'd', status: 'review',   archived: false, dueDate: ds(2026, 2, 5),  customer: 'Dave',  orderNo: '444', request: '' },        // 2 months ago
    { id: 'e', status: 'making',   archived: true,  dueDate: ds(2026, 4, 1),  customer: 'Eve',   orderNo: '555', request: 'archived' }
  ];
  eq(O.applyExportFilter(data, 'all', '', today).length, 5, 'all = 5件');
  // 案C: review も active カウント、shipped のみ完了扱い
  eq(O.applyExportFilter(data, 'active', '', today).map(n => n.id), ['a', 'b', 'd'], 'active = received/making/review (案C)');
  eq(O.applyExportFilter(data, 'shipped', '', today).map(n => n.id), ['c'], 'shipped = c のみ');
  // 案C: archived は archived フラグ true のみ。review は active 扱い
  eq(O.applyExportFilter(data, 'archived', '', today).map(n => n.id).sort(), ['e'], 'archived = archived フラグ true のみ (案C)');
  // this-month は archived も含めて dueDate が今月のものを返す（仕様）
  eq(O.applyExportFilter(data, 'this-month', '', today).map(n => n.id).sort(), ['a', 'b', 'e'], 'this-month (archived も含む)');
  eq(O.applyExportFilter(data, 'last-month', '', today).map(n => n.id), ['c'], 'last-month');
  eq(O.applyExportFilter(data, 'last-3-months', '', today).map(n => n.id).sort(), ['a','b','c','d','e'], 'last-3-months 全部入る');
  eq(O.applyExportFilter(data, 'search', 'rush', today).map(n => n.id), ['b'], 'search = b');
  eq(O.applyExportFilter(data, 'search', 'BOB', today).map(n => n.id), ['b'], 'search 大文字無視');
  eq(O.applyExportFilter(data, 'search', '', today).length, 5, 'search クエリ空 = 全件');
  eq(O.applyExportFilter([], 'all', '', today).length, 0, '空配列入力で 0');
  eq(O.applyExportFilter(null, 'all', '', today).length, 0, 'null 入力で 0');
  eq(O.applyExportFilter(data, 'unknown-filter', '', today).length, 5, '未知 filter は全件 (default)');
}

console.log('\n[csv-utils] parseCSV - エッジ');
eq(C.parseCSV('').length, 0, '空CSVは 0行');
eq(C.parseCSV('Order,Buyer\n').length, 0, 'ヘッダーのみは 0行');
{
  // CRLF
  const r = C.parseCSV('Order,Buyer\r\n111,Alice\r\n222,Bob');
  eq(r.length, 2, 'CRLF で 2行');
  eq(r[0]['order'], '111', 'CRLF parse OK');
}
{
  // 末尾に改行なし
  const r = C.parseCSV('Order,Buyer\n111,Alice');
  eq(r.length, 1, '末尾改行なしでも 1行');
}
{
  // quoted セル内の改行・カンマ・クォート
  const r = C.parseCSV('A,B\n"a, b","line1\nline2"\n"esc ""quote""",second');
  eq(r[0]['a'], 'a, b', 'quoted カンマ');
  eq(r[0]['b'], 'line1\nline2', 'quoted 改行');
  eq(r[1]['a'], 'esc "quote"', 'エスケープされた quote');
}

console.log('\n[csv-utils] normalizeOrderRow - 列名バリエーション');
{
  const cases = [
    [{ 'order id': '111', 'buyer': 'A' }, { orderNo: '111', customer: 'A' }],
    [{ 'order number': '222', 'customer': 'B' }, { orderNo: '222', customer: 'B' }],
    [{ 'order #': '333', 'ship name': 'C' }, { orderNo: '333', customer: 'C' }],
    [{ 'name': '#444', 'full name': 'D' }, { orderNo: '444', customer: 'D' }], // # 除去
    // # プレフィックスなしの数値だけだと、'name' は orderNo に流れるが platform 判定までは
    // 行わない（実装の意図的な限界）。manual のままで良い。
    [{ 'name': '5123456789' }, { orderNo: '5123456789', platform: 'manual' }]
  ];
  for (const [row, expect] of cases) {
    const got = C.normalizeOrderRow(row);
    truthy(got, `normalize ${JSON.stringify(row)}`);
    if (expect.orderNo) eq(got.orderNo, expect.orderNo, `  -> orderNo ${expect.orderNo}`);
    if (expect.customer) eq(got.customer, expect.customer, `  -> customer ${expect.customer}`);
    if (expect.platform) eq(got.platform, expect.platform, `  -> platform ${expect.platform}`);
  }
  eq(C.normalizeOrderRow({ 'foo': 'bar' }), null, 'orderNo列がない -> null');
}

console.log('\n[csv-utils] normalizeDate - 不正format');
eq(C.normalizeDate('not a date'), null, '不正文字列は null');
eq(C.normalizeDate(null), null, 'null は null');
eq(C.normalizeDate(undefined), null, 'undefined は null');
eq(C.normalizeDate('2026-1-5'),  '2026-01-05', '月日1桁 ISO もゼロ埋め');
eq(C.normalizeDate('1/5/2026'),  '2026-01-05', 'US 月日1桁');
eq(C.normalizeDate('5.1.2026'),  '2026-01-05', 'EU 月日1桁');

console.log('\n[csv-utils] pickFirst');
eq(C.pickFirst({ a: '', b: 'X', c: 'Y' }, ['a', 'b', 'c']), 'X', '空をスキップして次');
eq(C.pickFirst({ a: '  ', b: 'X' }, ['a', 'b']), 'X', '空白のみは空扱い');
eq(C.pickFirst({}, ['a', 'b']), '', '全部なし -> 空文字');
eq(C.pickFirst({ a: 'first' }, ['a', 'b']), 'first', '一致したらそこで停止');

console.log('\n[csv-utils] notesToCSV - エッジ');
{
  const empty = C.notesToCSV([]);
  truthy(empty.startsWith('orderNo,'), '空配列でもヘッダー出力');
  // undefined フィールド
  const partial = C.notesToCSV([{ orderNo: 'X' }]);
  const lines = partial.split(/\r?\n/);
  eq(lines.length, 2, '1件 = 2行（ヘッダ+データ）');
  truthy(lines[1].startsWith('X,'), 'orderNo は出る、他は空');
}

console.log(`\n=== Result ===`);
console.log(`Pass: ${pass} / Fail: ${fail}`);
if (fail > 0) process.exit(1);
process.exit(0);
