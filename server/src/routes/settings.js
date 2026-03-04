import { Router } from 'express';
import pool from '../db/client.js';
import { testConnection } from '../services/tbApiService.js';
import { updateLimits } from '../services/queueService.js';

const router = Router();

const SENSITIVE_KEYS = new Set([
  'anthropic_api_key',
  'openrouter_api_key',
  'tb_password',
  'tb_jwt_token',
]);

function maskValue(key, value) {
  if (SENSITIVE_KEYS.has(key) && value && value.length > 8) {
    return value.slice(0, 4) + '****' + value.slice(-4);
  }
  return value;
}

// GET /api/settings - Read all settings (sensitive values masked)
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT key, value, updated_at FROM settings ORDER BY key');
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = {
        value: maskValue(row.key, row.value),
        updated_at: row.updated_at,
        isSensitive: SENSITIVE_KEYS.has(row.key),
      };
    }
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings - Batch update settings
router.put('/', async (req, res, next) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Request body must be an object' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(updates)) {
        if (value === '' || value === null || value === undefined) continue;
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, String(value)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const queuePatch = {};
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'queue_max_concurrent' && value)
        queuePatch.maxConcurrentApi = value;
      else if (key === 'queue_cpu_threshold' && value)
        queuePatch.cpuThreshold = value;
      else if (key === 'queue_mem_threshold' && value)
        queuePatch.memoryThreshold = value;
    }
    if (Object.keys(queuePatch).length > 0) {
      updateLimits(queuePatch);
      console.log('[Settings] Synced queue limits to queueService:', queuePatch);
    }

    res.json({ message: 'Settings updated' });
  } catch (err) {
    next(err);
  }
});

// POST /api/settings/test-connection - Test TB connection
router.post('/test-connection', async (req, res, next) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
