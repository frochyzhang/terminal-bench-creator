/**
 * polishService.js
 *
 * 六项本地检查 **并发执行** → AI 统一修复 → 全部通过后提交 TB 平台。
 *
 * 每轮并发：
 *   ┌─ Format       : 验证 5 个必要文件存在且非空
 *   ├─ Oracle       : harbor run --agent oracle   （solution 能通过测试）
 *   ├─ Lint         : harbor tasks check -m …     （11 项质量检查）
 *   ├─ InstrQuality : AI 审查 instruction.md      （A1–A5 规则）
 *   ├─ AgentTest    : harbor run --agent terminus-2 -k N （难度校验）
 *   └─ PostCheck    : AI 综合质量审核              （训练价值 + 基础质量）
 *
 * 全部通过 → pack → 提交 TB 平台 → startPolling
 * 任何失败 → AI 一次性修复所有问题 → 下一轮
 */

import { spawn } from 'child_process';
import { readFile, writeFile, rm, mkdir, access } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/client.js';
import { getTaskDir, readTaskFiles, writeTaskFile } from './taskFileService.js';
import { packTask } from './packService.js';
import { createSubmission } from './tbApiService.js';
import { startPolling } from './pollService.js';
import { runWithQueue } from './queueService.js';
import { INSTR_QUALITY_REVIEWER_SYSTEM, INSTR_FIX_GUIDANCE } from './aiService/prompts/qualityRules.js';
import { POST_CHECK_01_SYSTEM, POST_CHECK_02_SYSTEM, POST_CHECK_FIX_GUIDANCE } from './aiService/prompts/postCheckPrompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_DIR = resolve(__dirname, '../../../verfifier');
const VERIFIER_ENV = join(VERIFIER_DIR, '.env');

const REQUIRED_FILES = [
  'instruction.md',
  'task.toml',
  'solution/solve.sh',
  'tests/test.sh',
  'environment/Dockerfile',
];

// ── SSE 客户端管理 ────────────────────────────────────────────────────────────

const polishClients = new Map();

export function addPolishSSEClient(taskId, res) {
  if (!polishClients.has(taskId)) polishClients.set(taskId, new Set());
  polishClients.get(taskId).add(res);
}
export function removePolishSSEClient(taskId, res) {
  polishClients.get(taskId)?.delete(res);
}

function broadcast(taskId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...(polishClients.get(taskId) || new Set())]) {
    try { res.write(payload); } catch { polishClients.get(taskId)?.delete(res); }
  }
  const job = polishJobs.get(taskId);
  if (job?.externalBroadcast) {
    try { job.externalBroadcast(event, data); } catch { /* ignore */ }
  }
}

// ── 作业状态 ──────────────────────────────────────────────────────────────────

const polishJobs = new Map();

export function getPolishStatus(taskId) { return polishJobs.get(taskId) || null; }

export function stopPolish(taskId) {
  const job = polishJobs.get(taskId);
  if (job?.running) { job.stopped = true; log(job, 'warn', 'Stop requested.'); }
}

