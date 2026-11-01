import { api } from '../api.js';
import { h, pageHead, withLoading, toast } from '../ui.js';
import { requestNotificationPermission } from '../notifier.js';

export async function render(root, { me, refreshMe }) {
  const name = h('input', { value: me.name || '', maxLength: 200, 'aria-label': 'Display name' });
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [me.timezone];
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = h('select', { 'aria-label': 'Time zone' }, [...new Set([me.timezone, detected, ...zones])].map((z) => h('option', { value: z, selected: z === (me.timezone === 'UTC' ? detected : me.timezone) }, z)));
  const notif = h('span', { class: 'badge' });
  const showNotif = () => { const p = 'Notification' in window ? Notification.permission : 'unsupported'; notif.textContent = p; notif.className = `badge ${p === 'granted' ? 'ok' : p === 'denied' ? 'bad' : 'warn'}`; };
  showNotif();

  root.append(pageHead('Profile & Settings'),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card stack' }, h('h2', {}, 'Profile'),
        h('div', { class: 'row' }, me.avatarUrl ? h('img', { class: 'avatar', src: me.avatarUrl, alt: '', referrerPolicy: 'no-referrer' }) : h('div', { class: 'avatar' }, (me.name || '?')[0]), h('div', {}, h('div', {}, me.email), h('div', { class: 'small muted' }, 'Managed by your Google account'))),
        h('div', {}, h('label', {}, 'Display name'), name), h('div', {}, h('label', {}, 'Time zone'), tz),
        h('div', {}, h('button', { class: 'btn primary', onclick: (e) => withLoading(e.currentTarget, async () => {
          if (!name.value.trim()) throw new Error('Name cannot be empty');
          await api.patch('/me', { name: name.value.trim(), timezone: tz.value }); await refreshMe(); toast('Profile saved', 'success');
        }) }, 'Save profile'))),
      h('div', { class: 'card stack' }, h('h2', {}, 'Notifications'),
        h('div', { class: 'row' }, 'Browser notifications: ', notif),
        h('p', { class: 'small muted' }, 'Reminders appear as browser notifications when permitted; otherwise as an in-app alert while LIGHT is open. LIGHT marks a reminder "delivered" only after your browser actually showed it.'),
        h('div', {}, h('button', { class: 'btn', onclick: (e) => withLoading(e.currentTarget, async () => { const r = await requestNotificationPermission(); showNotif(); if (r === 'denied') toast('Notifications are blocked. Enable them in your browser site settings.', 'error'); else if (r === 'unsupported') toast('This browser does not support notifications.', 'error'); }) }, 'Enable browser notifications')),
        h('p', { class: 'small muted' }, 'Voice options are on the ', h('a', { href: '#/voice' }, 'Voice page'), '.'))));
}
