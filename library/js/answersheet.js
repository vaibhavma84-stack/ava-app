/**
 * A SIRE answer is kept as one piece of text, so it reads, searches and backs
 * up like any other field:
 *
 *   ANSWER
 *   The overall answer.
 *
 *   EXPECTED EVIDENCE
 *   • The first thing the inspector looks for.
 *     → What answers it.
 *       More of what answers it.
 *   • The next thing.
 *     →
 *
 *   (Searched: the manuals read.)
 *
 * Written in, it is a box for the overall answer and a box under each point.
 * These turn one into the other, and back to exactly the same text when
 * nothing was changed.
 */

const ARROW = '  → ';
const MORE = '    ';
const TAIL = /\n*(\(Searched:[^\n]*\))\s*$/;

export function parseSheet(text) {
  let rest = String(text || '');
  let tail = '';
  const t = rest.match(TAIL);
  if (t) { tail = t[1]; rest = rest.slice(0, t.index); }

  let summary = '';
  let hasSummary = false;
  if (/^ANSWER\n/.test(rest)) {
    hasSummary = true;
    rest = rest.slice('ANSWER\n'.length);
    const cut = rest.indexOf('\n\nEXPECTED EVIDENCE\n');
    if (cut >= 0) {
      summary = rest.slice(0, cut);
      rest = rest.slice(cut + '\n\nEXPECTED EVIDENCE\n'.length);
    } else {
      summary = rest;
      rest = '';
    }
  }

  const lines = rest ? rest.split('\n') : [];
  const first = lines.findIndex((l) => l.startsWith('•'));
  // Written freely, with no points to answer: one box, kept as it was.
  if (first < 0) {
    return { summary: hasSummary ? summary : rest, points: [], tail, free: !hasSummary && !!rest };
  }
  const before = lines.slice(0, first).join('\n');
  const points = [];
  for (const line of lines.slice(first)) {
    if (line.startsWith('•')) { points.push({ point: line, lines: [] }); continue; }
    points.at(-1).lines.push(line);
  }
  for (const p of points) {
    const [head = '', ...more] = p.lines;
    const answer = [head.startsWith(ARROW.trimEnd()) ? head.slice(ARROW.trimEnd().length).replace(/^ /, '') : head.replace(/^\s+/, ''),
      ...more.map((l) => (l.startsWith(MORE) ? l.slice(MORE.length) : l))];
    p.answer = answer.join('\n');
    delete p.lines;
  }
  return { summary: hasSummary ? summary : before, points, tail, free: false };
}

export function buildSheet({ summary = '', points = [], tail = '', free = false }) {
  if (free && !points.length) return [summary, tail].filter(Boolean).join('\n\n');
  const parts = [];
  const said = summary.trim() ? summary.replace(/\s+$/, '') : '';
  const evidence = points.map((p) => `${p.point}\n${ARROW}${String(p.answer || '').split('\n').join(`\n${MORE}`)}`).join('\n');
  if (said) parts.push(`ANSWER\n${said}${evidence ? `\n\nEXPECTED EVIDENCE\n${evidence}` : ''}`);
  else if (evidence) parts.push(evidence);
  if (tail) parts.push(tail);
  return parts.join('\n\n');
}
