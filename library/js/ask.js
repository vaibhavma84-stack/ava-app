// Asking Claude, over the library's own pages.
//
// Everything else in Library works with no connection and sends nothing
// anywhere. This is the one exception, and it is off until an API key is put
// in: a question, and the handful of pages that best match it, go to
// Anthropic's API, and an answer comes back that cites each page it used.
//
// The pages are found here, on the phone, by the same search as everything
// else -- ranked by how many of the question's words they hold rather than
// needing all of them, since a question is a sentence and not a search. Claude
// is first asked for the words a manual would use for the question ("stripping"
// is also "residue", "eductor"), which is what the search alone cannot know.
// Only the chosen pages are sent, never a whole manual and never anything else.
//
// The answer is told to come from those pages and nothing else, and to say so
// when they do not hold it. For a setpoint or a procedure on a ship, "the
// manual does not say" is an answer; a figure from general knowledge is not.

import { compile, fold } from './search.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'most accurate', input: 4, output: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'about half the cost', input: 2, output: 10 }
];
export const DEFAULT_MODEL = MODELS[0].id;
export const modelInfo = (id) => MODELS.find((m) => m.id === id) || MODELS[0];

// How much goes with one question. Enough pages to hold a procedure that runs
// over several, few enough that a question costs cents.
const MAX_PAGES = 14;
const MAX_CHARS = 70000;

// Words that say nothing about which page answers a question.
const STOP = new Set(('a an and are as at be by can do does for from how i in is it me my of on or '
  + 'should the to what when where which who why will with you your we our this that there these those '
  + 'shall must need needs if then than into about after before during between give tell show find '
  + 'procedure procedures step steps manual manuals please explain describe list').split(' '));

