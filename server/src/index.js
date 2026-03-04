import 'dotenv/config';
import { mkdir } from 'fs/promises';
import app from './app.js';
import { config } from './config.js';
import { recoverPolling } from './services/pollService.js';
import { startMonitoring } from './services/resourceMonitor.js';
import { loadFromSettings } from './services/queueService.js';

async function start() {
  // Ensure tasks directory exists
  await mkdir(config.tasksDir, { recursive: true });

  app.listen(config.port, () => {
    console.log(`[Server] Listening on http://localhost:${config.port}`);
    console.log(`[Server] Tasks directory: ${config.tasksDir}`);
    console.log(`[Server] Environment: ${config.nodeEnv}`);
  });

  // Load queue limits from DB settings
  try {
    await loadFromSettings();
  } catch (err) {
    console.warn('[Server] Could not load queue settings (DB may not be ready):', err.message);
  }

  // Recover in-progress polls from DB
  try {
    await recoverPolling();
  } catch (err) {
    console.warn('[Server] Could not recover polling (DB may not be ready):', err.message);
  }

  // Start background resource monitoring (CPU / memory / disk auto-clean)
  startMonitoring();
}

start().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
