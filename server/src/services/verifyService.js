/**
 * verifyService.js
 *
 * Runs "harbor tasks check" on a task, then uses AI to fix failures.
 * Retries up to maxRetries times, broadcasting progress via SSE.
 */

import { spawn } from 'child_process';
import { readFile, rm } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getTaskDir, readTaskFiles, writeTaskFile } from './taskFileService.js';
import { runWithQueue } from './queueService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the verfifier directory (project root / verfifier)
const VERIFIER_DIR = resolve(__dirname, '../../../verfifier');
const VERIFIER_SCRIPT = join(VERIFIER_DIR, 'run_harbor_test_single.sh');
const VERIFIER_ENV = join(VERIFIER_DIR, '.env');

// ── SSE client management ─────────────────────────────────────────────────────

const verifyClients = new Map(); // taskId → Set<res>

export function addVerifySSEClient(taskId, res) {
  if (!verifyClients.has(taskId)) verifyClients.set(taskId, new Set());
  verifyClients.get(taskId).add(res);
}

export function removeVerifySSEClient(taskId, res) {
  verifyClients.get(taskId)?.delete(res);
}

function broadcast(taskId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...(verifyClients.get(taskId) || new Set())]) {
    try { res.write(payload); } catch { verifyClients.get(taskId)?.delete(res); }
  }
}

// ── Job state ─────────────────────────────────────────────────────────────────

const verifyJobs = new Map(); // taskId → job

export function getVerifyStatus(taskId) {
  return verifyJobs.get(taskId) || null;
}

export function stopVerify(taskId) {
  const job = verifyJobs.get(taskId);
  if (job?.running) {
    job.stopped = true;
    log(job, 'warn', 'Stop requested.');
  }
}