/** The words of a question worth searching for. */
export function questionTerms(question) {
  return question.toLowerCase().replace(/[?!,;:()"“”]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

let sdk = null;
async function client(apiKey) {
  // Loaded only when a question is asked: a phone that never asks never
  // downloads it.
  sdk = sdk || (await import('../../vendor/anthropic-sdk.mjs')).default;
  // The key is the person's own, held on their own phone and sent only to
  // Anthropic. There is no server of ours to hide it behind -- that is the
  // point of the app -- which is what the SDK's browser flag is asking about.
  return { Anthropic: sdk, api: new sdk({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }) };
}

/**
 * The words a manual would use for this question. Returns [] rather than
 * failing: the question's own words still search.
 */
export async function searchWords(apiKey, model, question) {
  try {
    const { api } = await client(apiKey);
    const response = await api.messages.create({
      model,
      max_tokens: 2000,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { terms: { type: 'array', items: { type: 'string' } } },
            required: ['terms'],
            additionalProperties: false
          }
        }
      },
      system: 'You turn a ship officer\'s question into search terms for ship manuals, alarm lists and company procedures. '
        + 'Give 4 to 10 short terms: the words and abbreviations such documents actually use for this subject, '
        + 'including the names of the equipment and systems involved. Single words or two-word phrases. No explanation.',
      messages: [{ role: 'user', content: question }]
    });
    if (response.stop_reason === 'refusal') return [];
    const text = response.content.find((b) => b.type === 'text')?.text || '{}';
    const terms = JSON.parse(text).terms;
    return Array.isArray(terms) ? terms.map(String).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

/**
 * The pages that best answer a question, best first.
 *
 * Every page is scored by the terms it holds, each weighted by how rare it is
 * across the library -- "pump" on a page says little, "eductor" says a lot --
 * and a page holding several of them outranks one holding a single term many
 * times. Returns [{ item, att, page, text, score }].
 */
export function choosePages(question, extraTerms, items, texts, titleOf) {
  const words = [...questionTerms(question), ...extraTerms.map((t) => t.toLowerCase())];
  const groups = [];
  const seen = new Set();
  for (const w of words) {
    for (const g of compile(w)) {
      if (seen.has(g.label)) continue;
      seen.add(g.label);
      groups.push(g);
    }
  }
  if (!groups.length) return [];

  const pages = [];
  for (const item of items) {
    for (const att of item.data?.attachments || []) {
      const held = texts.get(att.id);
      if (!held) continue;
      const scan = (att.readTo || 0) > 0 || att.fromScan === true;
      for (const p of held) {
        const text = [p.text, p.pictures].filter(Boolean).join('\n');
        if (text.trim()) pages.push({ item, att, page: p.page, text, scan, lower: text.toLowerCase() });
      }
    }
  }
  if (!pages.length) return [];

  // Built once, not once a page: a library is thousands of pages.
  const res = groups.map((g) => ({
    exact: new RegExp(g.exact, 'g'),
    both: g.folded ? new RegExp(`${g.exact}|${g.folded}`, 'g') : null
  }));
  const counts = pages.map((p) => {
    const folded = p.scan ? fold(p.lower) : null;
    return res.map((r) => {
      const [re, hay] = p.scan && r.both ? [r.both, folded] : [r.exact, p.lower];
      re.lastIndex = 0;
      return (hay.match(re) || []).length;
    });
  });
  const df = groups.map((_, j) => counts.filter((c) => c[j] > 0).length);
  const idf = df.map((n) => Math.log(1 + pages.length / (1 + n)));

  const scored = pages.map((p, i) => {
    let score = 0;
    let distinct = 0;
    counts[i].forEach((n, j) => {
      if (!n) return;
      distinct++;
      score += idf[j] * (1 + Math.log(n));
    });
    // A page that names the document's subject in its title is more likely
    // the one about it.
    const title = titleOf(p.item).toLowerCase();
    res.forEach((r, j) => {
      r.exact.lastIndex = 0;
      if (counts[i][j] && r.exact.test(title)) score += idf[j] * 0.5;
    });
    return { ...p, score: score * (1 + 0.35 * (distinct - 1)) };
  }).filter((p) => p.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const chosen = [];
  let chars = 0;
  for (const p of scored) {
    if (chosen.length >= MAX_PAGES) break;
    if (chars + p.text.length > MAX_CHARS && chosen.length) continue;
    chosen.push(p);
    chars += p.text.length;
  }
  // In the order a person would read them: by document, then page. A
  // procedure that runs over pages 12 to 14 reads as one.
  chosen.sort((a, b) => (a.item.id === b.item.id ? a.page - b.page : titleOf(a.item).localeCompare(titleOf(b.item))));
  return chosen.map(({ lower, ...rest }) => rest);
}

const SYSTEM = `You answer questions from a ship's officer using only the pages of their own ship's documents given with each question: manuals, alarm lists, procedures and circulars.

Answer only from those pages. If they do not contain the answer, say so plainly in one or two sentences and say what the pages do cover; never fill a gap from general knowledge, and never give a setpoint, pressure, temperature, limit or quantity that is not written in the pages.

For a procedure, give numbered steps in the order the document gives them, keeping close to its wording. Include every warning, caution and precondition the pages state, where they apply. Where two documents differ, say so and give both.

Some pages were read from scans by text recognition and may contain misread characters. If a figure looks misread, say so rather than correcting it.

Keep the answer focused and brief; the officer will check it against the pages.`;

/**
 * Ask, and stream the answer.
 *
 * `onText(soFar)` is called as the answer arrives. Resolves with
 * { blocks: [{ text, cites: [pageIndex] }], usage, model, refused }.
 */
export async function askClaude(apiKey, model, question, pages, titleOf, { onText, signal } = {}) {
  const { api } = await client(apiKey);
  const documents = pages.map((p) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: p.text },
    title: `${titleOf(p.item)} — page ${p.page}`,
    ...(p.scan ? { context: 'Read from a scanned page by text recognition.' } : {}),
    citations: { enabled: true }
  }));

  const stream = api.beta.messages.stream({
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    // If Claude's safety classifiers decline, the request is re-run on the
    // model Anthropic recommends for that case rather than simply stopping.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: [...documents, { type: 'text', text: question }] }]
  }, { signal });

  let soFar = '';
  stream.on('text', (delta) => { soFar += delta; onText?.(soFar); });
  const final = await stream.finalMessage();

  if (final.stop_reason === 'refusal') {
    return { blocks: [], usage: final.usage, model: final.model, refused: true };
  }
  const blocks = [];
  for (const block of final.content) {
    if (block.type !== 'text') continue;
    const cites = [...new Set((block.citations || [])
      .map((c) => c.document_index)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < pages.length))];
    blocks.push({ text: block.text, cites });
  }
  return { blocks, usage: final.usage, model: final.model, refused: false };
}

/** What an answer cost, in US dollars, from its usage. */
export function costOf(usage, model) {
  const m = modelInfo(model);
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  return (input * m.input + (usage?.output_tokens || 0) * m.output) / 1e6;
}

/** Why a question could not be asked, in words a person can act on. */
export function explainFailure(ex) {
  const A = sdk;
  if (A && ex instanceof A.AuthenticationError) return 'The API key was not accepted. Check it in Settings.';
  if (A && ex instanceof A.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (A && ex instanceof A.RateLimitError) return 'Too many questions at once, or the account is out of credit. Try again in a minute.';
  if (A && ex instanceof A.APIConnectionError) return 'No connection to Anthropic. Asking needs the internet; search still works offline.';
  if (A && ex instanceof A.BadRequestError) return `The request was refused: ${ex.message}`;
  if (A && ex instanceof A.APIError) return `Anthropic's API answered with an error (${ex.status ?? 'unknown'}). Try again shortly.`;
  if (ex?.name === 'AbortError' || /abort/i.test(String(ex?.message))) return 'Stopped.';
  return `Could not ask: ${ex?.message || ex}`;
}
