// Options page — All orders / Archive / Import-Export / About

const extpay = ExtPay('custom-order-notes');
const O = window.OrderUtils;
const C = window.CSVUtils;

let state = {
  notes: [],
  isPaid: false,
  query: '',
  pendingImport: null,    // { rows: [{normalized, skip, dup}], counts }
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await load();
  bindEvents();
  renderAll();

  try {
    const user = await extpay.getUser();
    if (user.paid && !state.isPaid) {
      state.isPaid = true;
      await chrome.storage.local.set({ isPaid: true });
      renderAll();
    }
  } catch (_) {}
}

async function load() {
  const data = await chrome.storage.local.get(['notes', 'isPaid']);
  state.notes = Array.isArray(data.notes) ? data.notes : [];
  state.isPaid = !!data.isPaid;
}

async function save() {
  await chrome.storage.local.set({ notes: state.notes });
}

// ---------- Render ----------

function renderAll() {
  $('#paid-pill').textContent = state.isPaid ? 'PRO' : '';
  renderOrders();
  renderArchive();
  updateExportCount();
}

function renderOrders() {
  const tbody = $('#orders-tbody');
  const todayISO = O.isoDate(new Date());
  let active = state.notes.filter(n => O.isActive(n));
  if (state.query) {
    const q = state.query.toLowerCase();
    active = active.filter(n =>
      (n.orderNo || '').toLowerCase().includes(q) ||
      (n.customer || '').toLowerCase().includes(q) ||
      (n.request || '').toLowerCase().includes(q)
    );
  }
  // 期限昇順、期限なしは末尾。'9999' を雑に当てると localeCompare で先頭に来てしまうので
  // 明示的に null を末尾扱いする。
  active.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  $('#orders-summary').textContent =
    state.isPaid
      ? `${active.length} active · Pro (unlimited)`
      : `${O.countActive(state.notes)}/${O.FREE_ACTIVE_LIMIT} active · Free`;

  if (active.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No orders. Add from the popup or import a CSV.</td></tr>`;
    return;
  }

  tbody.innerHTML = active.map(n => {
    const due = n.dueDate ? formatDue(n.dueDate, todayISO) : '';
    const dueLvl = O.dueLevel(n, todayISO);
    return `
      <tr data-id="${esc(n.id)}">
        <td><strong>#${esc(n.orderNo || '?')}</strong></td>
        <td>${esc(n.customer || '')}</td>
        <td class="col-req" title="${esc(n.request || '')}">${esc(n.request || '')}</td>
        <td class="due-cell ${dueLvl}">${esc(due)}</td>
        <td><span class="status-pill ${n.status}">${esc(O.STATUS_LABELS[n.status] || '')}</span></td>
        <td class="row-actions">
          <button class="btn-mini" data-act="prev"${O.STATUSES.indexOf(n.status) <= 0 ? ' disabled' : ''}>← Back</button>
          <button class="btn-mini" data-act="next">Next →</button>
          <button class="btn-mini danger" data-act="archive">Archive</button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderArchive() {
  const tbody = $('#archive-tbody');
  const archived = state.notes.filter(n => !O.isActive(n));
  archived.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (archived.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No archived orders.</td></tr>`;
    return;
  }

  tbody.innerHTML = archived.map(n => `
    <tr data-id="${esc(n.id)}">
      <td><strong>#${esc(n.orderNo || '?')}</strong></td>
      <td>${esc(n.customer || '')}</td>
      <td class="col-req" title="${esc(n.request || '')}">${esc(n.request || '')}</td>
      <td><span class="status-pill ${n.status}">${esc(O.STATUS_LABELS[n.status] || '')}</span></td>
      <td class="row-actions">
        <button class="btn-mini" data-act="restore">Restore</button>
        <button class="btn-mini danger" data-act="delete">Delete</button>
      </td>
    </tr>
  `).join('');
}

function formatDue(iso, todayISO) {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(todayISO + 'T00:00:00');
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff < 0) return `${-diff}d late`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Actions ----------

async function rowAction(noteId, act) {
  const n = state.notes.find(x => x.id === noteId);
  if (!n) return;
  if (act === 'next') {
    if (O.STATUSES.indexOf(n.status) >= O.STATUSES.length - 1) {
      n.archived = true;
    } else {
      n.status = O.nextStatus(n.status);
    }
  } else if (act === 'prev') {
    // 最初のステータス (received) では何もしない（disabled側で防いでいるが念のため）
    if (O.STATUSES.indexOf(n.status) > 0) {
      n.status = O.prevStatus(n.status);
    }
  } else if (act === 'archive') {
    n.archived = true;
  } else if (act === 'restore') {
    n.archived = false;
    if (n.status === 'shipped' || n.status === 'review') n.status = 'making';
  } else if (act === 'delete') {
    const ok = await confirmModal(`Delete order #${n.orderNo} permanently?`);
    if (!ok) return;
    state.notes = state.notes.filter(x => x.id !== noteId);
  }
  n.updatedAt = new Date().toISOString();
  await save();
  renderAll();
}

// ---------- CSV import ----------

async function handleCsvFile(file) {
  // CSV import は Free でも実行可能。Free 上限超過時は通常の追加と同じく
  // 11件目で upgrade モーダルが出る（既存ロジック）。
  const text = await file.text();
  const rawRows = C.parseCSV(text);
  if (rawRows.length === 0) {
    showToast('Empty CSV');
    return;
  }
  // 重複判定は platform + orderNo の複合キー。
  // Etsy と Shopify で同じ番号が衝突しても誤検出されないようにする。
  const existingKeys = new Set(
    state.notes
      .filter(n => n.orderNo)
      .map(n => `${n.platform || 'manual'}::${n.orderNo}`)
  );
  const rows = rawRows.map(r => {
    const norm = C.normalizeOrderRow(r);
    if (!norm) return { skip: true, reason: 'No order number column found' };
    const dup = existingKeys.has(`${norm.platform || 'manual'}::${norm.orderNo}`);
    return { normalized: norm, dup };
  });
  const ok = rows.filter(r => !r.skip && !r.dup);
  const dup = rows.filter(r => !r.skip && r.dup).length;
  const skip = rows.filter(r => r.skip).length;
  state.pendingImport = { rows };
  $('#import-summary').textContent =
    `Found ${rawRows.length} rows. Will import ${ok.length} new orders. ` +
    `Skip: ${dup} duplicates, ${skip} unparseable.`;
  $('#import-list').innerHTML = rows.slice(0, 50).map(r => {
    if (r.skip) return `<div class="row skipped">— ${esc(r.reason || 'skip')}</div>`;
    if (r.dup) return `<div class="row skipped">#${esc(r.normalized.orderNo)} ${esc(r.normalized.customer || '')} (already exists)</div>`;
    return `<div class="row">#${esc(r.normalized.orderNo)} · ${esc(r.normalized.customer || '(no buyer)')} · ${esc(r.normalized.request || '').slice(0, 60)}</div>`;
  }).join('') + (rows.length > 50 ? `<div class="row muted">…and ${rows.length - 50} more</div>` : '');
  $('#import-modal').classList.remove('hidden');
}

async function confirmImport() {
  if (!state.pendingImport) return;
  const ok = state.pendingImport.rows.filter(r => !r.skip && !r.dup);
  for (const r of ok) {
    const n = r.normalized;
    state.notes.push({
      id: O.newId(),
      platform: n.platform || 'manual',
      orderNo: n.orderNo,
      customer: n.customer,
      request: n.request,
      dueDate: n.dueDate,
      status: 'received',
      checklist: O.defaultChecklist(),
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  await save();
  state.pendingImport = null;
  $('#import-modal').classList.add('hidden');
  $('#csv-file').value = '';
  renderAll();
  showToast(`Imported ${ok.length} orders`);
}

// ---------- CSV export ----------

function exportCSV() {
  const sel = $('#export-filter');
  const filter = (sel && sel.value) || 'all';
  // 全件エクスポートは Free 可、月別/状態別/検索フィルタは Pro 限定。
  // 「データ持ち出し権は人権、業務効率は課金」の境界 (案3, 3名一致)。
  if (filter !== 'all' && !state.isPaid) {
    showToast('Filtered export is a Pro feature');
    showUpgrade();
    return;
  }
  const filtered = O.applyExportFilter(state.notes, filter, state.query);
  if (filtered.length === 0) {
    showToast('No orders matched the filter');
    return;
  }
  const csv = C.notesToCSV(filtered);
  const today = O.isoDate(new Date());
  const suffix = filter === 'all' ? '' : `-${filter}`;
  downloadFile(`custom-order-notes-${today}${suffix}.csv`, csv, 'text/csv');
  showToast(`Exported ${filtered.length} orders`);
}

function updateExportCount() {
  const sel = $('#export-filter');
  const out = $('#export-count');
  if (!sel || !out) return;
  const n = O.applyExportFilter(state.notes, sel.value, state.query).length;
  out.textContent = `${n} order${n === 1 ? '' : 's'} will be exported with this filter.`;
}

// ---------- JSON backup ----------

function exportJSON() {
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    appName: 'custom-order-notes',
    notes: state.notes
  };
  downloadFile(
    `custom-order-notes-backup-${O.isoDate(new Date())}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  );
}

async function importJSON(file) {
  const text = await file.text();
  let payload;
  try { payload = JSON.parse(text); } catch (_) {
    showToast('Invalid JSON');
    return;
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.notes)) {
    showToast('Backup file is not recognized');
    return;
  }
  if (payload.schemaVersion !== 1) {
    showToast(`Unsupported backup schema (v${payload.schemaVersion})`);
    return;
  }

  // 上書き前に現在のデータを必ず自動バックアップ。
  // 「妻が間違えて restore ボタンを押す」事故で過去データを消さないための保険。
  if (state.notes.length > 0) {
    const safetyName = `custom-order-notes-pre-restore-${O.isoDate(new Date())}-${Date.now()}.json`;
    const safetyPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      appName: 'custom-order-notes',
      reason: 'auto-backup-before-restore',
      notes: state.notes
    };
    downloadFile(safetyName, JSON.stringify(safetyPayload, null, 2), 'application/json');
  }

  const ok = await confirmModal(
    `Restore ${payload.notes.length} orders from backup?\n\n` +
    `Your current data has been auto-saved to your Downloads folder. ` +
    `This will replace all current data with the backup contents.`
  );
  if (!ok) return;
  state.notes = payload.notes;
  await save();
  renderAll();
  showToast(`Restored ${payload.notes.length} orders`);
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function clearAll() {
  const ok = await confirmModal('Permanently delete ALL orders (active + archived)? This cannot be undone.');
  if (!ok) return;
  state.notes = [];
  await save();
  renderAll();
  showToast('All orders deleted');
}

// ---------- Modals / toast ----------

function showUpgrade() {
  extpay.openPaymentPage();
}

let confirmResolver = null;
function confirmModal(text) {
  return new Promise(resolve => {
    $('#confirm-text').textContent = text;
    $('#confirm-modal').classList.remove('hidden');
    confirmResolver = resolve;
  });
}
function resolveConfirm(value) {
  $('#confirm-modal').classList.add('hidden');
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
}

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}

// ---------- Tabs ----------

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  ['orders', 'archive', 'data', 'about'].forEach(k => {
    const panel = document.getElementById('tab-' + k);
    if (panel) panel.classList.toggle('hidden', k !== name);
  });
}

// ---------- Events ----------

function bindEvents() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#orders-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderOrders();
  });

  $('#orders-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    rowAction(tr.dataset.id, btn.dataset.act);
  });

  $('#archive-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    rowAction(tr.dataset.id, btn.dataset.act);
  });

  $('#csv-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleCsvFile(f);
  });

  $('#import-confirm').addEventListener('click', confirmImport);
  $('#import-cancel').addEventListener('click', () => {
    $('#import-modal').classList.add('hidden');
    state.pendingImport = null;
    $('#csv-file').value = '';
  });

  $('#btn-csv-export').addEventListener('click', exportCSV);
  $('#export-filter').addEventListener('change', updateExportCount);
  $('#btn-json-export').addEventListener('click', exportJSON);
  $('#btn-json-import').addEventListener('click', () => $('#json-file').click());
  $('#json-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importJSON(f);
    e.target.value = '';
  });
  $('#btn-clear-all').addEventListener('click', clearAll);
  $('#btn-options-upgrade').addEventListener('click', () => extpay.openPaymentPage());

  $('#confirm-yes').addEventListener('click', () => resolveConfirm(true));
  $('#confirm-no').addEventListener('click', () => resolveConfirm(false));

  // Escape でモーダルを閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#confirm-modal').classList.contains('hidden')) {
      e.preventDefault();
      resolveConfirm(false);
    } else if (!$('#import-modal').classList.contains('hidden')) {
      e.preventDefault();
      $('#import-modal').classList.add('hidden');
      state.pendingImport = null;
      $('#csv-file').value = '';
    }
  });

  extpay.onPaid.addListener(() => {
    state.isPaid = true;
    chrome.storage.local.set({ isPaid: true });
    renderAll();
    showToast('Welcome to Pro!');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.notes) {
      state.notes = changes.notes.newValue || [];
      renderAll();
    }
    if (changes.isPaid) {
      state.isPaid = !!changes.isPaid.newValue;
      renderAll();
    }
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
