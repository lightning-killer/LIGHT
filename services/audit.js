import { query } from '../database/db.js';

/** Append-only audit trail. Never throws: auditing must not break the request. */
export async function audit(userId, event, details = {}, ip = null) {
  try {
    await query('INSERT INTO audit_logs (user_id, event, details, ip) VALUES (?, ?, ?, ?)', [
      userId ?? null, String(event).slice(0, 100), JSON.stringify(details), ip,
    ]);
  } catch (e) {
    console.error('[audit] failed:', e.message);
  }
}
