// Search across record fields and extracted PDF text.
//
// Snippets are returned as token arrays rather than HTML strings, so the UI can
// build them with textContent and a document's own words can never become
// markup.

import { TYPES } from './schema.js';

const SNIPPET_BEFORE = 55;
const SNIPPET_AFTER = 95;

export function terms(query) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Everything about a record that is worth matching, excluding file contents. */
function metaText(item) {
  const parts = [TYPES[item.type]?.label || ''];
  for (const [key, value] of Object.entries(item.data || {})) {
    if (key === 'attachments' && Array.isArray(value)) {
      for (const a of value) parts.push(a.name || '');
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
function markUp(passage, words) {
  const lower = passage.toLowerCase();
  const spans = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(w, from);
      if (at === -1) break;
      spans.push([at, at + w.length]);
      from = at + w.length;
    }
  }
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
function hitPositions(text, words) {
  const lower = text.toLowerCase();
  const positions = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(w, from);
      if (at === -1) break;
      positions.push(at);
      from = at + w.length;
    }
  }
  return positions.sort((a, b) => a - b);
}

/** A readable window of text around one hit. */
function snippetAt(text, at, words) {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + SNIPPET_AFTER);
  const passage = (start > 0 ? '… ' : '') + text.slice(start, end).trim() + (end < text.length ? ' …' : '');
  return markUp(passage, words);
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
  const words = terms(query);
  if (!words.length) return [];

  const results = [];
  for (const item of items) {
    if (type && item.type !== type) continue;

    const meta = metaText(item);
    const metaHits = words.filter((w) => meta.includes(w)).length;

    const snippets = [];
    const contentWords = new Set();
    let matchCount = 0;
    let pagesWithHits = 0;
    if (texts) {
      for (const att of item.data?.attachments || []) {
        const pages = texts.get(att.id);
        if (!pages) continue;
        for (const { page, text } of pages) {
          const lower = text.toLowerCase();
          const present = words.filter((w) => lower.includes(w));
          if (!present.length) continue;
          present.forEach((w) => contentWords.add(w));

          const positions = hitPositions(text, words);
          matchCount += positions.length;
          pagesWithHits++;
          // A page mentioning a term twenty times does not need twenty
          // snippets; a couple shows the context and the rest is noise.
          for (const at of positions.slice(0, perPage)) {
            snippets.push({ attachmentId: att.id, file: att.name, page, parts: snippetAt(text, at, words) });
          }
        }
      }
    }

    // Every term must appear somewhere — in the record or in a file it holds.
    const covered = words.every((w) => meta.includes(w) || contentWords.has(w));
    if (!covered) continue;

    results.push({
      item,
      snippets,
      matchCount,
      pagesWithHits,
      // Title and field matches outrank a mention buried in a PDF, but a
      // document mentioning the term throughout outranks one mentioning it once.
      score: metaHits * 10 + contentWords.size * 3 + Math.min(matchCount, 20)
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
