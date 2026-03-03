import { Router } from 'express';
import pool from '../db/client.js';
import { packTask } from '../services/packService.js';
import { createSubmission } from '../services/tbApiService.js';
import { startPolling } from '../services/pollService.js';

const router = Router({ mergeParams: true });

// POST /api/tasks/:id/submit
router.post('/', async (req, res, next) => {
  try {
    const taskResult = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    const task = taskResult.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Pack the task
    let zipPath;
    try {
      zipPath = await packTask(task.slug);
    } catch (err) {
      return res.status(500).json({ error: `Pack failed: ${err.message}` });
    }

    // Submit to TB platform
    let tbData;
    try {
      tbData = await createSubmission(zipPath);
    } catch (err) {
      return res.status(502).json({ error: `TB submission failed: ${err.message}` });
    }

    const tbSubmissionId = tbData.id || tbData.submission_id;

    // Create local submission record
    const subResult = await pool.query(
      `INSERT INTO submissions (task_id, tb_submission_id, status, zip_path)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
      [task.id, tbSubmissionId, zipPath]
    );

    // Update task status
    await pool.query(
      "UPDATE tasks SET status = 'submitted', updated_at = NOW() WHERE id = $1",
      [task.id]
    );

    const submission = subResult.rows[0];

    // Start polling
    startPolling(submission.id);

    res.status(201).json({
      submission,
      tbData,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
