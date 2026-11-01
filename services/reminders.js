import { query, one } from '../database/db.js';
import { HttpError } from '../middleware/errorHandler.js';

export const getReminder = (userId, id) => one('SELECT * FROM reminders WHERE id = ? AND user_id = ?', [id, userId]);

/** filter: upcoming | overdue | triggered | completed | cancelled | all */
export async function listReminders(userId, filter = 'all') {
  const base = 'SELECT * FROM reminders WHERE user_id = ?';
  switch (filter) {
    case 'upcoming': return query(`${base} AND status = 'scheduled' AND remind_at > UTC_TIMESTAMP() ORDER BY remind_at ASC LIMIT 200`, [userId]);
    case 'overdue': return query(`${base} AND (status = 'triggered' OR (status = 'scheduled' AND remind_at <= UTC_TIMESTAMP())) ORDER BY remind_at ASC LIMIT 200`, [userId]);
    case 'completed': case 'cancelled': return query(`${base} AND status = ? ORDER BY remind_at DESC LIMIT 200`, [userId, filter]);
    default: return query(`${base} ORDER BY FIELD(status,'triggered','scheduled','completed','cancelled'), remind_at ASC LIMIT 500`, [userId]);
  }
}

export async function createReminder(userId, { title, notes = null, remindAt }) {
  const r = await query('INSERT INTO reminders (user_id, title, notes, remind_at) VALUES (?, ?, ?, ?)', [userId, title, notes, remindAt]);
  return getReminder(userId, r.insertId);
}

export async function updateReminder(userId, id, patch) {
  const existing = await getReminder(userId, id);
  if (!existing) throw new HttpError(404, 'Reminder not found', 'not_found');
  if (['completed', 'cancelled'].includes(existing.status)) throw new HttpError(409, `A ${existing.status} reminder cannot be edited`, 'conflict');
  const sets = []; const params = [];
  if ('title' in patch) { sets.push('title = ?'); params.push(patch.title); }
  if ('notes' in patch) { sets.push('notes = ?'); params.push(patch.notes); }
  if ('remindAt' in patch) { // rescheduling re-arms the reminder so it can notify again exactly once
    sets.push('remind_at = ?', "status = 'scheduled'", 'triggered_at = NULL', "notification_status = 'none'", 'notified_at = NULL');
    params.push(patch.remindAt);
  }
  if (sets.length) await query(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, id, userId]);
  return getReminder(userId, id);
}

async function setStatus(userId, id, status, allowedFrom) {
  const r = await query(`UPDATE reminders SET status = ? WHERE id = ? AND user_id = ? AND status IN (${allowedFrom.map(() => '?').join(',')})`, [status, id, userId, ...allowedFrom]);
  if (!r.affectedRows) {
    if (!(await getReminder(userId, id))) throw new HttpError(404, 'Reminder not found', 'not_found');
    throw new HttpError(409, `Reminder cannot be changed from its current state`, 'conflict');
  }
  return getReminder(userId, id);
}
export const cancelReminder = (userId, id) => setStatus(userId, id, 'cancelled', ['scheduled', 'triggered']);
export const completeReminder = (userId, id) => setStatus(userId, id, 'completed', ['scheduled', 'triggered']);

export async function deleteReminder(userId, id) {
  const r = await query('DELETE FROM reminders WHERE id = ? AND user_id = ?', [id, userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Reminder not found', 'not_found');
}

export function findRemindersByText(userId, text) {
  if (!text) return query("SELECT * FROM reminders WHERE user_id = ? AND status IN ('scheduled','triggered') ORDER BY remind_at ASC LIMIT 5", [userId]);
  return query("SELECT * FROM reminders WHERE user_id = ? AND status IN ('scheduled','triggered') AND title LIKE ? ORDER BY remind_at ASC LIMIT 5", [userId, `%${text}%`]);
}

/**
 * Scheduler step. The single UPDATE is atomic, so a reminder can only ever be claimed once
 * (no duplicate notifications even with several server processes).
 */
export async function claimDueReminders() {
  const r = await query(
    `UPDATE reminders SET status = 'triggered', triggered_at = UTC_TIMESTAMP(), notification_status = 'pending'
     WHERE status = 'scheduled' AND remind_at <= UTC_TIMESTAMP()`);
  return r.affectedRows;
}

/** Reminders that fired but whose notification has not been confirmed by a client yet. */
export const pendingNotifications = (userId) =>
  query("SELECT * FROM reminders WHERE user_id = ? AND status = 'triggered' AND notification_status = 'pending' ORDER BY remind_at ASC LIMIT 20", [userId]);

/** Called by the browser after it actually displayed (or failed to display) the notification. */
export async function acknowledgeNotification(userId, id, delivered) {
  const r = await query(
    `UPDATE reminders SET notification_status = ?, notified_at = IF(?, UTC_TIMESTAMP(), NULL)
     WHERE id = ? AND user_id = ? AND notification_status = 'pending'`,
    [delivered ? 'delivered' : 'failed', delivered ? 1 : 0, id, userId]);
  return r.affectedRows === 1;
}