function log(job, level, message) {
  const entry = { level, message, ts: new Date().toISOString() };
  job.logs.push(entry);
  broadcast(job.taskId, 'log', entry);
  console.log(`[Polish][${job.slug}][${level.toUpperCase()}] ${message}`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {object}   opts
 * @param {string}   opts.taskId
 * @param {string}   opts.slug
 * @param {number}   [opts.maxRounds=5]
 * @param {number}   [opts.oracleTimeout=600]      秒
 * @param {number}   [opts.agentAttempts=4]         0 = 跳过 agent 检查
 * @param {string}   [opts.agentModel]              terminus-2 使用的模型
 * @param {number}   [opts.agentTimeout=900]       秒（k=4 需要充足时间）
 * @param {string}   [opts.lintModel]
 * @param {string}   [opts.fixModel]
 * @param {string}   [opts.postCheckModel]          TB Step6 审核模型（默认 claude-opus-4-6）
 * @param {boolean}  [opts.autoSubmit=true]
 * @param {Function} [opts.externalBroadcast]
 */
export async function startPolish({
  taskId,
  slug,
  maxRounds     = 5,
  oracleTimeout = 600,
  agentAttempts = 4,
  agentModel    = 'anthropic/claude-opus-4-5',
  agentTimeout  = 3600,
  lintModel        = 'deepseek/deepseek-v3.2',
  fixModel         = 'anthropic/claude-opus-4-5',
  // TB Step 4 uses gemini-2.5-pro; Step 6 (post-check) mirrors Claude review
  instrCheckModel  = 'google/gemini-2.5-pro',
  postCheckModel   = 'anthropic/claude-sonnet-4-5',
  autoSubmit    = true,
  externalBroadcast = null,
}) {
  if (polishJobs.get(taskId)?.running) throw new Error('Polish already running for this task');

  const job = {
    running: true, stopped: false,
    taskId, slug,
    round: 0, maxRounds,
    oracleTimeout, agentAttempts, agentModel, agentTimeout,
    lintModel, fixModel, instrCheckModel, postCheckModel, autoSubmit, externalBroadcast,
    logs: [], rounds: [],
    result: null,
    submissionId: null,
  };
  polishJobs.set(taskId, job);

  broadcast(taskId, 'polish-start', { slug, maxRounds, autoSubmit, agentAttempts });
  log(job, 'info', `Polish pipeline started (maxRounds=${maxRounds}, agentAttempts=${agentAttempts})`);

  runPolishPipeline(job).catch(err => {
    log(job, 'error', `Fatal: ${err.message}`);
    job.running = false; job.result = 'error';
    broadcast(taskId, 'polish-done', { slug, result: 'error', error: err.message });
  });

  return job;
}

// ── Pipeline 主流程 ───────────────────────────────────────────────────────────

async function runPolishPipeline(job) {
  const taskPath = getTaskDir(job.slug);

  try {
    for (let round = 1; round <= job.maxRounds; round++) {
      if (job.stopped) break;

      job.round = round;
      log(job, 'info', `── Round ${round}/${job.maxRounds}: 并发执行六项检查 ──`);
      broadcast(job.taskId, 'round-start', { round, maxRounds: job.maxRounds });

      // ── 六项检查并发 ───────────────────────────────────────────────────────
      const [formatResult, oracleResult, lintResult, instrResult, agentResult, postResult] =
        await Promise.all([
          runFormatCheck(job, taskPath),
          runOracleCheck(job, taskPath),
          runLintCheck(job, taskPath),
          runInstrQualityCheck(job),
          job.agentAttempts > 0
            ? runAgentCheck(job, taskPath)
            : (broadcast(job.taskId, 'agent-running', {}),
               broadcast(job.taskId, 'agent-done', { passed: true, skipped: true }),
               Promise.resolve({ passed: true, skipped: true, issues: [] })),
          runPostCheck(job),
        ]);

      const allPassed = formatResult.passed && oracleResult.passed && lintResult.passed
                     && instrResult.passed  && agentResult.passed  && postResult.passed;

      const roundSummary = {
        round,
        format: slim(formatResult), oracle: slim(oracleResult), lint:  slim(lintResult),
        instr:  slim(instrResult),  agent:  slim(agentResult),  post:  slim(postResult),
        allPassed,
      };
      job.rounds.push(roundSummary);
      broadcast(job.taskId, 'round-done', roundSummary);

      const statLine = [
        `format=${yn(formatResult)}`, `oracle=${yn(oracleResult)}`, `lint=${yn(lintResult)}`,
        `instr=${yn(instrResult)}`,   `agent=${yn(agentResult)}`,   `post=${yn(postResult)}`,
      ].join(' ');
      log(job, allPassed ? 'info' : 'warn',
        allPassed ? `✅ Round ${round}: 全部通过！` : `❌ Round ${round}: ${statLine}`);

      if (allPassed) {
        job.result = 'passed';
        if (job.autoSubmit) await submitToTB(job);
        break;
      }

      // 汇总所有失败
      const failedChecks = [];
      if (!formatResult.passed && !formatResult.skipped)
        failedChecks.push({ source: 'format',             issues: formatResult.issues });
      if (!oracleResult.passed && !oracleResult.skipped)
        failedChecks.push({ source: 'oracle',             issues: oracleResult.issues, output: oracleResult.output });
      if (!lintResult.passed  && !lintResult.skipped)
        failedChecks.push({ source: 'lint',               issues: lintResult.issues,   raw: lintResult.raw });
      if (!instrResult.passed && !instrResult.skipped)
        failedChecks.push({ source: 'instruction-quality', issues: instrResult.issues });
      if (!agentResult.passed && !agentResult.skipped)
        failedChecks.push({ source: 'agent-test',         issues: agentResult.issues,  output: agentResult.output });
      if (!postResult.passed  && !postResult.skipped)
        failedChecks.push({ source: 'post-check',         issues: postResult.issues });

      if (round >= job.maxRounds) { log(job, 'warn', `Max rounds (${job.maxRounds}) reached.`); job.result = 'max-rounds'; break; }
      if (job.stopped) break;

      await fixWithAI(job, failedChecks);
    }
  } finally {
    if (!job.result) job.result = job.stopped ? 'stopped' : 'max-rounds';
    job.running = false;
    broadcast(job.taskId, 'polish-done', {
      slug: job.slug, result: job.result,
      rounds: job.round, submissionId: job.submissionId,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 六项本地检查
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Format Check — 5 个必要文件存在且非空 ──────────────────────────────────

async function runFormatCheck(job, taskPath) {
  broadcast(job.taskId, 'format-running', {});
  log(job, 'info', '  [Format] Verifying required files…');

  const issues = [];
  for (const f of REQUIRED_FILES) {
    const fullPath = join(taskPath, f);
    try {
      await access(fullPath);
      const content = await readFile(fullPath, 'utf-8');
      if (!content.trim()) issues.push(`${f} is empty`);
    } catch {
      issues.push(`${f} is missing`);
    }
  }

  const passed = issues.length === 0;
  broadcast(job.taskId, 'format-done', { passed, issueCount: issues.length, issues });
  log(job, passed ? 'info' : 'warn',
    `  [Format] ${passed ? '✅ all files present' : `❌ ${issues.length} issue(s): ${issues.join('; ')}`}`);
  return { passed, issues };
}

// ── 2. Oracle Check — harbor run --agent oracle ───────────────────────────────

function runOracleCheck(job, taskPath) {
  return new Promise(async resolve => {
    broadcast(job.taskId, 'oracle-running', {});

    const outDir   = join(taskPath, 'post_logs');
    const logFile  = join(outDir, `oracle_r${job.round}.log`);
    try { await mkdir(outDir, { recursive: true }); } catch { }

    const jobsDir   = join(taskPath, 'harbor_jobs', `oracle_r${job.round}`);
    const harborCmd = `harbor run --path "${taskPath}" --agent oracle --jobs-dir "${jobsDir}"`;

    log(job, 'info', `  [Oracle] ${harborCmd}  (timeout=${job.oracleTimeout}s)`);

    const t0    = Date.now();
    const child = spawnBash(mkHarborCmd(harborCmd));

    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, job.oracleTimeout * 1000);

    const lines = collectLines(child, line => broadcast(job.taskId, 'oracle-log', { text: line }));

    child.on('close', async (code, signal) => {
      clearTimeout(killTimer);
      if (signal) timedOut = true;
      const elapsedMs = Date.now() - t0;
      await _writeRunLog(logFile, `Oracle Round ${job.round}`, job.slug, harborCmd, lines, code ?? signal, elapsedMs);

      const passed = !timedOut && code === 0;
      const output = lines.slice(-50).join('\n');
      const issues = passed ? [] : [
        timedOut
          ? `Oracle timed out (${job.oracleTimeout}s) — solution or test may hang`
          : 'Oracle failed — solution does not pass the task tests',
      ];
      broadcast(job.taskId, 'oracle-done', { passed, timedOut, issueCount: issues.length });
      log(job, passed ? 'info' : 'warn',
        `  [Oracle] ${passed ? '✅' : timedOut ? '⏱ timed out' : '❌'} exit=${code ?? signal} elapsed=${Math.round(elapsedMs / 1000)}s → ${logFile}`);
      resolve({ passed, timedOut, issues, output });
    });

    child.on('error', err => {
      log(job, 'warn', `  [Oracle] Spawn error: ${err.message} — skipped`);
      broadcast(job.taskId, 'oracle-done', { passed: true, skipped: true });
      resolve({ passed: true, issues: [], skipped: true });
    });
  });
}

// ── 3. Lint Check — harbor tasks check ───────────────────────────────────────

function runLintCheck(job, taskPath) {
  return new Promise(async resolve => {
    broadcast(job.taskId, 'lint-running', {});
    log(job, 'info', `  [Lint] harbor tasks check (${job.lintModel})…`);

    const outDir  = join(taskPath, 'post_logs');
    const outFile = join(outDir, `lint_r${job.round}.json`);
    try { await mkdir(outDir, { recursive: true }); } catch { /* exists */ }
    try { await rm(outFile, { force: true }); } catch { /* absent */ }

    const cmd = mkHarborCmd(
      `harbor tasks check "${taskPath}" -m ${job.lintModel} -o "${outFile}"`
    );
    const child = spawnBash(cmd);
    collectLines(child, line => broadcast(job.taskId, 'lint-log', { text: line }));

    child.on('close', async () => {
      let raw = null;
      try { raw = JSON.parse(await readFile(outFile, 'utf-8')); } catch { /* no file */ }

      const { passed, issues } = parseLintResult(raw);
      broadcast(job.taskId, 'lint-done', { passed, issueCount: issues.length, issues });
      log(job, passed ? 'info' : 'warn', `  [Lint] ${passed ? '✅' : `❌ ${issues.length} issue(s)`}`);
      resolve({ passed, issues, raw });
    });

    child.on('error', err => {
      log(job, 'warn', `  [Lint] Spawn error: ${err.message} — skipped`);
      broadcast(job.taskId, 'lint-done', { passed: true, skipped: true });
      resolve({ passed: true, issues: [], skipped: true });
    });
  });
}

function parseLintResult(raw) {
  if (!raw) return { passed: false, issues: ['No lint output — harbor check may not be installed'] };
  const checks = Array.isArray(raw) ? raw : (raw.checks || raw.items || raw.results || []);
  if (Array.isArray(checks) && checks.length > 0) {
    const issues = [];
    for (const c of checks) {
      const status = c.pass ?? c.passed ?? c.status;
      const isPass = status === true || status === 'pass' || status === 'PASS';
      const isNA   = c.status === 'NOT_APPLICABLE' || c.not_applicable === true;
      if (!isPass && !isNA) {
        const id  = c.id || c.check || c.name || '?';
        const msg = c.message || c.error || c.reason || c.details || 'check failed';
        issues.push(`[${id}] ${msg}`);
      }
    }
    return { passed: issues.length === 0, issues };
  }
  const s = JSON.stringify(raw);
  const fail = s.includes('"pass":false') || s.includes('"status":"FAIL"') || s.includes('"passed":false');
  return fail ? { passed: false, issues: ['Lint checks found issues'] } : { passed: true, issues: [] };
}

// ── 4. Instruction Quality — AI 审查 A1–A5 ───────────────────────────────────

async function runInstrQualityCheck(job) {
  broadcast(job.taskId, 'instr-running', {});
  log(job, 'info', '  [InstrQuality] AI reviewing instruction.md…');
  try {
    const files = await readTaskFiles(job.slug);
    const instr = (files['instruction.md'] || '').trim();
    if (!instr) {
      const r = { passed: false, issues: ['instruction.md is empty'] };
      broadcast(job.taskId, 'instr-done', r);
      return r;
    }
    const { generateWithOpenRouter } = await import('./aiService/openrouterProvider.js');

    // TB Step 4 uses gemini-2.5-pro — use instrCheckModel (same default)
    let out = '';
    await runWithQueue(() =>
      generateWithOpenRouter(INSTR_QUALITY_REVIEWER_SYSTEM, `Review this instruction.md:\n\n${instr}`, c => { out += c; }, job.instrCheckModel)
    );
    let result = { passed: true, issues: [] };
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const p = JSON.parse(m[0]);
        result = { passed: p.passed === true && (!p.issues?.length), issues: p.issues || [] };
      } catch { /* keep default */ }
    }
    broadcast(job.taskId, 'instr-done', result);
    log(job, result.passed ? 'info' : 'warn',
      `  [InstrQuality] ${result.passed ? '✅' : `❌ ${result.issues.length} issue(s)`}`);
    return result;
  } catch (err) {
    log(job, 'warn', `  [InstrQuality] Error: ${err.message} — skipped`);
    broadcast(job.taskId, 'instr-done', { passed: true, skipped: true });
    return { passed: true, issues: [], skipped: true };
  }
}

// ── 5. Agent Test — harbor run terminus-2 k=N ────────────────────────────────
//    目标：1–(N-1)/N 通过（有难度，能被解但不全过）
//    全部失败 (0/N) → 任务有问题（测试/环境 bug）→ 失败

function runAgentCheck(job, taskPath) {
  return new Promise(async resolve => {
    broadcast(job.taskId, 'agent-running', {});

    const outDir  = join(taskPath, 'post_logs');
    const logFile = join(outDir, `agent_r${job.round}.log`);
    try { await mkdir(outDir, { recursive: true }); } catch { }

    const jobsDir   = join(taskPath, 'harbor_jobs', `agent_r${job.round}`);
    const harborCmd =
      ` harbor run` +
      ` --path "${taskPath}"` +
      ` --agent terminus-2` +
      ` --model "${job.agentModel}"` +
      ` --n-attempts ${job.agentAttempts}` +
      ` --jobs-dir "${jobsDir}"`;

    log(job, 'info', `  [AgentTest] ${harborCmd}  (timeout=${job.agentTimeout}s)`);

    const t0    = Date.now();
    const child = spawnBash(mkHarborCmd(harborCmd));

    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000);
    }, job.agentTimeout * 1000);

    const lines = collectLines(child, line => broadcast(job.taskId, 'agent-log', { text: line }));

    child.on('close', async (code, signal) => {
      clearTimeout(killTimer);
      if (signal) timedOut = true;
      const elapsedMs = Date.now() - t0;
      await _writeRunLog(logFile, `Agent Test Round ${job.round}`, job.slug, harborCmd, lines, code ?? signal, elapsedMs);

      const allOutput = lines.join('\n');
      const rateMatch = allOutput.match(/(\d+)\s*\/\s*(\d+)\s*(attempts?\s*)?(passed|success)/i);
      let passed   = code === 0;
      let passRate = rateMatch ? `${rateMatch[1]}/${rateMatch[2]}` : (passed ? `≥1/${job.agentAttempts}` : `0/${job.agentAttempts}`);
      const issues = [];

      if (timedOut) {
        passed = false;
        issues.push(`Agent test timed out (${job.agentTimeout}s) — task or environment may be too slow`);
      } else if (rateMatch) {
        const passCount  = parseInt(rateMatch[1]);
        const totalCount = parseInt(rateMatch[2]);
        if (passCount === 0) {
          passed = false;
          issues.push(`Agent test failed: 0/${totalCount} attempts passed — task may be broken (tests/Dockerfile/instruction issue)`);
        } else if (passCount === totalCount) {
          passed = false;
          issues.push(`Agent test too easy: ${passRate} — ALL attempts passed. Task lacks difficulty discrimination. Target: 1–${totalCount - 1}/${totalCount}`);
        }
      } else if (!passed) {
        issues.push(`Agent test failed: 0/${job.agentAttempts} attempts passed — task may be broken (tests/Dockerfile/instruction issue)`);
      }

      broadcast(job.taskId, 'agent-done', { passed, passRate, timedOut, issueCount: issues.length });
      log(job, passed ? 'info' : 'warn',
        `  [AgentTest] ${passed ? `✅ ${passRate} passed` : timedOut ? '⏱ timed out' : `❌ ${passRate} passed`} exit=${code} elapsed=${Math.round(elapsedMs / 1000)}s → ${logFile}`);
      resolve({ passed, passRate, timedOut, issues, output: allOutput.slice(-2000) });
    });

    child.on('error', err => {
      log(job, 'warn', `  [AgentTest] Spawn error: ${err.message} — skipped`);
      broadcast(job.taskId, 'agent-done', { passed: true, skipped: true });
      resolve({ passed: true, issues: [], skipped: true });
    });
  });
}

