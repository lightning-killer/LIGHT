import { Router } from 'express';
import { z } from 'zod';
import { wrap, ok, HttpError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/security.js';
import * as tasks from '../services/tasks.js';
import { audit } from '../services/audit.js';

const router = Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const date = z.union([z.string().datetime({ offset: true }), z.null()]).transform((v) => (v ? new Date(v) : null));

const listQuery = z.object({
  status: z.enum(['open', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(['created', 'due', 'priority', 'title', 'status']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
const createBody = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueAt: date.optional(),
});
const patchBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['open', 'done']).optional(),
  dueAt: date.optional(),
}).strict();

router.get('/', validate(listQuery, 'query'), wrap(async (req, res) => ok(res, { tasks: await tasks.listTasks(req.userId, req.query) })));

router.post('/', validate(createBody), wrap(async (req, res) => {
  const task = await tasks.createTask(req.userId, req.body);
  await audit(req.userId, 'task.created', { id: task.id }, req.ip);
  ok(res, { task }, 201);
}));

router.patch('/:id', validate(idParam, 'params'), validate(patchBody), wrap(async (req, res) => {
  if (!Object.keys(req.body).length) throw new HttpError(400, 'Nothing to update', 'invalid_input');
  ok(res, { task: await tasks.updateTask(req.userId, Number(req.params.id), req.body) });
}));

router.delete('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  await tasks.deleteTask(req.userId, Number(req.params.id));
  await audit(req.userId, 'task.deleted', { id: Number(req.params.id) }, req.ip);
  ok(res, {});
}));

export default router;
