// A document's words as a plain text file.
//
// For handing a library to something that reads text -- a Claude project, a
// laptop search, a printout -- without the PDFs. The words are what the app
// already holds for the search, so this costs nothing to produce and is a
// small fraction of the size of the file it came from.
//
// Each page is marked, so whatever reads it can still say "page 84" and a
// person can go and find it in the real manual. The entry's own fields go at
// the top, because a file called "Main Engine.txt" says nothing about which
// ship it belongs to.

import { TYPES } from './schema.js';

const SKIP = new Set(['attachments', 'answers', 'pageNotes', 'fileLink']);

/** The header: title, then every filled-in field of the entry. */
function heading(item, att) {
  const def = TYPES[item.type];
  const lines = [];
  const title = item.data?.[def?.titleKey || 'title'] || att.name;
  lines.push(title);
  lines.push('='.repeat(Math.min(Math.max(String(title).length, 3), 80)));
  if (def) lines.push(`Section: ${def.singular || def.label}`);
  for (const f of def?.fields || []) {
    if (SKIP.has(f.key) || f.key === def.titleKey) continue;
    const value = item.data?.[f.key];
    if (value === undefined || value === null || value === '' || typeof value === 'object') continue;
    lines.push(`${f.label}: ${String(value).replace(/\s+/g, ' ').trim()}`);
  }
  lines.push(`File: ${att.name}`);
  return lines;
}

/**
 * The text of one attached file, page by page.
 *
 * Words read out of a page's pictures are kept apart from its text, marked as
 * such: they are what a diagram's labels said, not a sentence of the page.
 */
export function documentText(item, att, pages) {
  const sorted = [...(pages || [])].sort((a, b) => a.page - b.page);
  const lines = heading(item, att);
  lines.push(`Pages with text: ${sorted.length}${att.pageCount ? ` of ${att.pageCount}` : ''}`);
  if ((att.readTo || 0) > 0) {
    lines.push('Read from a scan by text recognition: expect some misread characters, and check figures against the page.');
  }
  lines.push('');
  for (const p of sorted) {
    const text = (p.text || '').trim();
    const pictures = (p.pictures || '').trim();
    if (!text && !pictures) continue;
    lines.push(`--- Page ${p.page} ---`);
    if (text) lines.push(text);
    if (pictures) lines.push(`[Words in the pictures on this page] ${pictures}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** A file name that survives every file system it is likely to meet. */
export function textFileName(item, att, taken = new Set()) {
  const def = TYPES[item.type];
  const title = item.data?.[def?.titleKey || 'title'] || att.name.replace(/\.[^.]+$/, '');
  let base = String(title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100) || 'document';
  // Two files on one entry, or two entries with one title, must not overwrite
  // each other inside the zip.
  let name = `${base}.txt`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).txt`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Everything in the library that has words to give, as [{ item, att }].
 *
 * `type` narrows it to one section.
 */
export function exportable(items, texts, type = null) {
  const out = [];
  for (const item of items) {
    if (type && item.type !== type) continue;
    for (const att of item.data?.attachments || []) {
      const pages = texts.get(att.id);
      if (pages && pages.some((p) => (p.text || '').trim() || (p.pictures || '').trim())) {
        out.push({ item, att, pages });
      }
    }
  }
  return out;
}
