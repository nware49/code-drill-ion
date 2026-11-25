#!/usr/bin/env node
// Grow the answer bank with Claude.
//   node scripts/grow-bank.mjs                        defaults from drill.config.json
//   node scripts/grow-bank.mjs --propose 3 --expand 0 three new prompts only
//   node scripts/grow-bank.mjs --expand-ids sorting,git --add 80
//   options: --no-verify  --no-views  --summary out.md  --body pr.md  --dry-run (nothing written)
// Needs Claude credentials: ANTHROPIC_API_KEY locally, Workload Identity Federation in GitHub Actions.
import { writeFileSync, appendFileSync } from 'node:fs';
import { loadBank, isLive } from './lib/bank.mjs';
import { loadConfig, parseArgs } from './lib/config.mjs';
import { createClaude } from './lib/claude.mjs';
import { growBank } from './lib/grow.mjs';
import { deadlineMarker } from './lib/review.mjs';

const args = parseArgs();
const config = loadConfig();
const num = (v, d) => (v === undefined ? d : Number(v));

const llm = await createClaude({ model: config.model, effort: config.effort });
try {
  const result = await growBank({
    llm,
    bank: loadBank().filter(isLive),
    propose: num(args.propose, config.growth.proposePrompts),
    expand: num(args.expand, config.growth.expandPrompts),
    expandIds: args['expand-ids'] ? String(args['expand-ids']).split(',') : null,
    answersPerNewPrompt: num(args.answers, config.growth.answersPerNewPrompt),
    answersPerExpansion: num(args.add, config.growth.answersPerExpansion),
    verify: !args['no-verify'],
    views: !args['no-views'],
    write: !args['dry-run'],
    date: new Date().toISOString().slice(0, 10),
    log: (m) => console.log(m),
  });

  console.log(`\n${result.summary}`);
  if (args.summary) writeFileSync(args.summary, `${result.summary}\n`);
  const changed = result.created.length + result.expanded.length > 0;
  if (args.body) {
    const now = new Date();
    const auto = config.growth.autoApprove;
    const at = new Date(now.getTime() + config.approvalHours * 3600000);
    writeFileSync(args.body, [
      '## Bank growth', '', result.summary, '',
      auto ? `**Auto-approves ${at.toUTCString().replace(' GMT', ' UTC')}** if nobody leaves feedback.` : 'Merge this pull request to add these to the bank.',
      '', 'Comment `/approve` to merge now, `/hold` to pause auto-approval (any other comment or review also pauses it), or `/release` to restart the window. You can edit any file in `bank/prompts/` on this branch first.',
      '', deadlineMarker(at, now), '',
    ].join('\n'));
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nauto_approve=${config.growth.autoApprove}\n`);
} finally {
  await llm.shutdown();
}
