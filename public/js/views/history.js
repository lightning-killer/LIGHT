import { api, qs } from '../api.js';
import { h, pageHead, empty, fmtDate, relTime, withLoading, confirmDialog, formDialog, toast, debounce } from '../ui.js';

export async function render(root, { navigate }) {
  const list = h('ul', { class: 'list' });
  const search = h('input', { type: 'search', placeholder: 'Search titles and messages…', 'aria-label': 'Search conversations' });
  const newBtn = h('button', { class: 'btn primary', onclick: (e) => withLoading(e.currentTarget, async () => { const { conversation } = await api.post('/conversations', {}); navigate(`chat/${conversation.id}`); }) }, 'New conversation');
  root.append(pageHead('Conversation History', newBtn), h('div', { class: 'card' }, h('div', { class: 'toolbar' }, search), list));

  async function load() {
    const { conversations } = await api.get('/conversations' + qs({ q: search.value.trim() }));
    list.replaceChildren(...(conversations.length ? conversations.map(row) : [h('li', {}, empty(search.value ? 'No conversations match your search.' : 'No conversations yet. Start one!'))]));
  }
  function row(c) {
    return h('li', {},
      h('div', { class: 'grow' }, h('a', { href: `#/chat/${c.id}` }, c.title), h('div', { class: 'small muted', title: fmtDate(c.updated_at) }, `Updated ${relTime(c.updated_at)}`)),
      h('button', { class: 'btn sm', onclick: async (e) => {
        const v = await formDialog({ title: 'Rename conversation', fields: [{ name: 'title', label: 'Title', value: c.title, required: true, maxLength: 200 }], onSubmit: (vals) => api.patch(`/conversations/${c.id}`, { title: vals.title.trim() }) });
        if (v) { toast('Conversation renamed', 'success'); load(); }
      } }, 'Rename'),
      h('button', { class: 'btn sm danger', onclick: async (e) => {
        if (!(await confirmDialog({ title: 'Delete conversation?', message: `"${c.title}" and all of its messages will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return;
        await withLoading(e.currentTarget, async () => { await api.del(`/conversations/${c.id}`); toast('Conversation deleted', 'success'); await load(); });
      } }, 'Delete'));
  }
  search.addEventListener('input', debounce(() => load().catch((e) => toast(e.message, 'error'))));
  await load();
}
