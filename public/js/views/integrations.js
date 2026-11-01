import { api } from '../api.js';
import { h, pageHead, fmtDate, withLoading, confirmDialog, toast } from '../ui.js';

const SCOPE_LABEL = (s) => s.split('/').pop();

export async function render(root, { query }) {
  if (query.get('connected')) toast('Integration connected', 'success');
  if (query.get('error')) toast('The connection was not completed.', 'error');
  const grid = h('div', { class: 'grid cols-2' });
  root.append(pageHead('Integrations'),
    h('p', { class: 'muted' }, 'Everything is disconnected until you choose to connect it. LIGHT asks only for the narrowest read-only permission, and you can disconnect (which also revokes access at Google) at any time.'), grid);

  async function load() {
    const { integrations, planned } = await api.get('/integrations');
    grid.replaceChildren(
      ...integrations.map((i) => {
        const on = i.status === 'connected';
        return h('div', { class: 'card stack' },
          h('div', { class: 'row between' }, h('h2', {}, i.name), h('span', { class: `badge ${on ? 'ok' : ''}` }, on ? 'Connected' : 'Disconnected')),
          h('p', { class: 'muted' }, i.description),
          h('div', { class: 'small muted' }, 'Permission requested: ', i.scopes.map((s) => h('span', { class: 'kbd' }, SCOPE_LABEL(s)))),
          on ? h('div', { class: 'small muted' }, `Connected ${fmtDate(i.connectedAt)}`) : null,
          on
            ? h('button', { class: 'btn danger', onclick: async (e) => {
                if (!(await confirmDialog({ title: `Disconnect ${i.name}?`, message: 'LIGHT will delete the stored credentials and ask Google to revoke access.', confirmLabel: 'Disconnect', danger: true }))) return;
                await withLoading(e.currentTarget, async () => { const r = await api.post(`/integrations/${i.provider}/disconnect`); toast(r.revoked ? 'Disconnected and revoked' : 'Disconnected (revocation at Google could not be confirmed; you can also remove access in your Google account)', 'success'); await load(); });
              } }, 'Disconnect')
            : h('a', { class: 'btn primary', href: `/auth/integrations/start/${i.provider}` }, `Connect ${i.name}`));
      }),
      ...planned.map((p) => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h2', {}, p.name), h('span', { class: 'badge' }, 'Server setting')), h('p', { class: 'muted' }, p.description))));
  }
  await load();
}
