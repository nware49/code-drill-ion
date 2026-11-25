// Rarity from Wikipedia pageviews: how often people look an answer up. Hand-ranked answers
// keep their tier; generated answers blend Claude's estimate with a pageview tier.
//
// Pageview tiers are relative to the prompt, not fixed view counts: tech articles rarely pass
// a million views a year (USB gets about 420,000), so fixed cutoffs pushed every answer of a
// prompt out of topsoil. Instead the most-viewed answers take the shallowest tiers Claude
// gave out: Claude decides how many answers sit in each tier, pageviews decide which ones.
const VIEWS_API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yyyymm = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const userAgentFor = (userAgent) => userAgent || process.env.WIKIMEDIA_USER_AGENT || 'code-drillion-bank-builder/1.0';

/** GET with retries on 429 and 5xx. Returns the response, or null when it kept failing. */
async function getWithRetry(url, { fetchImpl, userAgent }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchImpl(url, { headers: { 'user-agent': userAgentFor(userAgent) } });
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    return res;
  }
  return null;
}

/**
 * Total views over the last `months` full months, or null when there is no data (no such
 * article, or the request failed). The API counts only the exact title and does not follow
 * redirects, so resolve titles first (see resolveTitles).
 */
export async function fetchViews(title, { fetchImpl = fetch, months = 12, now = new Date(), userAgent } = {}) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  const url = `${VIEWS_API}/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${yyyymm(start)}0100/${yyyymm(end)}0100`;
  const res = await getWithRetry(url, { fetchImpl, userAgent });
  if (!res?.ok) return null;
  const body = await res.json();
  return (body.items ?? []).reduce((n, it) => n + (it.views ?? 0), 0);
}

/**
 * Maps each title to the title of the article it reaches after normalizing and following
 * redirects ("Universal Serial Bus" -> "USB"), or to null when there is no such article.
 * Titles the lookup could not check are left out of the map.
 */
export async function resolveTitles(titles, { fetchImpl = fetch, userAgent } = {}) {
  const resolved = new Map();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const url = `${WIKI_API}?action=query&format=json&formatversion=2&redirects=1&titles=${encodeURIComponent(batch.join('|'))}`;
    const res = await getWithRetry(url, { fetchImpl, userAgent });
    if (!res?.ok) continue;
    const { query = {} } = await res.json();
    const normalized = new Map((query.normalized ?? []).map((r) => [r.from, r.to]));
    const redirects = new Map((query.redirects ?? []).map((r) => [r.from, r.to]));
    const pages = new Map((query.pages ?? []).map((p) => [p.title, p]));
    for (const title of batch) {
      const name = normalized.get(title) ?? title;
      const target = redirects.get(name) ?? name;
      const page = pages.get(target);
      if (page) resolved.set(title, page.missing || page.invalid ? null : target);
    }
  }
  return resolved;
}

/**
 * Fill in `views` for answers that name a Wikipedia article, a few requests at a time.
 * Redirect titles are replaced by the article they point to, and titles with no article
 * are dropped. Returns counts for the log.
 */
export async function addViews(answers, { concurrency = 3, fetchImpl = fetch, userAgent, ...opts } = {}) {
  const todo = answers.filter((a) => a.wiki && a.views === undefined);
  const resolved = await resolveTitles(todo.map((a) => a.wiki), { fetchImpl, userAgent });
  const stats = { found: 0, redirected: 0, missing: 0, unchecked: 0 };
  const lookups = [];
  for (const a of todo) {
    if (!resolved.has(a.wiki)) { stats.unchecked++; lookups.push(a); continue; }
    const title = resolved.get(a.wiki);
    if (title === null) { stats.missing++; delete a.wiki; continue; }
    if (title !== a.wiki) { stats.redirected++; a.wiki = title; }
    lookups.push(a);
  }
  let next = 0;
  const worker = async () => {
    while (next < lookups.length) {
      const a = lookups[next++];
      const v = await fetchViews(a.wiki, { fetchImpl, userAgent, ...opts });
      if (v !== null) { a.views = v; stats.found++; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return stats;
}

/** The mean of two tiers. A tie between neighbours goes to Claude's tier, not always deeper. */
function blend(claude, views) {
  const mean = (claude + views) / 2;
  if (Number.isInteger(mean)) return mean;
  return claude < views ? Math.floor(mean) : Math.ceil(mean);
}

/**
 * Re-tier generated answers that have pageviews: rank them by views and give them, in that
 * order, the tiers Claude assigned them (shallowest first), then blend that with Claude's own
 * tier. Hand-ranked answers (no `src`) and answers without views are never changed.
 * Topsoil stays small: at most four answers, or as many as were hand-ranked there.
 */
export function retier(prompt) {
  const viewed = prompt.answers.filter((a) => a.src && typeof a.views === 'number');
  const claudeTiers = viewed.map((a) => a.t).sort((x, y) => x - y);
  const viewTier = new Map([...viewed].sort((a, b) => b.views - a.views).map((a, i) => [a, claudeTiers[i]]));

  let answers = prompt.answers.map((a) => (viewTier.has(a) ? { ...a, t: blend(a.t, viewTier.get(a)) } : a));
  // A prompt needs topsoil and the inner core. If blending emptied one that Claude filled,
  // move the generated answer closest to it there: by blended tier, then by views.
  for (const [tier, byViews] of [[0, (a, b) => (b.views ?? 0) - (a.views ?? 0)], [5, (a, b) => (a.views ?? 0) - (b.views ?? 0)]]) {
    if (answers.some((a) => a.t === tier) || !viewed.some((a) => a.t === tier)) continue;
    const pick = answers.filter((a) => a.src).sort((a, b) => Math.abs(a.t - tier) - Math.abs(b.t - tier) || byViews(a, b))[0];
    answers = answers.map((a) => (a === pick ? { ...a, t: tier } : a));
  }

  const curatedTop = answers.filter((a) => !a.src && a.t === 0).length;
  const room = Math.max(4, curatedTop) - curatedTop;
  const generatedTop = answers.filter((a) => a.src && a.t === 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const keepTop = new Set(generatedTop.slice(0, Math.max(0, room)).map((a) => a.n));
  return { ...prompt, answers: answers.map((a) => (a.src && a.t === 0 && !keepTop.has(a.n) ? { ...a, t: 1 } : a)) };
}
