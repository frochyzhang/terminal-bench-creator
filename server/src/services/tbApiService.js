import { readFileSync } from 'fs';
import { basename } from 'path';
import pool from '../db/client.js';

/**
 * Build a multipart/form-data Buffer with an exact Content-Length.
 * Avoids chunked transfer encoding that some servers reject.
 */
function buildMultipart(zipPath) {
  const fileBuffer = readFileSync(zipPath);
  const filename = basename(zipPath);
  const boundary = `----FormBoundary${Date.now().toString(16)}`;

  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/zip\r\n` +
    `\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBuffer, tail]);

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

const SENSITIVE_KEYS = new Set([
  'anthropic_api_key',
  'openrouter_api_key',
  'tb_password',
  'tb_jwt_token',
]);

async function getSetting(key) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value || '';
}

async function getSettings(...keys) {
  const result = await pool.query(
    'SELECT key, value FROM settings WHERE key = ANY($1)',
    [keys]
  );
  const map = {};
  for (const row of result.rows) {
    map[row.key] = row.value;
  }
  return map;
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
    [key, value]
  );
}

async function login(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TB login failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const token = data.token || data.access_token || data.jwt;
  if (!token) {
    throw new Error('TB login response did not contain a token');
  }

  // Store token with 23-hour expiry (refresh 5min before 24h)
  const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  await setSetting('tb_jwt_token', token);
  await setSetting('tb_jwt_expires_at', expiresAt);

  return token;
}

async function ensureToken() {
  const settings = await getSettings(
    'tb_base_url', 'tb_email', 'tb_password',
    'tb_jwt_token', 'tb_jwt_expires_at'
  );

  const { tb_base_url: baseUrl, tb_email: email, tb_password: password } = settings;
  let { tb_jwt_token: token, tb_jwt_expires_at: expiresAt } = settings;

  if (!baseUrl || !email || !password) {
    throw new Error('TB credentials not configured. Please set them in Settings.');
  }

  const isExpired = !token || !expiresAt || new Date(expiresAt) <= new Date(Date.now() + 5 * 60 * 1000);

  if (isExpired) {
    token = await login(baseUrl, email, password);
  }

  return { token, baseUrl };
}

async function postZip(url, token, zipPath) {
  const { body, contentType } = buildMultipart(zipPath);
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    body,
  });
}

export async function createSubmission(zipPath) {
  const { token, baseUrl } = await ensureToken();
  const url = `${baseUrl}/api/submissions`;

  let res = await postZip(url, token, zipPath);

  if (res.status === 401) {
    // Token expired mid-session — re-login once
    const settings = await getSettings('tb_base_url', 'tb_email', 'tb_password');
    const newToken = await login(settings.tb_base_url, settings.tb_email, settings.tb_password);
    res = await postZip(url, newToken, zipPath);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TB submission failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getSubmissionStatus(tbSubmissionId) {
  const { token, baseUrl } = await ensureToken();

  const res = await fetch(`${baseUrl}/api/submissions/${tbSubmissionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TB status check failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getSubmissionLogs(tbSubmissionId) {
  const { token, baseUrl } = await ensureToken();

  const res = await fetch(`${baseUrl}/api/submissions/${tbSubmissionId}/logs`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TB logs fetch failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function requestReview(tbSubmissionId) {
  const { token, baseUrl } = await ensureToken();

  const res = await fetch(`${baseUrl}/api/submissions/${tbSubmissionId}/review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TB review request failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function testConnection() {
  const settings = await getSettings('tb_base_url', 'tb_email', 'tb_password');
  const { tb_base_url: baseUrl, tb_email: email, tb_password: password } = settings;

  if (!baseUrl || !email || !password) {
    return { success: false, message: 'TB credentials not configured' };
  }

  try {
    await login(baseUrl, email, password);
    return { success: true, message: 'Connection successful' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
