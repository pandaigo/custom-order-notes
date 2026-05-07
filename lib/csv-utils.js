// CSV パース・生成のユーティリティ。
// ブラウザ (window.CSVUtils) と Node.js (module.exports) の両方で使える。
// ヘッダー名マッピングで Etsy 公式CSV の列名変更にも耐える設計。

// quoted セル内の改行・カンマを正しく保持するマルチライン対応 CSV パーサ。
function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
  }
  // 末尾セル
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  // 完全に空の行は捨てる
  return rows.filter(r => r.some(c => c.length > 0));
}

// 1行分だけパースする後方互換 API（テストや単純用途用）。
function parseCSVLine(line) {
  const rows = parseCSVRows(line);
  return rows[0] || [];
}

function parseCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.toLowerCase().trim());
  return rows.slice(1).map(cells => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] != null ? cells[i] : ''; });
    return obj;
  });
}

// 注文CSV行を内部 note フォーマットに正規化する。
// Etsy 公式CSV (Sold Orders / Sold Order Items) の列名と、
// Shopify Order Export の列名と、汎用フォーマットの3系統を吸収する。
function normalizeOrderRow(row) {
  // 注文番号
  const orderNo = pickFirst(row, [
    'order id', 'order number', 'order #', 'order_id', 'name'
  ]);
  if (!orderNo) return null;

  // 顧客名
  const customer = pickFirst(row, [
    'buyer', 'buyer name', 'customer', 'customer name', 'ship name', 'full name'
  ]);

  // カスタム要望
  const request = pickFirst(row, [
    'variations', 'personalization', 'custom request', 'message from buyer',
    'note from buyer', 'notes', 'item name', 'product'
  ]);

  // 期限・配送予定日
  const dueDate = normalizeDate(pickFirst(row, [
    'ship by date', 'ship by', 'expected ship date', 'due date', 'fulfillment by'
  ]));

  // プラットフォーム推定
  let platform = 'manual';
  const orderIdRaw = String(row['order id'] || '');
  if (row['ship by date'] || row['variations'] || row['transaction id']) platform = 'etsy';
  else if (row['name'] && row['name'].startsWith && row['name'].startsWith('#')) platform = 'shopify';
  else if (orderIdRaw.length >= 9) platform = 'shopify';

  return {
    platform,
    orderNo: String(orderNo).replace(/^#/, '').trim(),
    customer: (customer || '').trim(),
    request: (request || '').trim(),
    dueDate
  };
}

function pickFirst(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

// note 配列を CSV にエクスポートする。
function notesToCSV(notes) {
  const headers = ['orderNo', 'platform', 'customer', 'request', 'dueDate', 'status', 'archived', 'createdAt', 'updatedAt'];
  const rows = [headers.join(',')];
  for (const n of notes) {
    const row = headers.map(h => {
      let v = n[h];
      if (v == null) v = '';
      v = String(v);
      // CSV injection 対策（OWASP 推奨の = + - @ TAB CR を全カバー）
      if (/^[=@+\-\t\r]/.test(v)) v = "'" + v;
      if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    });
    rows.push(row.join(','));
  }
  return rows.join('\r\n');
}

function normalizeDate(s) {
  if (!s) return null;
  const text = String(s).trim();

  // ISO yyyy-mm-dd (or yyyy-m-d)
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  // US m/d/yyyy
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  // EU d.m.yyyy
  m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const CSV_UTILS_API = { parseCSV, parseCSVLine, normalizeOrderRow, notesToCSV, normalizeDate, pickFirst };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSV_UTILS_API;
}
if (typeof window !== 'undefined') {
  window.CSVUtils = CSV_UTILS_API;
}
