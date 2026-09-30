// Cross-references: "see section 4.3", "refer to Appendix B", "chapter 5".
//
// A manual points at itself all the time, and following one of those means
// leaving the page, finding the contents, finding the page, and finding the
// way back. Here the reference itself is tapped.
//
// Two halves, both plain functions: picking the references out of a line of
// text, so the viewer can mark them, and finding where one leads, from the
// document's own contents list where it has one and from its stored text
// where it does not.

// The words that introduce a reference, and what each is a reference to.
const KINDS = new Map([
  ['section', 'section'], ['sect.', 'section'], ['sec.', 'section'], ['paragraph', 'section'],
  ['para', 'section'], ['para.', 'section'], ['clause', 'section'],
  ['chapter', 'chapter'], ['chap.', 'chapter'],
  ['appendix', 'appendix'], ['annex', 'appendix'],
  ['page', 'page'], ['p.', 'page'], ['pp.', 'page']
]);

const KEYWORDED = /\b(section|sect\.|sec\.|chapter|chap\.|paragraph|para\.?|clause|appendix|annex|page|pp?\.)\s*(\d{1,3}(?:\.\d{1,3}){0,4}|[A-Z](?![\w])|[IVX]{1,5}(?![\w]))/gi;
// "see 4.3", with no word saying what 4.3 is: a numbered section.
const BARE = /\b(see|refer to|as per|iaw)\s+(\d{1,3}(?:\.\d{1,3}){1,4})\b/gi;
// "MARPOL Annex VI" and "SOLAS chapter II-2" point at another book entirely.
const ELSEWHERE = /(marpol|solas|stcw|colreg|convention|code|regulation|reg\.|isgott|imdg|ibc|igc)\s*$/i;

/**
 * The references in one line of text, as [start, end) of the part to mark
 * and what it points at.
 */
export function referencesIn(text) {
  const str = String(text || '');
  const found = [];
  for (const m of str.matchAll(KEYWORDED)) {
    const word = m[1].toLowerCase();
    const kind = KINDS.get(word) || KINDS.get(word.replace(/\.$/, ''));
    const label = m[2];
    if (!kind) continue;
    const numeric = /^\d/.test(label);
    // A lone letter or a Roman numeral is an appendix, an annex or a
    // chapter -- "section a" is a sentence, not a reference -- and only in
    // capitals.
    if (!numeric && (kind === 'page' || kind === 'section' || label !== label.toUpperCase())) continue;
    if (/^[IVX]+$/.test(label) && kind !== 'chapter' && kind !== 'appendix') continue;
    if (ELSEWHERE.test(str.slice(Math.max(0, m.index - 24), m.index))) continue;
    // "Section 2 — Lubrication" at the head of a line is the section itself,
    // not a pointer to it.
    const end = m.index + m[0].length;
    if (!str.slice(0, m.index).trim() && kind !== 'page' && /^\s*([—–:.-]|[A-Z][a-z])/.test(str.slice(end))) continue;
    found.push({ start: m.index, end, kind, word, label });
  }
  for (const m of str.matchAll(BARE)) {
    const start = m.index + m[0].indexOf(m[2]);
    if (found.some((f) => start < f.end && start + m[2].length > f.start)) continue;
    found.push({ start, end: start + m[2].length, kind: 'section', word: '', label: m[2] });
  }
  return found.sort((a, b) => a.start - b.start);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Said in passing rather than as a heading: "see 4.3", "in section 4.3".
const IN_PASSING = /(see|refer(?:red)?\s+to|in|under|per|and|or|to|of|with|also|by|as|from|section|sect\.|sec\.|para(?:graph)?\.?|clause|chapter|chap\.)\s*[,(]?\s*$/i;

/** A contents page: its entries run out to their page numbers along dots. */
export function isContentsPage(text) {
  const t = String(text || '');
  if (/^\W*(table of\s+)?contents\b/i.test(t.slice(0, 200))) return true;
  return (t.match(/\.{4,}|(?:\. ){4,}|…{2,}/g) || []).length >= 3;
}

function patternFor(ref) {
  const label = escape(ref.label);
  if (ref.kind === 'appendix') return new RegExp(`\\b(?:appendix|annex)\\s+${label}(?![\\w.])`, 'gi');
  if (ref.kind === 'chapter') return new RegExp(`\\b(?:[Cc][Hh][Aa][Pp][Tt][Ee][Rr]\\s+${label}(?![\\w.])|(?<![\\w.])${label}\\.?\\s+(?=[A-Z]))`, 'g');
  // A numbered heading: the number, then the heading's first word.
  return new RegExp(`(?<![\\w.])${label}\\.?\\s+(?=[A-Z])`, 'g');
}

/**
 * The page a reference leads to, or null.
 *
 * @param pages     the document's stored text, [{ page, text }]
 * @param ref       from referencesIn
 * @param from      the page the reference is on
 * @param contents  the document's own contents list, [{ title, page }]
 * @param pageCount how many pages it has
 */
export function findReference(pages, ref, { from = 0, contents = [], pageCount = Infinity } = {}) {
  if (!ref) return null;
  if (ref.kind === 'page') {
    const n = Number(ref.label);
    return n >= 1 && n <= pageCount ? n : null;
  }

  // The document's own contents list, where it has one, says exactly.
  const label = escape(ref.label);
  const title = ref.kind === 'appendix'
    ? new RegExp(`^\\W*(?:appendix|annex)\\s+${label}(?![\\w.])`, 'i')
    : ref.kind === 'chapter'
      ? new RegExp(`^\\W*(?:chapter\\s+)?${label}(?![\\w.]|\\.\\d)`, 'i')
      : new RegExp(`^\\W*(?:(?:section|para(?:graph)?|clause)\\s+)?${label}(?![\\w]|\\.\\d)`, 'i');
  const listed = contents.find((c) => c.page && title.test(c.title || ''));
  if (listed) return listed.page;

  // Otherwise the text: the first place the number stands as a heading, not
  // a mention of it, and not in the contents list at the front.
  const pattern = patternFor(ref);
  let fallback = null;
  for (const { page, text } of [...pages].sort((a, b) => a.page - b.page)) {
    if (!text || isContentsPage(text)) continue;
    for (const m of text.matchAll(pattern)) {
      if (IN_PASSING.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
      // At the top of a page is where a chapter or an appendix starts.
      const heading = ref.kind === 'section' || m.index < 200;
      if (page === from) { fallback = fallback ?? page; break; }
      if (heading) return page;
      fallback = fallback ?? page;
      break;
    }
  }
  return fallback;
}

/** How a reference reads, for saying it could not be found. */
export function describeReference(ref) {
  const word = ref.word && !/^(p|pp|sect|sec|chap|para)\.?$/.test(ref.word) ? ref.word : ref.kind;
  return `${word[0].toUpperCase()}${word.slice(1)} ${ref.label}`;
}
