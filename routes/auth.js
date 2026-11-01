import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/index.js';
import { query, one } from '../database/db.js';
import { randomToken, safeEqual } from '../services/crypto.js';
import { audit } from '../services/audit.js';
import { wrap, HttpError } from '../middleware/errorHandler.js';
import { authLimiter, requireAuth, csrfProtection } from '../middleware/security.js';
import * as integrations from '../services/integrations.js';

const router = Router();
router.use(authLimiter);
const client = () => new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.callbackUrl);
const fail = (res, code) => res.redirect(`/?auth_error=${encodeURIComponent(code)}`);
const regenerate = (req) => new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
const save = (req) => new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

// Step 2-3: send the browser to Google with state, nonce and PKCE.
router.get('/google', wrap(async (req, res) => {
  if (!config.google.clientId || !config.google.clientSecret) return fail(res, 'not_configured');
  const c = client();
  const { codeVerifier, codeChallenge } = await c.generateCodeVerifierAsync();
  const state = randomToken(24); const nonce = randomToken(24);
  req.session.oauth = { state, nonce, codeVerifier, at: Date.now() };
  const url = c.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256', prompt: 'select_account' });
  await save(req);
  res.redirect(url);
}));

// Steps 4-9: validate state, exchange the code, verify the ID token, find/create the user, start a session.
router.get('/google/callback', wrap(async (req, res) => {
  const pending = req.session.oauth;
  delete req.session.oauth;
  const { state, code, error } = req.query;
  if (error) return fail(res, 'access_denied');
  if (!pending || typeof state !== 'string' || typeof code !== 'string' || !safeEqual(state, pending.state) || Date.now() - pending.at > 10 * 60_000) {
    await audit(null, 'auth.callback_rejected', { reason: 'state_mismatch_or_expired' }, req.ip);
    return fail(res, 'invalid_state');
  }
  let payload;
  try {
    const c = client();
    const { tokens } = await c.getToken({ code, codeVerifier: pending.codeVerifier });
    if (!tokens.id_token) throw new Error('no id_token');
    // verifyIdToken checks signature (Google's certs), issuer, audience (our client id) and expiry.
    const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
    payload = ticket.getPayload();
    if (!payload?.sub || !safeEqual(payload.nonce || '', pending.nonce)) throw new Error('nonce mismatch');
  } catch (e) {
    await audit(null, 'auth.token_rejected', { reason: e.message }, req.ip);
    return fail(res, 'token_invalid');
  }

  // Identity key is Google's stable subject, never the email.
  let link = await one("SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_subject = ?", [payload.sub]);
  let userId;
  if (link) {
    userId = link.user_id;
    await query('UPDATE users SET last_login_at = UTC_TIMESTAMP(), name = ?, avatar_url = ?, email = ? WHERE id = ?', [payload.name || '', payload.picture || null, payload.email || '', userId]);
    await query('UPDATE oauth_accounts SET email = ? WHERE provider = \'google\' AND provider_subject = ?', [payload.email || null, payload.sub]);
  } else {
    const r = await query('INSERT INTO users (email, name, avatar_url, last_login_at) VALUES (?, ?, ?, UTC_TIMESTAMP())', [payload.email || '', payload.name || '', payload.picture || null]);
    userId = r.insertId;
    await query("INSERT INTO oauth_accounts (user_id, provider, provider_subject, email) VALUES (?, 'google', ?, ?)", [userId, payload.sub, payload.email || null]);
    await audit(userId, 'account.created', { provider: 'google' }, req.ip);
  }

  await regenerate(req); // new session id on login prevents session fixation
  req.session.userId = userId;
  req.session.meta = { ip: req.ip, userAgent: req.get('user-agent') || '' };
  await save(req);
  await audit(userId, 'auth.login', { provider: 'google' }, req.ip);
  res.redirect('/#/dashboard');
}));

router.post('/logout', requireAuth, csrfProtection, wrap(async (req, res) => {
  const userId = req.userId;
  await audit(userId, 'auth.logout', {}, req.ip);
  req.session.destroy(() => {
    res.clearCookie('light.sid');
    res.json({ ok: true, data: {} });
  });
}));

// ---- optional integrations: explicit, per-integration consent with its own state ----
router.get('/integrations/start/:provider', requireAuth, wrap(async (req, res) => {
  const state = randomToken(24);
  req.session.integrationOauth = { state, provider: req.params.provider, at: Date.now() };
  const url = integrations.buildConnectUrl(req.params.provider, state);
  await save(req);
  res.redirect(url);
}));

router.get('/integrations/callback', requireAuth, wrap(async (req, res) => {
  const pending = req.session.integrationOauth;
  delete req.session.integrationOauth;
  const { state, code, error } = req.query;
  if (error || !pending || typeof state !== 'string' || typeof code !== 'string' || !safeEqual(state, pending.state) || Date.now() - pending.at > 10 * 60_000) {
    await audit(req.userId, 'integration.connect_rejected', { provider: pending?.provider }, req.ip);
    return res.redirect('/#/integrations?error=connect_failed');
  }
  try {
    await integrations.completeConnect(req.userId, pending.provider, code);
    await audit(req.userId, 'integration.connected', { provider: pending.provider }, req.ip);
    res.redirect('/#/integrations?connected=' + encodeURIComponent(pending.provider));
  } catch (e) {
    await audit(req.userId, 'integration.connect_failed', { provider: pending.provider, error: e.message }, req.ip);
    res.redirect('/#/integrations?error=connect_failed');
  }
}));

export default router;
export { HttpError };
