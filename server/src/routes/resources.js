import { Router } from 'express';
import { getMetrics, refreshMetrics, cleanTaskLogs, DISK_CLEAN_THRESHOLD } from '../services/resourceMonitor.js';
import { getQueueStats, LIMITS, updateLimits } from '../services/queueService.js';

const router = Router();

// GET /api/resources
router.get('/', (req, res) => {
  res.json({
    ...getMetrics(),
    queue: getQueueStats(),
    diskCleanThreshold: DISK_CLEAN_THRESHOLD,
  });
});

// POST /api/resources/refresh — force an immediate metric refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const metrics = await refreshMetrics();
    res.json({ ...metrics, queue: getQueueStats() });
  } catch (err) {
    next(err);
  }
});

// POST /api/resources/clean — manually trigger log cleanup
router.post('/clean', async (req, res, next) => {
  try {
    const removed = await cleanTaskLogs();
    const metrics = await refreshMetrics();
    res.json({ removed, message: `Removed ${removed} log directories`, disk: metrics.disk });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/resources/limits — update queue thresholds at runtime
router.patch('/limits', (req, res) => {
  const { maxConcurrentApi, cpuThreshold, memoryThreshold } = req.body;
  updateLimits({ maxConcurrentApi, cpuThreshold, memoryThreshold });
  res.json({ limits: LIMITS, queue: getQueueStats() });
});

export default router;
