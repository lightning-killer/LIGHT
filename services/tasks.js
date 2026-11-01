import { query, one } from '../database/db.js';
import { HttpError } from '../middleware/errorHandler.js';

// Every statement filters by user_id: ownership is enforced in the data layer.
const SORTS = { created: 'created_at', due: 'due_at', priority: "FIELD(priority,'high','medium','low')", title: 'title', status: 'status' };

export async function listTasks(userId, { status, priority, q, sort = 'created', order = 'desc' } = {}) {
  const where = ['user_id = ?']; const params = [userId];
  if (status === 'open' || status === 'done') { where.push('status = ?'); params.push(status); }
  if (priority) { where.push('priority = ?'); params.push(priority); }
  if (q) { where.push('(title LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  const col = SORTS[sort] || SORTS.created;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const nullsLast = sort === 'due' ? 'due_at IS NULL, ' : '';
  return query(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY ${nullsLast}${col} ${dir}, id DESC LIMIT 500`, params);
}

export const getTask = (userId, id) => one('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, userId]);

export async function createTask(userId, { title, description = null, priority = 'medium', dueAt = null }) {
  const r = await query('INSERT INTO tasks (user_id, title, description, priority, due_at) VALUES (?, ?, ?, ?, ?)', [userId, title, description, priority, dueAt]);
  return getTask(userId, r.insertId);
}

export async function updateTask(userId, id, patch) {
  const existing = await getTask(userId, id);
  if (!existing) throw new HttpError(404, 'Task not found', 'not_found');
  const sets = []; const params = [];
  for (const k of ['title', 'description', 'priority']) if (k in patch) { sets.push(`${k} = ?`); params.push(patch[k]); }
  if ('dueAt' in patch) { sets.push('due_at = ?'); params.push(patch.dueAt); }
  if ('status' in patch) {
    sets.push('status = ?'); params.push(patch.status);
    sets.push('completed_at = ?'); params.push(patch.status === 'done' ? new Date() : null);
  }
  if (sets.length) await query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, id, userId]);
  return getTask(userId, id);
}

export async function deleteTask(userId, id) {
  const r = await query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Task not found', 'not_found');
}

/** Fuzzy lookup used by the command engine ("mark buy milk as done"). */
export async function findTasksByText(userId, text, status = 'open') {
  const num = /^#?(\d+)$/.exec(text.trim());
  if (num) { const t = await getTask(userId, Number(num[1])); return t && t.status === status ? [t] : []; }
  const exact = await query('SELECT * FROM tasks WHERE user_id = ? AND status = ? AND LOWER(title) = LOWER(?) LIMIT 5', [userId, status, text]);
  if (exact.length) return exact;
  return query('SELECT * FROM tasks WHERE user_id = ? AND status = ? AND title LIKE ? ORDER BY id DESC LIMIT 5', [userId, status, `%${text}%`]);
}
