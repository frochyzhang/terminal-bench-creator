import Anthropic from '@anthropic-ai/sdk';
import pool from '../../db/client.js';

async function getApiKey() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'anthropic_api_key'");
  return result.rows[0]?.value || '';
}

async function getModel() {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'anthropic_model'");
  return result.rows[0]?.value || 'claude-opus-4-6';
}

/**
 * Generate content using Anthropic API.
 * Streams response chunks via callback.
 */
export async function generateWithAnthropic(systemPrompt, userPrompt, onChunk) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  const model = await getModel();
  const client = new Anthropic({ apiKey });

  let fullText = '';

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const chunk = event.delta.text;
      fullText += chunk;
      if (onChunk) onChunk(chunk);
    }
  }

  return fullText;
}
