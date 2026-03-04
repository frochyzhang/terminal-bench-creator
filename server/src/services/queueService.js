/**
 * queueService.js
 *
 * 1. API concurrency semaphore  — limits simultaneous AI model requests
 * 2. Resource gate               — waits until CPU / memory are within bounds
 *
 * Usage:
 *   import { runWithQueue } from './queueService.js';
 *   const result = await runWithQueue(() => callSomeAI(...));
 */

import { getMetrics } from './resourceMonitor.js';
import { getQueueSettings } from './settingsService.js';

// ── Configurable limits (can be patched at runtime via PATCH /api/resources/limits) ──
export const LIMITS = {
  maxConcurrentApi: 3,   // max simultaneous AI API calls
  cpuThreshold:    80,   // % — pause new calls when CPU load > this
  memoryThreshold: 90,   // % — pause new calls when memory > this
  pollInterval:  2_000,  // ms between resource-check polls
};

// ── Semaphore ─────────────────────────────────────────────────────────────────

let _active = 0;
const _queue = []; // pending resolve functions

function _tryFulfill() {
  while (_queue.length > 0 && _active < LIMITS.maxConcurrentApi) {
    _active++;
    _queue.shift()();
  }
}

/**
 * Acquire one API slot.
 * @returns {Function} release — call when the request finishes.
 */
export async function acquireApiSlot() {
  if (_active < LIMITS.maxConcurrentApi) {
    _active++;
    return _release;
  }
  await new Promise(resolve => _queue.push(resolve));
  return _release;
}

function _release() {
  _active = Math.max(0, _active - 1);
  _tryFulfill();
}

// ── Resource gate ─────────────────────────────────────────────────────────────

/**
 * Resolves when CPU and memory are both within configured thresholds.
 * No-ops if the monitor hasn't collected data yet (avoids startup blocks).
 */
export async function waitForResources() {
  const m = getMetrics();
  if (!m.lastChecked) return; // monitor not started, skip gate

  let warned = false;
  while (true) {
    const { cpu, memory } = getMetrics();
    if ((cpu?.percent ?? 0) <= LIMITS.cpuThreshold &&
        (memory?.percent ?? 0) <= LIMITS.memoryThreshold) {
      break;
    }
    if (!warned) {
      console.log(
        `[Queue] Resources high — CPU: ${cpu?.percent}%  MEM: ${memory?.percent}% — holding...`
      );
      warned = true;
    }
    await new Promise(r => setTimeout(r, LIMITS.pollInterval));
  }
}

// ── Composite helper ──────────────────────────────────────────────────────────

/**
 * Run an async function after:
 *   1. waiting for resources to be within thresholds
 *   2. acquiring an API concurrency slot
 *
 * @param {Function} fn  async function to execute
 */
export async function runWithQueue(fn) {
  await waitForResources();
  const release = await acquireApiSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

// ── Stats & config ────────────────────────────────────────────────────────────

export function getQueueStats() {
  return {
    activeApiCalls:    _active,
    waitingApiCalls:   _queue.length,
    maxConcurrentApi:  LIMITS.maxConcurrentApi,
    cpuThreshold:      LIMITS.cpuThreshold,
    memoryThreshold:   LIMITS.memoryThreshold,
  };
}

export function updateLimits(patch) {
  if (patch.maxConcurrentApi !== undefined) {
    LIMITS.maxConcurrentApi = Math.max(1, parseInt(patch.maxConcurrentApi));
    _tryFulfill(); // might free up slots
  }
  if (patch.cpuThreshold !== undefined)
    LIMITS.cpuThreshold = parseFloat(patch.cpuThreshold);
  if (patch.memoryThreshold !== undefined)
    LIMITS.memoryThreshold = parseFloat(patch.memoryThreshold);
}

/**
 * Load queue limits from DB settings and apply to in-memory LIMITS.
 * Called once on server startup and can be called again to refresh.
 */
export async function loadFromSettings() {
  try {
    const settings = await getQueueSettings();
    updateLimits(settings);
    console.log('[Queue] Loaded limits from DB:', {
      maxConcurrentApi: LIMITS.maxConcurrentApi,
      cpuThreshold: LIMITS.cpuThreshold,
      memoryThreshold: LIMITS.memoryThreshold,
    });
  } catch (err) {
    console.warn('[Queue] Could not load settings from DB, using defaults:', err.message);
  }
}
