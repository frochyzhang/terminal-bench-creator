import { Router } from 'express';
import pool from '../db/client.js';
import { readTaskFiles } from '../services/taskFileService.js';
import { lintTask } from '../services/lintService.js';

const router = Router({ mergeParams: true });

// POST /api/tasks/:id/lint
router.post('/', async (req, res, next) => {
  try {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    const task = taskResult.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const files = await readTaskFiles(task.slug);
    const result = lintTask(files);

    // Update task status based on lint
    if (result.ready && task.status === 'draft') {
      await pool.query(
        "UPDATE tasks SET status = 'ready', updated_at = NOW() WHERE id = $1",
        [task.id]
      );
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
