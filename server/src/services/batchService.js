/**
 * Batch service: SO scrape → task create → AI generate → screening pipeline.
 *
 * New in v2:
 *   - Screening step: run harbor agent with opus-4.5 (timeout 180s)
 *     If agent passes within 3 min → task is too easy → mark 'discarded'
 *   - Queue integration: AI calls respect the concurrency semaphore + resource gate
 *   - TB domain/workload extracted from task.toml and saved to DB
 */

import { spawn } from 'child_process';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/client.js';
import { fetchSOQuestions, buildSOContext, titleToSlug, uniqueSlug } from './scraperService.js';
import { createTaskScaffold, writeTaskFile, getTaskDir } from './taskFileService.js';
import { lintTask } from './lintService.js';
import { runWithQueue } from './queueService.js';
import { startPolish } from './polishService.js';
import {
  soInstructionPrompt,
  soDockerfilePrompt,
  soSolvePrompt,
  soTestPrompt,
  soTomlPrompt,
} from './aiService/prompts/soConverter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_DIR = resolve(__dirname, '../../../verfifier');
const VERIFIER_ENV = join(VERIFIER_DIR, '.env');

const SO_PROMPTS = {
  'instruction.md': soInstructionPrompt,
  'environment/Dockerfile': soDockerfilePrompt,
  'solution/solve.sh': soSolvePrompt,
  'tests/test.sh': soTestPrompt,
  'task.toml': soTomlPrompt,
};

export const GENERATION_ORDER = [
  'instruction.md',
  'environment/Dockerfile',
  'solution/solve.sh',
  'tests/test.sh',
  'task.toml',
];

// ── SSE client management ─────────────────────────────────────────────────────

const sseClients = new Set();

export function addScrapeSSEClient(res) { sseClients.add(res); }
export function removeScrapeSSEClient(res) { sseClients.delete(res); }

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...sseClients]) {
    try { res.write(payload); } catch { sseClients.delete(res); }
  }
}

// ── Job state ─────────────────────────────────────────────────────────────────

let currentJob = null;

export function getJobStatus() {
  return currentJob ? { ...currentJob } : null;
}

export function stopJob() {
  if (currentJob?.running) {
    currentJob.stopped = true;
    log('warn', 'Stop requested — finishing current task then halting.');
  }
}

export function pauseJob() {
  if (currentJob?.running && !currentJob.paused) {
    currentJob.paused = true;
    log('warn', 'Job paused.');
    broadcast('paused', {});
  }
}

export function resumeJob() {
  if (currentJob?.paused) {
    currentJob.paused = false;
    log('info', 'Job resumed.');
    broadcast('resumed', {});
  }
}

