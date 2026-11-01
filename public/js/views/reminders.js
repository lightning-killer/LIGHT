import { api, qs } from '../api.js';
import { h, pageHead, empty, fmtDate, relTime, toInputValue, fromInputValue, withLoading, confirmDialog, formDialog, toast } from '../ui.js';
import { requestNotificationPermission } from '../notifier.js';

const NOTIF = { none: ['Not sent', ''], pending: ['Waiting for delivery', 'warn'], delivered: ['Delivered', 'ok'], failed: ['Delivery failed', 'bad'] };

export async function render(root) {
  const list = h('ul', { class: 'list' });
  const filter = h('select', { 'aria-label': 'Filter reminders' }, [['all', 'All'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue / due now'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([v, t]) => h('option', { value: v }, t)));
  const permBadge = h('span', { class: 'badge' });
  const refreshPerm = () => {
    const p = 'Notification' in window ? Notification.permission : 'unsupported';
    permBadge.textContent = p === 'granted' ? 'Browser notifications on' : p === 'denied' ? 'Browser notifications blocked' : p === 'unsupported' ? 'Notifications unsupported' : 'Browser notifications off';
    permBadge.className = `badge ${p === 'granted' ? 'ok' : p === 'denied' ? 'bad' : 'warn'}`;
    enableBtn.classList.toggle('hidden', p !== 'default');
  };
  const enableBtn = h('button', { class: 'btn', onclick: (e) => withLoading(e.currentTarget, async () => { await requestNotificationPermission(); refreshPerm(); }) }, 'Enable notifications');

  const fields = (r = {}) => [
    { name: 'title', label: 'What should I remind you about?', value: r.title, required: true, maxLength: 300 },
    { name: 'when', label: 'When', type: 'datetime-local', value: toInputValue(r.remind_at || new Date(Date.now() + 3600000)), required: true },
    { name: 'notes', label: 'Notes (optional)', type: 'textarea', value: r.notes || '' },
  ];
  const addBtn = h('button', { class: 'btn primary', onclick: async () => {
    const v = await formDialog({ title: 'New reminder', fields: fields(), submitLabel: 'Create reminder', onSubmit: (x) => api.post('/reminders', { title: x.title.trim(), remindAt: fromInputValue(x.when), notes: x.notes.trim() || null }) });
    if (v) { toast('Reminder created', 'success'); load(); }
  } }, 'New reminder');
  root.append(pageHead('Reminders', enableBtn, addBtn), h('div', { class: 'card' }, h('div', { class: 'toolbar' }, filter, permBadge), list));

  async function load() {
    const { reminders } = await api.get('/reminders' + qs({ filter: filter.value }));
    list.replaceChildren(...(reminders.length ? reminders.map(row) : [h('li', {}, empty('No reminders here.'))]));
  }
  const act = (btn, fn, msg) => withLoading(btn, async () => { await fn(); toast(msg, 'success'); await load(); });

  function row(r) {
    const active = r.status === 'scheduled' || r.status === 'triggered';
    const [nLabel, nCls] = NOTIF[r.notification_status] || NOTIF.none;
    return h('li', { class: 'wrap' },
      h('div', { class: 'grow' },
        h('div', { class: r.status === 'cancelled' || r.status === 'completed' ? 'done-title' : '' }, r.title),
        h('div', { class: 'small muted' }, `${fmtDate(r.remind_at)} (${relTime(r.remind_at)}) · `, h('span', { class: `badge ${r.status === 'triggered' ? 'warn' : ''}` }, r.status), ' ',
          r.status !== 'scheduled' && r.status !== 'cancelled' ? h('span', { class: `badge ${nCls}` }, nLabel) : null)),
      active ? h('button', { class: 'btn sm', onclick: (e) => act(e.currentTarget, () => api.post(`/reminders/${r.id}/complete`), 'Marked complete') }, 'Complete') : null,
      active ? h('button', { class: 'btn sm', onclick: async () => {
        const v = await formDialog({ title: 'Edit reminder', fields: fields(r), onSubmit: (x) => api.patch(`/reminders/${r.id}`, { title: x.title.trim(), remindAt: fromInputValue(x.when), notes: x.notes.trim() || null }) });
        if (v) { toast('Reminder updated', 'success'); load(); }
      } }, 'Edit') : null,
      active ? h('button', { class: 'btn sm', onclick: async (e) => {
        if (await confirmDialog({ title: 'Cancel reminder?', message: `"${r.title}" will not notify you.`, confirmLabel: 'Cancel reminder' })) act(e.currentTarget, () => api.post(`/reminders/${r.id}/cancel`), 'Reminder cancelled');
      } }, 'Cancel') : null,
      h('button', { class: 'btn sm danger', onclick: async (e) => {
        if (await confirmDialog({ title: 'Delete reminder?', message: 'This permanently deletes the reminder.', confirmLabel: 'Delete', danger: true })) act(e.currentTarget, () => api.del(`/reminders/${r.id}`), 'Reminder deleted');
      } }, 'Delete'));
  }

  filter.addEventListener('change', () => load().catch((e) => toast(e.message, 'error')));
  const onChange = () => load().catch(() => {});
  window.addEventListener('light:reminders-changed', onChange);
  const poll = setInterval(onChange, 20000); // reflect reminders the scheduler just triggered
  refreshPerm();
  await load();
  return () => { clearInterval(poll); window.removeEventListener('light:reminders-changed', onChange); };
}
