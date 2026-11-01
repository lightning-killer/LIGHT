// Polls for reminders the server has triggered and confirms delivery back to the server
// ONLY after the browser notification (or a visible in-app alert) was actually shown.
import { api } from './api.js';
import { toast } from './ui.js';

let timer = null;
const shown = new Set();

async function tick() {
  let due;
  try { due = (await api.get('/reminders/due')).reminders; } catch { return; }
  for (const r of due) {
    if (shown.has(r.id)) continue;
    let delivered = false;
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('LIGHT reminder', { body: r.title, tag: `reminder-${r.id}` }); delivered = true; } catch { /* fall through to in-app */ }
    }
    if (!delivered && document.visibilityState === 'visible') {
      toast(`Reminder: ${r.title}`, 'info', 15000);
      delivered = true; // the in-app alert is on screen in a visible tab
    }
    if (!delivered) continue; // hidden tab and no permission: leave it pending until the user is back
    shown.add(r.id);
    try { await api.post(`/reminders/${r.id}/delivered`, { delivered: true }); window.dispatchEvent(new CustomEvent('light:reminders-changed')); } catch { shown.delete(r.id); }
  }
}

export function startReminderPoller() { stopReminderPoller(); tick(); timer = setInterval(tick, 15000); document.addEventListener('visibilitychange', onVisible); }
export function stopReminderPoller() { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); }
const onVisible = () => { if (document.visibilityState === 'visible') tick(); };

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}
