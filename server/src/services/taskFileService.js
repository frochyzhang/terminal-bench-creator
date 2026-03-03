import { mkdir, readFile, writeFile, rm, access } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';

const TASK_FILES = [
  'instruction.md',
  'task.toml',
  'solution/solve.sh',
  'tests/test.sh',
  'environment/Dockerfile',
];

const FILE_TEMPLATES = {
  'instruction.md': `# Task Title

## Description

Describe the task clearly here.

## Requirements

- Requirement 1
- Requirement 2

## Expected Output

Describe what the correct output looks like.
`,
  'task.toml': `[task]
name = "task-slug"
description = "Brief task description"
category = "general"
difficulty = "Easy"

[timeout]
agent = 300
eval = 120
`,
  'solution/solve.sh': `#!/usr/bin/env bash
set -euo pipefail

# Solution implementation here
`,
  'tests/test.sh': `#!/usr/bin/env bash
set -euo pipefail

# Test implementation here
# Exit 0 = pass, non-zero = fail

echo "Tests passed"
`,
  'environment/Dockerfile': `FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \\
    bash \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
`,
};

export function getTaskDir(slug) {
  return join(config.tasksDir, slug);
}

export async function createTaskScaffold(slug) {
  const taskDir = getTaskDir(slug);
  await mkdir(taskDir, { recursive: true });
  await mkdir(join(taskDir, 'solution'), { recursive: true });
  await mkdir(join(taskDir, 'tests'), { recursive: true });
  await mkdir(join(taskDir, 'environment'), { recursive: true });

  for (const [filename, content] of Object.entries(FILE_TEMPLATES)) {
    const filePath = join(taskDir, filename);
    await writeFile(filePath, content, 'utf-8');
  }
}

export async function readTaskFiles(slug) {
  const taskDir = getTaskDir(slug);
  const result = {};

  for (const filename of TASK_FILES) {
    const filePath = join(taskDir, filename);
    try {
      result[filename] = await readFile(filePath, 'utf-8');
    } catch {
      result[filename] = '';
    }
  }

  return result;
}

export async function writeTaskFile(slug, filename, content) {
  if (!TASK_FILES.includes(filename)) {
    const err = new Error(`Invalid filename: ${filename}`);
    err.status = 400;
    throw err;
  }

  const taskDir = getTaskDir(slug);
  const filePath = join(taskDir, filename);

  // Ensure subdirectory exists
  const parts = filename.split('/');
  if (parts.length > 1) {
    await mkdir(join(taskDir, parts.slice(0, -1).join('/')), { recursive: true });
  }

  await writeFile(filePath, content, 'utf-8');
}

export async function deleteTaskDir(slug) {
  const taskDir = getTaskDir(slug);
  try {
    await rm(taskDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }
}

export async function taskDirExists(slug) {
  try {
    await access(getTaskDir(slug));
    return true;
  } catch {
    return false;
  }
}

export { TASK_FILES };
