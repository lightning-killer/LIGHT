// Controlled tool execution. The assistant (and the UI) can only act through registered tools.
// Each tool: id, risk (low | moderate | sensitive), permissions, zod input schema, describe(), execute().
import { z } from 'zod';
import { query, one } from '../database/db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { audit } from './audit.js';
import * as tasks from './tasks.js';
import * as reminders from './reminders.js';
import * as conversations from './conversations.js';
import { safeCalc } from './commandEngine.js';

const APPROVAL_TTL_MS = 10 * 60 * 1000;
export const RISK = { LOW: 'low', MODERATE: 'moderate', SENSITIVE: 'sensitive' };

// Internal permissions every signed-in user holds. `integration:*` permissions require a connected integration.
const BASE_PERMISSIONS = new Set(['tasks:read', 'tasks:write', 'reminders:read', 'reminders:write', 'memory:write', 'conversations:write', 'compute']);

export async function hasPermission(userId, permission) {
  if (BASE_PERMISSIONS.has(permission)) return true;
  if (permission.startsWith('integration:')) {
    const row = await one("SELECT 1 AS ok FROM integrations WHERE user_id = ? AND provider = ? AND status = 'connected'", [userId, permission.split(':')[1]]);
    return !!row;
  }
  return false;
}

const id = z.coerce.number().int().positive();
const iso = z.union([z.date(), z.string().datetime({ offset: true })]).transform((v) => (v instanceof Date ? v : new Date(v)));

const defs = [
  {
    id: 'calc.evaluate', risk: RISK.LOW, permissions: ['compute'],
    schema: z.object({ expression: z.string().min(1).max(200) }),
    describe: (i) => `Calculate ${i.expression}`,
    execute: async (ctx, i) => ({ value: safeCalc(i.expression) }),
  },
  {
    id: 'task.list', risk: RISK.LOW, permissions: ['tasks:read'],
    schema: z.object({ status: z.enum(['open', 'done']).optional() }),
    describe: (i) => `List ${i.status || 'all'} tasks`,
    execute: async (ctx, i) => ({ tasks: await tasks.listTasks(ctx.userId, { status: i.status, sort: 'due', order: 'asc' }) }),
  },
  {
    id: 'task.create', risk: RISK.MODERATE, permissions: ['tasks:write'],
    schema: z.object({ title: z.string().trim().min(1).max(300), priority: z.enum(['low', 'medium', 'high']).default('medium'), dueAt: iso.nullable().optional() }),
    describe: (i) => `Create task "${i.title}"`,
    execute: async (ctx, i) => ({ task: await tasks.createTask(ctx.userId, { title: i.title, priority: i.priority, dueAt: i.dueAt ?? null }) }),
  },
  {
    id: 'task.complete', risk: RISK.MODERATE, permissions: ['tasks:write'],
    schema: z.object({ taskId: id }),
    describe: (i) => `Mark task #${i.taskId} as done`,
    execute: async (ctx, i) => ({ task: await tasks.updateTask(ctx.userId, i.taskId, { status: 'done' }) }),
  },
  {
    id: 'task.delete', risk: RISK.SENSITIVE, permissions: ['tasks:write'],
    schema: z.object({ taskId: id, title: z.string().max(300).optional() }),
    describe: (i) => `Permanently delete task #${i.taskId}${i.title ? ` "${i.title}"` : ''}`,
    execute: async (ctx, i) => { await tasks.deleteTask(ctx.userId, i.taskId); return { deleted: i.taskId }; },
  },
  {
    id: 'reminder.list', risk: RISK.LOW, permissions: ['reminders:read'],
    schema: z.object({ filter: z.enum(['upcoming', 'overdue', 'all']).default('upcoming') }),
    describe: (i) => `List ${i.filter} reminders`,
    execute: async (ctx, i) => ({ reminders: await reminders.listReminders(ctx.userId, i.filter) }),
  },
  {
    id: 'reminder.create', risk: RISK.MODERATE, permissions: ['reminders:write'],
    schema: z.object({ title: z.string().trim().min(1).max(300), remindAt: iso }),
    describe: (i) => `Create reminder "${i.title}" at ${i.remindAt.toISOString()}`,
    execute: async (ctx, i) => {
      if (i.remindAt.getTime() <= Date.now()) throw new HttpError(400, 'Reminder time must be in the future', 'invalid_input');
      return { reminder: await reminders.createReminder(ctx.userId, { title: i.title, remindAt: i.remindAt }) };
    },
  },
  {
    id: 'reminder.cancel', risk: RISK.MODERATE, permissions: ['reminders:write'],
    schema: z.object({ reminderId: id }),
    describe: (i) => `Cancel reminder #${i.reminderId}`,
    execute: async (ctx, i) => ({ reminder: await reminders.cancelReminder(ctx.userId, i.reminderId) }),
  },
  {
    id: 'memory.save', risk: RISK.MODERATE, permissions: ['memory:write'],
    schema: z.object({ content: z.string().trim().min(1).max(2000), category: z.string().max(64).default('general') }),
    describe: (i) => `Save to memory: "${i.content.slice(0, 80)}"`,
    execute: async (ctx, i) => {
      const r = await query('INSERT INTO memories (user_id, content, category) VALUES (?, ?, ?)', [ctx.userId, i.content, i.category]);
      return { memoryId: r.insertId };
    },
  },
  {
    id: 'conversation.create', risk: RISK.MODERATE, permissions: ['conversations:write'],
    schema: z.object({ title: z.string().max(200).default('New conversation') }),
    describe: () => 'Start a new conversation',
    execute: async (ctx, i) => ({ conversation: await conversations.createConversation(ctx.userId, i.title) }),
  },
  {
    id: 'conversation.delete', risk: RISK.SENSITIVE, permissions: ['conversations:write'],
    schema: z.object({ conversationId: id }),
    describe: (i) => `Permanently delete conversation #${i.conversationId} and all its messages`,
    execute: async (ctx, i) => { await conversations.deleteConversation(ctx.userId, i.conversationId); return { deleted: i.conversationId }; },
  },
];

