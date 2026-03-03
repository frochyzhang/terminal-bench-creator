import { Router } from 'express';
import pool from '../db/client.js';
import {
  startVerify,
  stopVerify,
  getVerifyStatus,
  addVerifySSEClient,
  removeVerifySSEClient,
} from '../services/verifyService.js';

const router = Router({ mergeParams: true });

// POST /api/tasks/:id/verify — start verify loop
router.post('/', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { maxRetries = 10, model = 'openrouter/deepseek/deepseek-v3.2' } = req.body;

    const result = await pool.query(
      'SELECT id, slug FROM tasks WHERE id::text = $1 OR slug = $1',
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });

    const task = result.rows[0];
    await startVerify({ taskId: task.id, slug: task.slug, maxRetries: Number(maxRetries), model });
    res.json({ message: 'Verify started', taskId: task.id, slug: task.slug, maxRetries, model });
  } catch (err) {
    if (err.message.includes('already running')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/tasks/:id/verify — current status
router.get('/', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id FROM tasks WHERE id::text = $1 OR slug = $1',
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });

    const status = getVerifyStatus(result.rows[0].id);
    res.json(status || { running: false, result: null, logs: [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/verify/stop — request stop
router.post('/stop', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id FROM tasks WHERE id::text = $1 OR slug = $1',
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });

    stopVerify(result.rows[0].id);
    res.json({ message: 'Stop requested' });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id/verify/stream — SSE real-time updates
router.get('/stream', async (req, res) => {
  const { id } = req.params;

  let taskId;
  try {
    const result = await pool.query(
      'SELECT id FROM tasks WHERE id::text = $1 OR slug = $1',
      [id]
    );
    if (!result.rows.length) { res.status(404).end(); return; }
    taskId = result.rows[0].id;
  } catch {
    res.status(500).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ taskId })}\n\n`);
  addVerifySSEClient(taskId, res);

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeVerifySSEClient(taskId, res);
  });
});

export default router;