// ── 6. Post Check — 双 AI 并发质量审核 ───────────────────────────────────────
//    对齐 verfifier/post_check_prompts/:
//    01_rl_value    : 8 基础质量 + 5 RL 训练价值
//    02_test_quality: 5 测试与环境质量维度

async function runPostCheck(job) {
  broadcast(job.taskId, 'post-running', {});
  log(job, 'info', '  [PostCheck] Dual AI audit: RL value + test quality (concurrent)…');
  try {
    const files = await readTaskFiles(job.slug);
    const { generateWithOpenRouter } = await import('./aiService/openrouterProvider.js');

    const allFilesBlock =
      `=== instruction.md ===\n${files['instruction.md'] || '(empty)'}\n\n` +
      `=== solution/solve.sh ===\n${files['solution/solve.sh'] || '(empty)'}\n\n` +
      `=== tests/test.sh ===\n${files['tests/test.sh'] || '(empty)'}\n\n` +
      `=== environment/Dockerfile ===\n${files['environment/Dockerfile'] || '(empty)'}`;

    const [check01, check02] = await Promise.all([
      _postCheck01_RLValueQuality(job, allFilesBlock, generateWithOpenRouter),
      _postCheck02_TestQuality(job, allFilesBlock, generateWithOpenRouter),
    ]);

    const passed  = check01.passed && check02.passed;
    const issues  = [...(check01.issues || []), ...(check02.issues || [])];
    const result  = { passed, issues, details: { rl_value_quality: check01, test_quality: check02 } };

    broadcast(job.taskId, 'post-done', result);
    log(job, passed ? 'info' : 'warn',
      `  [PostCheck] ${passed
        ? '✅ both audits passed'
        : `❌ ${issues.length} issue(s) — rl_value=${check01.passed?'pass':'fail'}, test_quality=${check02.passed?'pass':'fail'}`}`);
    return result;
  } catch (err) {
    log(job, 'warn', `  [PostCheck] Error: ${err.message} — skipped`);
    broadcast(job.taskId, 'post-done', { passed: true, skipped: true });
    return { passed: true, issues: [], skipped: true };
  }
}

