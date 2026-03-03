/**
 * resourceMonitor.js
 *
 * Tracks CPU, memory, and disk usage.
 * Automatically cleans harbor_jobs/ and post_logs/ for completed/discarded
 * tasks when disk usage reaches DISK_CLEAN_THRESHOLD.
 */

import os from 'os';
import { exec } from 'child_process';
import { stat, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';
import pool from '../db/client.js';

export const DISK_CLEAN_THRESHOLD = 80; // % — triggers auto-clean
const MONITOR_INTERVAL = 30_000;        // 30 s

/** @type {ResourceMetrics} */
let _metrics = {
  cpu: { percent: 0, count: 0, load1: 0, load5: 0, load15: 0 },
  memory: { percent: 0, used: 0, total: 0, free: 0 },
  disk: { percent: 0, used: 0, total: 0, available: 0 },
  lastChecked: null,
  lastCleaned: null,
  lastCleanedDirs: 0,
};

let _monitorTimer = null;

export function getMetrics() {
  return { ..._metrics };
}

// ── Collectors ────────────────────────────────────────────────────────────────

function collectCpu() {
  const load = os.loadavg();
  const count = os.cpus().length;
  return {
    percent: parseFloat(Math.min((load[0] / count) * 100, 100).toFixed(1)),
    count,
    load1: parseFloat(load[0].toFixed(2)),
    load5: parseFloat(load[1].toFixed(2)),
    load15: parseFloat(load[2].toFixed(2)),
  };
}

function collectMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    percent: parseFloat(((used / total) * 100).toFixed(1)),
    used,
    total,
    free,
  };
}

function collectDisk() {
  return new Promise(resolve => {
    // -kP: POSIX format, 1K-blocks — consistent across Linux and macOS
    exec(`df -kP "${config.tasksDir}" 2>/dev/null || df -kP .`, (err, stdout) => {
      if (err || !stdout) {
        resolve({ percent: 0, used: 0, total: 0, available: 0 });
        return;
      }
      const lines = stdout.trim().split('\n');
      // POSIX df: Filesystem 1024-blocks Used Available Use% Mounted
      const parts = lines[lines.length - 1].trim().split(/\s+/);
      if (parts.length < 5) {
        resolve({ percent: 0, used: 0, total: 0, available: 0 });
        return;
      }
      resolve({
        percent: parseInt(parts[4]) || 0,      // "41%" → 41
        used: parseInt(parts[2]) * 1024,
        total: parseInt(parts[1]) * 1024,
        available: parseInt(parts[3]) * 1024,
      });
    });
  });
}

// ── Auto-clean ────────────────────────────────────────────────────────────────

/**
 * Remove harbor_jobs/ and post_logs/ for submitted/discarded tasks.
 * Essential task files (instruction.md etc.) are left untouched.
 * Returns count of directories removed.
 */
export async function cleanTaskLogs() {
  try {
    const result = await pool.query(
      "SELECT slug FROM tasks WHERE status IN ('submitted', 'discarded')"
    );
    const slugs = result.rows.map(r => r.slug);
    let removed = 0;

    for (const slug of slugs) {
      const taskDir = join(config.tasksDir, slug);
      for (const sub of ['harbor_jobs', 'post_logs']) {
        const dir = join(taskDir, sub);
        try {
          await stat(dir);
          await rm(dir, { recursive: true, force: true });
          removed++;
        } catch { /* not present, skip */ }
      }
    }

    console.log(`[ResourceMonitor] Cleaned ${removed} log dirs across ${slugs.length} eligible tasks`);
    return removed;
  } catch (err) {
    console.error('[ResourceMonitor] cleanTaskLogs error:', err.message);
    return 0;
  }
}

// ── Core refresh ──────────────────────────────────────────────────────────────

export async function refreshMetrics() {
  const [cpu, disk] = await Promise.all([
    Promise.resolve(collectCpu()),
    collectDisk(),
  ]);
  const memory = collectMemory();

  _metrics = {
    ..._metrics,
    cpu,
    memory,
    disk,
    lastChecked: new Date().toISOString(),
  };

  if (disk.percent >= DISK_CLEAN_THRESHOLD) {
    console.warn(`[ResourceMonitor] Disk at ${disk.percent}% ≥ ${DISK_CLEAN_THRESHOLD}% — auto-cleaning...`);
    const removed = await cleanTaskLogs();
    _metrics.lastCleaned = new Date().toISOString();
    _metrics.lastCleanedDirs = removed;
  }

  return _metrics;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function startMonitoring(interval = MONITOR_INTERVAL) {
  if (_monitorTimer) return;
  refreshMetrics().catch(() => {});
  _monitorTimer = setInterval(() => refreshMetrics().catch(() => {}), interval);
  console.log('[ResourceMonitor] Started (interval', interval / 1000, 's)');
}

export function stopMonitoring() {
  if (_monitorTimer) {
    clearInterval(_monitorTimer);
    _monitorTimer = null;
  }
}
