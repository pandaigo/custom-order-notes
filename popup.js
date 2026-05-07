// Custom Order Notes — popup
// データモデルは notes 配列（chrome.storage.local の 'notes' キー）に集約。
// 500件超でもたつくようなら note:<id> 別キー化を検討する（v1.1）。

const extpay = ExtPay('custom-order-notes');
const O = window.OrderUtils;

let state = {
  notes: [],
  isPaid: false,
  filter: 'all',
  query: '',
  view: 'main',           // 'main' | 'edit' | 'detail'
  editingId: null,
  detailId: null,
  todayISO: O.isoDate(new Date())
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadData();
  bindEvents();
  render();

  // ExtPay の最新状態を非同期で確認（決済直後の同期）
  syncPaidStatus();
}

async function loadData() {
  const data = await chrome.storage.local.get(['notes', 'isPaid']);
  state.notes = Array.isArray(data.notes) ? data.notes : [];
  state.isPaid = !!data.isPaid;
}

async function syncPaidStatus() {
  try {
    const user = await extpay.getUser();
    if (user.paid && !state.isPaid) {
      state.isPaid = true;
      await chrome.storage.local.set({ isPaid: true });
      render();
    }
  } catch (_) {}
}

async function saveNotes() {
  await chrome.storage.local.set({ notes: state.notes });
}

// ---------- Render ----------

function render() {
  switch (state.view) {
    case 'edit': renderEdit(); break;
    case 'detail': renderDetail(); break;
    default: renderMain();
  }
}

function renderMain() {
  showView('main-view');

  const all = state.notes;
  const visible = filterNotes(all, state.filter, state.query);

  // フィルタ件数（state.filter / state.query に依存しない、フィルタ単体の件数）
  setChipCount('all', all.filter(n => O.isActive(n)).length);
  setChipCount('today', all.filter(n => O.dueLevel(n, state.todayISO) === 'today').length);
  setChipCount('late', all.filter(n => O.dueLevel(n, state.todayISO) === 'overdue').length);
  setChipCount('ship', all.filter(n => O.isActive(n) && (n.status === 'packing' || n.status === 'making')).length);

  // クォータ
  const activeCount = O.countActive(all);
  const quotaEl = $('#quota-badge');
  if (state.isPaid) {
    quotaEl.textContent = 'Pro · unlimited';
    quotaEl.classList.remove('full');
  } else {
    quotaEl.textContent = `${activeCount}/${O.FREE_ACTIVE_LIMIT} Free`;
    quotaEl.classList.toggle('full', activeCount >= O.FREE_ACTIVE_LIMIT);
  }

  // フィルタ active 表示
  $$('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === state.filter));

  // リスト or empty
  const listEl = $('#list');
  const emptyEl = $('#empty');
  listEl.innerHTML = '';
  if (visible.length === 0) {
    if (all.length === 0) {
      emptyEl.classList.remove('hidden');
      listEl.classList.add('hidden');
    } else {
      emptyEl.classList.add('hidden');
      listEl.classList.remove('hidden');
      listEl.innerHTML = `<div class="empty" style="padding:18px 8px;font-size:12px;">No matches.</div>`;
    }
  } else {
    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');
    listEl.innerHTML = visible.map(renderNoteCard).join('');
  }

  // Paid badge
  $('#paid-badge').textContent = state.isPaid ? 'PRO' : '';
}

function setChipCount(key, n) {
  const el = document.querySelector(`.chip-count[data-count="${key}"]`);
  if (!el) return;
  el.textContent = n;
  el.dataset.value = String(n);
}

function filterNotes(notes, filter, query) {
  let result;
  switch (filter) {
    case 'today':
      result = notes.filter(n => O.dueLevel(n, state.todayISO) === 'today');
      break;
    case 'late':
      result = notes.filter(n => O.dueLevel(n, state.todayISO) === 'overdue');
      break;
    case 'ship':
      result = notes.filter(n => O.isActive(n) && (n.status === 'packing' || n.status === 'making'));
      break;
    default:
      // All = active のみ表示。完了済みは options で管理
      result = notes.filter(n => O.isActive(n));
  }
  if (query) {
    const q = query.toLowerCase();
    result = result.filter(n =>
      (n.orderNo || '').toLowerCase().includes(q) ||
      (n.customer || '').toLowerCase().includes(q) ||
      (n.request || '').toLowerCase().includes(q)
    );
  }
  // ソート: 期限昇順、期限なしは末尾
  result.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  return result;
}

function renderNoteCard(n) {
  const due = formatDue(n.dueDate);
  const dueLvl = O.dueLevel(n, state.todayISO);
  const dotIdx = O.STATUSES.indexOf(n.status);
  const dots = O.STATUSES.map((s, i) => `<span class="dot ${i <= dotIdx ? 'filled' : ''}" aria-hidden="true"></span>`).join('');
  const platform = n.platform && n.platform !== 'manual' ? `<span class="platform-pill">${esc(n.platform)}</span>` : '';
  const statusLabel = O.STATUS_LABELS[n.status] || '';
  const dueAria = due ? ` due ${due}` : '';
  return `
    <div class="note" data-id="${esc(n.id)}" role="button" tabindex="0" aria-label="Order ${esc(n.orderNo || 'unknown')}${n.customer ? ', ' + esc(n.customer) : ''}, status ${esc(statusLabel)}${dueAria}">
      <div class="note-header">
        ${platform}
        <span>#${esc(n.orderNo || '?')}</span>
        ${due ? `<span class="note-due ${dueLvl}">${esc(due)}</span>` : ''}
      </div>
      ${n.customer ? `<div class="note-customer">${esc(n.customer)}</div>` : ''}
      ${n.request ? `<div class="note-request">${esc(n.request)}</div>` : ''}
      <div class="note-status">
        <div class="note-dots" role="progressbar" aria-valuenow="${dotIdx + 1}" aria-valuemax="${O.STATUSES.length}" aria-label="Step ${dotIdx + 1} of ${O.STATUSES.length}: ${esc(statusLabel)}">${dots}</div>
        <span class="note-status-label">${esc(statusLabel)}</span>
      </div>
    </div>
  `;
}

function formatDue(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const today = new Date(state.todayISO + 'T00:00:00');
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) return `${-diff}d late`;
  if (diff <= 7) return `${diff}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Edit view ----------

function renderEdit() {
  showView('edit-view');
  const n = state.editingId ? state.notes.find(x => x.id === state.editingId) : null;
  $('#edit-title').textContent = n ? `Edit #${n.orderNo}` : 'New order';
  $('#f-url').value = '';
  $('#f-orderNo').value = n?.orderNo || '';
  $('#f-customer').value = n?.customer || '';
  $('#f-request').value = n?.request || '';
  $('#f-dueDate').value = n?.dueDate || '';
  $('#btn-delete').classList.toggle('hidden', !n);
}

