let csrfToken = null;
export const setCsrf = (t) => { csrfToken = t; };

export class ApiError extends Error {
  constructor(status, message, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

async function request(method, path, body, { signal, form } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken || '';
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, signal, credentials: 'same-origin', body: form ? body : body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Cannot reach the server. Check your connection.', 'network');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !json?.ok) {
    const err = new ApiError(res.status, json?.error?.message || `Request failed (${res.status})`, json?.error?.code, json?.error?.details);
    if (res.status === 401) window.dispatchEvent(new CustomEvent('light:unauthenticated'));
    throw err;
  }
  return json.data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  patch: (p, b, o) => request('PATCH', p, b, o),
  del: (p, o) => request('DELETE', p, undefined, o),
  upload: (p, formData) => request('POST', p, formData, { form: true }),
};

export async function logoutRequest() {
  const res = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken || '' } });
  if (!res.ok && res.status !== 401) throw new ApiError(res.status, 'Could not log out. Please try again.', 'logout_failed');
}

export const qs =(obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};
