// Search across record fields and extracted PDF text.
//
// Snippets are returned as token arrays rather than HTML strings, so the UI can
// build them with textContent and a document's own words can never become
// markup.

import { TYPES } from './schema.js';
import { expandAbbreviation, phraseAt } from './abbrev.js';

const SNIPPET_BEFORE = 55;
const SNIPPET_AFTER = 95;

export function terms(query) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// ── what a query asks for ───────────────────────────────────────────────────
//
// A query is a list of things that must all be found. Most are a word, found
// anywhere -- "press" finds "pressure", as it always has. Two kinds are more:
//
// An abbreviation stands for its words and they for it. "LO" finds "lube oil"
// and "L.O.", and "lube oil" finds "LO". An abbreviation is only found as a
// word of its own: "lo" inside "slow" is not lube oil.
//
// A page read by text recognition is searched with the characters it confuses
// folded together, so "Pump" misread as "Purnp" is not helped, but "O1L" for
// "OIL" and "5EAL" for "SEAL" are found. Only on those pages -- a PDF's own
// text layer is what the document says, and is searched as written.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// Letters and figures that text recognition mistakes for each other, folded
// to one. Length-preserving, so a position found in the folded text is the
// same position in the page.
const FOLD = { '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '!': 'l', '5': 's' };
export function fold(s) {
  let out = '';
  for (const ch of s) out += FOLD[ch] || ch;
  return out;
}

// A phrase with anything between its words: a line break, two spaces, a
// hyphen at the end of a line.
const phraseSource = (phrase) => phrase.split(' ').map(esc).join('[\\s\\-]+');

// Found only as a word of its own. No lookbehind, which older Safari rejects
// outright -- the boundary before is matched and measured off instead.
const wholeSource = (word) => `(?:^|[^a-z0-9])(${esc(word)})(?![a-z0-9])`;

/**
 * Turn a query into what must be found: [{ label, exact, folded }], where
 * exact and folded are RegExp sources (folded is null where folding does not
 * apply). Each source has exactly one capture group, around the words.
 */
export function compile(query) {
  const words = terms(query);
  const groups = [];
  for (let i = 0; i < words.length; i++) {
    const phrase = phraseAt(words, i);
    // "L.O." and "L/O" typed are the same abbreviation as "LO".
    const entry = phrase ? phrase[0] : expandAbbreviation(words[i].replace(/[./-]/g, ''));
    if (entry) {
      const used = phrase ? phrase[1] : 1;
      const alts = [
        ...entry.spellings.map((a) => wholeSource(a)),
        ...entry.full.map((f) => `(${phraseSource(f)})`)
      ];
      groups.push({
        label: words.slice(i, i + used).join(' '),
        exact: alts.join('|'),
        // The words written out can be misread on a scan like any others; the
        // abbreviation itself is too short to fold safely.
        folded: entry.full.map((f) => `(${phraseSource(fold(f))})`).join('|')
      });
      i += used - 1;
      continue;
    }
    const w = words[i];
    // Folding a number would make "150" find "ISO"; a figure is searched as
    // typed. Nor is it worth it for a word too short to be mistaken for much.
    const foldable = w.length >= 3 && /[a-z]/.test(w);
    groups.push({
      label: w,
      exact: `(${esc(w)})`,
      folded: foldable ? `(${esc(fold(w))})` : null
    });
  }
  return groups;
}

/**
 * Every place a group is found in some text: [[start, end]].
 * `ocr` says the text was read by recognition, and may be searched folded.
 */
function findAll(lower, group, ocr) {
  const useFold = ocr && group.folded;
  const hay = useFold ? fold(lower) : null;
  const out = [];
  const scan = (text, key, src) => {
    // Built once per query, not once per page: a library is thousands of them.
    const re = group[key] || (group[key] = new RegExp(src, 'g'));
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const word = m.slice(1).find((g) => g !== undefined) || m[0];
      const start = m.index + m[0].lastIndexOf(word);
      out.push([start, start + word.length]);
      if (m[0].length === 0) re.lastIndex++;
    }
  };
  scan(lower, 'exactRe', group.exact);
  if (useFold) scan(hay, 'foldedRe', group.folded);
  // The same place found both ways is one hit.
  const seen = new Set();
  return out.filter(([s]) => (seen.has(s) ? false : (seen.add(s), true))).sort((a, b) => a[0] - b[0]);
}

const found = (lower, group, ocr) => findAll(lower, group, ocr).length > 0;

/**
 * A test for a single piece of text: does it hold everything the query asks
 * for? For rows read out of a table, which are matched whole rather than
 * ranked page by page.
 */
export function matcher(query) {
  const groups = compile(query);
  return (text, ocr = false) => groups.length > 0 && groups.every((g) => found(String(text).toLowerCase(), g, ocr));
}

