import { Router } from 'express';
import { addSSEClient, removeSSEClient } from '../services/pollService.js';

const router = Router();

// GET /api/sse/submissions/:subId - Real-time submission status stream
router.get('/submissions/:subId', (req, res) => {
  const { subId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ submissionId: subId })}\n\n`);

  // Register client
  addSSEClient(subId, res);

  // Heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(subId, res);
  });
});

export default router;
