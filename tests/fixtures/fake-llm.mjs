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

export const fakeFetch = (views = {}) => async (url) => {
  const title = decodeURIComponent(url.split('/user/')[1].split('/')[0]);
  if (!(title in views)) return { status: 404, ok: false };
  return { status: 200, ok: true, json: async () => ({ items: [{ views: views[title] }] }) };
};
