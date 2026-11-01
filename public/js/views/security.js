import { api, logoutRequest } from '../api.js';
import { h, pageHead, empty, fmtDate, relTime, withLoading, confirmDialog, toast } from '../ui.js';

const EVENT = {
  'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'session.revoked': 'Session revoked', 'account.created': 'Account created', 'profile.updated': 'Profile updated',
  'auth.callback_rejected': 'Sign-in attempt rejected', 'auth.token_rejected': 'Sign-in token rejected', 'task.created': 'Task created', 'task.deleted': 'Task deleted', 'reminder.created': 'Reminder created',
  'conversation.deleted': 'Conversation deleted', 'approval.requested': 'Approval requested', 'approval.approved': 'Action approved', 'approval.rejected': 'Action rejected',
  'tool.failed': 'Action failed', 'tool.denied': 'Action blocked (no permission)', 'integration.connected': 'Integration connected', 'integration.disconnected': 'Integration disconnected', 'attachment.uploaded': 'File uploaded',
};
const device = (ua = '') => { const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'; const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''; return `${b}${o ? ' on ' + o : ''}`; };
const table = (head, rows, emptyText) => rows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows))) : empty(emptyText);

export async function render(root, { navigate }) {
  const body = h('div', { class: 'stack' });
  root.append(pageHead('Security Center', h('button', { class: 'btn', onclick: (e) => withLoading(e.currentTarget, load) }, 'Refresh')), body);

  async function load() {
    const d = await api.get('/security');
    const others = d.sessions.filter((s) => !s.current);
    body.replaceChildren(
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card stack' }, h('h2', {}, 'Account'),
          h('div', {}, h('div', { class: 'small muted' }, 'Name'), d.account.name || '—'), h('div', {}, h('div', { class: 'small muted' }, 'Email'), d.account.email),
          h('div', {}, h('div', { class: 'small muted' }, 'Member since'), fmtDate(d.account.created_at)), h('div', {}, h('div', { class: 'small muted' }, 'Last sign-in'), fmtDate(d.account.last_login_at)),
          h('div', {}, h('button', { class: 'btn', onclick: async (e) => {
            if (!(await confirmDialog({ title: 'Log out?', message: 'You will be signed out of this device.', confirmLabel: 'Log out' }))) return;
            await withLoading(e.currentTarget, async () => { await logoutRequest(); location.hash = ''; location.reload(); });
          } }, 'Log out of this device'))),
        h('div', { class: 'card' }, h('h2', {}, 'Permissions'), table(['Permission', 'Status', 'Scope'], d.permissions.map((p) => h('tr', {}, h('td', {}, p.permission), h('td', {}, h('span', { class: `badge ${p.granted === true ? 'ok' : p.granted === 'ask' ? 'warn' : ''}` }, p.granted === true ? 'Granted' : p.granted === 'ask' ? 'Ask each time' : 'Not granted')), h('td', { class: 'small muted' }, p.scope))), 'No permissions'))),
      h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('h2', {}, 'Active sessions'),
          others.length ? h('button', { class: 'btn danger sm', onclick: async (e) => {
            if (!(await confirmDialog({ title: 'Log out other devices?', message: `${others.length} other session(s) will be signed out immediately.`, confirmLabel: 'Revoke all', danger: true }))) return;
            await withLoading(e.currentTarget, async () => { const r = await api.post('/security/sessions/revoke-others'); toast(`${r.revoked} session(s) revoked`, 'success'); await load(); });
          } }, 'Revoke all others') : null),
        table(['Device', 'IP', 'Signed in', 'Last active', ''], d.sessions.map((s) => h('tr', {}, h('td', {}, device(s.userAgent), s.current ? h('span', { class: 'badge ok', style: 'margin-left:6px' }, 'This device') : null), h('td', {}, s.ip || '—'), h('td', {}, fmtDate(s.createdAt)), h('td', {}, relTime(s.lastSeenAt)),
          h('td', {}, s.current ? null : h('button', { class: 'btn sm danger', onclick: async (e) => {
            if (!(await confirmDialog({ title: 'Revoke this session?', message: `${device(s.userAgent)} will be signed out.`, confirmLabel: 'Revoke', danger: true }))) return;
            await withLoading(e.currentTarget, async () => { await api.del(`/security/sessions/${encodeURIComponent(s.id)}`); toast('Session revoked', 'success'); await load(); });
          } }, 'Revoke')))), 'No active sessions')),
      h('div', { class: 'card' }, h('h2', {}, 'Connected integrations'),
        table(['Integration', 'Status', 'Permission'], d.integrations.map((i) => h('tr', {}, h('td', {}, i.name), h('td', {}, h('span', { class: `badge ${i.status === 'connected' ? 'ok' : ''}` }, i.status)), h('td', { class: 'small muted' }, i.status === 'connected' ? i.scopes.map((s) => s.split('/').pop()).join(', ') : '—'))), 'None'),
        h('p', {}, h('a', { href: '#/integrations' }, 'Manage integrations'))),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' }, h('h2', {}, 'Recent login activity'), table(['Event', 'IP', 'When'], d.logins.map((l) => h('tr', {}, h('td', {}, EVENT[l.event] || l.event), h('td', {}, l.ip || '—'), h('td', { title: fmtDate(l.created_at) }, relTime(l.created_at)))), 'No login activity')),
        h('div', { class: 'card' }, h('h2', {}, 'Approval history'), table(['Action', 'Status', 'When'], d.approvals.map((a) => h('tr', {}, h('td', {}, a.summary), h('td', {}, h('span', { class: `badge ${a.status === 'executed' ? 'ok' : a.status === 'failed' ? 'bad' : a.status === 'pending' ? 'warn' : ''}` }, a.status)), h('td', { title: fmtDate(a.created_at) }, relTime(a.created_at)))), 'No sensitive actions have been requested'))),
      h('div', { class: 'card' }, h('h2', {}, 'Important account events'), table(['Event', 'When'], d.events.map((e) => h('tr', {}, h('td', {}, EVENT[e.event] || e.event), h('td', { title: fmtDate(e.created_at) }, relTime(e.created_at)))), 'No events')));
  }
  await load();
}
