import { api } from '../api.js';
import { h, pageHead, toast, withLoading } from '../ui.js';
import { speechSupport, listen, speak, stopSpeaking, isSpeaking, listVoices } from '../speech.js';

export async function render(root, { me, navigate, refreshMe }) {
  const v = me.settings?.voice || {};
  let recog = null; let convId = null;
  const orb = h('button', { class: 'orb mic-big', 'aria-label': 'Start listening', onclick: toggle });
  const state = h('div', { class: 'muted', role: 'status' }, speechSupport.recognition ? 'Tap the orb and speak' : 'Speech recognition is not supported in this browser (try Chrome or Edge).');
  const transcript = h('div', { class: 'bubble', style: 'min-height:48px;width:100%' }, '…');
  const reply = h('div', { class: 'bubble', style: 'min-height:48px;width:100%' }, '…');
  const stopBtn = h('button', { class: 'btn danger', onclick: () => { stopSpeaking(); orb.classList.remove('thinking'); state.textContent = 'Stopped speaking'; } }, 'Stop speaking');

  const voices = h('select', { 'aria-label': 'Voice' });
  const fillVoices = () => { voices.replaceChildren(h('option', { value: '' }, 'Browser default'), ...listVoices().map((x) => h('option', { value: x.name, selected: x.name === v.voiceName }, `${x.name} (${x.lang})`))); };
  fillVoices(); if (speechSupport.synthesis) speechSynthesis.onvoiceschanged = fillVoices;
  const rate = h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: v.rate ?? 1, 'aria-label': 'Speech rate' });
  const pitch = h('input', { type: 'range', min: 0, max: 2, step: 0.1, value: v.pitch ?? 1, 'aria-label': 'Speech pitch' });
  const lang = h('input', { value: v.lang || navigator.language || 'en-US', 'aria-label': 'Recognition language', placeholder: 'en-US' });
  const auto = h('input', { type: 'checkbox', checked: !!v.autoSpeak, id: 'auto' });
  const current = () => ({ rate: Number(rate.value), pitch: Number(pitch.value), voiceName: voices.value || undefined, lang: lang.value.trim() || undefined, autoSpeak: auto.checked });

  root.append(pageHead('Voice Assistant'),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card stack', style: 'align-items:center;text-align:center' }, orb, state,
        h('div', { style: 'width:100%;text-align:left' }, h('label', {}, 'You said'), transcript),
        h('div', { style: 'width:100%;text-align:left' }, h('label', {}, 'LIGHT replied'), reply),
        h('div', { class: 'row' }, stopBtn)),
      h('div', { class: 'card stack' }, h('h2', {}, 'Voice settings'),
        h('div', {}, h('label', {}, 'Voice'), voices), h('div', {}, h('label', {}, 'Speed'), rate), h('div', {}, h('label', {}, 'Pitch'), pitch),
        h('div', {}, h('label', {}, 'Recognition language (e.g. en-US, en-IN)'), lang),
        h('label', { class: 'row', for: 'auto' }, auto, 'Read assistant replies aloud in chat'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { try { speak('Hello, this is LIGHT.', current()); } catch (e) { toast(e.message, 'error'); } } }, 'Test voice'),
          h('button', { class: 'btn primary', onclick: (e) => withLoading(e.currentTarget, async () => { await api.patch('/me', { settings: { voice: current() } }); await refreshMe(); toast('Voice settings saved', 'success'); }) }, 'Save settings')),
        h('p', { class: 'small muted' }, 'Your browser asks for microphone permission the first time. Speech recognition in Chrome and Edge may send audio to the browser vendor\'s speech service.'))));

  function toggle() {
    if (recog) { recog.stop(); return; }
    try {
      stopSpeaking();
      recog = listen({ lang: lang.value.trim() || 'en-US',
        onResult: async (text, final) => { transcript.textContent = text || '…'; if (final && text) { recog?.stop(); await handle(text); } },
        onState: (s) => { orb.classList.toggle('listening', s === 'listening'); orb.setAttribute('aria-label', s === 'listening' ? 'Stop listening' : 'Start listening'); state.textContent = s === 'listening' ? 'Listening…' : 'Tap the orb and speak'; if (s === 'idle') recog = null; },
        onError: (m) => { state.textContent = m; toast(m, 'error'); recog = null; } });
    } catch (e) { toast(e.message, 'error'); state.textContent = e.message; recog = null; }
  }

  async function handle(text) {
    orb.classList.add('thinking'); state.textContent = 'Thinking…';
    try {
      if (!convId) convId = (await api.post('/conversations', { title: 'Voice session' })).conversation.id;
      const d = await api.post(`/conversations/${convId}/messages`, { content: text, tzOffsetMinutes: new Date().getTimezoneOffset() });
      reply.textContent = d.assistantMessage.content; state.textContent = 'Tap the orb and speak';
      try { speak(d.assistantMessage.content, current(), { onEnd: () => orb.classList.remove('thinking') }); } catch { orb.classList.remove('thinking'); }
    } catch (e) { toast(e.message, 'error'); state.textContent = e.message; orb.classList.remove('thinking'); }
  }
  return () => { recog?.stop(); stopSpeaking(); };
}
