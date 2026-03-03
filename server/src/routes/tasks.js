import { Router } from 'express';
import pool from '../db/client.js';
import { createTaskScaffold, deleteTaskDir } from '../services/taskFileService.js';

const router = Router();

// POST /api/tasks - Create a new task
router.post('/', async (req, res, next) => {
  try {
    const { slug, title, description, category, difficulty } = req.body;
    if (!slug) {
      return res.status(400).json({ error: 'slug is required' });
    }

    // Validate slug format
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) {
      return res.status(400).json({ error: 'slug must be lowercase kebab-case' });
    }

    const result = await pool.query(
      `INSERT INTO tasks (slug, title, description, category, difficulty)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [slug, title || slug, description, category, difficulty || 'Easy']
    );

    await createTaskScaffold(slug);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Task with slug "${req.body.slug}" already exists` });
    }
    next(err);
  }
});

// GET /api/tasks - List tasks
router.get('/', async (req, res, next) => {
  try {
    const { status, category, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*) FROM tasks ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await pool.query(
      `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id - Get task detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/:id - Update task metadata
router.patch('/:id', async (req, res, next) => {
  try {
    const { title, description, category, difficulty, status } = req.body;
    const result = await pool.query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         category = COALESCE($3, category),
         difficulty = COALESCE($4, difficulty),
         status = COALESCE($5, status),
         updated_at = NOW()
       WHERE id::text = $6 OR slug = $6
       RETURNING *`,
      [title, description, category, difficulty, status, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id::text = $1 OR slug = $1 RETURNING *',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Task not found' });
    }
    await deleteTaskDir(result.rows[0].slug);
    res.json({ message: 'Task deleted', task: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
