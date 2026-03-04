import pool from '../../db/client.js';

// ── Debug logging ─────────────────────────────────────────────────────────────
// 调试阶段打印模型交互日志；后续关闭：在 server/.env 中设置 AI_LOG=0
const AI_LOG = process.env.AI_LOG !== '0';

function aiDebugLog(model, systemPrompt, userPrompt, response, elapsedMs) {
  if (!AI_LOG) return;
  const sep = '─'.repeat(72);
  const trunc = (s, n) => s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s;
  console.log(`\n┌${sep}┐`);
  console.log(`│ [AI] model=${model}  elapsed=${elapsedMs}ms`);
  console.log(`├${sep}┤`);
  console.log(`│ SYSTEM (${systemPrompt.length} chars):`);
  console.log(`│ ${trunc(systemPrompt.replace(/\n/g, '\n│ '), 400)}`);
  console.log(`├${sep}┤`);
  console.log(`│ USER (${userPrompt.length} chars):`);
  console.log(`│ ${trunc(userPrompt.replace(/\n/g, '\n│ '), 300)}`);
  console.log(`├${sep}┤`);
  console.log(`│ RESPONSE (${response.length} chars):`);
  console.log(`│ ${trunc(response.replace(/\n/g, '\n│ '), 600)}`);
  console.log(`└${sep}┘\n`);
}

async function getApiKey() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'openrouter_api_key'");
  return result.rows[0]?.value || '';
}

async function getApiBase() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'openrouter_api_base'");
  const base = result.rows[0]?.value?.trim();
  return base ? base.replace(/\/+$/, '') : 'https://openrouter.ai/api/v1';
}

async function getModel() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'openrouter_model'");
  return result.rows[0]?.value || 'anthropic/claude-opus-4-6';
}

/**
 * Generate content using OpenRouter API.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {Function} onChunk - streaming callback
 * @param {string} [modelOverride] - override settings model
 */
export async function generateWithOpenRouter(systemPrompt, userPrompt, onChunk, modelOverride) {
  const [apiKey, model, apiBase] = await Promise.all([
    getApiKey(),
    modelOverride ? Promise.resolve(modelOverride) : getModel(),
    getApiBase(),
  ]);

  const isDefaultBase = apiBase === 'https://openrouter.ai/api/v1';
  if (!apiKey && isDefaultBase) {
    throw new Error('OpenRouter API key not configured');
  }

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://terminal-bench-station',
    'X-Title': 'Terminal-Bench Station',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${text}`);
  }

  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const t0 = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const json = JSON.parse(trimmed.slice(6));
        const chunk = json.choices?.[0]?.delta?.content || '';
        if (chunk) {
          fullText += chunk;
          if (onChunk) onChunk(chunk);
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  aiDebugLog(model, systemPrompt, userPrompt, fullText, Date.now() - t0);
  return fullText;
}
