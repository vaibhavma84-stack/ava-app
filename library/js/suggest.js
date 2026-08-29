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

/**
 * Headings that name the kind of document rather than the document.
 *
 * A fleet alert has FLEET ALERT across the top in the largest type on the
 * page, so "the biggest text is the title" hands back the category every
 * time. What the reader actually wants is the subject line further down.
 */
const KIND_HEADING = /^(fleet\s+alert|safety\s+alert|alert|circular|fleet\s+circular|notice|bulletin|advisory|memo(randum)?|technical\s+bulletin|marine\s+notice)\.?$/i;

/**
 * Read a "Label: value" line out of the first page.
 *
 * Circulars, alerts and bulletins across the industry are laid out this way —
 * Subject, Ref, Date, To — and the labelled value is far more reliable than
 * anything inferred from type size. A label alone on its line takes the line
 * below it; a value that wraps takes the continuation with it.
 */
function pickLabelled(described, labels) {
  const lines = String(described.firstPageText || '').split('\n').map((l) => l.trim());
  const label = new RegExp(`^(?:${labels.join('|')})\\s*[:\\-–—]\\s*(.*)$`, 'i');
  const anyLabel = /^[A-Za-z][A-Za-z /.'-]{1,24}\s*[:\-–—]\s/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;

    let value = tidy(m[1]);
    // A label on a line of its own, or a value that runs on: keep taking lines
    // until the sentence closes. A subject is routinely three lines long, and
    // stopping at a fixed count truncated it mid-clause. What stops it is the
    // full stop, a label starting below it, or a length no subject reaches.
    for (let j = i + 1; j < lines.length && j - i <= 3; j++) {
      const next = lines[j];
      if (!next || anyLabel.test(next)) break;
      if (!value) { value = tidy(next); continue; }
      if (/[.:;!?]$/.test(value) || value.length >= 200) break;
      value = tidy(`${value} ${next}`);
    }
    if (value.length >= 3) return value.slice(0, 160);
  }
  return '';
}

