import { api, qs } from '../api.js';
import { h, pageHead, empty, fmtDate, toInputValue, fromInputValue, withLoading, confirmDialog, formDialog, toast, debounce } from '../ui.js';

const PRIORITIES = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }];

export async function render(root) {
  const list = h('ul', { class: 'list' });
  const q = h('input', { type: 'search', placeholder: 'Search tasks…', 'aria-label': 'Search tasks' });
  const select = (label, opts, value = '') => h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  const status = select('Status filter', [['', 'All statuses'], ['open', 'Open'], ['done', 'Done']], 'open');
  const priority = select('Priority filter', [['', 'All priorities'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]);
  const sort = select('Sort by', [['created', 'Newest'], ['due', 'Due date'], ['priority', 'Priority'], ['title', 'Title']]);
  const order = select('Order', [['desc', 'Descending'], ['asc', 'Ascending']]);
  const count = h('span', { class: 'muted small' });

  const taskForm = (t = {}) => [
    { name: 'title', label: 'Title', value: t.title, required: true, maxLength: 300 },
    { name: 'description', label: 'Notes (optional)', type: 'textarea', value: t.description || '' },
    { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, value: t.priority || 'medium' },
    { name: 'due', label: 'Due date (optional)', type: 'datetime-local', value: toInputValue(t.due_at) },
  ];
  const payload = (v) => ({ title: v.title.trim(), description: v.description.trim() || null, priority: v.priority, dueAt: fromInputValue(v.due) });

  const addBtn = h('button', { class: 'btn primary', onclick: async () => {
    const v = await formDialog({ title: 'New task', fields: taskForm(), submitLabel: 'Create task', onSubmit: (vals) => api.post('/tasks', payload(vals)) });
    if (v) { toast('Task created', 'success'); load(); }
  } }, 'New task');
  root.append(pageHead('Tasks', addBtn), h('div', { class: 'card' }, h('div', { class: 'toolbar' }, q, status, priority, sort, order), count, list));

  async function load() {
    const { tasks } = await api.get('/tasks' + qs({ q: q.value.trim(), status: status.value, priority: priority.value, sort: sort.value, order: order.value }));
    count.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    list.replaceChildren(...(tasks.length ? tasks.map(row) : [h('li', {}, empty('No tasks match.'))]));
  }

  function row(t) {
    const overdue = t.status === 'open' && t.due_at && new Date(t.due_at) < new Date();
    return h('li', {},
      h('input', { type: 'checkbox', checked: t.status === 'done', 'aria-label': t.status === 'done' ? 'Reopen task' : 'Mark task complete', onchange: async (e) => {
        const box = e.currentTarget; box.disabled = true;
        try { await api.patch(`/tasks/${t.id}`, { status: box.checked ? 'done' : 'open' }); await load(); }
        catch (err) { box.checked = !box.checked; box.disabled = false; toast(err.message, 'error'); }
      } }),
      h('div', { class: 'grow' },
        h('div', { class: t.status === 'done' ? 'done-title' : '' }, t.title),
        h('div', { class: 'small muted' }, h('span', { class: `pri-${t.priority}` }, t.priority), t.due_at ? [' · due ', h('span', { class: overdue ? 'pri-high' : '' }, fmtDate(t.due_at))] : null, t.description ? ` · ${t.description.slice(0, 80)}` : '')),
      h('button', { class: 'btn sm', onclick: async () => {
        const v = await formDialog({ title: 'Edit task', fields: taskForm(t), onSubmit: (vals) => api.patch(`/tasks/${t.id}`, payload(vals)) });
        if (v) { toast('Task updated', 'success'); load(); }
      } }, 'Edit'),
      h('button', { class: 'btn sm danger', onclick: async (e) => {
        if (!(await confirmDialog({ title: 'Delete task?', message: `"${t.title}" will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return;
        await withLoading(e.currentTarget, async () => { await api.del(`/tasks/${t.id}`); toast('Task deleted', 'success'); await load(); });
      } }, 'Delete'));
  }

  const reload = () => load().catch((e) => toast(e.message, 'error'));
  q.addEventListener('input', debounce(reload));
  [status, priority, sort, order].forEach((s) => s.addEventListener('change', reload));
  await load();
}
