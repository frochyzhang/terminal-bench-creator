import { Router } from 'express';
import pool from '../db/client.js';
import { readTaskFiles, writeTaskFile, TASK_FILES } from '../services/taskFileService.js';

const router = Router({ mergeParams: true });

// GET /api/tasks/:id/files - Get all files
router.get('/', async (req, res, next) => {
  try {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    const task = taskResult.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const files = await readTaskFiles(task.slug);
    res.json({ files, taskFiles: TASK_FILES });
  } catch (err) {
    next(err);
  }
});

// PUT /api/tasks/:id/files/:filename(*) - Write a file
router.put('/:filename(*)', async (req, res, next) => {
  try {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    const task = taskResult.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const { content } = req.body;
    if (content === undefined) {
      return res.status(400).json({ error: 'content is required' });
    }

    await writeTaskFile(task.slug, req.params.filename, content);
    res.json({ message: 'File saved', filename: req.params.filename });
  } catch (err) {
    next(err);
  }
});

export default router;