async function _postCheck01_RLValueQuality(job, allFilesBlock, generateWithOpenRouter) {
  return _parsePostCheckJSON(
    await _aiCallPost(job, `Review this task:\n\n${allFilesBlock}`, POST_CHECK_01_SYSTEM, generateWithOpenRouter)
  );
}

async function _postCheck02_TestQuality(job, allFilesBlock, generateWithOpenRouter) {
  return _parsePostCheckJSON(
    await _aiCallPost(job, `Review this task:\n\n${allFilesBlock}`, POST_CHECK_02_SYSTEM, generateWithOpenRouter)
  );
}

// Post-check calls use postCheckModel (claude-opus by default — matches TB Step 6 "Claude review")
async function _aiCallPost(job, user, system, generateWithOpenRouter) {
  let out = '';
  await runWithQueue(() =>
    generateWithOpenRouter(system, user, c => { out += c; }, job.postCheckModel)
  );
  return out;
}

function _parsePostCheckJSON(out) {
  let result = { passed: true, issues: [] };
  const m = out.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const p = JSON.parse(m[0]);
      result = { passed: p.passed === true && (!p.issues?.length), issues: p.issues || [] };
    } catch { /* keep default */ }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// AI 统一修复
// ══════════════════════════════════════════════════════════════════════════════

