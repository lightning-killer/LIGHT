// Research Workspace (kind=research) and Project Workspace (kind=project) share one implementation.
import { api, qs } from '../api.js';
import { h, pageHead, empty, fmtDate, relTime, withLoading, confirmDialog, formDialog, toast } from '../ui.js';

const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'done', label: 'Done' }];

function workspace(kind, labels) {
  return {
    async render(root, { params, navigate }) {
      const id = params[0] ? Number(params[0]) : null;
      return id ? detail(root, id, navigate) : listView(root, navigate);
    },
  };

  async function listView(root, navigate) {
    const list = h('ul', { class: 'list' });
    const addBtn = h('button', { class: 'btn primary', onclick: async () => {
      const v = await formDialog({ title: `New ${labels.one}`, submitLabel: 'Create', fields: [
        { name: 'name', label: 'Name', required: true, maxLength: 200 }, { name: 'description', label: labels.descLabel, type: 'textarea' }],
        onSubmit: (x) => api.post('/projects', { kind, name: x.name.trim(), description: x.description.trim() || null }) });
      if (v) { toast(`${labels.One} created`, 'success'); load(); }
    } }, `New ${labels.one}`);
    root.append(pageHead(labels.title, addBtn), h('div', { class: 'card' }, list));
    async function load() {
      const { projects } = await api.get('/projects' + qs({ kind }));
      list.replaceChildren(...(projects.length ? projects.map((p) => h('li', {},
        h('div', { class: 'grow' }, h('a', { href: `#/${kind === 'research' ? 'research' : 'projects'}/${p.id}` }, p.name), h('div', { class: 'small muted' }, p.description ? p.description.slice(0, 120) : 'No description', ` · updated ${relTime(p.updated_at)}`)),
        h('span', { class: `badge ${p.status === 'active' ? 'ok' : ''}` }, p.status),
        h('button', { class: 'btn sm danger', onclick: async (e) => {
          if (!(await confirmDialog({ title: `Delete ${labels.one}?`, message: `"${p.name}" and its notes will be permanently deleted.`, confirmLabel: 'Delete', danger: true }))) return;
          await withLoading(e.currentTarget, async () => { await api.del(`/projects/${p.id}`); toast(`${labels.One} deleted`, 'success'); await load(); });
        } }, 'Delete'))) : [h('li', {}, empty(labels.empty))]));
    }
    await load();
  }

  async function detail(root, id, navigate) {
    const { project: p } = await api.get(`/projects/${id}`);
    let sources = [...p.sources];
    const name = h('input', { value: p.name, maxLength: 200, 'aria-label': 'Name' });
    const desc = h('textarea', { rows: 2, value: p.description || '', 'aria-label': 'Description' });
    const status = h('select', { 'aria-label': 'Status' }, STATUSES.map((s) => h('option', { value: s.value, selected: s.value === p.status }, s.label)));
    const notes = h('textarea', { class: 'notes', value: p.notes || '', placeholder: labels.notesPlaceholder, 'aria-label': 'Notes', maxLength: 200000 });
    const srcList = h('ul', { class: 'list' });
    const saved = h('span', { class: 'small muted' }, `Last saved ${fmtDate(p.updated_at)}`);
    const saveBtn = h('button', { class: 'btn primary', onclick: (e) => withLoading(e.currentTarget, save) }, 'Save');
    const back = h('a', { class: 'btn', href: `#/${kind === 'research' ? 'research' : 'projects'}` }, '← All');
    root.append(pageHead(p.name, back, saveBtn),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card stack' }, h('div', {}, h('label', {}, 'Name'), name), h('div', {}, h('label', {}, labels.descLabel), desc), h('div', {}, h('label', {}, 'Status'), status), saved),
        h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', {}, 'Sources & links'), h('button', { class: 'btn sm', onclick: addSource }, 'Add link')), srcList)),
      h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Notes'), notes));

    function renderSources() {
      srcList.replaceChildren(...(sources.length ? sources.map((s, i) => h('li', {}, h('div', { class: 'grow' }, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title) : s.title, s.note ? h('div', { class: 'small muted' }, s.note) : null),
        h('button', { class: 'btn sm danger', 'aria-label': `Remove ${s.title}`, onclick: () => { sources.splice(i, 1); renderSources(); } }, 'Remove'))) : [h('li', {}, empty('No sources yet. Add links, papers or references; remember to Save.'))]));
    }
    async function addSource() {
      const v = await formDialog({ title: 'Add source', fields: [{ name: 'title', label: 'Title', required: true, maxLength: 200 }, { name: 'url', label: 'URL (https://…)', type: 'url' }, { name: 'note', label: 'Note', maxLength: 1000 }], submitLabel: 'Add' });
      if (v) { sources.push({ title: v.title.trim(), ...(v.url.trim() ? { url: v.url.trim() } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) }); renderSources(); }
    }
    async function save() {
      const { project } = await api.patch(`/projects/${id}`, { name: name.value.trim(), description: desc.value.trim() || null, status: status.value, notes: notes.value || null, sources });
      saved.textContent = `Saved ${fmtDate(project.updated_at)}`; toast('Saved', 'success');
    }
    renderSources();
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); withLoading(saveBtn, save); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }
}

export const research = workspace('research', { title: 'Research Workspace', one: 'research topic', One: 'Research topic', descLabel: 'Question or goal', notesPlaceholder: 'Findings, quotes, open questions…', empty: 'No research topics yet. Create one to collect notes and sources.' });
export const projects = workspace('project', { title: 'Project Workspace', one: 'project', One: 'Project', descLabel: 'Description', notesPlaceholder: 'Plans, decisions, next steps…', empty: 'No projects yet. Create one to track notes and links.' });
