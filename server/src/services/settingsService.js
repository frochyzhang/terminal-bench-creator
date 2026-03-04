import pool from '../db/client.js';

const DEFAULTS = {
  rate_control_enabled: 'true',
  rate_so_delay:        '2000',
  rate_ai_delay:        '2000',
  rate_task_delay:      '3000',
  queue_max_concurrent: '3',
  queue_cpu_threshold:  '80',
  queue_mem_threshold:  '90',
};

export async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? DEFAULTS[key] ?? null;
}

export async function getMultiple(keys) {
  const { rows } = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  for (const k of keys) {
    if (!(k in map)) map[k] = DEFAULTS[k] ?? null;
  }
  return map;
}

export async function getRateSettings() {
  const s = await getMultiple([
    'rate_control_enabled', 'rate_so_delay', 'rate_ai_delay', 'rate_task_delay',
  ]);
  const enabled = s.rate_control_enabled !== 'false';
  return {
    enabled,
    soDelay:   enabled ? (parseInt(s.rate_so_delay)   || 2000) : 0,
    aiDelay:   enabled ? (parseInt(s.rate_ai_delay)   || 2000) : 0,
    taskDelay: enabled ? (parseInt(s.rate_task_delay)  || 3000) : 0,
  };
}

export async function getQueueSettings() {
  const s = await getMultiple([
    'queue_max_concurrent', 'queue_cpu_threshold', 'queue_mem_threshold',
  ]);
  return {
    maxConcurrentApi: parseInt(s.queue_max_concurrent) || 3,
    cpuThreshold:     parseInt(s.queue_cpu_threshold)  || 80,
    memoryThreshold:  parseInt(s.queue_mem_threshold)  || 90,
  };
}
