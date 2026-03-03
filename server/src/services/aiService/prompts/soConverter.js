/**
 * System prompts for converting a StackOverflow question into Terminal-Bench task files.
 * Uses the official Terminal-Bench quality rules and 12-domain taxonomy.
 */
import { ALL_QUALITY_RULES } from './qualityRules.js';

// ── Terminal-Bench domain taxonomy ──────────────────────────────────────────
// Used in the TOML prompt for domain classification.
const TB_DOMAINS = `
D1  system-infrastructure   — 虚拟化与容器, 服务部署与配置, 构建系统
D2  language-runtime        — 解释器与虚拟机, 语言迁移与兼容, 并发与异步
D3  algorithm-math          — 密码学与安全算法, 数值优化与矩阵计算, 组合优化
D4  machine-learning        — 模型训练与调优, 推理优化, ML系统工程
D5  data-engineering        — 数据提取与清洗, 查询与检索, 数据分片与存储
D6  computational-biology   — DNA与蛋白质设计, 统计建模
D7  security-reverse        — 漏洞发现与利用, 数据恢复与取证
D8  file-encoding           — 二进制分析, 文本处理, 格式转换
D9  debugging-repair        — 崩溃分析, 代码修复
D10 graphics-multimedia     — 图像处理, 视频分析
D11 creative-programming    — Code Golf, Polyglot编程
D12 formal-verification     — 定理证明
`.trim();

// ── Workload taxonomy (for task.toml workload field) ────────────────────────
const TB_WORKLOADS = `
W1  greenfield-impl    — Implement from scratch
W2  bug-fixing         — Fix broken code/config
W3  perf-optimization  — Improve speed or resource usage
W4  refactoring        — Restructure without behavior change
W5  integration        — Wire together systems/APIs
W6  configuration      — Tune system/app settings
W7  deployment         — Package, launch, orchestrate
W8  testing            — Write or run tests
W9  data-analysis      — Process, transform, query data
W10 security-audit     — Find vulnerabilities, harden system
W11 migration          — Port across versions/platforms
W12 format-conversion  — Transform file formats/encodings
`.trim();

// ── Prompts ──────────────────────────────────────────────────────────────────

export const soInstructionPrompt = `You are an expert Terminal-Bench task author.
You receive a StackOverflow question about Linux/bash/terminal/shell/programming.
Convert it into a production-quality instruction.md for a Terminal-Bench task.

# Conversion principle
Transform the Q&A into a CONCRETE TASK: specific environment setup + measurable outcome.
"How to do X?" → "Do X on this prepared environment (files, services, data already provided)."

# Mandatory quality rules — ALL enforced; task rejected on any violation

${ALL_QUALITY_RULES}

# Structure (follow exactly)

# <Concrete Task Title — imperative phrase, ≤ 8 words>

## Background
1–2 sentences: why this is a real engineering task (not "in this exercise…").

## Environment
What is already set up: files at exact absolute paths, running services,
pre-installed tools with exact versions.

## Requirements
Numbered or bulleted list.  Each item must be specific and testable.
Include exact file/directory paths and expected output format.

## Expected Output
What must exist or happen after successful completion.
Exact file paths, values, or observable state changes.

# Output contract
Output ONLY the instruction.md content — no markdown fences, no preamble, no explanation.

# BEFORE outputting — verify every item:
☐ First word(s) are NOT "You are a/an" — if so, rewrite to an imperative verb
☐ First word(s) are NOT "Hello/Hi/In this task/Let's/We will" — rewrite if so
☐ NONE of these words appear anywhere: homework, exercise, learn, tutorial,
  course, experiment, lab, assignment, practice, haha, good luck, try it out,
  please help, sorry to bother, probably, maybe, perhaps, try to,
  approximately, basically, kind of, sort of, let's, through this exercise
☐ All file paths are absolute (start with /)
☐ All third-party libraries have exact version numbers
☐ Entire text is in English`;


export const soDockerfilePrompt = `You are an expert at writing Dockerfiles for Terminal-Bench tasks.
You receive a StackOverflow question and the instruction.md already written.
Create a Dockerfile that sets up the EXACT environment described in the instruction.

# Mandatory rules
- Base image: ubuntu:22.04 or debian:bookworm-slim (match the task needs)
- ENV DEBIAN_FRONTEND=noninteractive
- NEVER COPY solution/ or ADD solution/ — agents must not access solution files
- NEVER install test-only tools in the image (pytest, bats, mocha, jest, etc.)
- Pin ALL third-party package versions: pip install foo==1.2.3 (system apt packages may be unpinned)
- Create ALL files/directories mentioned in instruction.md with realistic data
- Use RUN echo/printf/cat heredoc to populate files — make data non-trivial
- WORKDIR /app

Output ONLY the Dockerfile content, no markdown fences.`;


export const soSolvePrompt = `You are an expert bash programmer. You receive a StackOverflow question and the task files already written.
Write solve.sh that ACTUALLY solves the task described in instruction.md.

# Rules
- Shebang: #!/usr/bin/env bash
- set -euo pipefail
- Do NOT hardcode answers or copy pre-made answer files
- Do NOT do: cp /somewhere/answer.py /app/answer.py — that counts as hardcoded solution
- Use the exact tools from the SO question/answers; work with files from instruction.md / Dockerfile
- Show the actual problem-solving logic: write code inline using cat << 'EOF', or use commands to produce the result
- The solution must be idiomatic, correct, and non-trivial

Output ONLY the solve.sh content, no markdown fences.`;


export const soTestPrompt = `You are an expert at writing test scripts for Terminal-Bench tasks.
You receive a StackOverflow question and the task files already written.
Write test.sh that VERIFIES the task was completed correctly.

# Rules
- Shebang: #!/usr/bin/env bash
- set -euo pipefail
- Exit 0 = pass, non-zero = fail
- Test the RESULT (files created, state changed, output produced) — NOT the method used
- NEVER call docker, NEVER reference solution/ in any path
- NEVER use test frameworks — pure bash only (no pytest, bats, etc.)
- Install test utilities at the START of test.sh if needed: pip install pyyaml==6.0.1 etc.
- Tests must be anti-cheat: do NOT rely on data that could be simply copied from a sample file
- Print clear PASS/FAIL messages for each check
- Cover the core logic (not just "file exists" checks)

Output ONLY the test.sh content, no markdown fences.`;


export const soTomlPrompt = `You are a Terminal-Bench task metadata specialist.
Write a task.toml for a Terminal-Bench task derived from a StackOverflow question.
You have access to the instruction.md already written.

# Required format
\`\`\`
[task]
name        = "<kebab-case-slug>"
description = "<one concrete sentence — what the task does, not how>"
domain      = "<see domain list below>"
workload    = "<see workload list below>"
difficulty  = "<Easy|Medium|Hard>"

[timeout]
agent = <seconds: Easy=180, Medium=360, Hard=600>
eval  = <seconds: 60-120>
\`\`\`

# Domain taxonomy (pick ONE that best fits)
${TB_DOMAINS}

# Workload taxonomy (pick ONE primary workload)
${TB_WORKLOADS}

# Difficulty guidelines
- Easy:   Standard tool usage, clear steps, <5 min for expert. Rare — use sparingly.
- Medium: Requires combining multiple tools/techniques, non-trivial logic.  ← Most tasks
- Hard:   Deep domain knowledge, complex algorithms, or multi-step debugging.

# Difficulty distribution target: Easy 5% / Medium 65% / Hard 30%

Output ONLY the task.toml content, no markdown fences.`;
