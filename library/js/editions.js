// Editions: a newer copy of a document already held.
//
// A manual comes aboard at Rev 7 while Rev 6 is still on the phone. Both stay
// searchable -- the old one is still the one the ship worked to until today --
// but the old one is marked superseded, the new one says what it replaces,
// and the pages whose words changed are listed, which is the part of a
// revision anyone actually needs to read.

// What distinguishes one edition of a title from another, and nothing else.
const EDITION_WORDS = /\b(?:rev(?:ision)?|ed(?:ition)?|ver(?:sion)?|v|issue|iss|amend(?:ment)?|amdt|corr(?:ected)?|update[ds]?|draft|final|copy|new|old|latest|current|superseded)\b\.?\s*(?:no\.?\s*)?[\w./-]*/gi;
const DATES = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?|(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b/gi;

/** The title with its edition, revision and date taken out. */
export function editionKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\.(pdf|epub|txt)$/i, '')
    .replace(/[_]+/g, ' ')
    // "Ed2", "Rev7", "v2.1": the number run on to the word.
    .replace(/\b(?:rev|ed|ver|v|iss|issue)\.?\d[\w./-]*/gi, ' ')
    .replace(EDITION_WORDS, ' ')
    .replace(DATES, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * An entry the new one looks to be a later edition of: the same kind of
 * document, the same title once editions and dates are set aside, and not
 * already replaced by something. Null if there is none.
 */
export function findOlderEdition(items, fresh, titleOf) {
  const key = editionKey(titleOf(fresh));
  // "Manual" alone matches everything; a title has to say something.
  if (key.length < 6 || !key.includes(' ') && key.length < 10) return null;
  const same = items.filter((i) => i.id !== fresh.id && i.type === fresh.type
    && !i.data.supersededBy && editionKey(titleOf(i)) === key);
  return same.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

const words = (text) => String(text || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// Runs of four words: a page is the same page if nearly all of them are.
function shingles(text) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + 4 <= w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]} ${w[i + 3]}`);
  if (!out.size && w.length) out.add(w.join(' '));
  return out;
}

/**
 * The pages of the new edition whose words are not on any page of the old.
 *
 * Compared page against page by what they say rather than by number: a page
 * added near the front moves every page after it along one, and none of
 * those have changed.
 *
 * @returns { changed: [page], same: n, unread: n }
 */
export function changedPages(oldPages, newPages, { alike = 0.85 } = {}) {
  const index = new Map();
  const sizes = [];
  oldPages.forEach((p, i) => {
    const set = shingles(p.text);
    sizes[i] = set.size;
    for (const s of set) {
      if (!index.has(s)) index.set(s, []);
      index.get(s).push(i);
    }
  });
  const changed = [];
  let same = 0;
  let unread = 0;
  for (const page of [...newPages].sort((a, b) => a.page - b.page)) {
    const set = shingles(page.text);
    if (!set.size) { unread++; continue; }
    const shared = new Map();
    for (const s of set) for (const i of index.get(s) || []) shared.set(i, (shared.get(i) || 0) + 1);
    let best = 0;
    for (const [i, n] of shared) best = Math.max(best, n / (set.size + sizes[i] - n));
    if (best >= alike) same++;
    else changed.push(page.page);
  }
  return { changed, same, unread };
}

/** 1, 2, 3, 7, 9, 10 -> "1–3, 7, 9–10" */
export function pageRanges(pages) {
  const out = [];
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(', ');
}
