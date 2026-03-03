/**
 * StackOverflow scraper using the StackExchange API v2.3.
 * Docs: https://api.stackexchange.com/docs
 */

// Tags that indicate terminal/bash relevance
const TERMINAL_TAGS = new Set([
  'bash', 'shell', 'linux', 'unix', 'command-line', 'terminal',
  'awk', 'sed', 'grep', 'find', 'sh', 'zsh', 'ubuntu', 'debian',
  'scripting', 'cron', 'ssh', 'permissions', 'filesystem',
  'pipe', 'redirect', 'regex', 'curl', 'wget', 'tar', 'zip',
]);

/** Strip HTML tags and decode common HTML entities */
function stripHtml(html = '') {
  return html
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, '\n[code block omitted]\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

/** Convert a question title to a kebab-case slug */
export function titleToSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-+$/, '');
}

/** Make slug unique by appending a short suffix */
export async function uniqueSlug(baseSlug, pool) {
  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 100) {
    const result = await pool.query('SELECT id FROM tasks WHERE slug = $1', [slug]);
    if (result.rows.length === 0) return slug;
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }
  throw new Error(`Could not generate unique slug for: ${baseSlug}`);
}

/**
 * Fetch questions from the StackExchange API.
 *
 * When multiple tags are provided (semicolon or comma separated), they are
 * treated as a **union** (OR): one parallel API call is made per tag and
 * results are merged + deduplicated. This is necessary because the SO API
 * `tagged` parameter performs intersection (AND), which would return almost
 * nothing when many tags are supplied.
 *
 * @param {object} opts
 * @param {string} opts.tags       - semicolon-separated tags (union / OR semantics)
 * @param {string} opts.query      - free-text title search
 * @param {string} [opts.site]     - SE site (default: stackoverflow)
 * @param {string} [opts.apiKey]   - optional API key (higher quota)
 * @param {number} [opts.pagesize] - results per call per tag (max 100)
 * @param {number} [opts.page]     - page number
 * @param {string} [opts.sort]     - votes|activity|creation (default: votes)
 * @param {number} [opts.minScore] - minimum question score filter
 * @returns {Promise<{questions: object[], quota_remaining: number|null, has_more: boolean}>}
 */
export async function fetchSOQuestions(opts = {}) {
  const {
    tags = '',
    query,
    site = 'stackoverflow',
    apiKey,
    pagesize = 20,
    page = 1,
    sort = 'votes',
    minScore = 5,
  } = opts;

  // Split into individual tags — union mode
  const tagList = tags
    .split(/[;,]/)
    .map(t => t.trim())
    .filter(Boolean);

  if (tagList.length === 0) tagList.push('');   // no tag filter

  // Parallel fetch, one call per tag
  const results = await Promise.all(
    tagList.map(tag => _fetchSingleTag({ tag, query, site, apiKey, pagesize, page, sort, minScore }))
  );

  // Merge + deduplicate by question id, keep highest-score version
  const byId = new Map();
  let minQuota = Infinity;
  let hasMore = false;

  for (const r of results) {
    if (r.quota_remaining !== null) minQuota = Math.min(minQuota, r.quota_remaining);
    if (r.has_more) hasMore = true;
    for (const q of r.questions) {
      if (!byId.has(q.id) || q.score > byId.get(q.id).score) byId.set(q.id, q);
    }
  }

  const questions = [...byId.values()].sort((a, b) => b.score - a.score);

  return {
    questions,
    quota_remaining: minQuota === Infinity ? null : minQuota,
    has_more: hasMore,
  };
}

/** Single tag → one SO API page (internal helper). */
async function _fetchSingleTag({ tag, query, site, apiKey, pagesize, page, sort, minScore }) {
  const params = new URLSearchParams({
    order: 'desc',
    sort,
    site,
    filter: 'withbody',
    pagesize: String(Math.min(pagesize, 100)),
    page: String(page),
  });

  if (tag)   params.set('tagged', tag);
  if (query) params.set('intitle', query);
  if (apiKey) params.set('key', apiKey);

  const url = `https://api.stackexchange.com/2.3/questions?${params}`;
  const res = await fetch(url, { headers: { 'Accept-Encoding': 'gzip' } });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SO API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (data.error_id) throw new Error(`SO API error ${data.error_id}: ${data.error_message}`);

  const questions = (data.items || [])
    .filter(q => q.is_answered && !q.closed_date && q.score >= minScore)
    .map(q => ({
      id: q.question_id,
      title: q.title,
      body: stripHtml(q.body),
      tags: q.tags || [],
      score: q.score,
      answer_count: q.answer_count,
      link: q.link,
      isTerminal: q.tags?.some(t => TERMINAL_TAGS.has(t)) ?? false,
    }));

  return {
    questions,
    quota_remaining: data.quota_remaining ?? null,
    has_more: data.has_more ?? false,
  };
}

/**
 * Build a rich description string for AI generation context.
 */
export function buildSOContext(question) {
  return `StackOverflow Question (score: ${question.score}, answers: ${question.answer_count})
Tags: ${question.tags.join(', ')}
URL: ${question.link}

TITLE: ${question.title}

BODY:
${question.body.slice(0, 3000)}`;
}
