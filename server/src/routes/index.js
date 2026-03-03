import { Router } from 'express';
import tasksRouter from './tasks.js';
import filesRouter from './files.js';
import generateRouter from './generate.js';
import lintRouter from './lint.js';
import submitRouter from './submit.js';
import submissionsRouter from './submissions.js';
import sseRouter from './sse.js';
import settingsRouter from './settings.js';
import dashboardRouter from './dashboard.js';
import scrapeRouter from './scrape.js';
import verifyRouter from './verify.js';
import polishRouter from './polish.js';
import resourcesRouter from './resources.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Task CRUD
router.use('/tasks', tasksRouter);

// File operations (nested under tasks)
router.use('/tasks/:id/files', filesRouter);

// AI generation (nested under tasks)
router.use('/tasks/:id/generate', generateRouter);

// Lint (nested under tasks)
router.use('/tasks/:id/lint', lintRouter);

// Submit (nested under tasks)
router.use('/tasks/:id/submit', submitRouter);

// Submissions
router.use('/submissions', submissionsRouter);

// SSE
router.use('/sse', sseRouter);

// Settings
router.use('/settings', settingsRouter);

// Dashboard
router.use('/dashboard', dashboardRouter);

// SO Scraper
router.use('/scrape', scrapeRouter);

// Harbor Verify
router.use('/tasks/:id/verify', verifyRouter);

// Polish pipeline (oracle + lint + instr-quality + auto-submit)
router.use('/tasks/:id/polish', polishRouter);

// Resource monitor + queue limits
router.use('/resources', resourcesRouter);

export default router;
