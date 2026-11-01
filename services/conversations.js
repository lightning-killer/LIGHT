import { query, one } from '../database/db.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function listConversations(userId, q) {
  if (q) {
    const like = `%${q}%`;
    return query(
      `SELECT c.id, c.title, c.created_at, c.updated_at FROM conversations c
       WHERE c.user_id = ? AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.user_id = ? AND m.content LIKE ?))
       ORDER BY c.updated_at DESC LIMIT 100`, [userId, like, userId, like]);
  }
  return query('SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100', [userId]);
}

export async function createConversation(userId, title = 'New conversation') {
  const r = await query('INSERT INTO conversations (user_id, title) VALUES (?, ?)', [userId, title.slice(0, 200)]);
  return getConversation(userId, r.insertId);
}

export const getConversation = (userId, id) =>
  one('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?', [id, userId]);

export async function requireConversation(userId, id) {
  const c = await getConversation(userId, id);
  if (!c) throw new HttpError(404, 'Conversation not found', 'not_found');
  return c;
}

export async function getMessages(userId, conversationId, limit = 500) {
  const rows = await query(
    `SELECT m.id, m.role, m.content, m.meta, m.created_at FROM messages m
     JOIN conversations c ON c.id = m.conversation_id AND c.user_id = ?
     WHERE m.conversation_id = ? ORDER BY m.id ASC LIMIT ?`, [userId, conversationId, limit]);
  if (!rows.length) return [];
  const atts = await query('SELECT id, message_id, original_name, mime, size FROM attachments WHERE user_id = ? AND message_id IN (?)', [userId, rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, attachments: atts.filter((a) => a.message_id === r.id) }));
}

export async function addMessage(userId, conversationId, role, content, meta = null) {
  await requireConversation(userId, conversationId); // defence in depth: never write into someone else's conversation
  const r = await query('INSERT INTO messages (conversation_id, user_id, role, content, meta) VALUES (?, ?, ?, ?, ?)',
    [conversationId, userId, role, content, meta ? JSON.stringify(meta) : null]);
  await query('UPDATE conversations SET updated_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?', [conversationId, userId]);
  return one('SELECT id, role, content, meta, created_at FROM messages WHERE id = ?', [r.insertId]);
}

export async function renameConversation(userId, id, title) {
  const r = await query('UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?', [title, id, userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Conversation not found', 'not_found');
  return getConversation(userId, id);
}

export async function deleteConversation(userId, id) {
  const r = await query('DELETE FROM conversations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Conversation not found', 'not_found');
}

export async function autoTitle(userId, conv, firstUserText) {
  if (conv.title !== 'New conversation') return;
  const t = firstUserText.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (t) await query('UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?', [t, conv.id, userId]);
}

export const deleteMessage = (userId, id) => query('DELETE FROM messages WHERE id = ? AND user_id = ?', [id, userId]);