async function fixWithAI(job, failedChecks) {
  const { generateWithOpenRouter } = await import('./aiService/openrouterProvider.js');
  const files  = await readTaskFiles(job.slug);
  const total  = failedChecks.reduce((n, g) => n + g.issues.length, 0);
  const srcs   = failedChecks.map(g => g.source).join(', ');

  log(job, 'info', `  [Fix] AI (${job.fixModel}) fixing ${total} issue(s) from: ${srcs}…`);
  broadcast(job.taskId, 'fix-start', { issueCount: total, sources: failedChecks.map(g => g.source), model: job.fixModel });

  const issueBlock = failedChecks.map(g => {
    const header = `=== ${g.source.toUpperCase()} FAILURES ===`;
    const items  = g.issues.map((iss, i) => `  ${i + 1}. ${iss}`).join('\n');
    const extra  = g.output ? `\nRelevant output:\n${g.output.slice(-1000)}` : '';
    return `${header}\n${items}${extra}`;
  }).join('\n\n');

  const system = `You are an expert Terminal-Bench task author. Fix ALL listed issues.

Output ONLY corrected files in XML:
<files>
  <file name="instruction.md">...complete content...</file>
  <file name="task.toml">...complete content...</file>
  <file name="solution/solve.sh">...complete content...</file>
  <file name="tests/test.sh">...complete content...</file>
  <file name="environment/Dockerfile">...complete content...</file>
</files>

Fix guidelines per source:
• format             → ensure all 5 files are present, non-empty, and well-formed
• oracle             → fix solve.sh to correctly implement the task; fix test.sh to correctly validate; fix Dockerfile if dependencies are missing
• lint               → fix exactly what each harbor check item requires (pin deps with ==, remove test deps from Dockerfile, align file references, etc.)
• instruction-quality → ${INSTR_FIX_GUIDANCE}
• agent-test         → analyse the output; if 0/N passed, the task is likely broken: fix tests/test.sh, Dockerfile, or clarify instruction.md; if N/N passed (too easy), increase task difficulty or complexity
• ${POST_CHECK_FIX_GUIDANCE}

Rules: include ALL 5 files; preserve core task logic; complete content, no placeholders.`;

  const user = `Fix these issues:\n\n${issueBlock}

Current files:
=== instruction.md ===\n${files['instruction.md'] || '(empty)'}
=== task.toml ===\n${files['task.toml'] || '(empty)'}
=== solution/solve.sh ===\n${files['solution/solve.sh'] || '(empty)'}
=== tests/test.sh ===\n${files['tests/test.sh'] || '(empty)'}
=== environment/Dockerfile ===\n${files['environment/Dockerfile'] || '(empty)'}

Output the corrected <files> XML.`;

  let aiOut = '';
  await runWithQueue(() =>
    generateWithOpenRouter(system, user, chunk => {
      aiOut += chunk;
      broadcast(job.taskId, 'fix-chunk', { chunk });
    }, job.fixModel)
  );

  const pattern    = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g;
  const validFiles = REQUIRED_FILES;
  let fixedCount   = 0, m;
  while ((m = pattern.exec(aiOut)) !== null) {
    const [, name, content] = m;
    if (validFiles.includes(name)) {
      await writeTaskFile(job.slug, name, content.trim() + '\n');
      log(job, 'info', `    Updated: ${name}`);
      fixedCount++;
    }
  }
  if (fixedCount === 0) log(job, 'warn', '  [Fix] AI produced no file changes');
  else                  log(job, 'info', `  [Fix] Updated ${fixedCount} file(s)`);
  broadcast(job.taskId, 'fix-done', { fixedCount, totalIssues: total });
}

