// Approval rules for puzzle and bank pull requests. Pure: the CLI supplies GitHub data.
//
// A pull request carries a deadline in its body. Until then a trusted person can:
//   /approve        publish now (an approving review does the same)
//   /hold           stop auto-approval (any other comment or review does the same)
//   /release        resume auto-approval; the deadline restarts
//   /reroll         replace all six prompts (puzzles only); the deadline restarts
//   /swap N         replace prompt N (puzzles only); the deadline restarts
// With no feedback, the scheduled job merges it once the deadline passes.

export const LABELS = {
  puzzle: 'drill-puzzle',
  bank: 'drill-bank',
  auto: 'auto-approve',
  hold: 'hold',
};
export const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MARKER_RE = /<!-- auto-approve-at: (\S+) set-at: (\S+) -->/;

export function deadlineMarker(at, setAt) {
  return `<!-- auto-approve-at: ${new Date(at).toISOString()} set-at: ${new Date(setAt).toISOString()} -->`;
}

/** { at, setAt } from the PR body, falling back to creation time + hours. */
export function readDeadline(body, createdAt, hours) {
  const m = MARKER_RE.exec(body ?? '');
  if (m) return { at: new Date(m[1]), setAt: new Date(m[2]) };
  return { at: new Date(new Date(createdAt).getTime() + hours * 3600000), setAt: new Date(createdAt) };
}

export function withDeadline(body, at, setAt) {
  const marker = deadlineMarker(at, setAt);
  return MARKER_RE.test(body ?? '') ? body.replace(MARKER_RE, marker) : `${body ?? ''}\n\n${marker}`;
}

/** The command in a comment, if its first word is one. */
export function parseCommand(text) {
  const m = /^\s*\/(approve|hold|release|reroll|swap)\b\s*(\d+)?/i.exec(text ?? '');
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  if (cmd === 'swap') {
    const slot = Number(m[2]);
    return slot >= 1 && slot <= 6 ? { cmd, slot } : { cmd: 'invalid', reason: 'Use /swap followed by a prompt number from 1 to 6.' };
  }
  return { cmd };
}

const isHuman = (user) => user && user.type !== 'Bot' && !String(user.login).endsWith('[bot]');
export const isTrusted = (item) => isHuman(item.user) && TRUSTED.has(item.author_association);

/** Trusted feedback after `since` that isn't /approve, /release, /reroll or /swap. */
export function feedbackSince({ comments = [], reviews = [], since }) {
  const after = (d) => new Date(d) > since;
  const fromComments = comments.filter((c) => isTrusted(c) && after(c.created_at) && !['approve', 'release', 'reroll', 'swap'].includes(parseCommand(c.body)?.cmd));
  const fromReviews = reviews.filter((r) => isTrusted(r) && after(r.submitted_at) && r.state !== 'APPROVED' && r.state !== 'DISMISSED');
  return [...fromComments, ...fromReviews];
}

/**
 * What the scheduled job should do with one open pull request:
 *   { action: 'merge' | 'wait' | 'hold' | 'close', reason }
 * checks: 'ok' | 'pending' | 'failed'; puzzleDate: YYYY-MM-DD for puzzle PRs; today: YYYY-MM-DD (UTC).
 */
export function decideScheduled({ pr, comments, reviews, checks = 'ok', now, hours, today, puzzleDate = null, validationErrors = [] }) {
  const labels = new Set(pr.labels.map((l) => l.name ?? l));
  if (puzzleDate && puzzleDate < today) return { action: 'close', reason: `The puzzle date ${puzzleDate} has passed, so the site served its fallback puzzle that day.` };
  if (!labels.has(LABELS.auto)) return { action: 'wait', reason: 'auto-approval is off for this pull request' };
  if (labels.has(LABELS.hold)) return { action: 'wait', reason: 'on hold' };
  const { at, setAt } = readDeadline(pr.body, pr.created_at, hours);
  const feedback = feedbackSince({ comments, reviews, since: setAt });
  if (feedback.length) return { action: 'hold', reason: `feedback from @${feedback[0].user.login}` };
  if (now < at) return { action: 'wait', reason: `auto-approves at ${at.toISOString()}` };
  if (checks === 'pending') return { action: 'wait', reason: 'checks are still running' };
  if (checks === 'failed') return { action: 'hold', reason: 'a check failed' };
  if (validationErrors.length) return { action: 'hold', reason: `the puzzle file is invalid: ${validationErrors[0]}` };
  return { action: 'merge', reason: `no feedback for ${hours} hours` };
}

/** What to do about a new comment or review. Returns { action, ... } or null to ignore it. */
export function decideEvent({ kind, item, isPuzzle }) {
  if (!isTrusted(item)) return null;
  if (kind === 'review') {
    if (item.state === 'APPROVED') return { action: 'merge', reason: `approved by @${item.user.login}` };
    return { action: 'hold', reason: `review from @${item.user.login}` };
  }
  const command = parseCommand(item.body);
  if (!command) return { action: 'hold', reason: `comment from @${item.user.login}` };
  switch (command.cmd) {
    case 'approve': return { action: 'merge', reason: `/approve from @${item.user.login}` };
    case 'hold': return { action: 'hold', reason: `/hold from @${item.user.login}` };
    case 'release': return { action: 'release' };
    case 'reroll': return isPuzzle ? { action: 'rework', mode: 'reroll' } : { action: 'reply', text: '/reroll only works on puzzle pull requests.' };
    case 'swap': return isPuzzle ? { action: 'rework', mode: 'swap', slot: command.slot } : { action: 'reply', text: '/swap only works on puzzle pull requests.' };
    default: return { action: 'reply', text: command.reason };
  }
}