/** The subject of a circular, however it is labelled. */
const pickSubject = (described) =>
  pickLabelled(described, ['subject', 'sub', 'subj', 're', 'title']);

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
  if (meta && meta.length > 3 && !JUNK_TITLE.test(meta) && !KIND_HEADING.test(meta)) return meta;

  // Otherwise the largest text on page one, provided it reads like a heading
  // and not merely like the kind of document this is.
  for (const line of described.largestLines || []) {
    const candidate = tidy(line);
    if (candidate.length >= 4 && candidate.length <= 120
        && !/^page\b/i.test(candidate) && !KIND_HEADING.test(candidate)) {
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

// Only the three administrations in use, and the wording that identifies each
// on a circular. MCA is an administration rather than a flag, but it is how
// these documents are filed in practice.
const FLAGS = [
  [/\bmaritime\s+and\s+coastguard\s+agency\b|\bMCA\b|\bMGN\s?\d|\bMSN\s?\d|\bMIN\s?\d/i, 'MCA'],
  [/\bpanama\b|panama\s+maritime\s+authority|\bAMP\b|\bMMN\b/i, 'Panama'],
  [/\bsingapore\b|maritime\s+and\s+port\s+authority|\bMPA\b|\bSC\s?No\b/i, 'Singapore']
];

const ADMINISTRATIONS = [
  [/panama\s+maritime\s+authority|autoridad\s+mar[ií]tima\s+de\s+panam[áa]/i, 'Panama Maritime Authority'],
  [/maritime\s+and\s+port\s+authority\s+of\s+singapore|\bMPA\b/i, 'MPA Singapore'],
  [/maritime\s+and\s+coastguard\s+agency|\bMCA\b/i, 'Maritime & Coastguard Agency']
];

function pickFlagState(described, filename) {
  const haystack = `${described.firstPageText || ''} ${filename} ${described.info?.Author || ''}`;
  for (const [re, name] of FLAGS) if (re.test(haystack)) return name;
  return '';
}

// The prefix on a notice identifies its class, per administration.
const FLAG_DOC_TYPE_HINTS = [
  [/\bMSN\s?\d/i, 'MCA', 'MSN (Merchant Shipping Notice)'],
  [/\bMGN\s?\d/i, 'MCA', 'MGN (Marine Guidance Note)'],
  [/\bMIN\s?\d/i, 'MCA', 'MIN (Marine Information Note)'],
  [/\bMMN\s?\d|merchant\s+marine\s+notice/i, 'Panama', 'MMN (Merchant Marine Notice)'],
  [/merchant\s+marine\s+circular/i, 'Panama', 'Merchant Marine Circular'],
  [/\bshipping\s+circular\b/i, 'Singapore', 'Shipping Circular'],
  [/\bport\s+marine\s+circular\b/i, 'Singapore', 'Port Marine Circular']
];

function pickFlagDocType(described, filename, flagState) {
  const haystack = `${described.firstPageText || ''} ${filename}`;
  for (const [re, admin, label] of FLAG_DOC_TYPE_HINTS) {
    if ((!flagState || admin === flagState) && re.test(haystack)) return label;
  }
  return '';
}

function pickAdministration(described) {
  const haystack = `${described.info?.Author || ''} ${described.firstPageText || ''}`;
  for (const [re, name] of ADMINISTRATIONS) if (re.test(haystack)) return name;
  return '';
}

function pickPublisher(described) {
  const haystack = `${described.info?.Author || ''} ${described.firstPageText || ''}`;
  for (const [needle, name] of PUBLISHERS) {
    if (haystack.toLowerCase().includes(needle.toLowerCase())) return name;
  }
  return '';
}

/**
 * Notice and circular numbering, which follows its own conventions: MMN 7-070
 * from Panama, MGN 654 (M) from the MCA, SC No. 4 of 2026 from Singapore, and
 * the "Circular No." wording used almost everywhere else.
 */
function pickNoticeReference(described, filename) {
  // A labelled reference is the document telling you its own number, so it is
  // worth more than anything matched out of running text.
  const labelled = pickLabelled(described,
    ['ref', 'ref no', 'reference', 'our ref', 'circular no', 'alert no', 'notice no',
     'bulletin no', 'document no', 'doc no', 'no']);
  if (labelled && /\d/.test(labelled) && labelled.length <= 40) return labelled;

  const haystack = `${described.firstPageText || ''} ${filename}`;
  const patterns = [
    /\b(?:MMN|MGN|MSN|MIN|MC|MN|TA|SC)\s?\.?\s?\d+[\w./-]*(?:\s?\([A-Z+]+\))?/i,
    /\b(?:circular|notice|alert)\s+no\.?\s*[\w./-]+(?:\s+of\s+(?:19|20)\d{2})?/i,
    // "Fleet Alert 05/2026", with the "No." that a form often leaves out.
    /\b(?:fleet|safety|technical)\s+(?:alert|circular|bulletin)\s*[#:]?\s*\d+[\w./-]*/i,
    /\bno\.?\s*\d+\s+of\s+(?:19|20)\d{2}\b/i
  ];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m) return tidy(m[0]).replace(/\s*\.\s*/, ' ').replace(/\s+/g, ' ');
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
    // The subject line is the document's own statement of what it is about,
    // and outranks a heading that only says what kind of document it is.
    if (has('title')) out.title = pickSubject(described) || out.title;
    if (has('refNo')) out.refNo = pickNoticeReference(described, filename) || pickReference(described, filename);
    if (has('issuer')) out.issuer = pickPublisher(described);
    if (has('revision')) out.revision = pickRevision(described);
    if (has('date')) out.date = pickDate(described);
  }
  if (type === 'notice') {
    if (has('date')) out.date = pickDate(described);
    if (has('refNo')) out.refNo = pickNoticeReference(described, filename);
  }

  if (type === 'flag') {
    if (has('title')) out.title = pickSubject(described) || out.title;
    if (has('refNo')) out.refNo = pickNoticeReference(described, filename) || pickReference(described, filename);
    if (has('date')) out.date = pickDate(described);
    if (has('flagState')) out.flagState = pickFlagState(described, filename);
    if (has('docType')) out.docType = pickFlagDocType(described, filename, out.flagState);
    if (has('issuer')) out.issuer = pickAdministration(described);
  }
  if (type === 'manual' && has('vessel')) {
    // A ship name in the filename is a common convention: "MV Something - ...".
    const vessel = String(filename || '').match(/\b(?:MV|MT|MS|SS)\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?/i);
    if (vessel) out.vessel = tidy(vessel[0]);
  }

  // Never offer an empty suggestion.
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}
