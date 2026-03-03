import { Router } from 'express';
import pool from '../db/client.js';

const router = Router();

// GET /api/dashboard — aggregate stats
router.get('/', async (req, res, next) => {
  try {
    const [taskStats, subStats, recentSubs, recentTasks] = await Promise.all([
      // Task counts by status
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'draft')::int      AS draft,
          COUNT(*) FILTER (WHERE status = 'ready')::int      AS ready,
          COUNT(*) FILTER (WHERE status = 'submitted')::int  AS submitted,
          COUNT(*) FILTER (WHERE status = 'discarded')::int  AS discarded
        FROM tasks
      `),
      // Submission counts by status
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'local')::int             AS local,
          COUNT(*) FILTER (WHERE status = 'pending')::int           AS pending,
          COUNT(*) FILTER (WHERE status = 'running')::int           AS running,
          COUNT(*) FILTER (WHERE status = 'AUTO_PASSED')::int       AS auto_passed,
          COUNT(*) FILTER (WHERE status = 'AUTO_FAILED')::int       AS auto_failed,
          COUNT(*) FILTER (WHERE status = 'APPROVED')::int          AS approved,
          COUNT(*) FILTER (WHERE status = 'REJECTED')::int          AS rejected,
          COUNT(*) FILTER (WHERE status = 'review_requested')::int  AS review_requested,
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::int         AS cancelled
        FROM submissions
      `),
      // Recent 10 submissions with task info
      pool.query(`
        SELECT s.id, s.task_id, s.status, s.agent_fail_reason, s.task_points,
               s.retry_count, s.created_at, s.updated_at,
               t.slug AS task_slug, t.title AS task_title
        FROM submissions s
        JOIN tasks t ON s.task_id = t.id
        ORDER BY s.created_at DESC
        LIMIT 10
      `),
      // Recent 8 tasks
      pool.query(`
        SELECT id, slug, title, status, difficulty, category, created_at
        FROM tasks
        ORDER BY created_at DESC
        LIMIT 8
      `),
    ]);

    res.json({
      tasks: taskStats.rows[0],
      submissions: subStats.rows[0],
      recentSubmissions: recentSubs.rows,
      recentTasks: recentTasks.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
