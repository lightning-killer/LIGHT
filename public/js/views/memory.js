import { api, qs } from '../api.js';
import { h, pageHead, empty, fmtDate, withLoading, confirmDialog, formDialog, toast, debounce } from '../ui.js';

const CATS = ['general', 'personal', 'work', 'preferences', 'people'].map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }));

export async function render(root) {
  const list = h('ul', { class: 'list' });
  const q = h('input', { type: 'search', placeholder: 'Search memory…', 'aria-label': 'Search memory' });
  const fields = (m = {}) => [
    { name: 'content', label: 'What should LIGHT remember?', type: 'textarea', value: m.content, required: true, maxLength: 2000, rows: 4 },
    { name: 'category', label: 'Category', type: 'select', options: CATS, value: m.category || 'general' },
  ];
  const addBtn = h('button', { class: 'btn primary', onclick: async () => {
    const v = await formDialog({ title: 'Add memory', fields: fields(), submitLabel: 'Save', onSubmit: (x) => api.post('/memories', { content: x.content.trim(), category: x.category }) });
    if (v) { toast('Saved to memory', 'success'); load(); }
  } }, 'Add memory');
  root.append(pageHead('Assistant Memory', addBtn),
    h('p', { class: 'muted' }, 'Facts you ask LIGHT to remember (try saying "Remember that …" in chat). They are stored in your account only and are sent to an AI provider only if one is connected.'),
    h('div', { class: 'card' }, h('div', { class: 'toolbar' }, q), list));

  async function load() {
    const { memories } = await api.get('/memories' + qs({ q: q.value.trim() }));
    list.replaceChildren(...(memories.length ? memories.map((m) => h('li', {},
      h('div', { class: 'grow' }, h('div', {}, m.content), h('div', { class: 'small muted' }, h('span', { class: 'badge' }, m.category), ` · ${fmtDate(m.created_at)}`)),
      h('button', { class: 'btn sm', onclick: async () => {
        const v = await formDialog({ title: 'Edit memory', fields: fields(m), onSubmit: (x) => api.patch(`/memories/${m.id}`, { content: x.content.trim(), category: x.category }) });
        if (v) { toast('Memory updated', 'success'); load(); }
      } }, 'Edit'),
      h('button', { class: 'btn sm danger', onclick: async (e) => {
        if (!(await confirmDialog({ title: 'Forget this?', message: 'This memory will be permanently deleted.', confirmLabel: 'Delete', danger: true }))) return;
        await withLoading(e.currentTarget, async () => { await api.del(`/memories/${m.id}`); toast('Memory deleted', 'success'); await load(); });
      } }, 'Delete'))) : [h('li', {}, empty('Nothing remembered yet.'))]));
  }
  q.addEventListener('input', debounce(() => load().catch((e) => toast(e.message, 'error'))));
  await load();
}
