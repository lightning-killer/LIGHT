// Profile, dashboard, status, security center, approvals and integrations (all require a session).
import { Router } from 'express';
import { z } from 'zod';
import { query, one, ping } from '../database/db.js';
import { wrap, ok, HttpError } from '../middleware/errorHandler.js';
import { validate, ensureCsrfToken } from '../middleware/security.js';
import { providerStatus } from '../services/aiProvider.js';
import { audit } from '../services/audit.js';
import * as tools from '../services/tools.js';
import * as integrations from '../services/integrations.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------------- profile ----------------
export const profile = Router();
const settingsSchema = z.object({
  voice: z.object({ rate: z.number().min(0.5).max(2).optional(), pitch: z.number().min(0).max(2).optional(), voiceName: z.string().max(200).optional(), autoSpeak: z.boolean().optional(), lang: z.string().max(20).optional() }).optional(),
  notifications: z.object({ browser: z.boolean().optional() }).optional(),
}).strict();
const profileBody = z.object({ name: z.string().trim().min(1).max(200).optional(), timezone: z.string().trim().min(1).max(64).optional(), settings: settingsSchema.optional() }).strict();
const shape = (u) => ({ id: u.id, email: u.email, name: u.name, avatarUrl: u.avatar_url, timezone: u.timezone, settings: typeof u.settings === 'string' ? JSON.parse(u.settings) : u.settings || {}, createdAt: u.created_at, lastLoginAt: u.last_login_at });

profile.get('/me', wrap(async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!u) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
  ok(res, { user: shape(u), csrfToken: ensureCsrfToken(req) });
}));

profile.patch('/me', validate(profileBody), wrap(async (req, res) => {
  const { name, timezone, settings } = req.body;
  if (timezone) { try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new HttpError(400, 'Unknown time zone', 'invalid_input'); } }
  if (name !== undefined) await query('UPDATE users SET name = ? WHERE id = ?', [name, req.userId]);
  if (timezone !== undefined) await query('UPDATE users SET timezone = ? WHERE id = ?', [timezone, req.userId]);
  if (settings) {
    const cur = await one('SELECT settings FROM users WHERE id = ?', [req.userId]);
    const prev = typeof cur.settings === 'string' ? JSON.parse(cur.settings) : cur.settings || {};
    const merged = { ...prev, ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, { ...(prev[k] || {}), ...v }])) };
    await query('UPDATE users SET settings = ? WHERE id = ?', [JSON.stringify(merged), req.userId]);
  }
  await audit(req.userId, 'profile.updated', { fields: Object.keys(req.body) }, req.ip);
  ok(res, { user: shape(await one('SELECT * FROM users WHERE id = ?', [req.userId])) });
}));

// ---------------- status + dashboard ----------------
export const dashboard = Router();

dashboard.get('/status', wrap(async (req, res) => {
  const [db, ai] = await Promise.all([ping(), providerStatus()]);
  ok(res, { assistant: { online: true }, database: { connected: db }, ai, serverTime: new Date().toISOString() });
}));

dashboard.get('/dashboard', wrap(async (req, res) => {
  const uid = req.userId;
  const [counts, upcoming, recentConversations, activity, overdue, user, db, ai] = await Promise.all([
    one(`SELECT SUM(status='open') AS pending, SUM(status='done') AS completed FROM tasks WHERE user_id = ?`, [uid]),
    query("SELECT id, title, remind_at FROM reminders WHERE user_id = ? AND status = 'scheduled' AND remind_at > UTC_TIMESTAMP() ORDER BY remind_at ASC LIMIT 5", [uid]),
    query('SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5', [uid]),
    query("SELECT event, details, created_at FROM audit_logs WHERE user_id = ? AND event NOT IN ('tool.executed') ORDER BY id DESC LIMIT 8", [uid]),
    one("SELECT COUNT(*) AS n FROM reminders WHERE user_id = ? AND (status = 'triggered' OR (status = 'scheduled' AND remind_at <= UTC_TIMESTAMP()))", [uid]),
    one('SELECT name FROM users WHERE id = ?', [uid]),
    ping(), providerStatus(),
  ]);
  ok(res, {
    name: user?.name || '',
    tasks: { pending: Number(counts.pending || 0), completed: Number(counts.completed || 0) },
    overdueReminders: Number(overdue.n), upcomingReminders: upcoming, recentConversations,
    recentActivity: activity.map((a) => ({ ...a, details: typeof a.details === 'string' ? JSON.parse(a.details) : a.details })),
    status: { assistant: { online: true }, database: { connected: db }, ai },
  });
}));

