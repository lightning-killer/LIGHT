import { api } from '../api.js';
import { h, pageHead, empty, fmtDate, relTime, withLoading } from '../ui.js';

const EVENT_LABELS = {
  'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'task.created': 'Task created', 'task.deleted': 'Task deleted', 'reminder.created': 'Reminder created',
  'conversation.deleted': 'Conversation deleted', 'approval.requested': 'Approval requested', 'approval.approved': 'Action approved', 'approval.rejected': 'Action rejected',
  'tool.failed': 'An action failed', 'tool.denied': 'An action was blocked', 'integration.connected': 'Integration connected', 'integration.disconnected': 'Integration disconnected',
  'session.revoked': 'Session revoked', 'profile.updated': 'Profile updated', 'account.created': 'Account created', 'attachment.uploaded': 'File uploaded',
};

export async function render(root, { navigate }) {
  const clock = h('div', { class: 'muted' });
  const tick = () => { clock.textContent = new Date().toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }); };
  tick(); const timer = setInterval(tick, 1000);
  const body = h('div', { class: 'stack' });
  const refresh = h('button', { class: 'btn', onclick: (e) => withLoading(e.currentTarget, load) }, 'Refresh');
  root.append(pageHead('Dashboard', refresh), body);

  async function load() {
    const d = await api.get('/dashboard');
    const status = (label, ok, detail) => h('div', { class: 'row' }, h('span', { class: `dot ${ok ? 'ok' : 'bad'}` }), h('div', {}, h('div', {}, label), h('div', { class: 'small muted' }, detail)));
    body.replaceChildren(
      h('div', { class: 'card row' }, h('div', { class: 'orb' }), h('div', {}, h('h2', {}, `Welcome back${d.name ? ', ' + d.name.split(' ')[0] : ''}`), clock)),
      h('div', { class: 'grid cols-4' },
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Pending tasks'), h('div', { class: 'stat' }, d.tasks.pending), h('a', { href: '#/tasks' }, 'Open tasks')),
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Completed tasks'), h('div', { class: 'stat' }, d.tasks.completed)),
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Upcoming reminders'), h('div', { class: 'stat' }, d.upcomingReminders.length), h('a', { href: '#/reminders' }, 'Open reminders')),
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Overdue reminders'), h('div', { class: `stat ${d.overdueReminders ? 'pri-high' : ''}` }, d.overdueReminders))),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' }, h('h2', {}, 'Upcoming reminders'),
          d.upcomingReminders.length ? h('ul', { class: 'list' }, d.upcomingReminders.map((r) => h('li', {}, h('span', { class: 'grow' }, r.title), h('span', { class: 'small muted', title: fmtDate(r.remind_at) }, relTime(r.remind_at))))) : empty('No upcoming reminders.')),
        h('div', { class: 'card' }, h('h2', {}, 'Recent conversations'),
          d.recentConversations.length ? h('ul', { class: 'list' }, d.recentConversations.map((c) => h('li', {}, h('a', { class: 'grow', href: `#/chat/${c.id}` }, c.title), h('span', { class: 'small muted' }, relTime(c.updated_at))))) : empty('No conversations yet.')),
        h('div', { class: 'card' }, h('h2', {}, 'Recent activity'),
          d.recentActivity.length ? h('ul', { class: 'list' }, d.recentActivity.map((a) => h('li', {}, h('span', { class: 'grow' }, EVENT_LABELS[a.event] || a.event), h('span', { class: 'small muted' }, relTime(a.created_at))))) : empty('No activity yet.')),
        h('div', { class: 'card stack' }, h('h2', {}, 'System status'),
          status('Assistant', d.status.assistant.online, d.status.assistant.online ? 'Online' : 'Offline'),
          status('Database', d.status.database.connected, d.status.database.connected ? 'Connected (MySQL)' : 'Not connected'),
          status('AI provider', d.status.ai.configured && d.status.ai.reachable, `${d.status.ai.name}: ${d.status.ai.detail}`))));
  }
  await load();
  const onChange = () => load().catch(() => {});
  window.addEventListener('light:reminders-changed', onChange);
  return () => { clearInterval(timer); window.removeEventListener('light:reminders-changed', onChange); };
}
