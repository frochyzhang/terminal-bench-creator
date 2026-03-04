const AI_LOG = process.env.AI_LOG !== '0';

function maskKey(val) {
  if (!val || val.length <= 8) return val;
  return val.slice(0, 4) + '...' + val.slice(-4);
}

function maskHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => {
      const lower = k.toLowerCase();
      if (lower === 'authorization') {
        const bearer = v.startsWith('Bearer ') ? 'Bearer ' + maskKey(v.slice(7)) : maskKey(v);
        return [k, bearer];
      }
      if (lower === 'x-api-key') return [k, maskKey(v)];
      return [k, v];
    })
  );
}

function truncateStr(s, n) {
  if (typeof s !== 'string') return s;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s;
}

function truncateMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(m => ({
    role: m.role,
    content: truncateStr(m.content, 300),
  }));
}

export function logCurlRequest(url, headers, body) {
  if (!AI_LOG) return;

  const safeHeaders = maskHeaders(headers);
  const headerArgs = Object.entries(safeHeaders)
    .map(([k, v]) => `-H '${k}: ${v}'`)
    .join(' \\\n     ');

  const loggableBody = {
    ...body,
    ...(body.system   ? { system:   truncateStr(body.system,   400) } : {}),
    ...(body.messages ? { messages: truncateMessages(body.messages)  } : {}),
  };

  const bodyJson = JSON.stringify(loggableBody, null, 2).replace(/'/g, "'\\''");

  console.log(`\n[AI] curl -X POST '${url}' \\\n     ${headerArgs} \\\n     -d '${bodyJson}'\n`);
}

export function logResponseMeta(status, contentType) {
  if (!AI_LOG) return;
  console.log(`[AI] response  status=${status}  content-type=${contentType}`);
}

export function logRawSseSample(lines) {
  if (!AI_LOG) return;
  const sample = lines.slice(0, 4);
  if (sample.length === 0) return;
  console.log(`[AI] raw SSE (first ${sample.length} lines):`);
  sample.forEach((l, i) => console.log(`  [${i}] ${l.slice(0, 160)}`));
}

export function logCurlResponse(model, elapsedMs, text) {
  if (!AI_LOG) return;
  if (!text) {
    console.warn(`[AI] WARNING: empty response — model=${model} elapsed=${elapsedMs}ms — SSE parse likely failed, check raw SSE above`);
    return;
  }
  console.log(`[AI] ← model=${model}  elapsed=${elapsedMs}ms  chars=${text.length}`);
  console.log(`     ${truncateStr(text.replace(/\n/g, '\\n'), 500)}\n`);
}
