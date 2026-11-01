// Provider-independent AI layer. Each provider implements:
//   name, configured(), status() -> { name, configured, reachable, detail }, complete({ messages, signal }) -> string
// Add a provider by adding a class and registering it in PROVIDERS; nothing else in the backend changes.
import { config } from '../config/index.js';

const SYSTEM_PROMPT =
  'You are LIGHT, a concise, helpful personal assistant. You cannot create tasks, reminders or other records yourself; ' +
  'if the user wants that, tell them to phrase it as a command (e.g. "Add task ...", "Remind me to ..."). Never claim to have performed an action.';

class RulesProvider {
  name = 'rules';
  configured() { return false; }
  async status() { return { name: this.name, configured: false, reachable: false, detail: 'Rule-based commands only. No language model connected.' }; }
  async complete() { return null; }
}

class OllamaProvider {
  name = 'ollama';
  configured() { return !!config.ai.ollamaUrl; }
  async status() {
    try {
      const r = await fetch(`${config.ai.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
      return { name: this.name, configured: true, reachable: r.ok, detail: r.ok ? `Model: ${config.ai.ollamaModel}` : `HTTP ${r.status}` };
    } catch { return { name: this.name, configured: true, reachable: false, detail: 'Ollama is not reachable' }; }
  }
  async complete({ messages, signal }) {
    const r = await fetch(`${config.ai.ollamaUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ model: config.ai.ollamaModel, stream: false, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages] }),
    });
    if (!r.ok) throw new Error(`Ollama returned HTTP ${r.status}`);
    return (await r.json()).message?.content?.trim() || null;
  }
}

// Any OpenAI-compatible chat completions endpoint (CLOUD_AI_URL should be the base URL, e.g. https://api.openai.com/v1)
class CloudProvider {
  name = 'cloud';
  configured() { return !!(config.ai.cloudUrl && config.ai.cloudKey && config.ai.cloudModel); }
  async status() {
    return { name: this.name, configured: this.configured(), reachable: this.configured(), detail: this.configured() ? `Model: ${config.ai.cloudModel}` : 'CLOUD_AI_URL / CLOUD_AI_KEY / CLOUD_AI_MODEL not set' };
  }
  async complete({ messages, signal }) {
    const r = await fetch(`${config.ai.cloudUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.cloudKey}` },
      body: JSON.stringify({ model: config.ai.cloudModel, messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages] }),
    });
    if (!r.ok) throw new Error(`AI provider returned HTTP ${r.status}`);
    return (await r.json()).choices?.[0]?.message?.content?.trim() || null;
  }
}

const PROVIDERS = { rules: new RulesProvider(), ollama: new OllamaProvider(), cloud: new CloudProvider() };
export const getProvider = () => PROVIDERS[config.ai.provider] || PROVIDERS.rules;
export const providerStatus = () => getProvider().status();
