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
const sample = [
  { id: 'a', status: 'received', archived: false },
  { id: 'b', status: 'making', archived: false },
  { id: 'c', status: 'shipped', archived: false },     // shipped excluded
  { id: 'd', status: 'review', archived: false },      // review excluded
  { id: 'e', status: 'making', archived: true },       // archived excluded
];
eq(O.countActive(sample), 2, 'countActive counts only non-shipped non-archived');
truthy(O.isActive(sample[0]), 'received is active');
truthy(!O.isActive(sample[2]), 'shipped is NOT active');
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
const evil = [{ orderNo: '=cmd|"calc"!A0', customer: 'foo' }];
const evilOut = C.notesToCSV(evil);
truthy(evilOut.includes("'=cmd"), 'leading = is escaped with apostrophe');

console.log(`\n=== Result ===`);
console.log(`Pass: ${pass} / Fail: ${fail}`);
if (fail > 0) process.exit(1);
process.exit(0);
