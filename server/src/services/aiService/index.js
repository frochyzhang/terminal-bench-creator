import { generateWithPoe } from './poeProvider.js';
import { instructionSystemPrompt } from './prompts/instruction.js';
import { dockerfileSystemPrompt } from './prompts/dockerfile.js';
import { solveSystemPrompt } from './prompts/solve.js';
import { testSystemPrompt } from './prompts/test.js';
import { taskTomlSystemPrompt } from './prompts/taskToml.js';

const SYSTEM_PROMPTS = {
  'instruction.md': instructionSystemPrompt,
  'environment/Dockerfile': dockerfileSystemPrompt,
  'solution/solve.sh': solveSystemPrompt,
  'tests/test.sh': testSystemPrompt,
  'task.toml': taskTomlSystemPrompt,
};

/**
 * Generate a single task file using AI.
 * @param {string} filename - The file to generate
 * @param {string} taskDescription - User's task description
 * @param {object} existingFiles - Already-generated files for context
 * @param {Function} onChunk - Streaming callback
 * @param {string} [modelOverride] - force a specific Poe model (bypasses settings)
 */
export async function generateFile(filename, taskDescription, existingFiles = {}, onChunk, modelOverride) {
  const systemPrompt = SYSTEM_PROMPTS[filename];
  if (!systemPrompt) {
    throw new Error(`No AI prompt defined for file: ${filename}`);
  }

  const contextParts = [];
  if (taskDescription) {
    contextParts.push(`Task description: ${taskDescription}`);
  }

  // Add existing files as context
  const contextOrder = ['instruction.md', 'environment/Dockerfile', 'solution/solve.sh', 'tests/test.sh'];
  for (const ctxFile of contextOrder) {
    if (ctxFile !== filename && existingFiles[ctxFile]) {
      contextParts.push(`\n\n=== ${ctxFile} (already written) ===\n${existingFiles[ctxFile]}`);
    }
  }

  const userPrompt = contextParts.join('\n');

  return generateWithPoe(systemPrompt, userPrompt, onChunk, modelOverride);
}

/**
 * Generation order for "generate all" flow.
 */
export const GENERATION_ORDER = [
  'instruction.md',
  'environment/Dockerfile',
  'solution/solve.sh',
  'tests/test.sh',
  'task.toml',
];
