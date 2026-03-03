import { Router } from 'express';
import {
  startJob, stopJob, pauseJob, resumeJob, getJobStatus,
  addScrapeSSEClient, removeScrapeSSEClient,
} from '../services/batchService.js';
import { fetchSOQuestions } from '../services/scraperService.js';

const router = Router();

// POST /api/scrape/start — start a batch job
router.post('/start', async (req, res, next) => {
  try {
    const job = await startJob(req.body);
    res.json({ message: 'Job started', status: job.running ? 'running' : 'idle' });
  } catch (err) {
    if (err.message.includes('already running')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/scrape/stop
router.post('/stop', (req, res) => {
  stopJob();
  res.json({ message: 'Stop requested' });
});

// POST /api/scrape/pause
router.post('/pause', (req, res) => {
  pauseJob();
  res.json({ message: 'Pause requested' });
});

// POST /api/scrape/resume
router.post('/resume', (req, res) => {
  resumeJob();
  res.json({ message: 'Resume requested' });
});

// GET /api/scrape/status — current job state
router.get('/status', (req, res) => {
  const job = getJobStatus();
  res.json(job || { running: false, stopped: false, logs: [], createdTasks: [], progress: { current: 0, total: 0 } });
});

// GET /api/scrape/preview — fetch SO questions without creating tasks
router.get('/preview', async (req, res, next) => {
  try {
    const { tags, query, site, pagesize = 10, minScore = 5 } = req.query;
    const result = await fetchSOQuestions({ tags, query, site, pagesize: parseInt(pagesize), minScore: parseInt(minScore) });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/scrape/sse — SSE stream for job progress
router.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: {}\n\n`);
  addScrapeSSEClient(res);

  // Heartbeat
  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { clearInterval(hb); }
  }, 25000);

  // Send current job state on connect
  const job = getJobStatus();
  if (job) {
    res.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
  }

  req.on('close', () => {
    clearInterval(hb);
    removeScrapeSSEClient(res);
  });
});

export default router;