/** Everything about a record that is worth matching, excluding file contents. */
function metaText(item) {
  const parts = [TYPES[item.type]?.label || ''];
  for (const [key, value] of Object.entries(item.data || {})) {
    // Rows read out of the document's own tables: its text is searched as
    // text already, and counting them again as fields of the entry would rank
    // a document by how many settings it lists.
    if (key === 'alarms' || key === 'alarmsRead') continue;
    if (key === 'attachments' && Array.isArray(value)) {
      for (const a of value) parts.push(a.name || '');
    } else if (Array.isArray(value)) {
      // Notes written on a page, and the clauses linked to a question, are
      // lists of records. String() on one of those is "[object Object]", so
      // every word a person wrote in them was unfindable -- the one kind of
      // text in the library that is certainly worth finding, because someone
      // sat down and typed it.
      for (const entry of value) {
        if (entry === null || entry === undefined) continue;
        if (typeof entry !== 'object') { parts.push(String(entry)); continue; }
        for (const field of Object.values(entry)) {
          if (typeof field === 'string' || typeof field === 'number') parts.push(String(field));
        }
      }
    } else if (value !== null && value !== undefined) {
      parts.push(String(value));
    }
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Split a passage around the first match so the UI can highlight it.
 * Returns [{ text, hit }].
 */
function markUp(passage, groups, ocr) {
  const lower = passage.toLowerCase();
  const spans = [];
  for (const g of groups) spans.push(...findAll(lower, g, ocr));
  if (!spans.length) return [{ text: passage, hit: false }];

  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const out = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) out.push({ text: passage.slice(cursor, s), hit: false });
    out.push({ text: passage.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < passage.length) out.push({ text: passage.slice(cursor), hit: false });
  return out;
}

/** Every position on a page where any search term appears. */
function hitPositions(text, groups, ocr) {
  const lower = text.toLowerCase();
  const positions = [];
  for (const g of groups) for (const [at] of findAll(lower, g, ocr)) positions.push(at);
  return positions.sort((a, b) => a - b);
}

/**
 * The numbered clause a hit sits under.
 *
 * "Page 84" is not what anyone cites. A manual is quoted by its clause --
 * "5.3.1" -- and an inspector asking a question wants the clause, not a page
 * number that changes with every revision.
 *
 * Found by walking back from the hit to the nearest line that opens with a
 * clause number. No attempt is made to tell a heading from a numbered
 * paragraph: in a company manual they look identical, and the paragraph number
 * is the more useful of the two to be given.
 *
 * Returns null rather than a guess. A document with no numbering gets a page
 * number, which is honest, where an invented clause would not be.
 */
// A clause number: "5", "5.3", "5.3.1", followed by the text it introduces.
//
// Deliberately NOT anchored to a line. A page of a PDF comes out of extraction
// as a single unbroken line -- the paragraph breaks are in the layout, not in
// the text -- so a pattern anchored with ^ finds the first number on the page
// and nothing else. That was the first version of this, and on real documents
// it reported chapter 5 for every hit on the page.
//
// The following capital is what keeps "3.4 million tonnes" and "page 5 of 9"
// out. A clause introduces a sentence or a heading, and those start with one.
const CLAUSE = /(?:^|[\s (])(\d{1,2}(?:\.\d{1,3}){0,4})[.):]?[ \t ]+(?=[A-Z(])/g;

/**
 * A numbered stretch that reads as a heading rather than as a paragraph.
 *
 * "5.3 Maintenance of statutory certificates" is the thing worth showing.
 * "5.3.1 The Master shall ensure that all statutory certificates and..." is
 * the same shape and tells the reader nothing they are not already reading.
 */
function readsAsHeading(rest) {
  if (!/[A-Za-z]/.test(rest) || /[.,;:]$/.test(rest)) return false;
  // A heading set in capitals can run long and still be a heading. In normal
  // case, length is what separates one from the opening words of a paragraph.
  if (rest === rest.toUpperCase()) return rest.length <= 90;
  return rest.length <= 45;
}

/**
 * The numbered clause a hit sits under.
 *
 * "Page 84" is not what anyone cites. A manual is quoted by its clause --
 * "5.3.1" -- and an inspector asking a question wants the clause, not a page
 * number that changes with every revision of the manual.
 *
 * Returns the nearest clause number before the hit, and the heading that
 * covers it where there is one: 5.3.1 sits under 5.3, so a hit inside 5.3.1
 * reads as "5.3.1 — Maintenance of statutory certificates". A heading that
 * does not cover the clause is not its title and is not used.
 *
 * Returns null rather than a guess. A document with no numbering gets a page
 * number, which is honest, where an invented clause would not be.
 */
export function clauseAt(text, at) {
  // About a page back. A clause number further away than that is not the
  // clause the hit is in.
  const floor = Math.max(0, at - 3000);
  // Past the hit, not up to it. The pattern needs the capital that follows a
  // clause number in order to match it at all, so a window ending at the hit
  // cannot see the clause the hit is the first word of -- "5.3.2 A register of
  // statutory certificates" reported as 5.3.1.
  const window = text.slice(floor, Math.min(text.length, at + 200));
  const hitAt = at - floor;

  const marks = [];
  CLAUSE.lastIndex = 0;
  for (let found = CLAUSE.exec(window); found; found = CLAUSE.exec(window)) {
    marks.push({ number: found[1], from: found.index + found[0].length });
    // Overlapping starts: the boundary character is part of the match, so
    // stepping back one lets two clause numbers in a row both be seen.
    CLAUSE.lastIndex = Math.max(CLAUSE.lastIndex - 1, found.index + 1);
  }
  if (!marks.length) return null;

  // What each clause number introduces: everything up to the next one.
  for (const [i, mark] of marks.entries()) {
    const to = i + 1 < marks.length ? marks[i + 1].from : window.length;
    mark.text = window.slice(mark.from, to).replace(/\s+/g, ' ').trim()
      // The next clause's own number is on the end of this one's text.
      .replace(/\s*\d{1,2}(?:\.\d{1,3}){0,4}[.):]?$/, '').trim();
  }

  // Only clauses that begin at or before the hit. The window runs past it so
  // the text of the last one is bounded properly, not so a clause further down
  // the page can claim the hit.
  const before = marks.filter((m) => m.from <= hitAt + 1);
  if (!before.length) return null;

  const ref = before[before.length - 1].number;
  for (let i = before.length - 1; i >= 0; i--) {
    if (!readsAsHeading(before[i].text)) continue;
    // Only a heading the clause sits under. 5.2 is not the title of 5.3.1.
    if (ref !== before[i].number && !ref.startsWith(`${before[i].number}.`)) continue;
    return { ref, label: before[i].text };
  }
  return { ref, label: null };
}

/** A readable window of text around one hit. */
function snippetAt(text, at, groups, ocr) {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + SNIPPET_AFTER);
  const passage = (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '');
  return markUp(passage, groups, ocr);
}

/**
 * Rank records against a query.
 *
 * Every match is returned, not a sample of them: a phrase can appear on forty
 * pages of a publication and the point of searching is to find all of them. The
 * caller decides how many to show at once.
 *
 * `texts` maps attachment id -> [{ page, text }]; pass null to search metadata
 * only, which is what happens before the text index has been loaded.
 */
export function search(query, items, texts, { type = null, perPage = 2 } = {}) {
  const groups = compile(query);
  if (!groups.length) return [];

  const results = [];
  for (const item of items) {
    if (type && item.type !== type) continue;

    const meta = metaText(item);
    const inMeta = groups.map((g) => found(meta, g, false));
    const metaHits = inMeta.filter(Boolean).length;

    const snippets = [];
    const contentGroups = new Set();
    let matchCount = 0;
    let pagesWithHits = 0;
    if (texts) {
      for (const att of item.data?.attachments || []) {
        const pages = texts.get(att.id);
        if (!pages) continue;
        // A scan's pages were read by recognition; a PDF's text layer was not.
        const scanned = (att.readTo || 0) > 0 || att.fromScan === true;
        for (const { page, text = '', pictures } of pages) {
          const lower = text.toLowerCase();
          const present = groups.filter((g) => found(lower, g, scanned));
          if (present.length) {
            present.forEach((g) => contentGroups.add(g));

            const positions = hitPositions(text, groups, scanned);
            matchCount += positions.length;
            pagesWithHits++;
            // A page mentioning a term twenty times does not need twenty
            // snippets; a couple shows the context and the rest is noise.
            for (const at of positions.slice(0, perPage)) {
              snippets.push({
                attachmentId: att.id, file: att.name, page,
                clause: clauseAt(text, at),
                parts: snippetAt(text, at, groups, scanned)
              });
            }
          }

          // Words read out of the pictures on the page — the labels on a
          // diagram, the text in a photograph — which the page's own text
          // layer never held.
          //
          // Only terms the text layer does not already have. Reading a page as
          // a picture reads all of it, body text included, so counting both
          // would report every ordinary word twice and show the same sentence
          // in two snippets. What is genuinely new here is what was drawn
          // rather than typed.
          if (!pictures) continue;
          const inPicture = pictures.toLowerCase();
          const only = groups.filter((g) => found(inPicture, g, true) && !present.includes(g));
          if (!only.length) continue;
          only.forEach((g) => contentGroups.add(g));

          const hits = hitPositions(pictures, only, true);
          matchCount += hits.length;
          if (!present.length) pagesWithHits++;
          for (const at of hits.slice(0, perPage)) {
            snippets.push({
              attachmentId: att.id, file: att.name, page,
              inPicture: true, parts: snippetAt(pictures, at, only, true)
            });
          }
        }
      }
    }

    // Every term must appear somewhere — in the record or in a file it holds.
    const covered = groups.every((g, i) => inMeta[i] || contentGroups.has(g));
    if (!covered) continue;

    results.push({
      item,
      snippets,
      matchCount,
      pagesWithHits,
      // Title and field matches outrank a mention buried in a PDF, but a
      // document mentioning the term throughout outranks one mentioning it once.
      score: metaHits * 10 + contentGroups.size * 3 + Math.min(matchCount, 20)
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