function log(level, message, extra = {}) {
  const entry = { level, message, ts: new Date().toISOString(), ...extra };
  if (currentJob) currentJob.logs.push(entry);
  broadcast('log', entry);
  console.log(`[Batch][${level.toUpperCase()}] ${message}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitWhilePaused() {
  while (currentJob?.paused && !currentJob?.stopped) {
    await delay(500);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {object} config
 * @param {string}  config.tags
 * @param {string}  [config.query]
 * @param {string}  [config.site]
 * @param {string}  [config.apiKey]
 * @param {number}  [config.maxTasks=5]
 * @param {string}  [config.model]
 * @param {number}  [config.soDelay=2000]
 * @param {number}  [config.aiDelay=2000]
 * @param {number}  [config.taskDelay=3000]
 * @param {number}  [config.minScore=5]
 * @param {boolean} [config.skipExisting=true]
 * @param {string}  [config.difficulty]
 * @param {boolean} [config.terminalOnly=true]
 * @param {boolean} [config.screening=true]      — run harbor screening
 * @param {number}  [config.screeningTimeout=180] — seconds
 * @param {string}  [config.screeningModel]       — agent model for screening
 * @param {boolean} [config.polish=true]          — run quality polish after screening passes
 * @param {number}  [config.polishMaxRounds=5]    — max fix rounds in polish
 */
export async function startJob(config) {
  if (currentJob?.running) throw new Error('A scrape job is already running');

  const cfg = {
    tags:              config.tags || 'bash;linux',
    query:             config.query || '',
    site:              config.site || 'stackoverflow',
    apiKey:            config.apiKey || '',
    maxTasks:          Math.min(config.maxTasks || 5, 50),
    model:             config.model || 'deepseek/deepseek-chat',
    soDelay:           config.soDelay ?? 2000,
    aiDelay:           config.aiDelay ?? 2000,
    taskDelay:         config.taskDelay ?? 3000,
    minScore:          config.minScore ?? 5,
    skipExisting:      config.skipExisting ?? true,
    difficulty:        config.difficulty || '',
    terminalOnly:      config.terminalOnly ?? true,
    screening:         config.screening ?? true,
    screeningTimeout:  config.screeningTimeout ?? 180,
    screeningModel:    config.screeningModel || 'openrouter/anthropic/claude-opus-4.5',
    polish:            config.polish ?? true,
    polishMaxRounds:   config.polishMaxRounds ?? 5,
  };

  currentJob = {
    running: true,
    stopped: false,
    paused: false,
    config: cfg,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: { current: 0, total: cfg.maxTasks },
    logs: [],
    createdTasks: [],
    discardedTasks: [],
    quotaRemaining: null,
  };

  broadcast('started', { config: cfg });
  log('info', `Job started — model: ${cfg.model}, max: ${cfg.maxTasks}, screening: ${cfg.screening}`);

  runPipeline(cfg).catch(err => {
    log('error', `Fatal pipeline error: ${err.message}`);
    if (currentJob) {
      currentJob.running = false;
      currentJob.finishedAt = new Date().toISOString();
    }
    broadcast('error', { message: err.message });
  });

  return currentJob;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

async function runPipeline(cfg) {
  let processed = 0;
  let page = 1;
  const pageSize = Math.min(cfg.maxTasks * 2, 50);

  try {
    while (processed < cfg.maxTasks && !currentJob.stopped) {
      await waitWhilePaused();
      if (currentJob.stopped) break;

      log('info', `Fetching SO questions (page ${page}, tags: ${cfg.tags})…`);

      let soResult;
      try {
        soResult = await fetchSOQuestions({
          tags: cfg.tags, query: cfg.query, site: cfg.site,
          apiKey: cfg.apiKey, pagesize: pageSize, page, minScore: cfg.minScore,
        });
      } catch (err) {
        log('error', `SO API fetch failed: ${err.message}`);
        break;
      }

      if (soResult.quotaRemaining !== null) {
        currentJob.quotaRemaining = soResult.quotaRemaining;
        log('info', `SO API quota remaining: ${soResult.quotaRemaining}`);
      }

      let questions = soResult.questions;
      if (cfg.terminalOnly) {
        questions = questions.filter(q => q.isTerminal);
        log('info', `After terminal filter: ${questions.length}/${soResult.questions.length}`);
      }

      if (questions.length === 0) {
        log('warn', 'No suitable questions on this page.');
        if (!soResult.has_more) break;
        page++;
        await delay(cfg.soDelay);
        continue;
      }

      for (const q of questions) {
        if (processed >= cfg.maxTasks || currentJob.stopped) break;
        await waitWhilePaused();

        const baseSlug = titleToSlug(q.title);

        if (cfg.skipExisting) {
          const exists = await pool.query(
            'SELECT id FROM tasks WHERE slug LIKE $1 LIMIT 1', [`${baseSlug}%`]
          );
          if (exists.rows.length > 0) {
            log('info', `Skipping (exists): ${baseSlug}`);
            continue;
          }
        }

        log('info', `[${processed + 1}/${cfg.maxTasks}] Processing: "${q.title}"`, { url: q.link });
        broadcast('task-start', { index: processed + 1, title: q.title, url: q.link });

        try {
          const kept = await processQuestion(q, cfg, baseSlug);
          if (kept) {
            processed++;
            currentJob.progress.current = processed;
            broadcast('progress', { current: processed, total: cfg.maxTasks });
          }
          // even discarded tasks count against maxTasks to prevent infinite loops
          else {
            processed++;
          }
        } catch (err) {
          log('error', `Failed to process "${q.title}": ${err.message}`);
          broadcast('task-error', { title: q.title, error: err.message });
        }

        if (processed < cfg.maxTasks && !currentJob.stopped) {
          await delay(cfg.taskDelay);
        }
      }

      if (!soResult.has_more) {
        log('info', 'No more SO pages.');
        break;
      }
      page++;
      await delay(cfg.soDelay);
    }
  } finally {
    currentJob.running = false;
    currentJob.finishedAt = new Date().toISOString();
    const reason = currentJob.stopped ? 'stopped by user' : 'completed';
    log('info', `Job ${reason}. Created: ${currentJob.createdTasks.length}, Discarded: ${currentJob.discardedTasks.length}`);
    broadcast('done', {
      reason,
      created: currentJob.createdTasks.length,
      discarded: currentJob.discardedTasks.length,
      tasks: currentJob.createdTasks,
    });
  }
}

// ── AI Task Slug Generator ────────────────────────────────────────────────────

/**
 * Use DeepSeek V3.2 to generate a concise, technical task slug from SO question.
 * Falls back to titleToSlug on failure.
 */
async function generateAITaskSlug(q, model) {
  try {
    const { generateWithOpenRouter } = await import('./aiService/openrouterProvider.js');

    const system = `Generate a concise technical slug for a Terminal-Bench programming challenge derived from a StackOverflow question.

Rules:
- 3-5 words, ALL lowercase, separated by hyphens
- Describe the TECHNICAL TASK (action verb + subject), NOT the question
- No articles (a/an/the), no filler words (how/what/why/using)
- 20-45 characters total
- Good slugs: "parse-csv-with-awk", "implement-lru-cache-bash", "optimize-nginx-proxy-timeout", "extract-ssl-cert-expiry", "convert-json-to-toml", "simulate-pid-controller-c", "debug-memory-leak-valgrind", "build-static-binary-musl"
- Bad slugs: "how-to-parse-csv", "question-about-bash", "linux-problem-help", "bash-scripting"

Return ONLY the slug. No explanation, no quotes, no punctuation.`;

    const context = `Title: ${q.title}\nTags: ${(q.tags || []).join(', ')}`;
    let slug = '';
    await runWithQueue(() =>
      generateWithOpenRouter(system, context, c => { slug += c; }, model)
    );

    slug = slug.trim().toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (slug.length > 50) slug = slug.slice(0, 50).replace(/-[^-]*$/, '');
    return slug.length >= 8 ? slug : null;
  } catch {
    return null;
  }
}

// ── Question processor ────────────────────────────────────────────────────────

/**
 * Full pipeline for one SO question.
 * @returns {boolean} true = kept, false = discarded by screening
 */
async function processQuestion(q, cfg, baseSlug) {
  // 1. Create task record + scaffold
  log('info', `  Generating task name for "${q.title}"…`);
  const aiSlug = await generateAITaskSlug(q, cfg.model);
  if (aiSlug) log('info', `  AI slug: ${aiSlug} (was: ${baseSlug})`);
  const slug = await uniqueSlug(aiSlug || baseSlug, pool);
  const title = q.title.slice(0, 120);
  const soContext = buildSOContext(q);

  const dbResult = await pool.query(
    `INSERT INTO tasks (slug, title, description, category, difficulty, status)
     VALUES ($1, $2, $3, 'scripting', $4, 'draft') RETURNING *`,
    [slug, title, `Auto-imported from StackOverflow: ${q.link}`, cfg.difficulty || 'Medium']
  );
  const task = dbResult.rows[0];
  const taskPath = getTaskDir(slug);
  await createTaskScaffold(slug);

  log('info', `  Created task: ${slug} (${task.id})`);
  broadcast('task-created', { slug, taskId: task.id, title });

  // 2. Generate all files sequentially (with queue)
  const generatedFiles = {};
  const ctxOrder = ['instruction.md', 'environment/Dockerfile', 'solution/solve.sh', 'tests/test.sh'];

  for (const filename of GENERATION_ORDER) {
    await waitWhilePaused();
    if (currentJob.stopped) {
      log('warn', `  Stopped during generation of ${filename}`);
      break;
    }

    const systemPrompt = SO_PROMPTS[filename];
    if (!systemPrompt) continue;

    const contextParts = [soContext];
    for (const ctxFile of ctxOrder) {
      if (ctxFile !== filename && generatedFiles[ctxFile]) {
        contextParts.push(`\n\n=== ${ctxFile} (already written) ===\n${generatedFiles[ctxFile]}`);
      }
    }

    log('info', `  Generating ${filename}…`);
    broadcast('file-start', { slug, filename });

    let content = '';
    try {
      content = await runWithQueue(() =>
        callOpenRouter(systemPrompt, contextParts.join('\n'), cfg.model, chunk =>
          broadcast('file-chunk', { slug, filename, chunk })
        )
      );
    } catch (err) {
      log('error', `  Failed to generate ${filename}: ${err.message}`);
      broadcast('file-error', { slug, filename, error: err.message });
      continue;
    }

    await writeTaskFile(slug, filename, content);
    generatedFiles[filename] = content;
    broadcast('file-done', { slug, filename });

    if (cfg.aiDelay > 0) await delay(cfg.aiDelay);
  }

  // 3. Extract domain/workload from generated task.toml and update DB
  const tomlContent = generatedFiles['task.toml'] || '';
  const domain = (tomlContent.match(/^domain\s*=\s*"([^"]+)"/m) || [])[1] || null;
  const workload = (tomlContent.match(/^workload\s*=\s*"([^"]+)"/m) || [])[1] || null;

  if (domain || workload) {
    await pool.query(
      'UPDATE tasks SET domain = $1, workload = $2 WHERE id = $3',
      [domain, workload, task.id]
    );
  }

  // 4. Screening — run harbor agent once with opus-4.5
  if (cfg.screening && !currentJob.stopped) {
    log('info', `  [Screening] Running harbor agent (model: ${cfg.screeningModel}, timeout: ${cfg.screeningTimeout}s)…`);
    broadcast('screening-start', { slug, taskId: task.id });

    const screenResult = await runHarborScreening(taskPath, cfg.screeningModel, cfg.screeningTimeout, slug);
    broadcast('screening-done', { slug, ...screenResult });

    if (screenResult.tooEasy) {
      log('warn', `  [Screening] ⚠️  Task passed in ${screenResult.elapsed}s — too easy, discarding.`);

      await pool.query(
        'UPDATE tasks SET status = $1, screening_elapsed_sec = $2 WHERE id = $3',
        ['discarded', screenResult.elapsed, task.id]
      );

      currentJob.discardedTasks.push({ slug, taskId: task.id, title, elapsed: screenResult.elapsed });
      broadcast('task-discarded', { slug, taskId: task.id, elapsed: screenResult.elapsed });
      return false; // signal: not kept
    }

    log('info', `  [Screening] ✓ Task appropriately challenging (exit=${screenResult.exitCode}, ${screenResult.elapsed}s).`);
    await pool.query(
      'UPDATE tasks SET screening_elapsed_sec = $1 WHERE id = $2',
      [screenResult.elapsed, task.id]
    );
  }

  // 5. Lint (quick local check for the table view)
  const lintResult = lintTask(generatedFiles);
  const entry = { slug, taskId: task.id, title, domain, workload, lintScore: lintResult.score, lint: lintResult };
  currentJob.createdTasks.push(entry);

  log('info', `  Lint: ${lintResult.score} ${lintResult.ready ? '✅' : '❌'}  domain: ${domain || '?'}`, { slug });
  broadcast('task-done', entry);

  // 6. Polish pipeline — oracle + lint + instr-quality checks → AI fix → submit to TB
  if (cfg.polish && !currentJob.stopped) {
    log('info', `  [Polish] Starting quality pipeline for ${slug} in background…`);

    // Route polish log entries back to the batch SSE log channel
    const externalBroadcast = (event, data) => {
      if (event === 'log') {
        broadcast('log', data);                  // shows up in Scraper live output
      } else {
        broadcast(`polish-${event}`, data);      // structured events (e.g. polish-submitted)
      }
    };

    startPolish({
      taskId:          task.id,
      slug,
      maxRounds:       cfg.polishMaxRounds,
      oracleTimeout:   600,
      agentAttempts:   cfg.agentAttempts ?? 1,
      lintModel:       'openrouter/deepseek/deepseek-v3.2',
      fixModel:        cfg.model,
      autoSubmit:      true,
      externalBroadcast,
    }).catch(err => {
      log('error', `  [Polish] Pipeline error for ${slug}: ${err.message}`);
    });
    // Fire-and-forget — batch continues to next task while polish runs in background
  }

  return true; // kept
}

// ── Harbor screening ──────────────────────────────────────────────────────────

function runHarborScreening(taskPath, model, timeoutSec, slug) {
  return new Promise(resolve => {
    const jobsDir = join(taskPath, 'harbor_jobs', 'screening');

    // Source the verifier .env, then run harbor agent with hard timeout
    const cmd = [
      'set -a',
      `source "${VERIFIER_ENV}" 2>/dev/null || true`,
      'set +a',
      `timeout ${timeoutSec} uv run harbor run ` +
        `--path "${taskPath}" ` +
        `--agent terminus-2 ` +
        `--model "${model}" ` +
        `--n-attempts 1 ` +
        `--jobs-dir "${jobsDir}"`,
    ].join('\n');

    const startTime = Date.now();

    const child = spawn('bash', ['-c', cmd], {
      cwd: VERIFIER_DIR,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/root',
        PATH: `${process.env.HOME || '/root'}/.local/bin:${process.env.PATH}`,
      },
    });

    // Swallow output to avoid cluttering batch logs
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});

    child.on('close', code => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const exitCode = code ?? 1;
      // exit 124 = timeout (GNU timeout), any non-zero = failed/timeout
      const tooEasy = exitCode === 0 && elapsed < timeoutSec;
      resolve({ exitCode, elapsed, tooEasy, timedOut: exitCode === 124 });
    });

    child.on('error', err => {
      console.warn(`[Batch][Screening] spawn error for ${slug}: ${err.message}`);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      // If harbor/docker isn't available, treat as "not too easy"
      resolve({ exitCode: 1, elapsed, tooEasy: false, timedOut: false, error: err.message });
    });
  });
}

// ── OpenRouter helper (bypasses settings, uses explicit model) ────────────────

async function callOpenRouter(systemPrompt, userPrompt, model, onChunk) {
  const { generateWithOpenRouter } = await import('./aiService/openrouterProvider.js');
  return generateWithOpenRouter(systemPrompt, userPrompt, onChunk, model);
}
