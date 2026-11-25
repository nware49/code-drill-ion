// A stand-in for Claude in tests: returns canned, schema-shaped JSON and records calls.
export function fakeLLM({ invalid = [], badLore = [] } = {}) {
  const calls = [];
  const answer = (n, t, extra = {}) => ({ n, t, l: `${n} is a test answer with a true fact.`, alias: [], wiki: n.replace(/ /g, '_'), ...extra });
  return {
    calls,
    async json({ prompt, schema }) {
      calls.push(prompt);
      const keys = Object.keys(schema.properties);
      if (keys.includes('prompts')) {
        const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar'];
        return { data: { prompts: [{
          id: 'test-phonetic', cat: 'folklore', d: 2, q: 'Name a NATO phonetic alphabet word', hint: '', numeric: false, strip: [],
          answers: names.map((n, i) => answer(n, Math.min(5, Math.floor(i / 2.5)), i === 0 ? { alias: ['alfa', 'Bravo'] } : {})),
          nope: [{ typed: 'Zebra', reason: 'Not in the alphabet.' }, { typed: 'Alpha', reason: 'oops, a real answer' }],
          traps: [{ q: 'Name the word for A.', answer: 'Alpha', lore: 'Spelled Alfa officially.' }, { q: 'Name the word for O.', answer: 'Oscar', lore: '' }],
        }] } };
      }
      if (keys.includes('answers')) return { data: { answers: [answer('Papa', 3), answer('Quebec', 4), answer('Quicksort', 4), answer('Romeo', 5)] } };
      if (keys.includes('verdicts')) {
        const names = [...prompt.matchAll(/^\d+\. ([^:]+):/gm)].map((m) => m[1]);
        return { data: { verdicts: names.map((n) => ({ n, valid: !invalid.includes(n), lore_ok: !badLore.includes(n), fixed_lore: badLore.includes(n) ? `${n}, corrected.` : '', reason: invalid.includes(n) ? 'not a real member' : '' })) } };
      }
      throw new Error('unexpected schema');
    },
  };
}

// A stand-in for Wikipedia: pageviews per exact title (other titles 404), and a title lookup
// where every title is an article except those in `missing`, and `redirects` map one to another.
// `failLookup` makes the title lookup fail as if rate limited.
export const fakeFetch = (views = {}, { redirects = {}, missing = [], failLookup = false } = {}) => async (url) => {
  if (url.includes('/w/api.php')) {
    if (failLookup) return { status: 403, ok: false };
    const titles = new URL(url).searchParams.get('titles').split('|');
    const normalize = (t) => t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const normalized = titles.filter((t) => normalize(t) !== t).map((t) => ({ from: t, to: normalize(t) }));
    const names = titles.map(normalize);
    const redirected = names.filter((t) => t in redirects).map((t) => ({ from: t, to: redirects[t] }));
    const pages = [...new Set(names.map((t) => redirects[t] ?? t))].map((t) => (missing.includes(t) ? { title: t, missing: true } : { title: t, pageid: 1 }));
    return { status: 200, ok: true, json: async () => ({ query: { normalized, redirects: redirected, pages } }) };
  }
  const title = decodeURIComponent(url.split('/user/')[1].split('/')[0]).replace(/_/g, ' ');
  if (!(title in views)) return { status: 404, ok: false };
  return { status: 200, ok: true, json: async () => ({ items: [{ views: views[title] }] }) };
};
