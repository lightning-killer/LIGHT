import session from 'express-session';
import { query, one } from '../database/db.js';
import { config } from '../config/index.js';

/** MySQL-backed session store. Rows can be revoked (revoked_at) and are tied to users. */
export class MySQLSessionStore extends session.Store {
  async get(sid, cb) {
    try {
      const row = await one(
        'SELECT data FROM sessions WHERE session_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()', [sid]);
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (e) { cb(e); }
  }

  async set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + config.sessionTtlMs);
      const meta = sess.meta || {};
      await query(
        `INSERT INTO sessions (session_id, user_id, data, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), data = VALUES(data), expires_at = VALUES(expires_at), last_seen_at = UTC_TIMESTAMP()`,
        [sid, sess.userId ?? null, JSON.stringify(sess), expires, meta.ip ?? null, (meta.userAgent || '').slice(0, 400)]);
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  async touch(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + config.sessionTtlMs);
      await query('UPDATE sessions SET expires_at = ?, last_seen_at = UTC_TIMESTAMP() WHERE session_id = ? AND revoked_at IS NULL', [expires, sid]);
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  async destroy(sid, cb) {
    try { await query('DELETE FROM sessions WHERE session_id = ?', [sid]); cb?.(null); } catch (e) { cb?.(e); }
  }
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP() OR revoked_at < (UTC_TIMESTAMP() - INTERVAL 7 DAY)');
}
