import rateLimit from 'express-rate-limit';
import { HttpError } from './errorHandler.js';
import { randomToken, safeEqual } from '../services/crypto.js';

/** Authentication: the user id ONLY ever comes from the server-side session. */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) return next(new HttpError(401, 'Authentication required', 'unauthenticated'));
  req.userId = req.session.userId;
  next();
}

/** CSRF: synchronizer token kept in the session, sent back in the X-CSRF-Token header. */
export function ensureCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomToken(24);
  return req.session.csrfToken;
}

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token');
  const expected = req.session?.csrfToken;
  if (!sent || !expected || !safeEqual(sent, expected)) return next(new HttpError(403, 'Invalid or missing CSRF token', 'csrf'));
  next();
}

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      req[source === 'body' ? 'body' : source] = schema.parse(req[source]);
      next();
    } catch (e) { next(e); }
  };
}

const limiterOpts = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ ok: false, error: { code: 'rate_limited', message: 'Too many requests, please slow down' } }),
};
export const apiLimiter = rateLimit({ ...limiterOpts, windowMs: 60_000, limit: 300 });
export const authLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60_000, limit: 30 });
export const chatLimiter = rateLimit({ ...limiterOpts, windowMs: 60_000, limit: 40 });
export const uploadLimiter = rateLimit({ ...limiterOpts, windowMs: 60_000, limit: 20 });
