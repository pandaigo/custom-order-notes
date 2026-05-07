importScripts('ExtPay.js');
const extpay = ExtPay('custom-order-notes');
extpay.startBackground();

extpay.onPaid.addListener(() => {
  chrome.storage.local.set({ isPaid: true });
});

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const user = await extpay.getUser();
    if (user.paid) await chrome.storage.local.set({ isPaid: true });
  } catch (_) {}

  scheduleDailyCheck();

  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  }
});

// Service Worker 起動時にも alarm を確保（消失対策）
chrome.runtime.onStartup.addListener(() => {
  scheduleDailyCheck();
});

function scheduleDailyCheck() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  chrome.alarms.create('daily-check', {
    when: next.getTime(),
    periodInMinutes: 1440
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily-check') {
    await runDailyCheck();
  }
});

async function runDailyCheck() {
  const { notes = [] } = await chrome.storage.local.get(['notes']);
  const today = new Date();
  const todayISO = isoDate(today);

  const due = notes.filter(n => {
    if (!n || n.archived) return false;
    if (n.status === 'shipped' || n.status === 'review') return false;
    return n.dueDate && n.dueDate <= todayISO;
  });

  if (due.length === 0) return;

  const overdue = due.filter(n => n.dueDate < todayISO).length;
  const dueToday = due.length - overdue;

  let title, message;
  if (overdue > 0 && dueToday > 0) {
    title = `${due.length} orders need action`;
    message = `${overdue} overdue, ${dueToday} due today`;
  } else if (overdue > 0) {
    title = `${overdue} order${overdue > 1 ? 's' : ''} overdue`;
    message = due.slice(0, 3).map(n => `#${n.orderNo} ${n.customer || ''}`.trim()).join(', ');
  } else {
    title = `${dueToday} order${dueToday > 1 ? 's' : ''} due today`;
    message = due.slice(0, 3).map(n => `#${n.orderNo} ${n.customer || ''}`.trim()).join(', ');
  }

  chrome.notifications.create('daily-check-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1
  });
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
  if (typeof chrome.action.openPopup === 'function') {
    try { await chrome.action.openPopup(); } catch (_) {}
  }
});