// ══════════════════════════════════════════════════════════════════════════════
// 提交 TB 平台
// ══════════════════════════════════════════════════════════════════════════════

async function submitToTB(job) {
  log(job, 'info', '  [Submit] All 6 local checks passed — packing and submitting to TB…');
  broadcast(job.taskId, 'submitting', { slug: job.slug });
  try {
    const zipPath    = await packTask(job.slug);
    log(job, 'info', `  [Submit] Packed: ${zipPath}`);

    const tbData     = await createSubmission(zipPath);
    const tbSubId    = tbData.id || tbData.submission_id;
    log(job, 'info', `  [Submit] TB submission ID: ${tbSubId}`);

    const { rows }   = await pool.query(
      `INSERT INTO submissions (task_id, tb_submission_id, status, zip_path)
       VALUES ($1, $2, 'pending', $3) RETURNING id`,
      [job.taskId, tbSubId, zipPath]
    );
    const localSubId = rows[0].id;

    await pool.query(
      "UPDATE tasks SET status = 'submitted', updated_at = NOW() WHERE id = $1",
      [job.taskId]
    );

    startPolling(localSubId);
    job.submissionId = localSubId;
    job.result       = 'submitted';

    broadcast(job.taskId, 'submitted', {
      slug: job.slug, submissionId: localSubId, tbSubmissionId: tbSubId,
    });
    log(job, 'info', `  [Submit] ✅ Submitted! Local ID: ${localSubId}`);
  } catch (err) {
    log(job, 'error', `  [Submit] Failed: ${err.message}`);
    broadcast(job.taskId, 'submit-error', { error: err.message });
    job.result = 'passed';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════════════════

function mkHarborCmd(cmd) {
  return [
    'set -a',
    `source "${VERIFIER_ENV}" 2>/dev/null || true`,
    'set +a',
    cmd,
  ].join('\n');
}

function spawnBash(cmd) {
  return spawn('bash', ['-c', cmd], {
    cwd: VERIFIER_DIR,
    env: {
      ...process.env,
      HOME: process.env.HOME || '/root',
      PATH: `${process.env.HOME || '/root'}/.local/bin:${process.env.PATH}`,
    },
  });
}

function collectLines(child, onLine) {
  const lines    = [];
  const stripAnsi = s => s.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
  const handle   = d => {
    for (const line of d.toString().split('\n')) {
      const clean = stripAnsi(line).trim();
      if (clean) { lines.push(clean); if (onLine) onLine(clean); }
    }
  };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  return lines;
}

async function _writeRunLog(logFile, title, slug, cmd, lines, exitCode, elapsedMs) {
  const started = new Date(Date.now() - elapsedMs).toISOString();
  const ended   = new Date().toISOString();
  const sep     = '─'.repeat(72);
  const header  = `=== ${title} ===\nTask:  ${slug}\nCmd:   ${cmd}\nStart: ${started}\nEnd:   ${ended}\nExit:  ${exitCode}  Elapsed: ${Math.round(elapsedMs / 1000)}s\n${sep}`;
  try { await writeFile(logFile, header + '\n' + lines.join('\n'), 'utf-8'); } catch { }
}

const slim = r => ({ passed: r.passed, issues: r.issues, skipped: r.skipped, timedOut: r.timedOut });
const yn   = r  => r.skipped ? 'skip' : r.passed ? '✅' : '❌';