function openEdit(id) {
  state.view = 'edit';
  state.editingId = id || null;
  render();
}

async function saveEdit() {
  const orderNo = $('#f-orderNo').value.trim();
  if (!orderNo) {
    showToast('Order # is required');
    return;
  }
  const customer = $('#f-customer').value.trim();
  const request = $('#f-request').value.trim();
  const dueDate = $('#f-dueDate').value || null;

  if (state.editingId) {
    const n = state.notes.find(x => x.id === state.editingId);
    if (n) {
      n.orderNo = orderNo;
      n.customer = customer;
      n.request = request;
      n.dueDate = dueDate;
      n.updatedAt = new Date().toISOString();
    }
  } else {
    // Free上限チェック
    if (!state.isPaid && O.countActive(state.notes) >= O.FREE_ACTIVE_LIMIT) {
      showUpgrade();
      return;
    }
    const urlInput = $('#f-url').value.trim();
    let platform = 'manual';
    if (urlInput) {
      const parsed = O.parseOrderUrl(urlInput);
      if (parsed) platform = parsed.platform;
    }
    state.notes.push({
      id: O.newId(),
      platform,
      orderNo,
      customer,
      request,
      dueDate,
      status: 'received',
      checklist: O.defaultChecklist(),
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  await saveNotes();
  state.view = 'main';
  state.editingId = null;
  render();
  showToast('Saved');
}

async function deleteEditing() {
  if (!state.editingId) return;
  const ok = await confirmModal('Delete this order? This cannot be undone.');
  if (!ok) return;
  state.notes = state.notes.filter(n => n.id !== state.editingId);
  await saveNotes();
  state.view = 'main';
  state.editingId = null;
  render();
  showToast('Deleted');
}

// ---------- Detail view ----------

function renderDetail() {
  showView('detail-view');
  const n = state.notes.find(x => x.id === state.detailId);
  if (!n) {
    state.view = 'main';
    render();
    return;
  }
  $('#d-orderNo').textContent = n.orderNo || '?';
  $('#d-customer').textContent = n.customer || '';
  $('#d-due').textContent = n.dueDate ? formatDue(n.dueDate) : 'No due date';
  $('#d-request').textContent = n.request || '(no request notes)';

  // status row
  const dotIdx = O.STATUSES.indexOf(n.status);
  const dots = O.STATUSES.map((s, i) => `<span class="dot ${i <= dotIdx ? 'filled' : ''}"></span>`).join('');
  $('#status-row').innerHTML = `
    <div class="status-current">${esc(O.STATUS_LABELS[n.status] || '')}</div>
    <div class="status-track">${dots}</div>
  `;
  const isLast = O.STATUSES.indexOf(n.status) >= O.STATUSES.length - 1;
  const nextLabel = isLast ? 'Archive' : `Move to ${O.STATUS_LABELS[O.nextStatus(n.status)]}`;
  $('#btn-next').textContent = nextLabel + ' →';
  $('#btn-next').dataset.nextAction = isLast ? 'archive' : 'next';

  // 戻すボタン: 最初のステータス (received) では無効化
  const isFirst = O.STATUSES.indexOf(n.status) <= 0;
  const prevBtn = $('#btn-prev');
  prevBtn.disabled = isFirst;
  prevBtn.title = isFirst
    ? 'Already at the first status'
    : `Move back to ${O.STATUS_LABELS[O.prevStatus(n.status)]}`;

  // checklist
  const cl = $('#checklist');
  cl.innerHTML = (n.checklist || []).map((item, i) => `
    <li class="${item.done ? 'done' : ''}" data-idx="${i}">
      <input type="checkbox" ${item.done ? 'checked' : ''} aria-label="Toggle">
      <span>${esc(item.text)}</span>
    </li>
  `).join('');
}

function openDetail(id) {
  state.view = 'detail';
  state.detailId = id;
  render();
}

async function advanceStatus() {
  const n = state.notes.find(x => x.id === state.detailId);
  if (!n) return;
  const action = $('#btn-next').dataset.nextAction;

  // 楽観的更新
  if (action === 'archive') {
    n.archived = true;
  } else {
    n.status = O.nextStatus(n.status);
  }
  n.updatedAt = new Date().toISOString();
  renderDetail();

  try {
    await saveNotes();
    if (action === 'archive') {
      state.view = 'main';
      render();
      showToast('Archived');
    }
  } catch (e) {
    showToast('Save failed, retry');
  }
}

async function regressStatus() {
  const n = state.notes.find(x => x.id === state.detailId);
  if (!n) return;
  if (O.STATUSES.indexOf(n.status) <= 0) return;
  // 楽観的更新
  n.status = O.prevStatus(n.status);
  n.updatedAt = new Date().toISOString();
  renderDetail();
  try { await saveNotes(); } catch (_) { showToast('Save failed, retry'); }
}

async function toggleChecklistItem(idx) {
  const n = state.notes.find(x => x.id === state.detailId);
  if (!n) return;
  if (!n.checklist || !n.checklist[idx]) return;
  n.checklist[idx].done = !n.checklist[idx].done;
  n.updatedAt = new Date().toISOString();
  renderDetail();
  try { await saveNotes(); } catch (_) { showToast('Save failed'); }
}

// ---------- Paste URL ----------

async function pasteUrl() {
  // Free 上限到達を先行判定。空フォーム→Save まで進ませてから upgrade を出すと
  // 入力した手間が無駄になりレビュー★1につながる。
  if (!state.isPaid && O.countActive(state.notes) >= O.FREE_ACTIVE_LIMIT) {
    showUpgrade();
    return;
  }

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    showToast('Allow clipboard access in the browser, or paste manually');
    openEdit();
    return;
  }
  const parsed = O.parseOrderUrl(text);
  if (!parsed) {
    showToast('No Etsy/Shopify order URL found');
    openEdit();
    setTimeout(() => $('#f-url').focus(), 30);
    return;
  }
  if (!state.isPaid && O.countActive(state.notes) >= O.FREE_ACTIVE_LIMIT) {
    showUpgrade();
    return;
  }
  // 既存に同じ orderNo があれば編集ジャンプ
  const existing = state.notes.find(n => n.orderNo === parsed.orderNo && !n.archived);
  if (existing) {
    openDetail(existing.id);
    showToast(`Order #${parsed.orderNo} already exists`);
    return;
  }
  openEdit();
  $('#f-url').value = text;
  $('#f-orderNo').value = parsed.orderNo;
  setTimeout(() => $('#f-customer').focus(), 30);
  showToast(`Parsed ${parsed.platform} #${parsed.orderNo}`);
}

// ---------- Modals ----------

function showUpgrade() {
  $('#upgrade-modal').classList.remove('hidden');
}

function closeUpgrade() {
  $('#upgrade-modal').classList.add('hidden');
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

// ---------- View switching ----------

function showView(id) {
  ['main-view', 'edit-view', 'detail-view'].forEach(v => {
    const el = document.getElementById(v);
    if (!el) return;
    el.classList.toggle('hidden', v !== id);
  });
}

// ---------- Events ----------

function bindEvents() {
  $('#btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // search
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderMain();
  });

  // filter chips
  $$('.chip').forEach(c => {
    c.addEventListener('click', () => {
      state.filter = c.dataset.filter;
      renderMain();
    });
  });

  // list (event delegation)
  $('#list').addEventListener('click', (e) => {
    const card = e.target.closest('.note');
    if (!card) return;
    openDetail(card.dataset.id);
  });

  // add bar
  $('#btn-add').addEventListener('click', () => {
    if (!state.isPaid && O.countActive(state.notes) >= O.FREE_ACTIVE_LIMIT) {
      showUpgrade();
      return;
    }
    openEdit();
  });
  $('#btn-paste').addEventListener('click', pasteUrl);
  $('#btn-add-empty').addEventListener('click', () => openEdit());

  // Edit view
  $('#btn-back').addEventListener('click', () => { state.view = 'main'; state.editingId = null; render(); });
  $('#btn-cancel').addEventListener('click', () => { state.view = 'main'; state.editingId = null; render(); });
  $('#btn-save').addEventListener('click', saveEdit);
  $('#btn-delete').addEventListener('click', deleteEditing);

  // URL field auto-parse on input
  $('#f-url').addEventListener('input', (e) => {
    const parsed = O.parseOrderUrl(e.target.value);
    if (parsed && !$('#f-orderNo').value) {
      $('#f-orderNo').value = parsed.orderNo;
    }
  });

  // Detail view
  $('#btn-detail-back').addEventListener('click', () => { state.view = 'main'; render(); });
  $('#btn-edit').addEventListener('click', () => openEdit(state.detailId));
  $('#btn-next').addEventListener('click', advanceStatus);
  $('#btn-prev').addEventListener('click', regressStatus);
  $('#checklist').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    toggleChecklistItem(parseInt(li.dataset.idx, 10));
  });

  // Upgrade
  $('#btn-upgrade').addEventListener('click', () => extpay.openPaymentPage());
  $('#btn-upgrade-close').addEventListener('click', closeUpgrade);
  extpay.onPaid.addListener(() => {
    state.isPaid = true;
    chrome.storage.local.set({ isPaid: true });
    closeUpgrade();
    render();
    showToast('Welcome to Pro!');
  });

  // Confirm modal
  $('#confirm-yes').addEventListener('click', () => resolveConfirm(true));
  $('#confirm-no').addEventListener('click', () => resolveConfirm(false));

  // Escape でモーダルを閉じる（フォーカストラップは v1.1）
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#confirm-modal').classList.contains('hidden')) {
      e.preventDefault();
      resolveConfirm(false);
    } else if (!$('#upgrade-modal').classList.contains('hidden')) {
      e.preventDefault();
      closeUpgrade();
    } else if (state.view === 'edit' || state.view === 'detail') {
      e.preventDefault();
      state.view = 'main';
      state.editingId = null;
      render();
    }
  });

  // .note カードを Enter / Space で開けるように（role="button" tabindex="0" を補完）
  $('#list').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.note');
    if (!card) return;
    e.preventDefault();
    openDetail(card.dataset.id);
  });

  // Storage sync (options 側で更新された場合に反映)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.notes) {
      // 編集中・詳細表示中に外部更新が来ると state.editingId / detailId が指す
      // 参照を消して save の find() が undefined を返す事故になる。
      // それを防ぐため、main view でない時は差し替えを保留する。
      if (state.view !== 'main') return;
      state.notes = changes.notes.newValue || [];
      render();
    }
    if (changes.isPaid) {
      state.isPaid = !!changes.isPaid.newValue;
      render();
    }
  });
}

// ---------- Util ----------

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
