// Browser speech helpers (Web Speech API). Everything degrades gracefully when unsupported.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupport = { recognition: !!Recognition, synthesis: 'speechSynthesis' in window };

export function listVoices() { return speechSupport.synthesis ? speechSynthesis.getVoices() : []; }

export function speak(text, settings = {}, { onStart, onEnd } = {}) {
  if (!speechSupport.synthesis) throw new Error('Text-to-speech is not supported in this browser.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = settings.rate ?? 1; u.pitch = settings.pitch ?? 1;
  if (settings.lang) u.lang = settings.lang;
  if (settings.voiceName) { const v = listVoices().find((x) => x.name === settings.voiceName); if (v) u.voice = v; }
  u.onstart = () => onStart?.(); u.onend = () => onEnd?.(); u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}
export const stopSpeaking = () => { if (speechSupport.synthesis) speechSynthesis.cancel(); };
export const isSpeaking = () => speechSupport.synthesis && speechSynthesis.speaking;

/** Starts one dictation session. Returns { stop }. The browser itself asks for microphone permission. */
export function listen({ lang = 'en-US', onResult, onState, onError }) {
  if (!Recognition) throw new Error('Speech recognition is not supported in this browser. Try Chrome or Edge.');
  const rec = new Recognition();
  rec.lang = lang; rec.interimResults = true; rec.continuous = false;
  let finalText = '';
  rec.onstart = () => onState?.('listening');
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; }
    onResult?.((finalText + interim).trim(), !interim);
  };
  rec.onerror = (e) => {
    const msg = { 'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings.', 'service-not-allowed': 'Microphone access is blocked for this site.', 'no-speech': 'I did not hear anything. Try again.', 'audio-capture': 'No microphone was found.', network: 'Speech recognition needs a network connection.' }[e.error] || `Speech recognition error: ${e.error}`;
    onError?.(msg);
  };
  rec.onend = () => onState?.('idle');
  rec.start();
  return { stop: () => rec.stop() };
}
