// Checklists: a procedure as steps to tick, with the time of each tick kept.
//
// A checklist is made once -- from an answer, from lines highlighted in a
// manual, or typed -- and used again every time the job comes round. Each
// use is kept as a record of its own: when it started, when each step was
// ticked, when it finished. The steps keep the page they came from, so the
// procedure is one tap from its source while it is being worked through.

/**
 * Steps out of an answer's text: each numbered line is a step, and so is a
 * warning or caution, marked as one. The pages an answer cited against a
 * passage go with the steps written in that passage.
 */
export function stepsFromAnswer(blocks) {
  const steps = [];
  for (const block of blocks || []) {
    const cite = (block.cites || [])[0];
    let added = 0;
    for (const raw of String(block.text || '').split(/\n+/)) {
      const line = raw.trim().replace(/\*\*/g, '');
      if (!line) continue;
      const numbered = /^(?:\d{1,2}|[a-z])[.)]\s+(.+)$/i.exec(line) || /^[-•*]\s+(.+)$/.exec(line);
      const caution = /^(caution|warning|danger)\b/i.test(line);
      if (numbered) { steps.push({ text: numbered[1].trim(), cite }); added++; }
      else if (caution) { steps.push({ text: line, cite, caution: true }); added++; }
    }
    // A passage with no step of its own, cited: the rest of the step before
    // it, and the page is that step's.
    if (!added && cite !== undefined && steps.length && steps[steps.length - 1].cite === undefined) {
      steps[steps.length - 1].cite = cite;
    }
  }
  return steps;
}

/** Typed steps, one to a line, keeping the page of any step left unchanged. */
export function stepsFromLines(text, before = []) {
  const kept = new Map(before.map((s) => [s.text.trim().toLowerCase(), s]));
  return String(text || '').split(/\n+/)
    .map((l) => l.trim().replace(/^(?:\d{1,2}[.)]|[-•*])\s+/, ''))
    .filter(Boolean)
    .map((t) => {
      const was = kept.get(t.toLowerCase());
      return was ? { ...was, text: t } : { text: t, caution: /^(caution|warning|danger)\b/i.test(t) };
    });
}

const time = (iso) => (iso ? new Date(iso).toLocaleString([], {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
}) : '');

/** A finished (or unfinished) use of a checklist, as a plain record. */
export function runRecord(list, run) {
  const lines = [
    list.title,
    '='.repeat(Math.min(Math.max(list.title.length, 3), 80)),
    `Started: ${time(run.startedAt)}`,
    `Finished: ${run.finishedAt ? time(run.finishedAt) : 'not finished'}`,
    ''
  ];
  list.steps.forEach((step, i) => {
    const at = run.ticks?.[i];
    const where = step.ref ? ` (${step.ref.title}, page ${step.ref.page})` : '';
    lines.push(`${at ? '[x]' : '[ ]'} ${i + 1}. ${step.caution ? '! ' : ''}${step.text}${where}${at ? ` — ${time(at)}` : ''}`);
  });
  const done = list.steps.filter((_, i) => run.ticks?.[i]).length;
  lines.push('', `${done} of ${list.steps.length} steps ticked.`);
  if (run.note) lines.push('', `Note: ${run.note}`);
  return lines.join('\n');
}
