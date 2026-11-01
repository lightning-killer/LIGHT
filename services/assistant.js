// Turns a user message into a reply. Side effects ONLY happen through executeTool(), and the reply
// only claims success after the tool returned status 'ok'.
import { parseCommand, formatLocal, formatDateTime, HELP_TEXT } from './commandEngine.js';
import { executeTool } from './tools.js';
import * as tasks from './tasks.js';
import * as reminders from './reminders.js';
import { getProvider } from './aiProvider.js';
import { query } from '../database/db.js';
import { HttpError } from '../middleware/errorHandler.js';

const SIDE_EFFECT_FREE = new Set(['ai', 'unknown', 'time', 'date', 'calculate', 'help', 'task_list', 'reminder_list']);
export const canRegenerate = (meta) => !meta?.intent || SIDE_EFFECT_FREE.has(meta.intent);

const fmtTask = (t, off) => `#${t.id} ${t.title}${t.priority === 'high' ? ' (high priority)' : ''}${t.due_at ? ` — due ${formatDateTime(new Date(t.due_at), off)}` : ''}`;
const fmtReminder = (r, off) => `#${r.id} ${r.title} — ${formatDateTime(new Date(r.remind_at), off)}${r.status === 'triggered' ? ' (due now)' : ''}`;
const reply = (text, meta = {}) => ({ text, meta });

export async function handleMessage(ctx, text, history = [], signal) {
  const off = ctx.tzOffsetMinutes ?? 0;
  const now = new Date();
  const cmd = parseCommand(text, { now, tzOffsetMinutes: off });
  const { intent, params } = cmd;

  switch (intent) {
    case 'empty': return reply('Say something and I will help.', { intent });
    case 'help': return reply(HELP_TEXT, { intent });
    case 'time': return reply(`It is ${formatLocal(now, off, { hour: 'numeric', minute: '2-digit', second: '2-digit' })} (your browser's time zone).`, { intent });
    case 'date': return reply(`Today is ${formatLocal(now, off, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`, { intent });

    case 'calculate': {
      const out = await executeTool(ctx, 'calc.evaluate', { expression: params.expression.startsWith('sqrt') ? String(params.value) : params.expression });
      return reply(`${params.expression.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ')} = ${out.result.value}`, { intent });
    }
    case 'calculate_error': return reply(`I couldn't calculate that: ${params.message}.`, { intent });

    case 'task_list': {
      const { result } = await executeTool(ctx, 'task.list', { status: params.status });
      if (!result.tasks.length) return reply(params.status === 'done' ? 'You have no completed tasks yet.' : 'You have no pending tasks.', { intent });
      return reply(`${params.status === 'done' ? 'Completed' : 'Pending'} tasks (${result.tasks.length}):\n` + result.tasks.map((t) => `• ${fmtTask(t, off)}`).join('\n'), { intent });
    }
    case 'task_create': {
      const out = await executeTool(ctx, 'task.create', { title: params.title, priority: params.priority, dueAt: params.dueAt });
      const t = out.result.task;
      return reply(`Task created: ${fmtTask(t, off)}`, { intent, taskId: t.id });
    }
    case 'task_complete': {
      const found = await tasks.findTasksByText(ctx.userId, params.query, 'open');
      if (!found.length) return reply(`I couldn't find an open task matching "${params.query}". Say "show my tasks" to see them.`, { intent });
      if (found.length > 1) return reply(`Several open tasks match "${params.query}". Use the number, e.g. "mark task #${found[0].id} as done":\n` + found.map((t) => `• ${fmtTask(t, off)}`).join('\n'), { intent });
      const out = await executeTool(ctx, 'task.complete', { taskId: found[0].id });
      return reply(`Marked as done: ${out.result.task.title}`, { intent, taskId: found[0].id });
    }
    case 'task_delete': {
      const found = await tasks.findTasksByText(ctx.userId, params.query, 'open');
      const all = found.length ? found : await tasks.findTasksByText(ctx.userId, params.query, 'done');
      if (!all.length) return reply(`I couldn't find a task matching "${params.query}".`, { intent });
      if (all.length > 1) return reply(`Several tasks match "${params.query}". Use the number, e.g. "delete task #${all[0].id}":\n` + all.map((t) => `• ${fmtTask(t, off)}`).join('\n'), { intent });
      const out = await executeTool(ctx, 'task.delete', { taskId: all[0].id, title: all[0].title });
      return reply(`Deleting is permanent, so I need your confirmation first: ${out.approval.summary}. Nothing has been deleted yet.`, { intent, approvalId: out.approval.id });
    }

    case 'reminder_create': {
      if (!params.remindAt) return reply(params.needsTime ? 'That time has already passed or is not valid. When should I remind you? For example: "Remind me to call mom tomorrow at 5pm".' : 'When should I remind you? For example: "Remind me to call mom tomorrow at 5pm".', { intent });
      const out = await executeTool(ctx, 'reminder.create', { title: params.title, remindAt: params.remindAt });
      return reply(`Reminder set: ${fmtReminder(out.result.reminder, off)}`, { intent, reminderId: out.result.reminder.id });
    }
    case 'reminder_list': {
      const { result } = await executeTool(ctx, 'reminder.list', { filter: params.overdue ? 'overdue' : 'upcoming' });
      if (!result.reminders.length) return reply(params.overdue ? 'You have no overdue reminders.' : 'You have no upcoming reminders.', { intent });
      return reply(`${params.overdue ? 'Overdue' : 'Upcoming'} reminders (${result.reminders.length}):\n` + result.reminders.map((r) => `• ${fmtReminder(r, off)}`).join('\n'), { intent });
    }
    case 'reminder_cancel': {
      const found = await reminders.findRemindersByText(ctx.userId, params.query);
      if (!found.length) return reply(params.query ? `I couldn't find an active reminder matching "${params.query}".` : 'You have no active reminders to cancel.', { intent });
      if (found.length > 1) return reply('Several reminders match. Tell me which one, e.g. "cancel reminder ' + found[0].title + '":\n' + found.map((r) => `• ${fmtReminder(r, off)}`).join('\n'), { intent });
      const out = await executeTool(ctx, 'reminder.cancel', { reminderId: found[0].id });
      return reply(`Reminder cancelled: ${out.result.reminder.title}`, { intent, reminderId: found[0].id });
    }

    case 'memory_save': {
      await executeTool(ctx, 'memory.save', { content: params.content });
      return reply('Saved to your assistant memory.', { intent });
    }
    case 'conversation_new': {
      const out = await executeTool(ctx, 'conversation.create', {});
      return reply('Started a new conversation.', { intent, newConversationId: out.result.conversation.id });
    }

    default: {
      const provider = getProvider();
      if (!provider.configured()) {
        return reply('I can\'t answer open-ended questions yet because no AI model is connected. I can still do tasks, reminders, math, time and date. Say "help" to see everything I can do.', { intent: 'unknown' });
      }
      try {
        const memories = await query('SELECT content FROM memories WHERE user_id = ? ORDER BY id DESC LIMIT 20', [ctx.userId]);
        const messages = [
          ...(memories.length ? [{ role: 'system', content: 'Things the user asked you to remember:\n' + memories.map((m) => `- ${m.content}`).join('\n') }] : []),
          ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: text },
        ];
        const out = await provider.complete({ messages, signal });
        if (!out) return reply('The AI provider returned an empty response.', { intent: 'ai', error: true });
        return reply(out, { intent: 'ai', provider: provider.name });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        return reply(`The AI provider could not be reached (${e.message}). Rule-based commands still work.`, { intent: 'ai', error: true });
      }
    }
  }
}

export { HttpError };
