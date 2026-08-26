// Work out what a PDF is, so an entry can fill itself in.
//
// Everything here is a guess offered for correction, never a decision: fields
// the user has already filled are left alone, and what was filled in is
// reported so it can be checked rather than trusted.

const PUBLISHERS = [
  ['International Maritime Organization', 'IMO'],
  ['IMO Publishing', 'IMO'],
  ['United Kingdom Hydrographic Office', 'UKHO'],
  ['UK Hydrographic Office', 'UKHO'],
  ['Admiralty', 'UKHO'],
  ['Witherby', 'Witherby'],
  ['OCIMF', 'OCIMF'],
  ['ICS', 'ICS'],
  ['IALA', 'IALA'],
  ['Lloyd', "Lloyd's Register"],
  ['DNV', 'DNV'],
  ['Bureau Veritas', 'Bureau Veritas'],
  ['ClassNK', 'ClassNK'],
  ['American Bureau of Shipping', 'ABS'],
  ['Synergy', 'Synergy']
];

/** Producer strings and placeholders that are not a real title. */
const JUNK_TITLE = /^(untitled|document\d*|microsoft word|microsoft powerpoint|adobe|print|scan|new document|.*\.(pdf|docx?|indd))/i;

function tidy(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_·•]+|[\s\-–—_·•]+$/g, '')
    .trim();
}

/** A filename is a decent fallback title once the noise is stripped out. */
export function titleFromFilename(name) {
  return tidy(String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\b(final|copy|v\d+|rev\s?\d+|compressed|scan(ned)?|ocr)\b/gi, ''));
}

function pickTitle(described, filename) {
  const meta = tidy(described.info?.Title);
  if (meta && meta.length > 3 && !JUNK_TITLE.test(meta)) return meta;

  // Otherwise the largest text on page one, provided it reads like a heading.
  for (const line of described.largestLines || []) {
    const candidate = tidy(line);
    if (candidate.length >= 4 && candidate.length <= 120 && !/^page\b/i.test(candidate)) {
      return candidate;
    }
  }
  return titleFromFilename(filename);
}

function pickYear(described) {
  const meta = String(described.info?.CreationDate || '');
  const fromText = (described.firstPageText || '').match(/\b(?:edition|published|version)\D{0,12}(19|20)\d{2}\b/i);
  if (fromText) {
    const year = fromText[0].match(/(19|20)\d{2}/);
    if (year) return year[0];
  }
  const anyYear = (described.firstPageText || '').match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  if (anyYear) return anyYear[0];
  const metaYear = meta.match(/D:(\d{4})/);
  return metaYear ? metaYear[1] : '';
}

/**
 * Edition or version as printed: "Fifth edition, 2016", "Rev 7", "Version 3.1".
 * Falls back to a bare year, which is what most publications actually carry.
 */
function pickEdition(described) {
  const text = described.firstPageText || '';
  // Ordered most specific first. An edition with its year beats the edition
  // alone, which is why the year is required in the first two patterns rather
  // than optional -- an optional group matches nothing and stops early.
  const ordinal = '\\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth';
  const patterns = [
    new RegExp(`\\b(?:${ordinal})\\s+edition\\b[^\\n]{0,20}?(?:19|20)\\d{2}`, 'i'),
    /\bedition\b[^\n]{0,20}?(?:19|20)\d{2}/i,
    new RegExp(`\\b(?:${ordinal})\\s+edition\\b`, 'i'),
    /\bversion\s*:?\s*\d+(?:\.\d+)*/i,
    /\brev(?:ision)?\s*:?\s*\d+(?:\.\d+)*/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return tidy(m[0]).replace(/\s+/g, ' ');
  }
  return pickYear(described);
}

/** Revision alone, for company documents that carry one. */
function pickRevision(described) {
  const m = (described.firstPageText || '').match(/\brev(?:ision)?\s*:?\s*(\d+(?:\.\d+)*)/i);
  return m ? `Rev ${m[1]}` : '';
}

/** A publication date as YYYY-MM-DD, for the fields that take a real date. */
function pickDate(described) {
  const text = described.firstPageText || '';
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
                  'august', 'september', 'october', 'november', 'december'];

  const named = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+((?:19|20)\d{2})\b/);
  if (named) {
    const month = months.findIndex((m) => m.startsWith(named[2].toLowerCase().slice(0, 3)));
    if (month >= 0) {
      return `${named[3]}-${String(month + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
    }
  }
  const iso = text.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  // Last resort: the date the file itself was made.
  const meta = String(described.info?.CreationDate || '').match(/D:(\d{4})(\d{2})(\d{2})/);
  return meta ? `${meta[1]}-${meta[2]}-${meta[3]}` : '';
}

function pickPublisher(described) {
  const haystack = `${described.info?.Author || ''} ${described.firstPageText || ''}`;
  for (const [needle, name] of PUBLISHERS) {
    if (haystack.toLowerCase().includes(needle.toLowerCase())) return name;
  }
  return '';
}

function pickReference(described, filename) {
  // Document text first: a filename is often an abbreviation of the real number.
  const haystack = `${described.firstPageText || ''} ${filename}`;
  // Admiralty numbers (NP281, NP 100(1)), then IMO sales codes, then ISBN.
  const np = haystack.match(/\bNP\s?\d{1,4}\s?(\(\d+\))?/i);
  if (np) return tidy(np[0].toUpperCase().replace(/\s+/g, ''));
  const imo = haystack.match(/\b[A-Z]{1,2}\d{3,4}[EX]?\b/);
  if (imo && /IMO/i.test(haystack)) return imo[0];
  const isbn = haystack.match(/\b97[89][\d-]{10,14}\b/);
  return isbn ? isbn[0] : '';
}

/**
 * Suggest field values for a record of `type`, from a described PDF and its
 * filename. Only fields the schema has are returned.
 */
export function suggestFields(type, described, filename, fieldKeys) {
  const has = (key) => fieldKeys.includes(key);
  const out = {};

  if (has('title')) out.title = pickTitle(described, filename);

  if (type === 'publication') {
    if (has('edition')) out.edition = pickEdition(described);
    if (has('publisher')) out.publisher = pickPublisher(described);
    if (has('refNo')) out.refNo = pickReference(described, filename);
  }
  if (type === 'synergy' || type === 'circular') {
    if (has('refNo')) out.refNo = pickReference(described, filename);
    if (has('issuer')) out.issuer = pickPublisher(described);
    if (has('revision')) out.revision = pickRevision(described);
    if (has('date')) out.date = pickDate(described);
  }
  if (type === 'notice' && has('date')) out.date = pickDate(described);
  if (type === 'manual' && has('vessel')) {
    // A ship name in the filename is a common convention: "MV Something - ...".
    const vessel = String(filename || '').match(/\b(?:MV|MT|MS|SS)\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?/i);
    if (vessel) out.vessel = tidy(vessel[0]);
  }

  // Never offer an empty suggestion.
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}
