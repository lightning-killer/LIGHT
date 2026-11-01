// Small DOM helpers. Text is always set with textContent / text nodes (never innerHTML), so data from the server cannot inject markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export function toast(message, type = 'info', ms = 4500) {
  const t = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

/** Runs fn while the button shows a spinner and is disabled, so a double click can't submit twice. */
export async function withLoading(btn, fn) {
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try { return await fn(); }
  catch (e) { if (e.name !== 'AbortError') toast(e.message || 'Something went wrong', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('loading'); } }
}

function openModal(content, { onClose } = {}) {
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content);
  backdrop.append(modal);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close(result) { document.removeEventListener('keydown', onKey); backdrop.remove(); onClose?.(result); }
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  modal.querySelector('input, textarea, select, button')?.focus();
  return close;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let close;
    const yes = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, confirmLabel);
    const no = h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel');
    close = openModal([h('h2', {}, title), h('p', { class: 'muted' }, message), h('div', { class: 'row', style: 'justify-content:flex-end' }, no, yes)], { onClose: (r) => resolve(!!r) });
    no.focus();
  });
}

/** fields: [{ name, label, type, value, required, options, placeholder, rows }] -> resolves with values or null */
export function formDialog({ title, fields, submitLabel = 'Save', onSubmit }) {
  return new Promise((resolve) => {
    let close;
    const inputs = {};
    const err = h('div', { class: 'error-text hidden' });
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) values[f.name] = f.type === 'checkbox' ? inputs[f.name].checked : inputs[f.name].value;
      const btn = form.querySelector('button[type=submit]');
      if (btn.disabled) return;
      btn.disabled = true; btn.classList.add('loading'); err.classList.add('hidden');
      try { if (onSubmit) await onSubmit(values); close(values); }
      catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      finally { btn.disabled = false; btn.classList.remove('loading'); }
    } },
    ...fields.map((f) => {
      let el;
      if (f.type === 'textarea') el = h('textarea', { rows: f.rows || 3, value: f.value ?? '', required: !!f.required, placeholder: f.placeholder || '', maxLength: f.maxLength });
      else if (f.type === 'select') el = h('select', {}, f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)));
      else el = h('input', { type: f.type || 'text', value: f.value ?? '', required: !!f.required, placeholder: f.placeholder || '', maxLength: f.maxLength, checked: f.type === 'checkbox' ? !!f.value : undefined });
      el.name = f.name; inputs[f.name] = el;
      return h('div', {}, h('label', { for: f.name }, f.label), el);
    }),
    err,
    h('div', { class: 'row', style: 'justify-content:flex-end' },
      h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, submitLabel)));
    close = openModal([h('h2', {}, title), form], { onClose: (r) => resolve(r ?? null) });
  });
}

// ---- date helpers ----
const pad = (n) => String(n).padStart(2, '0');
export const toInputValue = (d) => { if (!d) return ''; const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
export const fromInputValue = (v) => (v ? new Date(v).toISOString() : null);
export const fmtDate = (d) => (d ? new Date(d).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export function relTime(d) {
  const s = Math.round((new Date(d).getTime() - Date.now()) / 1000); const a = Math.abs(s);
  const [n, u] = a < 60 ? [a, 'second'] : a < 3600 ? [Math.round(a / 60), 'minute'] : a < 86400 ? [Math.round(a / 3600), 'hour'] : [Math.round(a / 86400), 'day'];
  const t = `${n} ${u}${n === 1 ? '' : 's'}`;
  return s >= 0 ? `in ${t}` : `${t} ago`;
}

export const pageHead = (title, ...actions) => h('div', { class: 'page-head' }, h('h1', {}, title), h('div', { class: 'row wrap' }, actions));
export const empty = (text) => h('div', { class: 'empty' }, text);
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
