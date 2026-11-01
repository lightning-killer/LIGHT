import { api, qs } from '../api.js';
import { h, empty, fmtDate, withLoading, confirmDialog, formDialog, toast, debounce } from '../ui.js';
import { speechSupport, listen, speak } from '../speech.js';

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function render(root, { me, params, navigate }) {
  let convId = params[0] ? Number(params[0]) : null;
  let messages = [];
  let pendingFiles = []; // uploaded, not yet sent
  let abort = null; // AbortController of the in-flight request
  let recog = null;

  const convList = h('div', { class: 'conv-list' });
  const search = h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search conversations' });
  const side = h('aside', { class: 'card chat-side' },
    h('button', { class: 'btn primary', onclick: (e) => withLoading(e.currentTarget, newConversation) }, '+ New conversation'), search, convList);
  const title = h('strong', { class: 'grow' }, 'LIGHT');
  const orb = h('div', { class: 'orb sm' });
  const msgBox = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  const chips = h('div', { class: 'chips' });
  const input = h('textarea', { rows: 1, placeholder: 'Message LIGHT…  (Enter to send, Shift+Enter for a new line)', 'aria-label': 'Message', maxLength: 4000 });
  const fileInput = h('input', { type: 'file', multiple: true, class: 'hidden', accept: '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json', onchange: onFiles });
  const attachBtn = h('button', { class: 'btn icon', title: 'Attach files (max 5 MB each)', 'aria-label': 'Attach files', onclick: () => fileInput.click() }, '📎');
  const micBtn = h('button', { class: 'btn icon', title: 'Dictate with your microphone', 'aria-label': 'Start voice input', onclick: toggleMic }, '🎤');
  const sendBtn = h('button', { class: 'btn primary', onclick: send }, 'Send');
  const stopBtn = h('button', { class: 'btn danger hidden', onclick: () => abort?.abort() }, 'Stop');
  const menuBtn = h('button', { class: 'btn sm', onclick: () => side.classList.toggle('open') }, 'Conversations');
  const renameBtn = h('button', { class: 'btn sm', disabled: true, onclick: renameConv }, 'Rename');
  const deleteBtn = h('button', { class: 'btn sm danger', disabled: true, onclick: deleteConv }, 'Delete');

  root.append(h('div', { class: 'chat-layout' }, side,
    h('section', { class: 'card chat-main' },
      h('div', { class: 'chat-head' }, orb, title, menuBtn, renameBtn, deleteBtn),
      msgBox,
      h('div', { class: 'composer' }, chips, h('div', { class: 'input-row' }, attachBtn, fileInput, input, micBtn, stopBtn, sendBtn)))));

  // ---------- conversations ----------
  async function loadList() {
    const { conversations } = await api.get('/conversations' + qs({ q: search.value.trim() }));
    convList.replaceChildren(...(conversations.length ? conversations.map((c) => h('div', { class: `conv-item ${c.id === convId ? 'active' : ''}`, onclick: () => { side.classList.remove('open'); navigate(`chat/${c.id}`); } }, h('span', { class: 'title', title: c.title }, c.title))) : [empty(search.value ? 'No matches' : 'No conversations yet')]));
  }
  async function loadConversation() {
    if (!convId) { messages = []; title.textContent = 'New chat'; renameBtn.disabled = deleteBtn.disabled = true; return renderMessages(); }
    try {
      const d = await api.get(`/conversations/${convId}`);
      messages = d.messages; title.textContent = d.conversation.title; renameBtn.disabled = deleteBtn.disabled = false;
      renderMessages(d.pendingApprovals);
    } catch (e) { if (e.status === 404) { convId = null; navigate('chat'); return; } throw e; }
  }
  async function newConversation() { const { conversation } = await api.post('/conversations', {}); navigate(`chat/${conversation.id}`); }
  async function renameConv() {
    const v = await formDialog({ title: 'Rename conversation', fields: [{ name: 'title', label: 'Title', value: title.textContent, required: true, maxLength: 200 }], onSubmit: (x) => api.patch(`/conversations/${convId}`, { title: x.title.trim() }) });
    if (v) { title.textContent = v.title.trim(); toast('Renamed', 'success'); loadList(); }
  }
  async function deleteConv(e) {
    if (!(await confirmDialog({ title: 'Delete conversation?', message: 'This conversation and all its messages will be permanently deleted.', confirmLabel: 'Delete', danger: true }))) return;
    await withLoading(e.currentTarget, async () => { await api.del(`/conversations/${convId}`); toast('Conversation deleted', 'success'); navigate('chat'); });
  }

  // ---------- rendering ----------
  function renderMessages(pendingApprovals = []) {
    msgBox.replaceChildren();
    if (!messages.length) msgBox.append(h('div', { class: 'empty' }, h('div', { class: 'orb lg', style: 'margin:0 auto 16px' }), h('p', {}, `Hi${me.name ? ' ' + me.name.split(' ')[0] : ''}, I'm LIGHT.`), h('p', { class: 'small' }, 'Try "Add task buy milk", "Remind me to call mom tomorrow at 5pm", "What time is it?" or "help".')));
    const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf('assistant');
    messages.forEach((m, i) => msgBox.append(messageEl(m, i === lastAssistantIdx, pendingApprovals)));
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function messageEl(m, isLastAssistant, pendingApprovals = []) {
    const body = h('div', { class: 'bubble' }, m.content);
    const wrap = h('div', { class: `msg ${m.role}` }, body);
    if (m.attachments?.length) wrap.append(h('div', { class: 'chips' }, m.attachments.map((a) => h('a', { class: 'chip', href: `/api/attachments/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.original_name} (${fmtSize(a.size)})`))));
    const approval = m.meta?.approvalId && pendingApprovals.find((p) => p.id === m.meta.approvalId);
    if (approval) wrap.append(approvalCard(approval, wrap));
    if (m.role === 'assistant') {
      wrap.append(h('div', { class: 'tools' },
        h('button', { class: 'btn sm', onclick: async (e) => { try { await navigator.clipboard.writeText(m.content); e.currentTarget.textContent = 'Copied'; setTimeout(() => { e.currentTarget.textContent = 'Copy'; }, 1500); } catch { toast('Could not copy. Select the text manually.', 'error'); } } }, 'Copy'),
        speechSupport.synthesis ? h('button', { class: 'btn sm', onclick: () => { try { speak(m.content, me.settings?.voice); } catch (e) { toast(e.message, 'error'); } } }, 'Read aloud') : null,
        isLastAssistant ? h('button', { class: 'btn sm', onclick: (e) => regenerate(e.currentTarget) }, 'Regenerate') : null,
        h('span', { class: 'small muted' }, fmtDate(m.created_at))));
    }
    return wrap;
  }

  function approvalCard(a, host) {
    const status = h('div', { class: 'small muted' });
    const card = h('div', { class: 'approval' }, h('strong', {}, 'Confirmation needed'), h('div', {}, a.summary), h('div', { class: 'small muted' }, 'This action only runs if you approve it, and approval applies to this one action only.'), status,
      h('div', { class: 'row' },
        h('button', { class: 'btn danger', onclick: (e) => decide(e.currentTarget, 'approve') }, 'Approve'),
        h('button', { class: 'btn', onclick: (e) => decide(e.currentTarget, 'reject') }, 'Reject')));
    async function decide(btn, what) {
      await withLoading(btn, async () => {
        const out = await api.post(`/approvals/${a.id}/${what}`);
        card.replaceChildren(h('div', {}, what === 'approve' ? `Done — ${out.status}.` : 'Rejected. Nothing was changed.'));
        if (what === 'approve') toast('Action completed', 'success');
      });
    }
    return card;
  }

  // ---------- sending ----------
  function setBusy(b) {
    sendBtn.disabled = b; attachBtn.disabled = b; input.disabled = b; stopBtn.classList.toggle('hidden', !b);
    orb.classList.toggle('thinking', b);
  }
  const typingEl = () => h('div', { class: 'msg assistant', id: 'typing' }, h('div', { class: 'bubble' }, h('span', { class: 'typing', 'aria-label': 'LIGHT is thinking' }, h('i'), h('i'), h('i'))));

  async function ensureConversation() {
    if (convId) return convId;
    const { conversation } = await api.post('/conversations', {});
    convId = conversation.id; history.replaceState(null, '', `#/chat/${convId}`);
    return convId;
  }

  async function send() {
    const content = input.value.trim();
    if (!content || sendBtn.disabled) return;
    abort = new AbortController(); setBusy(true);
    const files = pendingFiles;
    try {
      const id = await ensureConversation();
      messages.push({ id: 'tmp', role: 'user', content, created_at: new Date().toISOString(), attachments: files.map((f) => ({ id: f.id, original_name: f.original_name, size: f.size })) });
      input.value = ''; resize(); pendingFiles = []; renderChips();
      renderMessages(); msgBox.append(typingEl()); msgBox.scrollTop = msgBox.scrollHeight;
      const d = await api.post(`/conversations/${id}/messages`, { content, tzOffsetMinutes: new Date().getTimezoneOffset(), attachmentIds: files.map((f) => f.id) }, { signal: abort.signal });
      messages[messages.length - 1] = d.userMessage; messages.push(d.assistantMessage);
      title.textContent = d.conversation.title; renameBtn.disabled = deleteBtn.disabled = false;
      const pending = d.assistantMessage.meta?.approvalId ? (await api.get(`/conversations/${id}`)).pendingApprovals : [];
      renderMessages(pending); loadList();
      if (me.settings?.voice?.autoSpeak) { try { speak(d.assistantMessage.content, me.settings.voice); } catch { /* ignore */ } }
      if (d.newConversationId) navigate(`chat/${d.newConversationId}`);
    } catch (e) {
      document.getElementById('typing')?.remove();
      if (e.name === 'AbortError') { toast('Stopped. The assistant reply was not saved.', 'info'); await loadConversation(); }
      else { toast(e.message, 'error'); await loadConversation().catch(() => {}); input.value = input.value || content; }
    } finally { abort = null; setBusy(false); input.focus(); }
  }

  async function regenerate(btn) {
    abort = new AbortController(); setBusy(true);
    try {
      msgBox.append(typingEl()); msgBox.scrollTop = msgBox.scrollHeight;
      await api.post(`/conversations/${convId}/regenerate`, { tzOffsetMinutes: new Date().getTimezoneOffset() }, { signal: abort.signal });
      await loadConversation();
    } catch (e) { document.getElementById('typing')?.remove(); if (e.name !== 'AbortError') toast(e.message, 'error'); await loadConversation().catch(() => {}); }
    finally { abort = null; setBusy(false); }
  }

  // ---------- attachments ----------
  async function onFiles() {
    const files = [...fileInput.files]; fileInput.value = '';
    if (!files.length) return;
    if (files.length + pendingFiles.length > 5) return toast('You can attach up to 5 files per message.', 'error');
    const big = files.find((f) => f.size > 5 * 1024 * 1024);
    if (big) return toast(`"${big.name}" is larger than 5 MB.`, 'error');
    await withLoading(attachBtn, async () => {
      const fd = new FormData(); files.forEach((f) => fd.append('files', f));
      const { attachments } = await api.upload('/attachments', fd);
      pendingFiles.push(...attachments); renderChips();
    });
  }
  function renderChips() {
    chips.replaceChildren(...pendingFiles.map((f) => h('span', { class: 'chip' }, `📎 ${f.original_name} (${fmtSize(f.size)})`, h('button', { class: 'btn sm', 'aria-label': `Remove ${f.original_name}`, onclick: () => { pendingFiles = pendingFiles.filter((x) => x !== f); renderChips(); } }, '×'))));
  }

  // ---------- voice input ----------
  function toggleMic() {
    if (recog) { recog.stop(); return; }
    try {
      recog = listen({ lang: me.settings?.voice?.lang || navigator.language || 'en-US',
        onResult: (text) => { input.value = text; resize(); },
        onState: (s) => { micBtn.classList.toggle('primary', s === 'listening'); micBtn.setAttribute('aria-label', s === 'listening' ? 'Stop voice input' : 'Start voice input'); orb.classList.toggle('listening', s === 'listening'); if (s === 'idle') recog = null; },
        onError: (m) => { toast(m, 'error'); recog = null; } });
    } catch (e) { toast(e.message, 'error'); recog = null; }
  }

  function resize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; }
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  search.addEventListener('input', debounce(() => loadList().catch((e) => toast(e.message, 'error'))));

  await Promise.all([loadList(), loadConversation()]);
  input.focus();
  return () => { recog?.stop(); abort?.abort(); };
}
