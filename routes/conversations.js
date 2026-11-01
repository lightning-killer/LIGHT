import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { query, one } from '../database/db.js';
import { wrap, ok, HttpError } from '../middleware/errorHandler.js';
import { validate, chatLimiter, uploadLimiter } from '../middleware/security.js';
import * as conv from '../services/conversations.js';
import { handleMessage, canRegenerate } from '../services/assistant.js';
import { upload, contentLooksValid, removeFile, UPLOAD_ROOT } from '../services/uploads.js';
import { audit } from '../services/audit.js';
import { executeTool } from '../services/tools.js';

export const conversations = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const parseMeta = (m) => ({ ...m, meta: typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta });

conversations.get('/', validate(z.object({ q: z.string().max(200).optional() }), 'query'),
  wrap(async (req, res) => ok(res, { conversations: await conv.listConversations(req.userId, req.query.q) })));

conversations.post('/', validate(z.object({ title: z.string().trim().min(1).max(200).optional() })),
  wrap(async (req, res) => ok(res, { conversation: await conv.createConversation(req.userId, req.body.title) }, 201)));

conversations.get('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  const conversation = await conv.requireConversation(req.userId, req.params.id);
  const messages = (await conv.getMessages(req.userId, conversation.id)).map(parseMeta);
  // Approvals still waiting for this user, so the UI can re-show confirm cards after a refresh.
  const pending = await query("SELECT id, tool_id, summary, expires_at FROM approvals WHERE user_id = ? AND status = 'pending' AND expires_at > UTC_TIMESTAMP()", [req.userId]);
  ok(res, { conversation, messages, pendingApprovals: pending });
}));

conversations.patch('/:id', validate(idParam, 'params'), validate(z.object({ title: z.string().trim().min(1).max(200) })),
  wrap(async (req, res) => ok(res, { conversation: await conv.renameConversation(req.userId, Number(req.params.id), req.body.title) })));

// Deleting is a destructive action the user triggers explicitly in the UI (with a confirm dialog).
conversations.delete('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  await conv.deleteConversation(req.userId, Number(req.params.id));
  await audit(req.userId, 'conversation.deleted', { id: Number(req.params.id) }, req.ip);
  ok(res, {});
}));

const sendBody = z.object({
  content: z.string().trim().min(1).max(4000),
  tzOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  attachmentIds: z.array(z.number().int().positive()).max(5).default([]),
});

// Runs one assistant turn. If the browser aborts (Stop button), the assistant reply is NOT saved.
async function runTurn(req, res, conversation, text, attachmentIds = []) {
  const tz = req.body.tzOffsetMinutes ?? 0;
  const ctx = { userId: req.userId, ip: req.ip, tzOffsetMinutes: tz, conversationId: conversation.id };
  const history = (await conv.getMessages(req.userId, conversation.id, 50)).map((m) => ({ role: m.role, content: m.content }));
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  const out = await handleMessage(ctx, text, history, ac.signal);
  if (ac.signal.aborted) return null;
  const assistant = parseMeta(await conv.addMessage(req.userId, conversation.id, 'assistant', out.text, out.meta));
  return { assistant, newConversationId: out.meta?.newConversationId };
}

conversations.post('/:id/messages', chatLimiter, validate(idParam, 'params'), validate(sendBody), wrap(async (req, res) => {
  const conversation = await conv.requireConversation(req.userId, req.params.id);
  const { content, attachmentIds } = req.body;
  const userMsg = await conv.addMessage(req.userId, conversation.id, 'user', content);
  let attachments = [];
  if (attachmentIds.length) {
    await query('UPDATE attachments SET message_id = ? WHERE user_id = ? AND message_id IS NULL AND id IN (?)', [userMsg.id, req.userId, attachmentIds]);
    attachments = await query('SELECT id, original_name, mime, size FROM attachments WHERE user_id = ? AND message_id = ?', [req.userId, userMsg.id]);
  }
  await conv.autoTitle(req.userId, conversation, content);
  const turn = await runTurn(req, res, conversation, content, attachmentIds);
  if (!turn) return; // client stopped the request
  ok(res, { userMessage: { ...parseMeta(userMsg), attachments }, assistantMessage: turn.assistant, newConversationId: turn.newConversationId, conversation: await conv.getConversation(req.userId, conversation.id) });
}));

conversations.post('/:id/regenerate', chatLimiter, validate(idParam, 'params'), validate(z.object({ tzOffsetMinutes: z.number().int().min(-840).max(840).default(0) })), wrap(async (req, res) => {
  const conversation = await conv.requireConversation(req.userId, req.params.id);
  const msgs = (await conv.getMessages(req.userId, conversation.id)).map(parseMeta);
  const last = msgs[msgs.length - 1]; const prev = msgs[msgs.length - 2];
  if (!last || last.role !== 'assistant' || !prev || prev.role !== 'user') throw new HttpError(409, 'There is no assistant reply to regenerate', 'conflict');
  if (!canRegenerate(last.meta)) throw new HttpError(409, 'This reply performed an action (like creating a task), so it cannot be regenerated without repeating that action.', 'conflict');
  await conv.deleteMessage(req.userId, last.id);
  const turn = await runTurn(req, res, conversation, prev.content);
  if (!turn) return;
  ok(res, { assistantMessage: turn.assistant, replacedMessageId: last.id });
}));

// ---------------- attachments ----------------
export const attachments = Router();

attachments.post('/', uploadLimiter, upload.array('files', 5), wrap(async (req, res) => {
  const saved = [];
  for (const f of req.files || []) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!contentLooksValid(f.path, ext)) { await removeFile(f.path); throw new HttpError(415, `"${f.originalname}" does not match its file type`, 'unsupported_type'); }
    const r = await query('INSERT INTO attachments (user_id, original_name, stored_name, mime, size) VALUES (?, ?, ?, ?, ?)',
      [req.userId, path.basename(f.originalname).slice(0, 255), f.filename, f.mimetype, f.size]);
    saved.push({ id: r.insertId, original_name: path.basename(f.originalname), mime: f.mimetype, size: f.size });
  }
  if (!saved.length) throw new HttpError(400, 'No file received', 'invalid_input');
  await audit(req.userId, 'attachment.uploaded', { count: saved.length }, req.ip);
  ok(res, { attachments: saved }, 201);
}));

attachments.get('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  const a = await one('SELECT * FROM attachments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!a) throw new HttpError(404, 'File not found', 'not_found');
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(path.join(UPLOAD_ROOT, String(req.userId), a.stored_name), a.original_name);
}));

export { executeTool };
