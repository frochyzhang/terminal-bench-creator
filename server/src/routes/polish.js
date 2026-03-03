import { Router } from 'express';
import pool from '../db/client.js';
import {
  startPolish, stopPolish, getPolishStatus,
  addPolishSSEClient, removePolishSSEClient,
} from '../services/polishService.js';

const router = Router({ mergeParams: true });

// POST /api/tasks/:id/polish — start polish pipeline
router.post('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM tasks WHERE id::text = $1 OR slug = $1',
      [req.params.id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (getPolishStatus(task.id)?.running) {
      return res.status(409).json({ error: 'Polish already running for this task' });
    }

    const {
      maxRounds      = 5,
      oracleTimeout  = 600,
      agentAttempts  = 4,
      agentModel     = 'openrouter/anthropic/claude-opus-4-5',
      agentTimeout   = 3600,
      lintModel      = 'openrouter/deepseek/deepseek-v3.2',
      fixModel       = 'openrouter/deepseek/deepseek-chat',
      autoSubmit     = true,
    } = req.body || {};

    await startPolish({ taskId: task.id, slug: task.slug, maxRounds, oracleTimeout, agentAttempts, agentModel, agentTimeout, lintModel, fixModel, autoSubmit });

    res.json({ started: true, taskId: task.id, slug: task.slug });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id/polish — status
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM tasks WHERE id::text = $1 OR slug = $1',
      [req.params.id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const status = getPolishStatus(task.id);
    res.json(status
      ? { running: status.running, round: status.round, maxRounds: status.maxRounds, result: status.result, rounds: status.rounds }
      : { running: false });
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/polish/stop — stop
router.post('/stop', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM tasks WHERE id::text = $1 OR slug = $1',
      [req.params.id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    stopPolish(task.id);
    res.json({ stopped: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id/polish/stream — SSE
router.get('/stream', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM tasks WHERE id::text = $1 OR slug = $1',
      [req.params.id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const taskId = task.id;
    addPolishSSEClient(taskId, res);

    // Replay current job state immediately
    const status = getPolishStatus(taskId);
    if (status) {
      res.write(`event: status\ndata: ${JSON.stringify({
        running: status.running, round: status.round, maxRounds: status.maxRounds,
        result: status.result, rounds: status.rounds, logs: status.logs,
      })}\n\n`);
    }

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removePolishSSEClient(taskId, res);
    });
  } catch (err) {
    next(err);
  }
});

export default router;
