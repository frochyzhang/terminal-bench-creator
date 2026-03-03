/**
 * Poll service: checks TB submission status and broadcasts via SSE.
 * - Exponential backoff: 5s → 30s
 * - Terminal states: AUTO_PASSED, AUTO_FAILED, APPROVED, REJECTED, CANCELLED
 * - AUTO_FAILED: auto-retry up to 3 times based on failReason
 * - Recovers in-progress polls on server restart
 */

import pool from '../db/client.js';
import { getSubmissionStatus } from './tbApiService.js';

const TERMINAL_STATES = new Set([
  'AUTO_PASSED', 'AUTO_FAILED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ERROR',
]);

const MAX_RETRY = 3;
const INITIAL_INTERVAL = 5000;
const MAX_INTERVAL = 30000;

// Active SSE clients: Map<submissionId, Set<res>>
const sseClients = new Map();

// Active timers: Map<submissionId, NodeJS.Timeout>
const activeTimers = new Map();

export function addSSEClient(submissionId, res) {
  if (!sseClients.has(submissionId)) {
    sseClients.set(submissionId, new Set());
  }
  sseClients.get(submissionId).add(res);
}

export function removeSSEClient(submissionId, res) {
  const clients = sseClients.get(submissionId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) sseClients.delete(submissionId);
  }
}

function broadcast(submissionId, event, data) {
  const clients = sseClients.get(submissionId);
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

async function pollOnce(submissionId) {
  const subResult = await pool.query(
    'SELECT * FROM submissions WHERE id = $1',
    [submissionId]
  );
  const sub = subResult.rows[0];
  if (!sub || !sub.tb_submission_id) return;

  let tbData;
  try {
    tbData = await getSubmissionStatus(sub.tb_submission_id);
  } catch (err) {
    console.error(`[Poll] Error checking submission ${submissionId}:`, err.message);
    broadcast(submissionId, 'error', { message: err.message });
    return;
  }

  const newStatus = tbData.status || tbData.state || sub.status;
  const failReason = tbData.agent_fail_reason || tbData.failReason || sub.agent_fail_reason;
  const taskPoints = tbData.task_points || tbData.taskPoints || sub.task_points;

  await pool.query(
    `UPDATE submissions SET
       status = $1,
       agent_fail_reason = $2,
       task_points = $3,
       last_polled_at = NOW(),
       updated_at = NOW()
     WHERE id = $4`,
    [newStatus, failReason, taskPoints, submissionId]
  );

  broadcast(submissionId, 'status', {
    submissionId,
    status: newStatus,
    agent_fail_reason: failReason,
    task_points: taskPoints,
    raw: tbData,
  });

  return newStatus;
}

function scheduleNextPoll(submissionId, interval) {
  const nextInterval = Math.min(interval * 2, MAX_INTERVAL);
  const timer = setTimeout(() => poll(submissionId, nextInterval), interval);
  activeTimers.set(submissionId, timer);
}

async function poll(submissionId, interval = INITIAL_INTERVAL) {
  if (activeTimers.has(submissionId)) {
    clearTimeout(activeTimers.get(submissionId));
    activeTimers.delete(submissionId);
  }

  try {
    const status = await pollOnce(submissionId);

    if (!status || TERMINAL_STATES.has(status)) {
      broadcast(submissionId, 'done', { status });

      // Auto-retry on AUTO_FAILED
      if (status === 'AUTO_FAILED') {
        const sub = await pool.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
        const row = sub.rows[0];
        if (row && row.retry_count < MAX_RETRY) {
          await handleAutoRetry(row);
        }
      }
      return;
    }
  } catch (err) {
    console.error(`[Poll] Unexpected error for ${submissionId}:`, err);
  }

  scheduleNextPoll(submissionId, interval);
}

async function handleAutoRetry(sub) {
  // Import here to avoid circular deps
  const { packTask } = await import('./packService.js');
  const { createSubmission } = await import('./tbApiService.js');

  const taskResult = await pool.query('SELECT slug FROM tasks WHERE id = $1', [sub.task_id]);
  const slug = taskResult.rows[0]?.slug;
  if (!slug) return;

  console.log(`[Poll] Auto-retrying submission for task ${slug} (attempt ${sub.retry_count + 1})`);

  try {
    const zipPath = await packTask(slug);
    const tbData = await createSubmission(zipPath);
    const newTbId = tbData.id || tbData.submission_id;

    const newSub = await pool.query(
      `INSERT INTO submissions (task_id, tb_submission_id, status, zip_path, retry_count)
       VALUES ($1, $2, 'pending', $3, $4) RETURNING *`,
      [sub.task_id, newTbId, zipPath, sub.retry_count + 1]
    );

    startPolling(newSub.rows[0].id);
  } catch (err) {
    console.error(`[Poll] Auto-retry failed:`, err.message);
  }
}

export function startPolling(submissionId) {
  if (activeTimers.has(submissionId)) return;
  console.log(`[Poll] Starting poll for submission ${submissionId}`);
  poll(submissionId, INITIAL_INTERVAL);
}

export function stopPolling(submissionId) {
  const timer = activeTimers.get(submissionId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(submissionId);
  }
}

export async function recoverPolling() {
  const result = await pool.query(
    `SELECT id FROM submissions
     WHERE status NOT IN ('AUTO_PASSED','AUTO_FAILED','APPROVED','REJECTED','CANCELLED','ERROR','local')
     AND tb_submission_id IS NOT NULL`
  );
  for (const row of result.rows) {
    console.log(`[Poll] Recovering poll for submission ${row.id}`);
    startPolling(row.id);
  }
}