export const TOOLS = new Map(defs.map((d) => [d.id, d]));

/**
 * Run a tool on behalf of ctx.userId (always from the session, never from client input).
 * Sensitive tools never run here directly: they create a pending approval the user must confirm.
 */
export async function executeTool(ctx, toolId, rawInput, { approved = false } = {}) {
  const tool = TOOLS.get(toolId);
  if (!tool) throw new HttpError(404, 'Unknown tool', 'unknown_tool');
  if (!ctx?.userId) throw new HttpError(401, 'Authentication required', 'unauthenticated');
  const input = tool.schema.parse(rawInput ?? {});
  for (const p of tool.permissions) {
    if (!(await hasPermission(ctx.userId, p))) {
      await audit(ctx.userId, 'tool.denied', { toolId, permission: p }, ctx.ip);
      throw new HttpError(403, `Missing permission: ${p}`, 'forbidden');
    }
  }
  if (tool.risk === RISK.SENSITIVE && !approved) {
    const summary = tool.describe(input).slice(0, 500);
    const expires = new Date(Date.now() + APPROVAL_TTL_MS);
    const r = await query('INSERT INTO approvals (user_id, tool_id, risk, input, summary, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [ctx.userId, toolId, tool.risk, JSON.stringify(input), summary, expires]);
    await audit(ctx.userId, 'approval.requested', { approvalId: r.insertId, toolId, summary }, ctx.ip);
    return { status: 'approval_required', approval: { id: r.insertId, toolId, risk: tool.risk, summary, expiresAt: expires } };
  }
  try {
    const result = await tool.execute(ctx, input);
    await audit(ctx.userId, 'tool.executed', { toolId, risk: tool.risk, approved }, ctx.ip);
    return { status: 'ok', result };
  } catch (e) {
    await audit(ctx.userId, 'tool.failed', { toolId, error: e.message }, ctx.ip);
    throw e;
  }
}

// ---------- approvals ----------
export const listApprovals = (userId, limit = 50) =>
  query('SELECT id, tool_id, risk, summary, status, created_at, decided_at, expires_at FROM approvals WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit]);

async function loadPending(userId, approvalId) {
  const row = await one('SELECT * FROM approvals WHERE id = ? AND user_id = ?', [approvalId, userId]);
  if (!row) throw new HttpError(404, 'Approval not found', 'not_found');
  if (row.status !== 'pending') throw new HttpError(409, `Approval is already ${row.status}`, 'conflict');
  if (new Date(row.expires_at) <= new Date()) {
    await query("UPDATE approvals SET status = 'expired', decided_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'", [approvalId]);
    throw new HttpError(410, 'This approval has expired. Please ask again.', 'expired');
  }
  return row;
}

/** Approving is single-use and bound to the exact tool + input that was shown to the user. */
export async function approve(ctx, approvalId) {
  const row = await loadPending(ctx.userId, approvalId);
  const claim = await query("UPDATE approvals SET status = 'approved', decided_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND status = 'pending'", [approvalId, ctx.userId]);
  if (!claim.affectedRows) throw new HttpError(409, 'Approval is no longer pending', 'conflict');
  await audit(ctx.userId, 'approval.approved', { approvalId, toolId: row.tool_id }, ctx.ip);
  const input = typeof row.input === 'string' ? JSON.parse(row.input) : row.input;
  try {
    const out = await executeTool(ctx, row.tool_id, input, { approved: true });
    await query("UPDATE approvals SET status = 'executed', result = ? WHERE id = ?", [JSON.stringify(out.result), approvalId]);
    return { status: 'executed', result: out.result };
  } catch (e) {
    await query("UPDATE approvals SET status = 'failed', result = ? WHERE id = ?", [JSON.stringify({ error: e.message }), approvalId]);
    throw e;
  }
}

export async function reject(ctx, approvalId) {
  await loadPending(ctx.userId, approvalId);
  await query("UPDATE approvals SET status = 'rejected', decided_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND status = 'pending'", [approvalId, ctx.userId]);
  await audit(ctx.userId, 'approval.rejected', { approvalId }, ctx.ip);
  return { status: 'rejected' };
}
