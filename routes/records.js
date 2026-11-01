// Memories and Projects/Research workspaces: simple owner-scoped CRUD.
import { Router } from 'express';
import { z } from 'zod';
import { query, one } from '../database/db.js';
import { wrap, ok, HttpError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/security.js';
import { audit } from '../services/audit.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------------- memories ----------------
export const memories = Router();
const memBody = z.object({ content: z.string().trim().min(1).max(2000), category: z.string().trim().min(1).max(64).optional() });

memories.get('/', validate(z.object({ q: z.string().max(200).optional() }), 'query'), wrap(async (req, res) => {
  const q = req.query.q;
  const rows = q
    ? await query('SELECT * FROM memories WHERE user_id = ? AND content LIKE ? ORDER BY id DESC LIMIT 500', [req.userId, `%${q}%`])
    : await query('SELECT * FROM memories WHERE user_id = ? ORDER BY id DESC LIMIT 500', [req.userId]);
  ok(res, { memories: rows });
}));
memories.post('/', validate(memBody), wrap(async (req, res) => {
  const r = await query('INSERT INTO memories (user_id, content, category) VALUES (?, ?, ?)', [req.userId, req.body.content, req.body.category || 'general']);
  ok(res, { memory: await one('SELECT * FROM memories WHERE id = ? AND user_id = ?', [r.insertId, req.userId]) }, 201);
}));
memories.patch('/:id', validate(idParam, 'params'), validate(memBody.partial().strict()), wrap(async (req, res) => {
  const { content, category } = req.body;
  const r = await query('UPDATE memories SET content = COALESCE(?, content), category = COALESCE(?, category) WHERE id = ? AND user_id = ?', [content ?? null, category ?? null, req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Memory not found', 'not_found');
  ok(res, { memory: await one('SELECT * FROM memories WHERE id = ? AND user_id = ?', [req.params.id, req.userId]) });
}));
memories.delete('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  const r = await query('DELETE FROM memories WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Memory not found', 'not_found');
  ok(res, {});
}));

// ---------------- projects & research ----------------
export const projects = Router();
const kindQuery = z.object({ kind: z.enum(['project', 'research']).default('project') });
const source = z.object({ title: z.string().trim().min(1).max(200), url: z.string().url().max(1000).refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links').optional(), note: z.string().max(1000).optional() });
const projBody = z.object({
  kind: z.enum(['project', 'research']).default('project'),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(['active', 'paused', 'done']).optional(),
  notes: z.string().max(200_000).nullable().optional(),
  sources: z.array(source).max(100).optional(),
});
const parseRow = (r) => r && ({ ...r, sources: typeof r.sources === 'string' ? JSON.parse(r.sources) : r.sources || [] });
const getProject = async (userId, id) => parseRow(await one('SELECT * FROM projects WHERE id = ? AND user_id = ?', [id, userId]));

projects.get('/', validate(kindQuery, 'query'), wrap(async (req, res) => {
  const rows = await query('SELECT * FROM projects WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 200', [req.userId, req.query.kind]);
  ok(res, { projects: rows.map(parseRow) });
}));
projects.post('/', validate(projBody), wrap(async (req, res) => {
  const b = req.body;
  const r = await query('INSERT INTO projects (user_id, kind, name, description, status, notes, sources) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.userId, b.kind, b.name, b.description ?? null, b.status || 'active', b.notes ?? null, JSON.stringify(b.sources || [])]);
  await audit(req.userId, `${b.kind}.created`, { id: r.insertId }, req.ip);
  ok(res, { project: await getProject(req.userId, r.insertId) }, 201);
}));
projects.get('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  const p = await getProject(req.userId, req.params.id);
  if (!p) throw new HttpError(404, 'Not found', 'not_found');
  ok(res, { project: p });
}));
projects.patch('/:id', validate(idParam, 'params'), validate(projBody.omit({ kind: true }).partial().strict()), wrap(async (req, res) => {
  const b = req.body; const sets = []; const params = [];
  for (const k of ['name', 'description', 'status', 'notes']) if (k in b) { sets.push(`${k} = ?`); params.push(b[k]); }
  if ('sources' in b) { sets.push('sources = ?'); params.push(JSON.stringify(b.sources)); }
  if (!sets.length) throw new HttpError(400, 'Nothing to update', 'invalid_input');
  const r = await query(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, req.params.id, req.userId]);
  if (!r.affectedRows && !(await getProject(req.userId, req.params.id))) throw new HttpError(404, 'Not found', 'not_found');
  ok(res, { project: await getProject(req.userId, req.params.id) });
}));
projects.delete('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  const r = await query('DELETE FROM projects WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404, 'Not found', 'not_found');
  await audit(req.userId, 'project.deleted', { id: Number(req.params.id) }, req.ip);
  ok(res, {});
}));
