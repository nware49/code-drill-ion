// One bank-growth run: new prompts, more answers for existing ones, verification,
// pageview tiers, validation. Only prompts that pass validation are written.
import { proposePrompts, expandPrompt, verifyAnswers, mergeAnswers } from './generate.mjs';
import { addViews, retier } from './pageviews.mjs';
import { validatePrompt } from './validate.mjs';
import { savePrompt } from './bank.mjs';

const tierCounts = (p) => [0, 1, 2, 3, 4, 5].map((t) => p.answers.filter((a) => a.t === t).length).join(' / ');

/**
 * options: { llm, bank, propose, expand, expandIds, answersPerNewPrompt, answersPerExpansion,
 *            verify, views, write, date, log, fetchImpl }
 * Returns { created, expanded, rejected, summary } where summary is Markdown for a pull request.
 */
export async function growBank(o) {
  const log = o.log ?? (() => {});
  const created = [];
  const expanded = [];
  const rejected = [];
  const finish = async (prompt) => {
    let p = prompt;
    if (o.views !== false) {
      const n = await addViews(p.answers.filter((a) => a.src), { fetchImpl: o.fetchImpl });
      log(`  pageviews found for ${n} answers`);
      p = retier(p);
    }
    return p;
  };

  if (o.propose > 0) {
    const proposals = await proposePrompts({ llm: o.llm, bank: o.bank, count: o.propose, date: o.date, answersPerPrompt: o.answersPerNewPrompt, log });
    for (const { prompt, fixes } of proposals) {
      let p = prompt;
      let dropped = [];
      if (o.verify !== false) {
        log(`Verifying ${p.answers.length} answers for "${p.q}"...`);
        const v = await verifyAnswers({ llm: o.llm, prompt: p, answers: p.answers });
        dropped = v.dropped;
        p = { ...p, answers: v.kept, traps: p.traps.filter((t) => v.kept.some((a) => a.n === t.answer)) };
      }
      p = await finish(p);
      const errors = validatePrompt(p);
      if (errors.length) { rejected.push({ q: p.q, errors }); continue; }
      if (o.write !== false) savePrompt(p);
      created.push({ prompt: p, fixes, dropped });
    }
  }

  const targets = o.expandIds?.length
    ? o.bank.filter((p) => o.expandIds.includes(p.id))
    : [...o.bank].sort((a, b) => a.answers.length - b.answers.length).slice(0, o.expand ?? 0);
  for (const target of targets) {
    log(`Expanding "${target.q}" (${target.answers.length} answers)...`);
    let additions = await expandPrompt({ llm: o.llm, prompt: target, add: o.answersPerExpansion });
    let dropped = [];
    if (o.verify !== false && additions.length) {
      const v = await verifyAnswers({ llm: o.llm, prompt: target, answers: additions });
      additions = v.kept;
      dropped = v.dropped;
    }
    const merged = mergeAnswers(target, additions);
    const p = await finish(merged.prompt);
    const errors = validatePrompt(p);
    if (errors.length) { rejected.push({ q: target.q, errors }); continue; }
    if (o.write !== false) savePrompt(p);
    expanded.push({ prompt: p, added: p.answers.length - target.answers.length, skipped: merged.skipped, dropped });
  }

  return { created, expanded, rejected, summary: summarize({ created, expanded, rejected }) };
}

export function summarize({ created, expanded, rejected }) {
  const out = [];
  const totalNew = created.reduce((n, c) => n + c.prompt.answers.length, 0) + expanded.reduce((n, e) => n + e.added, 0);
  out.push(`**${created.length} new prompts and ${totalNew} new answers.** Every answer was generated, then checked a second time by Claude; answers it couldn't confirm were dropped. Rarity tiers blend Claude's estimate with Wikipedia pageviews.`);
  if (created.length) {
    out.push('', '### New prompts', '', '| Prompt | Category | Answers | Tiers 0-5 | Root questions |', '|---|---|---|---|---|');
    for (const { prompt: p } of created) out.push(`| ${p.q} | ${p.cat} | ${p.answers.length} | ${tierCounts(p)} | ${p.traps.length} |`);
  }
  if (expanded.length) {
    out.push('', '### More answers for existing prompts', '', '| Prompt | Added | Now | Dropped by fact-check |', '|---|---|---|---|');
    for (const e of expanded) out.push(`| ${e.prompt.q} | +${e.added} | ${e.prompt.answers.length} | ${e.dropped.length} |`);
  }
  const drops = [...created, ...expanded].flatMap((x) => x.dropped.map((d) => `- ${x.prompt.q}: **${d.n}**, ${d.reason}`));
  if (drops.length) out.push('', '<details><summary>Answers dropped by the fact-check</summary>', '', ...drops.slice(0, 200), '', '</details>');
  if (rejected.length) {
    out.push('', '### Rejected', '', 'These failed validation and were not written:', '');
    for (const r of rejected) out.push(`- ${r.q}: ${r.errors.slice(0, 3).join('; ')}`);
  }
  return out.join('\n');
}