// ---------------- security center ----------------
export const security = Router();

security.get('/', wrap(async (req, res) => {
  const uid = req.userId;
  const parse = (r) => ({ ...r, details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details });
  const [user, sessions, logins, events, approvals, integ] = await Promise.all([
    one('SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ?', [uid]),
    query('SELECT session_id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY last_seen_at DESC', [uid]),
    query("SELECT event, details, ip, created_at FROM audit_logs WHERE user_id = ? AND event IN ('auth.login','auth.logout','session.revoked') ORDER BY id DESC LIMIT 15", [uid]),
    query("SELECT event, details, ip, created_at FROM audit_logs WHERE user_id = ? AND event NOT IN ('tool.executed','auth.login','auth.logout') ORDER BY id DESC LIMIT 25", [uid]),
    tools.listApprovals(uid, 25),
    integrations.listIntegrations(uid),
  ]);
  const permissions = [
    { permission: 'Tasks (read/write)', granted: true, scope: 'LIGHT internal' }, { permission: 'Reminders (read/write)', granted: true, scope: 'LIGHT internal' },
    { permission: 'Memory (write)', granted: true, scope: 'LIGHT internal' }, { permission: 'Delete data / sensitive actions', granted: 'ask', scope: 'Requires your confirmation each time' },
    ...integ.map((i) => ({ permission: i.name, granted: i.status === 'connected', scope: i.status === 'connected' ? i.scopes.join(', ') : 'Not connected' })),
  ];
  ok(res, {
    account: user, currentSessionId: req.sessionID,
    sessions: sessions.map((s) => ({ id: s.session_id, current: s.session_id === req.sessionID, ip: s.ip, userAgent: s.user_agent, createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at })),
    logins: logins.map(parse), events: events.map(parse), approvals, integrations: integ, permissions,
  });
}));

security.delete('/sessions/:sid', wrap(async (req, res) => {
  const sid = String(req.params.sid).slice(0, 128);
  if (sid === req.sessionID) throw new HttpError(400, 'Use Log out to end the current session', 'invalid_input');
  const r = await query('UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL', [sid, req.userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Session not found', 'not_found');
  await audit(req.userId, 'session.revoked', { by: 'user' }, req.ip);
  ok(res, {});
}));

security.post('/sessions/revoke-others', wrap(async (req, res) => {
  const r = await query('UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND session_id <> ? AND revoked_at IS NULL', [req.userId, req.sessionID]);
  await audit(req.userId, 'session.revoked', { by: 'user', all_others: true, count: r.affectedRows }, req.ip);
  ok(res, { revoked: r.affectedRows });
}));

// ---------------- approvals ----------------
export const approvals = Router();
const ctxOf = (req) => ({ userId: req.userId, ip: req.ip, tzOffsetMinutes: 0 });
approvals.get('/', wrap(async (req, res) => ok(res, { approvals: await tools.listApprovals(req.userId) })));
approvals.post('/:id/approve', validate(idParam, 'params'), wrap(async (req, res) => ok(res, await tools.approve(ctxOf(req), Number(req.params.id)))));
approvals.post('/:id/reject', validate(idParam, 'params'), wrap(async (req, res) => ok(res, await tools.reject(ctxOf(req), Number(req.params.id)))));

// ---------------- integrations ----------------
export const integrationsRouter = Router();
integrationsRouter.get('/', wrap(async (req, res) => ok(res, { integrations: await integrations.listIntegrations(req.userId), planned: integrations.PLANNED })));
integrationsRouter.post('/:provider/disconnect', wrap(async (req, res) => {
  if (!integrations.CATALOG[req.params.provider]) throw new HttpError(404, 'Unknown integration', 'not_found');
  const out = await integrations.disconnect(req.userId, req.params.provider);
  await audit(req.userId, 'integration.disconnected', { provider: req.params.provider, revokedAtGoogle: out.revoked }, req.ip);
  ok(res, out);
}));
