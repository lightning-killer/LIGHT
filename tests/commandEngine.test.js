import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, safeCalc, extractWhen, calculate } from '../services/commandEngine.js';

// Fixed "now": Sunday 2026-11-01 00:11 IST == 2026-10-31T18:41:00Z, offset -330 (IST)
const now = new Date('2026-10-31T18:41:00Z');
const ctx = { now, tzOffsetMinutes: -330 };
const intent = (t) => parseCommand(t, ctx).intent;

test('time and date questions', () => {
  for (const t of ['What time is it?', 'Can you tell me the current time?', 'current time', 'what is the time now']) assert.equal(intent(t), 'time', t);
  for (const t of ["What is today's date?", 'what day is it', 'tell me the date']) assert.equal(intent(t), 'date', t);
});

test('task list phrasings', () => {
  for (const t of ['Do I have any pending tasks?', 'Show my to-do list.', 'list my tasks', 'what tasks do I have', 'show my todo list']) assert.equal(intent(t), 'task_list', t);
  assert.equal(parseCommand('show my completed tasks', ctx).params.status, 'done');
  assert.equal(parseCommand('show my pending tasks', ctx).params.status, 'open');
});

test('task create / complete / delete', () => {
  let r = parseCommand('Add task buy milk', ctx);
  assert.equal(r.intent, 'task_create'); assert.equal(r.params.title, 'buy milk');
  r = parseCommand('add buy eggs to my to-do list', ctx);
  assert.equal(r.intent, 'task_create'); assert.equal(r.params.title, 'buy eggs');
  r = parseCommand('create a task finish the report tomorrow', ctx);
  assert.equal(r.intent, 'task_create'); assert.equal(r.params.title, 'finish the report'); assert.ok(r.params.dueAt instanceof Date);
  r = parseCommand('Mark buy milk as done', ctx);
  assert.equal(r.intent, 'task_complete'); assert.equal(r.params.query, 'buy milk');
  r = parseCommand('delete task buy milk', ctx);
  assert.equal(r.intent, 'task_delete'); assert.equal(r.params.query, 'buy milk');
});

test('reminder phrasings', () => {
  let r = parseCommand('Remind me about my project tomorrow.', ctx);
  assert.equal(r.intent, 'reminder_create'); assert.equal(r.params.title, 'my project');
  // tomorrow 09:00 IST == 2026-11-02 03:30Z (today in IST is Nov 1)
  assert.equal(r.params.remindAt.toISOString(), '2026-11-02T03:30:00.000Z');
  r = parseCommand('Remind me to call mom tomorrow at 5pm', ctx);
  assert.equal(r.params.title, 'call mom');
  assert.equal(r.params.remindAt.toISOString(), '2026-11-02T11:30:00.000Z'); // 17:00 IST
  r = parseCommand('remind me in 30 minutes to stretch', ctx);
  assert.equal(r.params.title, 'stretch');
  assert.equal(r.params.remindAt.getTime(), now.getTime() + 30 * 60000);
  for (const t of ['show my reminders', 'Do I have any reminders?', 'what reminders do I have']) assert.equal(intent(t), 'reminder_list', t);
  r = parseCommand('cancel reminder call mom', ctx);
  assert.equal(r.intent, 'reminder_cancel'); assert.equal(r.params.query, 'call mom');
});

test('reminder in the past asks for a time instead of guessing', () => {
  const r = parseCommand('remind me to stand up today at 12:05am', ctx); // 00:05 IST today is before "now" (00:11)
  assert.equal(r.intent, 'reminder_create'); assert.equal(r.params.remindAt, null); assert.equal(r.params.needsTime, true);
});

test('arithmetic', () => {
  assert.equal(safeCalc('2+3*4'), 14);
  assert.equal(safeCalc('(2+3)*4'), 20);
  assert.equal(safeCalc('2^3^2'), 512);
  assert.equal(safeCalc('-5+2'), -3);
  assert.throws(() => safeCalc('1/0'));
  assert.throws(() => safeCalc('process.exit()'));
  assert.equal(calculate('what is 12 times 4 plus 2').value, 50);
  assert.equal(calculate('15% of 240').value, 36);
  assert.equal(calculate('twelve divided by four').value, 3);
  assert.equal(calculate('square root of 81').value, 9);
  assert.equal(intent('(3 + 4) * 5'), 'calculate');
  assert.equal(intent('what is 10 minus 3?'), 'calculate');
});

test('help, memory, conversation, unknown', () => {
  assert.equal(intent('help'), 'help');
  assert.equal(intent('What can you do?'), 'help');
  assert.equal(intent('Remember that my passport expires in 2028'), 'memory_save');
  assert.equal(intent('start a new conversation'), 'conversation_new');
  assert.equal(intent('write me a poem about the sea'), 'unknown');
  assert.equal(intent('   '), 'empty');
});

test('extractWhen handles weekdays and noon', () => {
  const { when } = extractWhen('call dad on friday at noon', now, -330);
  assert.equal(when.toISOString(), '2026-11-06T06:30:00.000Z'); // Friday Nov 6, 12:00 IST
});
