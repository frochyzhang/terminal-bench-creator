import { Router } from 'express';
import pool from '../db/client.js';
import { getSubmissionLogs, requestReview } from '../services/tbApiService.js';
import { packTask } from '../services/packService.js';
import { createSubmission } from '../services/tbApiService.js';
import { startPolling } from '../services/pollService.js';

const router = Router();

// GET /api/submissions - List all submissions
router.get('/', async (req, res, next) => {
  try {
    const { task_id, status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];

    if (task_id) {
      params.push(task_id);
      conditions.push(`s.task_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM submissions s ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(parseInt(limit), offset);
    const result = await pool.query(
      `SELECT s.*, t.slug as task_slug, t.title as task_title
       FROM submissions s
       JOIN tasks t ON s.task_id = t.id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ data: result.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// GET /api/submissions/:subId - Get submission detail
router.get('/:subId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT s.*, t.slug as task_slug, t.title as task_title
       FROM submissions s
       JOIN tasks t ON s.task_id = t.id
       WHERE s.id::text = $1`,
      [req.params.subId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Submission not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/submissions/:subId/retry - Retry a submission
router.post('/:subId/retry', async (req, res, next) => {
  try {
    const subResult = await pool.query(
      'SELECT s.*, t.slug FROM submissions s JOIN tasks t ON s.task_id = t.id WHERE s.id::text = $1',
      [req.params.subId]
    );
    const sub = subResult.rows[0];
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const zipPath = await packTask(sub.slug);
    const tbData = await createSubmission(zipPath);
    const tbSubmissionId = tbData.id || tbData.submission_id;

    const newSub = await pool.query(
      `INSERT INTO submissions (task_id, tb_submission_id, status, zip_path, retry_count)
       VALUES ($1, $2, 'pending', $3, $4) RETURNING *`,
      [sub.task_id, tbSubmissionId, zipPath, (sub.retry_count || 0) + 1]
    );

    startPolling(newSub.rows[0].id);
    res.status(201).json(newSub.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/submissions/:subId/review - Request human review
router.post('/:subId/review', async (req, res, next) => {
  try {
    const subResult = await pool.query('SELECT * FROM submissions WHERE id::text = $1', [req.params.subId]);
    const sub = subResult.rows[0];
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (!sub.tb_submission_id) return res.status(400).json({ error: 'No TB submission ID' });

    const result = await requestReview(sub.tb_submission_id);

    await pool.query(
      "UPDATE submissions SET status = 'review_requested', updated_at = NOW() WHERE id::text = $1",
      [sub.id]
    );

    res.json({ message: 'Review requested', result });
  } catch (err) {
    next(err);
  }
});

// GET /api/submissions/:subId/logs - Get TB logs
router.get('/:subId/logs', async (req, res, next) => {
  try {
    const subResult = await pool.query('SELECT * FROM submissions WHERE id::text = $1', [req.params.subId]);
    const sub = subResult.rows[0];
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (!sub.tb_submission_id) return res.status(400).json({ error: 'No TB submission ID' });

    const logs = await getSubmissionLogs(sub.tb_submission_id);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

export default router;
