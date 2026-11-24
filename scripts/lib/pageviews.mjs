// Rarity from Wikipedia pageviews: how often people look an answer up, as MedRare does
// for medicine. Hand-ranked answers keep their tier; generated answers blend Claude's
// estimate with the pageview tier.
const API = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user';

// Annual views at or above each threshold map to that tier; anything rarer is tier 5.
export const VIEW_THRESHOLDS = [
  [1000000, 0],
  [250000, 1],
  [60000, 2],
  [15000, 3],
  [3000, 4],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const yyyymm = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Total views over the last `months` full months, 0 if the article is missing, null on failure. */
export async function fetchViews(title, { fetchImpl = fetch, months = 12, now = new Date(), userAgent } = {}) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
  const url = `${API}/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${yyyymm(start)}0100/${yyyymm(end)}0100`;
  const headers = { 'user-agent': userAgent || process.env.WIKIMEDIA_USER_AGENT || 'code-drillion-bank-builder/1.0' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchImpl(url, { headers });
    if (res.status === 404) return 0;
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
    if (!res.ok) return null;
    const body = await res.json();
    return (body.items ?? []).reduce((n, it) => n + (it.views ?? 0), 0);
  }
  return null;
}

export function tierForViews(views) {
  for (const [min, tier] of VIEW_THRESHOLDS) if (views >= min) return tier;
  return 5;
}

/** Fill in `views` for answers that name a Wikipedia article, a few requests at a time. */
export async function addViews(answers, { concurrency = 3, ...opts } = {}) {
  const todo = answers.filter((a) => a.wiki && a.views === undefined);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const a = todo[next++];
      const v = await fetchViews(a.wiki, opts);
      if (v !== null) a.views = v;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return todo.filter((a) => a.views !== undefined).length;
}

/**
 * Re-tier generated answers: the rounded mean of Claude's tier and the pageview tier.
 * Hand-ranked answers (no `src`) are never changed. Topsoil stays small: at most four
 * answers, or as many as were hand-ranked there.
 */
export function retier(prompt) {
  const answers = prompt.answers.map((a) => {
    if (!a.src || typeof a.views !== 'number') return a;
    return { ...a, t: Math.round((a.t + tierForViews(a.views)) / 2) };
  });
  const curatedTop = answers.filter((a) => !a.src && a.t === 0).length;
  let room = Math.max(4, curatedTop) - curatedTop;
  const generatedTop = answers.filter((a) => a.src && a.t === 0).sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const keepTop = new Set(generatedTop.slice(0, Math.max(0, room)).map((a) => a.n));
  return { ...prompt, answers: answers.map((a) => (a.src && a.t === 0 && !keepTop.has(a.n) ? { ...a, t: 1 } : a)) };
}
