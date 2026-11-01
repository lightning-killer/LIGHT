import { api, setCsrf, logoutRequest } from './api.js';
import { h, toast, withLoading, confirmDialog } from './ui.js';
import { startReminderPoller, stopReminderPoller } from './notifier.js';
import * as dashboard from './views/dashboard.js';
import * as chat from './views/chat.js';
import * as history from './views/history.js';
import * as tasks from './views/tasks.js';
import * as reminders from './views/reminders.js';
import * as memory from './views/memory.js';
import { research, projects } from './views/workspace.js';
import * as voice from './views/voice.js';
import * as integrations from './views/integrations.js';
import * as security from './views/security.js';
import * as settings from './views/settings.js';

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: '◈', view: dashboard },
  { id: 'chat', label: 'AI Chat', icon: '✦', view: chat },
  { id: 'history', label: 'History', icon: '⟲', view: history },
  { id: 'tasks', label: 'Tasks', icon: '✓', view: tasks },
  { id: 'reminders', label: 'Reminders', icon: '⏰', view: reminders },
  { id: 'memory', label: 'Memory', icon: '❖', view: memory },
  { id: 'research', label: 'Research', icon: '⌕', view: research },
  { id: 'projects', label: 'Projects', icon: '▤', view: projects },
  { id: 'voice', label: 'Voice', icon: '◉', view: voice },
  { id: 'integrations', label: 'Integrations', icon: '⛓', view: integrations },
  { id: 'security', label: 'Security', icon: '⛨', view: security },
  { id: 'settings', label: 'Settings', icon: '⚙', view: settings },
];

const app = document.getElementById('app');
let me = null;
let cleanup = null;

function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [id, ...rest] = (path || 'dashboard').split('/');
  return { id: ROUTES.some((r) => r.id === id) ? id : 'dashboard', params: rest, query: new URLSearchParams(query) };
}

function renderLogin(errorCode) {
  cleanup?.(); cleanup = null; stopReminderPoller();
  const messages = {
    not_configured: 'Google sign-in is not configured on this server yet.',
    access_denied: 'Sign-in was cancelled.',
    invalid_state: 'The sign-in attempt expired or was invalid. Please try again.',
    token_invalid: 'Google sign-in could not be verified. Please try again.',
  };
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card login-card' },
    h('div', { class: 'orb lg' }),
    h('h1', {}, 'LIGHT'),
    h('p', { class: 'muted' }, 'Your personal AI assistant for tasks, reminders, research and projects.'),
    errorCode ? h('div', { class: 'error-text', role: 'alert' }, messages[errorCode] || 'Sign-in failed.') : null,
    h('a', { class: 'google-btn', href: '/auth/google' },
      h('svg', { width: 18, height: 18, viewBox: '0 0 48 48', 'aria-hidden': 'true' },
        ...[['#EA4335', 'M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z'], ['#4285F4', 'M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z'], ['#FBBC05', 'M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z'], ['#34A853', 'M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z']].map(([fill, d]) => {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('fill', fill); p.setAttribute('d', d); return p; })),
      'Continue with Google'),
    h('p', { class: 'small muted' }, 'LIGHT only requests your basic profile. Other permissions are asked only if you connect an integration.'))));
}

function renderShell() {
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('span', { class: 'orb sm' }), 'LIGHT'),
    h('nav', { class: 'nav', 'aria-label': 'Main' }, ROUTES.map((r) => h('a', { href: `#/${r.id}`, dataset: { route: r.id }, onclick: () => closeNav() }, h('span', { class: 'ic', 'aria-hidden': 'true' }, r.icon), r.label))),
    h('div', { class: 'user' },
      me.avatarUrl ? h('img', { class: 'avatar', src: me.avatarUrl, alt: '', referrerPolicy: 'no-referrer' }) : h('div', { class: 'avatar' }, (me.name || me.email || '?')[0].toUpperCase()),
      h('div', { class: 'grow' }, h('div', { class: 'small', style: 'overflow:hidden;text-overflow:ellipsis' }, me.name || me.email), h('div', { class: 'small muted', style: 'overflow:hidden;text-overflow:ellipsis' }, me.email)),
      h('button', { class: 'btn sm', id: 'logout-btn', title: 'Log out', onclick: (e) => logout(e.currentTarget) }, 'Log out')));
  const scrim = h('div', { class: 'scrim hidden', id: 'scrim', onclick: () => closeNav() });
  const topbar = h('header', { class: 'topbar' }, h('button', { class: 'btn icon', 'aria-label': 'Open menu', onclick: () => { sidebar.classList.add('open'); scrim.classList.remove('hidden'); } }, '☰'), h('span', { class: 'orb sm' }), h('strong', {}, 'LIGHT'));
  const main = h('main', { class: 'main', id: 'view', tabIndex: -1 });
  app.replaceChildren(h('div', { class: 'shell' }, sidebar, h('div', {}, topbar, main)), scrim);
}

function closeNav() { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('scrim')?.classList.add('hidden'); }

async function logout(btn) {
  if (!(await confirmDialog({ title: 'Log out?', message: 'You will be signed out of this device.', confirmLabel: 'Log out' }))) return;
  await withLoading(btn, async () => {
    await logoutRequest();
    location.hash = ''; location.reload();
  });
}

async function renderRoute() {
  if (!me) return;
  const { id, params, query } = parseHash();
  const route = ROUTES.find((r) => r.id === id);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === id));
  const main = document.getElementById('view');
  cleanup?.(); cleanup = null;
  main.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'orb thinking', style: 'margin:0 auto' })));
  try {
    const container = h('div', {});
    const ret = await route.view.render(container, { me, params, query, navigate: (to) => { location.hash = `#/${to}`; }, refreshMe });
    cleanup = typeof ret === 'function' ? ret : null;
    main.replaceChildren(container);
    document.title = `${route.label} — LIGHT`;
  } catch (e) {
    if (e.status === 401) return;
    main.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message), h('button', { class: 'btn', onclick: renderRoute }, 'Try again')));
  }
}

async function refreshMe() { const d = await api.get('/me'); me = d.user; setCsrf(d.csrfToken); return me; }

async function boot() {
  const err = new URLSearchParams(location.search).get('auth_error');
  if (err) history_replace();
  try {
    await refreshMe();
  } catch (e) {
    if (e.status === 401 || e.status === 0) { if (e.status === 0) toast(e.message, 'error'); return renderLogin(err); }
    throw e;
  }
  renderShell();
  startReminderPoller();
  window.addEventListener('hashchange', renderRoute);
  if (!location.hash) location.hash = '#/dashboard'; else renderRoute();
}

function history_replace() { window.history.replaceState({}, '', '/'); }

window.addEventListener('light:unauthenticated', () => { if (me) { me = null; toast('Your session has ended. Please sign in again.', 'error'); renderLogin(); } });
boot().catch((e) => { app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card login-card' }, h('h2', {}, 'LIGHT could not start'), h('p', { class: 'muted' }, e.message)))); });