function log(job, level, message, extra = {}) {
  const entry = { level, message, ts: new Date().toISOString(), ...extra };
  job.logs.push(entry);
  broadcast(job.taskId, 'log', entry);
  console.log(`[Verify][${job.slug}][${level.toUpperCase()}] ${message}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a verify+fix loop for a task.
 * @param {object} opts
 * @param {string} opts.taskId
 * @param {string} opts.slug
 * @param {number} [opts.maxRetries=10]
 * @param {string} [opts.model='deepseek/deepseek-v3.2']
 */
export async function startVerify({ taskId, slug, maxRetries = 10, model = 'deepseek/deepseek-v3.2' }) {
  if (verifyJobs.get(taskId)?.running) {
    throw new Error('Verify already running for this task');
  }

  const job = {
    running: true,
    stopped: false,
    taskId,
    slug,
    attempt: 0,
    maxRetries,
    model,
    logs: [],
    result: null, // 'passed' | 'failed' | 'stopped' | 'error'
    lastCheckResult: null,
  };
  verifyJobs.set(taskId, job);
  broadcast(taskId, 'started', { maxRetries, model });

  // Run async without blocking the HTTP response
  runVerifyLoop(job).catch((err) => {
    log(job, 'error', `Fatal: ${err.message}`);
    job.running = false;
    job.result = 'error';
    broadcast(taskId, 'done', { result: 'error', error: err.message });
  });

  return job;
}

// ── Verify loop ───────────────────────────────────────────────────────────────

async function runVerifyLoop(job) {
  const taskPath = getTaskDir(job.slug);
  const checkResultPath = join(taskPath, 'post_logs', 'harbor_check.json');

  try {
    for (let attempt = 1; attempt <= job.maxRetries; attempt++) {
      if (job.stopped) break;

      job.attempt = attempt;
      log(job, 'info', `Attempt ${attempt}/${job.maxRetries}: running harbor check…`);
      broadcast(job.taskId, 'attempt', { attempt, maxRetries: job.maxRetries });

      // Remove stale check result so harbor always produces a fresh one
      try { await rm(checkResultPath, { force: true }); } catch { /* ignore */ }

      await runHarborCheck(taskPath, job);

      // Parse result
      let checkResult = null;
      try {
        const raw = await readFile(checkResultPath, 'utf-8');
        checkResult = JSON.parse(raw);
      } catch {
        log(job, 'warn', 'Could not parse harbor_check.json — treating as failure');
      }

      const { passed, issues } = parseCheckResult(checkResult);
      job.lastCheckResult = { passed, issues, raw: checkResult };
      broadcast(job.taskId, 'check-result', { passed, issues, attempt, raw: checkResult });

      if (passed) {
        log(job, 'info', `✅ All checks passed on attempt ${attempt}!`);
        job.result = 'passed';
        break;
      }

      log(job, 'warn', `❌ ${issues.length} issue(s) found on attempt ${attempt}`, { issues });

      if (attempt >= job.maxRetries) {
        log(job, 'warn', `Max retries (${job.maxRetries}) reached.`);
        job.result = 'failed';
        break;
      }

      // Ask AI to fix files
      try {
        await fixWithAI(job, checkResult, issues);
      } catch (err) {
        log(job, 'error', `AI fix failed: ${err.message}`);
        // Continue to next attempt anyway
      }
    }
  } finally {
    if (!job.result) job.result = job.stopped ? 'stopped' : 'failed';
    job.running = false;
    broadcast(job.taskId, 'done', { result: job.result, attempts: job.attempt });
  }
}

// ── Harbor check subprocess ───────────────────────────────────────────────────

function runHarborCheck(taskPath, job) {
  return new Promise((resolve) => {
    // Source the verifier .env then run the script with command=check
    const cmd = [
      'set -a',
      `source "${VERIFIER_ENV}" 2>/dev/null || true`,
      'set +a',
      `SKIP_EXISTING=false API_PROVIDER=openrouter bash "${VERIFIER_SCRIPT}" "${taskPath}" check`,
    ].join('\n');

    const child = spawn('bash', ['-c', cmd], {
      cwd: VERIFIER_DIR,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        PATH: `${process.env.HOME || '/root'}/.local/bin:${process.env.PATH}`,
      },
    });

    const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');

    child.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const clean = stripAnsi(line).trim();
        if (clean) broadcast(job.taskId, 'harbor-log', { text: clean });
      }
    });

    child.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const clean = stripAnsi(line).trim();
        if (clean) broadcast(job.taskId, 'harbor-log', { text: clean });
      }
    });

    child.on('close', (code) => {
      log(job, 'info', `Harbor check process exited (code=${code ?? 0})`);
      resolve(code ?? 0);
    });

    child.on('error', (err) => {
      log(job, 'error', `Failed to spawn harbor check: ${err.message}`);
      resolve(1);
    });
  });
}

// ── Parse harbor_check.json ───────────────────────────────────────────────────

function parseCheckResult(raw) {
  if (!raw) return { passed: false, issues: ['No check result available'] };

  // Harbor may output an array or an object with a checks/items/results array
  const checks =
    Array.isArray(raw) ? raw :
    raw.checks || raw.items || raw.results || [];

  if (Array.isArray(checks) && checks.length > 0) {
    const issues = [];
    for (const c of checks) {
      const ok = c.pass ?? c.passed ?? (c.status === 'pass') ?? true;
      if (!ok) {
        const id = c.id || c.check || c.name || '?';
        const msg = c.message || c.error || c.reason || 'check failed';
        issues.push(`[${id}] ${msg}`);
      }
    }
    return { passed: issues.length === 0, issues };
  }

  // Fallback: search raw JSON for failure indicators
  const rawStr = JSON.stringify(raw);
  const hasFail =
    rawStr.includes('"pass":false') ||
    rawStr.includes('"passed":false') ||
    rawStr.includes('"status":"fail') ||
    raw.pass === false ||
    raw.passed === false;

  if (hasFail) {
    return { passed: false, issues: ['Harbor check found issues (see log for details)'] };
  }

  return { passed: true, issues: [] };
}

// ── AI fix ────────────────────────────────────────────────────────────────────

async function fixWithAI(job, checkResult, issues) {
  const { generateWithOpenRouter } = await import('./aiService/openrouterProvider.js');
  const files = await readTaskFiles(job.slug);

  const systemPrompt = `You are an expert Terminal-Bench task author. Fix the failing harbor quality checks in the task files.

Output ONLY the corrected files in this exact XML format:
<files>
  <file name="instruction.md">...complete file content...</file>
  <file name="task.toml">...complete file content...</file>
  <file name="solution/solve.sh">...complete file content...</file>
  <file name="tests/test.sh">...complete file content...</file>
  <file name="environment/Dockerfile">...complete file content...</file>
</files>

Rules:
- Include ALL 5 files even if only some need changes
- Fix ONLY the reported issues, keep core functionality intact
- Output complete file contents with no truncation or placeholders`;

  const checkJson = checkResult ? JSON.stringify(checkResult, null, 2) : '(unavailable)';
  const issueList = issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n');

  const userPrompt = `Failing harbor checks:
${issueList}

Full harbor_check.json output:
${checkJson}

Current task files:

=== instruction.md ===
${files['instruction.md'] || '(empty)'}

=== task.toml ===
${files['task.toml'] || '(empty)'}

=== solution/solve.sh ===
${files['solution/solve.sh'] || '(empty)'}

=== tests/test.sh ===
${files['tests/test.sh'] || '(empty)'}

=== environment/Dockerfile ===
${files['environment/Dockerfile'] || '(empty)'}

Please output the corrected <files> XML.`;

  log(job, 'info', `Calling AI (${job.model}) to fix ${issues.length} issue(s)…`);

  let aiOutput = '';
  await runWithQueue(() =>
    generateWithOpenRouter(systemPrompt, userPrompt, (chunk) => {
      aiOutput += chunk;
      broadcast(job.taskId, 'ai-chunk', { chunk });
    }, job.model)
  );

  // Parse <file name="...">content</file> blocks
  const pattern = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g;
  const validFiles = [
    'instruction.md',
    'task.toml',
    'solution/solve.sh',
    'tests/test.sh',
    'environment/Dockerfile',
  ];
  let fixedCount = 0;
  let m;
  while ((m = pattern.exec(aiOutput)) !== null) {
    const [, filename, content] = m;
    if (validFiles.includes(filename)) {
      const trimmed = content.trim();
      await writeTaskFile(job.slug, filename, trimmed ? trimmed + '\n' : '');
      log(job, 'info', `  Updated: ${filename}`);
      fixedCount++;
    }
  }

  if (fixedCount === 0) {
    log(job, 'warn', 'AI produced no file changes — check AI output above');
  } else {
    log(job, 'info', `AI updated ${fixedCount} file(s)`);
    broadcast(job.taskId, 'ai-fixed', { fixedCount });
  }
}
