import { ZodError } from 'zod';
import { config } from '../config/index.js';

export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ok = (res, data = {}, status = 200) => res.status(status).json({ ok: true, data });

export function notFound(req, res) {
  res.status(404).json({ ok: false, error: { code: 'not_found', message: 'Not found' } });
}

// Centralized error handler: consistent JSON, no stack traces or internals leaked.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: { code: 'invalid_input', message: 'Invalid input', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: { code: 'file_too_large', message: 'File is too large (max 5 MB)' } });
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: { code: 'too_large', message: 'Request body too large' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: { code: 'bad_json', message: 'Malformed JSON' } });
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ ok: false, error: { code: 'server_error', message: config.isProd ? 'Something went wrong' : String(err?.message || err) } });
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
