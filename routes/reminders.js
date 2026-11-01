import { Router } from 'express';
import { z } from 'zod';
import { wrap, ok, HttpError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/security.js';
import * as reminders from '../services/reminders.js';
import { audit } from '../services/audit.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const future = z.string().datetime({ offset: true }).transform((v) => new Date(v)).refine((d) => d.getTime() > Date.now(), 'Time must be in the future');

const createBody = z.object({ title: z.string().trim().min(1).max(300), notes: z.string().max(5000).nullable().optional(), remindAt: future });
const patchBody = z.object({ title: z.string().trim().min(1).max(300).optional(), notes: z.string().max(5000).nullable().optional(), remindAt: future.optional() }).strict();
const ackBody = z.object({ delivered: z.boolean() });

router.get('/', validate(z.object({ filter: z.enum(['upcoming', 'overdue', 'completed', 'cancelled', 'all']).optional() }), 'query'),
  wrap(async (req, res) => ok(res, { reminders: await reminders.listReminders(req.userId, req.query.filter || 'all') })));

// Polled by the browser: reminders that fired and still need a confirmed notification.
router.get('/due', wrap(async (req, res) => ok(res, { reminders: await reminders.pendingNotifications(req.userId) })));

router.post('/', validate(createBody), wrap(async (req, res) => {
  const reminder = await reminders.createReminder(req.userId, req.body);
  await audit(req.userId, 'reminder.created', { id: reminder.id }, req.ip);
  ok(res, { reminder }, 201);
}));

router.patch('/:id', validate(idParam, 'params'), validate(patchBody), wrap(async (req, res) => {
  if (!Object.keys(req.body).length) throw new HttpError(400, 'Nothing to update', 'invalid_input');
  ok(res, { reminder: await reminders.updateReminder(req.userId, Number(req.params.id), req.body) });
}));

router.post('/:id/cancel', validate(idParam, 'params'), wrap(async (req, res) => ok(res, { reminder: await reminders.cancelReminder(req.userId, Number(req.params.id)) })));
router.post('/:id/complete', validate(idParam, 'params'), wrap(async (req, res) => ok(res, { reminder: await reminders.completeReminder(req.userId, Number(req.params.id)) })));

// The browser calls this ONLY after it actually showed (or failed to show) the notification.
router.post('/:id/delivered', validate(idParam, 'params'), validate(ackBody), wrap(async (req, res) => {
  const changed = await reminders.acknowledgeNotification(req.userId, Number(req.params.id), req.body.delivered);
  ok(res, { updated: changed });
}));

router.delete('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  await reminders.deleteReminder(req.userId, Number(req.params.id));
  ok(res, {});
}));

export default router;
