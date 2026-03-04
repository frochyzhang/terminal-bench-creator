import pool from '../../db/client.js';
import { logCurlRequest, logCurlResponse, logRawSseSample, logResponseMeta } from './aiLogger.js';

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

  const requestBody = {
    model,
    max_tokens: 4096,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  const url = `${apiBase}/chat/completions`;
  logCurlRequest(url, headers, requestBody);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${text}`);
  }

  const t0 = Date.now();
  const contentType = response.headers.get('content-type') || '';
  logResponseMeta(response.status, contentType);

  if (contentType.includes('application/json')) {
    const text = await response.text();
    logRawSseSample([text.slice(0, 200)]);
    try {
      const json = JSON.parse(text);
      const content = json.choices?.[0]?.message?.content
        ?? json.choices?.[0]?.delta?.content
        ?? '';
      if (onChunk && content) onChunk(content);
      logCurlResponse(model, Date.now() - t0, content);
      return content;
    } catch {
      throw new Error(`Non-streaming response from ${url}: ${text.slice(0, 200)}`);
    }
  }

  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawLogged = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    if (!rawLogged && lines.length > 0) {
      logRawSseSample(lines);
      rawLogged = true;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const chunk = json.choices?.[0]?.delta?.content
          ?? json.choices?.[0]?.message?.content
          ?? '';
        if (chunk) {
          fullText += chunk;
          if (onChunk) onChunk(chunk);
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  if (buffer.trim()) {
    logRawSseSample([`[unprocessed buffer] ${buffer.trim().slice(0, 160)}`]);
  }

  logCurlResponse(model, Date.now() - t0, fullText);
  return fullText;
}
