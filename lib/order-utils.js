// 注文ユーティリティ。
// URL貼付パース・状態遷移・アクティブ判定など、純粋関数だけをまとめている。
// ブラウザ (window.OrderUtils) と Node.js (module.exports) の両方で使えるようにする。

const STATUSES = ['received', 'making', 'packing', 'shipped', 'review'];
const STATUS_LABELS = {
  received: 'Received',
  making: 'Making',
  packing: 'Packing',
  shipped: 'Shipped',
  review: 'Review'
};

// アクティブ枠から外す状態。
// 仕様（案C, ペルソナ会議 Marcus/Emily 一致）:
//   - shipped: 物理発送済み = ユーザーが触らない完了状態 → popup から消す
//   - review : レビュー依頼DMの送信などコミュニケーション作業が残る → active のまま
//   - archive: review でも Next を押せば archived フラグが立って一覧から消える
const COMPLETED_STATUSES = new Set(['shipped']);

const FREE_ACTIVE_LIMIT = 10;

// Etsy / Shopify URL から注文番号を抽出する。
// host_permissions なし、popup内のテキスト処理のみで完結する。
function parseOrderUrl(input) {
  if (!input) return null;
  const text = String(input).trim();

  // Etsy: 受注画面のURLパターンは複数ある:
  //   - /your/orders/sold/<receipt_id>
  //   - /your/shops/<shop>/orders/sold/<receipt_id>
  //   - /your/orders/sold/transaction:<id>  (transactionプレフィックス付き)
  // 末尾の連続する6桁以上の数値を拾う方針で吸収する。
  const etsyMatch =
    text.match(/etsy\.com\/your\/(?:orders\/sold|shops\/[^\/]+\/orders\/sold)[^?#]*?\/(?:transaction:)?(\d{6,})/i);
  if (etsyMatch) {
    return { platform: 'etsy', orderNo: etsyMatch[1] };
  }

  // Shopify URL は3形式ある（2026-05時点で Shopify 公式ドキュメント確認済み）:
  //   - 統合 admin: https://admin.shopify.com/store/<store>/orders/<numeric_id>
  //   - ショートカット: https://admin.shopify.com/orders/<numeric_id> （ログイン中ストアへリダイレクト）
  //   - 旧 admin:    https://<store>.myshopify.com/admin/orders/<id>
  // store/<store>/ 部分を optional にすることで上の2形式を1パターンで吸収する。
  const shopifyMatch =
    text.match(/admin\.shopify\.com\/(?:store\/[\w-]+\/)?orders\/(\d{6,})/i) ||
    text.match(/[\w-]+\.myshopify\.com\/admin\/orders\/(\d{6,})/i);
  if (shopifyMatch) {
    return { platform: 'shopify', orderNo: shopifyMatch[1] };
  }

  return null;
}

function nextStatus(current) {
  const idx = STATUSES.indexOf(current);
  if (idx < 0 || idx >= STATUSES.length - 1) return current;
  return STATUSES[idx + 1];
}

function prevStatus(current) {
  const idx = STATUSES.indexOf(current);
  if (idx <= 0) return current;
  return STATUSES[idx - 1];
}

function isActive(note) {
  if (!note) return false;
  if (note.archived) return false;
  return !COMPLETED_STATUSES.has(note.status);
}

function countActive(notes) {
  return notes.filter(isActive).length;
}

// 期限ステータス: 'overdue' | 'today' | 'soon' | 'future' | 'none'
function dueLevel(note, todayISO) {
  if (!note || !note.dueDate) return 'none';
  if (!isActive(note)) return 'none';
  if (note.dueDate < todayISO) return 'overdue';
  if (note.dueDate === todayISO) return 'today';

  // 3日以内を soon
  const due = new Date(note.dueDate + 'T00:00:00');
  const today = new Date(todayISO + 'T00:00:00');
  const diff = Math.round((due - today) / 86400000);
  if (diff <= 3) return 'soon';
  return 'future';
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function newId() {
  return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// プリセット5ステップのチェックリスト（v1.0は固定、v1.1でカスタマイズ追加検討）
function defaultChecklist() {
  return [
    { text: 'Confirm details with buyer', done: false },
    { text: 'Source materials', done: false },
    { text: 'Make / produce', done: false },
    { text: 'Pack & label', done: false },
    { text: 'Send tracking link', done: false }
  ];
}

// CSV エクスポート用フィルタ。
// filter: 'all' | 'active' | 'shipped' | 'archived' |
//         'this-month' | 'last-month' | 'last-3-months' | 'search'
// query: 'search' のときに使う検索文字列
// today: テスト用に注入可能。省略時は new Date() を使う
function applyExportFilter(notes, filter, query, today) {
  const t = today || new Date();
  const ymThis = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const ymLast = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const threeMonthsAgo = new Date(t.getFullYear(), t.getMonth() - 2, 1);
  const threeAgoISO = isoDate(threeMonthsAgo);

  if (!Array.isArray(notes)) return [];

  switch (filter) {
    case 'active':
      return notes.filter(n => isActive(n));
    case 'shipped':
      return notes.filter(n => !n.archived && n.status === 'shipped');
    case 'archived':
      // 案C準拠: archived フラグが立っているものだけ。
      // shipped は別フィルタ 'shipped' で取得可能、review は active 扱い。
      return notes.filter(n => n.archived);
    case 'this-month':
      return notes.filter(n => n.dueDate && n.dueDate.startsWith(ymThis));
    case 'last-month':
      return notes.filter(n => n.dueDate && n.dueDate.startsWith(ymLast));
    case 'last-3-months':
      return notes.filter(n => n.dueDate && n.dueDate >= threeAgoISO);
    case 'search': {
      if (!query) return notes;
      const q = String(query).toLowerCase();
      return notes.filter(n =>
        (n.orderNo || '').toLowerCase().includes(q) ||
        (n.customer || '').toLowerCase().includes(q) ||
        (n.request || '').toLowerCase().includes(q)
      );
    }
    default:
      return notes;
  }
}

const ORDER_UTILS_API = {
  STATUSES,
  STATUS_LABELS,
  COMPLETED_STATUSES,
  FREE_ACTIVE_LIMIT,
  parseOrderUrl,
  nextStatus,
  prevStatus,
  isActive,
  countActive,
  dueLevel,
  isoDate,
  newId,
  defaultChecklist,
  applyExportFilter
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ORDER_UTILS_API;
}
if (typeof window !== 'undefined') {
  window.OrderUtils = ORDER_UTILS_API;
}
