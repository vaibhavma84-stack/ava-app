// Every screen in Library is generated from these definitions: the list row,
// the detail view and the edit form. Adding a field is a one-line change.

import { IMO_LIST_URL } from './imo.js';

export const MANUAL_CATEGORIES = [
  'Deck', 'Engine', 'Safety', 'Cargo', 'Navigation', 'ISM / ISPS', 'MARPOL',
  'Machinery', 'Electrical', 'Company Procedures', 'Emergency', 'Other'
];

export const PUBLICATION_CATEGORIES = [
  'Chart', 'Sailing Directions', 'List of Lights', 'List of Radio Signals',
  'Tide Tables', 'Nautical Almanac', 'Notices to Mariners', 'IMO Convention',
  'Code / Guideline', 'Flag State', 'Company Manual', 'Other'
];

// What the fleet actually issues, replacing the generic list that was here
// before — this is the dropdown a Synergy circular is filed under, which is
// where these were asked for and where they were missing. More to come.
//
// A circular already filed under one of the old categories keeps it: the
// editor puts a stored value back as an option rather than changing it, and
// the filter chips are built from the entries themselves rather than from
// this list, so nothing already entered is disturbed or becomes unfindable.
export const CIRCULAR_CATEGORIES = [
  'Manager\u2019s Instructions',
  'QHSE',
  'Fleet Alert',
  'Safety Alert',
  'Other'
];

// This section holds the manuals and the procedures, so it is typed by what
// the document is. The four kinds of circular were briefly put here by
// mistake and have gone where they belong, on the circular's Category.
export const SYNERGY_DOC_TYPES = [
  'SMS Manual', 'Procedure', 'Circular', 'Form', 'Checklist', 'Policy',
  'Bulletin', 'Training', 'Fleet Instruction', 'Other'
];

// A local procedure is the ship's own working instruction -- how a job is
// actually done on this ship, which is not what the company manual says in
// general. Filed by the job rather than by the department, because that is
// what you are looking for when you go to find one.
export const LOCAL_PROCEDURE_CATEGORIES = [
  'Enclosed Space Entry', 'Mooring', 'Cargo Operations', 'Bunkering',
  'Hot Work', 'Working Aloft', 'Machinery Operation', 'Navigation / Bridge',
  'Emergency', 'Maintenance', 'Permit to Work', 'Other'
];

export const FLAG_STATES = ['MCA', 'Panama', 'Singapore', 'Other'];

/**
 * Order references the way a person reads them.
 *
 * "MGN 381" before "MGN 652" before "MGN 1905" — where comparing the strings
 * puts 1905 between 100 and 370, because '1' sorts before '3'. A reference
 * shelf in that order is no order at all: you cannot look along it for the one
 * you want.
 *
 * Split into runs of letters and runs of digits, and compare the digits as
 * numbers. That also does the right thing for "MMN 7-070" and "PC 01/2026"
 * without knowing anything about either.
 */
export function byReference(a, b) {
  const chunks = (text) => String(text || '').toUpperCase().match(/\d+|\D+/g) || [];
  const left = chunks(a);
  const right = chunks(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;   // "MGN 652" before "MGN 652 (M+F)"
    if (y === undefined) return 1;

    if (/^\d/.test(x) && /^\d/.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
      continue;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Where each administration publishes, for checking a held copy is still
 * current. These open in Safari, so they need a connection — the point is the
 * check you do alongside, not something the app can do at sea.
 */
export const FLAG_SOURCES = {
  MCA: [
    { label: 'MSNs', url: 'https://www.gov.uk/government/collections/merchant-shipping-notices-msns' },
    { label: 'MGNs', url: 'https://www.gov.uk/government/collections/active-marine-guidance-notes-mgns' },
    { label: 'MINs', url: 'https://www.gov.uk/government/collections/marine-information-notes-mins' }
  ],
  // /circulars/ is a 404 and had been for some time: Panama moved the whole
  // section under /segumar/. A button that sends you to a missing page to
  // check whether a notice is still current is worse than no button, and this
  // one was doing it silently. Each of these was opened and counted before it
  // was put here.
  Panama: [
    { label: 'Circulars', url: 'https://www.panamashipregistry.com/segumar/merchant-marine-circulars/' },
    { label: 'Notices', url: 'https://www.panamashipregistry.com/segumar/merchant-marine-circulars/marine-notices/' },
    { label: 'Cancelled', url: 'https://www.panamashipregistry.com/segumar/merchant-marine-circulars/cancelled-2/' },
    { label: 'Offshore', url: 'https://www.panamashipregistry.com/segumar/offshore-mmcs/' },
    { label: 'PSC', url: 'https://www.panamashipregistry.com/segumar/merchant-marine-circulars/psc-current/' }
  ],
  Singapore: [
    { label: 'Shipping', url: 'https://www.mpa.gov.sg/media-centre?type=Shipping+Circulars' },
    { label: 'Port Marine', url: 'https://www.mpa.gov.sg/media-centre?type=Port+Marine+Circulars' },
    { label: 'Notices', url: 'https://www.mpa.gov.sg/media-centre?type=Port+Marine+Notices' }
  ]
};

// Each administration issues its own classes of document, so the Type list
// follows the flag rather than offering everyone's terms to everyone.
export const FLAG_DOC_TYPES_BY_ADMIN = {
  MCA: [
    'MSN (Merchant Shipping Notice)',
    'MGN (Marine Guidance Note)',
    'MIN (Marine Information Note)',
    'Other'
  ],
  Panama: [
    'MMN (Merchant Marine Notice)',
    'Merchant Marine Circular',
    'Resolution',
    'Technical Alert',
    'Other'
  ],
  Singapore: [
    'Shipping Circular',
    'Port Marine Circular',
    'Marine Notice',
    'Other'
  ]
};

export const FLAG_DOC_TYPES = [
  'Marine Notice', 'Marine Circular', 'Merchant Marine Notice',
  'Marine Information Note', 'Technical Alert', 'Advisory', 'Amendment',
  'Instruction to ROs', 'Other'
];

export const NOTICE_SOURCES = [
  'Notice to Mariners', 'Marine Shipping Notice (MSN)', 'Marine Guidance Note (MGN)',
  'Marine Information Note (MIN)', 'Flag State', 'Classification Society',
  'Port State', 'P&I Club', 'Company', 'Other'
];

const FILE_LINK = {
  key: 'fileLink', label: 'Cloud link', type: 'url',
  placeholder: 'https://… (iCloud or Drive)',
  hint: 'For documents too large to hold on the phone.'
};

const ATTACHMENTS = {
  key: 'attachments', label: 'Files on this device', type: 'attachments',
  hint: 'PDFs are read for their text when added, so their contents become searchable.'
};

const NOTES = { key: 'notes', label: 'Notes', type: 'textarea' };

// Where a question is answered: a clause of a company document, held as a
// list on the question. Added from a search rather than typed -- the whole
// point is that you found the passage, and what is recorded is the passage you
// found, not a reference retyped from memory.
const ANSWERS = {
  key: 'answers', label: 'Answered by', type: 'answers',
  hint: 'The clauses of the company documents that answer this question. Added from a search.'
};

export const TYPES = {
  manual: {
    label: 'Manuals',
    short: 'Manuals',
    singular: 'Manual',
    icon: 'book',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Main Engine Operating Manual' },
      { key: 'category', label: 'Category', type: 'select', options: MANUAL_CATEGORIES },
      { key: 'vessel', label: 'Vessel', type: 'text', group: 'where', suggestFrom: true },
      { key: 'location', label: 'Location onboard', type: 'text', group: 'where', placeholder: 'e.g. ECR shelf 3' },
      { ...NOTES, label: 'Notes / extracted procedures' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['category'],
    // Manuals are filed by ship, then by what kind of manual they are.
    groupBy: { key: 'vessel', label: 'Vessel', blank: 'No vessel set' },
    subGroupBy: { key: 'category', label: 'Type', blank: 'Uncategorised' },
    collapsible: true,
    // A stack of manuals imported at once arrives with no ship and no type,
    // and they are all for the same ship. Setting that one at a time is the
    // work the import was meant to save.
    bulkFields: ['vessel', 'category'],
    // Dozens of documents and thousands of pages: nobody reads them one at a
    // time, so the whole section can be queued and worked through.
    bulkRead: true,
    filterBy: { key: 'category', label: 'Type' },
    sort: (a, b) => (a.category || '').localeCompare(b.category || '')
                 || (a.title || '').localeCompare(b.title || '')
  },

  local: {
    label: 'Local Procedures',
    short: 'Local',
    singular: 'Local procedure',
    icon: 'clipboard',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Entry into cargo compressor room' },
      { key: 'category', label: 'Job', type: 'select', options: LOCAL_PROCEDURE_CATEGORIES },
      { keepCase: true, key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. LP-07', group: 'ident' },
      { keepCase: true, key: 'revision', label: 'Revision', type: 'text', placeholder: 'e.g. Rev 2', group: 'ident' },
      { key: 'vessel', label: 'Vessel', type: 'text', group: 'where', suggestFrom: true },
      { key: 'location', label: 'Location onboard', type: 'text', group: 'where', placeholder: 'e.g. Ship\u2019s office' },
      { key: 'date', label: 'Issued', type: 'date' },
      {
        key: 'revisionChecked', label: 'Revision checked', type: 'date',
        hint: 'When you last confirmed this is still the current revision. The app flags it after 90 days \u2014 a superseded copy is worse than no copy.'
      },
      { ...NOTES, label: 'Notes / what differs from the company procedure' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'revision'],
    tracksRevision: true,
    // Same shape as the manuals: the ship, then the job, then the procedures.
    // A procedure belongs to one ship and moves with her, so a stack brought
    // aboard at once is set to the ship in one go.
    groupBy: { key: 'vessel', label: 'Vessel', blank: 'No vessel set' },
    subGroupBy: { key: 'category', label: 'Job', blank: 'Unsorted' },
    collapsible: true,
    bulkFields: ['vessel', 'category'],
    // Dozens of documents and thousands of pages: nobody reads them one at a
    // time, so the whole section can be queued and worked through.
    bulkRead: true,
    filterBy: { key: 'category', label: 'Job' },
    sort: (a, b) => (a.category || '').localeCompare(b.category || '')
                 || (a.title || '').localeCompare(b.title || '')
  },

  // A vetting question set, held as one entry per question, so a question can
  // be looked up by its number and carry the company clauses that answer it.
  //
  // The questions are not shipped with the app. They are OCIMF's, they differ
  // by vessel type, and they are revised -- so what the app holds is the shape
  // of a question and the links out of it, and the questions themselves come
  // off the copy on the phone.
  sire: {
    label: 'SIRE 2.0',
    short: 'SIRE',
    singular: 'SIRE question',
    icon: 'inspect',
    titleKey: 'title',
    fields: [
      { keepCase: true, key: 'refNo', label: 'Question', type: 'text', required: true, placeholder: 'e.g. 2.1', group: 'ident' },
      { key: 'chapter', label: 'Chapter', type: 'text', group: 'ident', suggestFrom: true, placeholder: 'e.g. Chapter 2' },
      { key: 'title', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Maintenance of statutory certificates' },
      { key: 'vessel', label: 'Applies to', type: 'text', placeholder: 'e.g. All vessels' },
      { ...NOTES, label: 'Notes / evidence to show' },
      ANSWERS,
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo'],
    groupBy: { key: 'chapter', label: 'Chapter', blank: 'No chapter set' },
    collapsible: true,
    bulkFields: ['chapter', 'vessel'],
    // The chapter is in the question number, so it is not asked for twice.
    // Typed over freely afterwards -- "Chapter 2" becomes "2 \u2014 Certification"
    // once, and every question after it is offered that.
    derive: (data) => {
      const number = String(data.refNo || '').trim();
      if (!data.chapter && /^\d/.test(number)) data.chapter = `Chapter ${number.split('.')[0]}`;
    },
    // Ascending: a question set is read from 1.1 down, not newest first.
    sort: (a, b) => byReference(a.refNo, b.refNo) || (a.title || '').localeCompare(b.title || '')
  },

  publication: {
    label: 'Publications',
    short: 'Pubs',
    singular: 'Publication',
    icon: 'library',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Admiralty List of Radio Signals Vol 1' },
      { keepCase: true, key: 'refNo', label: 'Number', type: 'text', placeholder: 'e.g. NP281(1)', group: 'ident' },
      { keepCase: true, key: 'edition', label: 'Edition / year', type: 'text', placeholder: 'e.g. 2026', group: 'ident' },
      { key: 'category', label: 'Category', type: 'select', options: PUBLICATION_CATEGORIES },
      { key: 'publisher', label: 'Publisher', type: 'text', placeholder: 'e.g. UKHO' },
      { keepCase: true, key: 'correctedTo', label: 'Corrected to', type: 'text', placeholder: 'e.g. NtM 12/2026' },
      { key: 'vessel', label: 'Vessel', type: 'text', group: 'where', suggestFrom: true },
      { key: 'location', label: 'Location onboard', type: 'text', group: 'where' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'edition'],
    // Filed under what kind of publication it is, so the conventions sit
    // together as their own section rather than mixed in among the charts.
    groupBy: { key: 'category', label: 'Category', blank: 'Uncategorised' },
    filterBy: { key: 'category', label: 'Type' },
    bulkRead: true,
    sources: { IMO: [{ label: 'Conventions', url: IMO_LIST_URL }] },
    sort: (a, b) => (a.title || '').localeCompare(b.title || '')
  },

  synergy: {
    label: 'Synergy',
    short: 'Synergy',
    singular: 'Synergy document',
    icon: 'file',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Shipboard Safety Management Manual' },
      { key: 'docType', label: 'Document type', type: 'select', options: SYNERGY_DOC_TYPES },
      { keepCase: true, key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. SMS-04', group: 'ident' },
      { keepCase: true, key: 'revision', label: 'Revision', type: 'text', placeholder: 'e.g. Rev 7', group: 'ident' },
      { key: 'date', label: 'Date', type: 'date' },
      {
        key: 'revisionChecked', label: 'Revision checked', type: 'date',
        hint: 'When you last confirmed this is still the current revision. The app flags it after 90 days — a superseded copy is worse than no copy.'
      },
      { key: 'department', label: 'Department', type: 'text', placeholder: 'e.g. HSEQ' },
      { key: 'vessel', label: 'Applies to', type: 'text', placeholder: 'e.g. All vessels' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'revision'],
    tracksRevision: true,
    bulkRead: true,
    filterBy: { key: 'docType', label: 'Type' },
    sort: (a, b) => (a.docType || '').localeCompare(b.docType || '')
                 || (a.title || '').localeCompare(b.title || '')
  },

  flag: {
    label: 'Flag Circulars',
    short: 'Flag',
    singular: 'Flag circular',
    icon: 'flag',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Implementation of MARPOL Annex VI amendments' },
      { key: 'flagState', label: 'Flag / Administration', type: 'select', options: FLAG_STATES },
      {
        key: 'docType', label: 'Type', type: 'select', options: FLAG_DOC_TYPES,
        // Narrows to the chosen administration's own document classes.
        optionsBy: { key: 'flagState', map: FLAG_DOC_TYPES_BY_ADMIN }
      },
      { keepCase: true, key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. MMN 7-070', group: 'ident' },
      { key: 'date', label: 'Date issued', type: 'date', group: 'ident' },
      { key: 'issuer', label: 'Issued by', type: 'text', placeholder: 'e.g. Panama Maritime Authority' },
      { key: 'supersedes', label: 'Supersedes', type: 'text', placeholder: 'e.g. MMN 7-070 Rev 2' },
      { key: 'vessel', label: 'Applies to', type: 'text', placeholder: 'e.g. All Panama-flagged vessels' },
      { ...NOTES, label: 'Summary' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'docType'],
    // sourceUrl is written by the MCA sync and is not edited by hand.
    // Filed by flag, since an officer serves under one at a time.
    groupBy: { key: 'flagState', label: 'Flag / Administration', blank: 'No flag set' },
    // And by class of notice inside each flag. Fourteen hundred circulars in
    // one list is not something anyone browses, and the numbering already
    // says how people look for them: you look for an MGN, not for a notice.
    subGroupBy: { key: 'docType', label: 'Type', blank: 'Unclassified' },
    collapsible: true,
    sources: FLAG_SOURCES,
    filterBy: { key: 'docType', label: 'Type' },
    // By number, not by date. A shelf of notices is looked along for the one
    // you want — "where is MGN 652" — and when it was issued says nothing
    // about where to find it. Type first, so the MGNs sit together and the
    // MSNs after them rather than interleaved by number.
    //
    // Highest number first within each type: the newest notice carries the
    // highest number, so the top of the list is where this year's are.
    sort: (a, b) => (a.docType || '').localeCompare(b.docType || '')
                 || -byReference(a.refNo, b.refNo)
                 || (b.date || '').localeCompare(a.date || '')
  },

  circular: {
    label: 'Circulars',
    short: 'Circulars',
    singular: 'Circular',
    icon: 'megaphone',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Revised bunkering procedure' },
      { keepCase: true, key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. FC-2026-014', group: 'ident' },
      { key: 'date', label: 'Date issued', type: 'date', group: 'ident' },
      { key: 'issuer', label: 'Issued by', type: 'text', placeholder: 'e.g. Fleet Technical' },
      { key: 'relatedTo', label: 'Related to', type: 'text', placeholder: 'e.g. Tank cleaning' },
      { key: 'category', label: 'Category', type: 'select', options: CIRCULAR_CATEGORIES },
      { key: 'vessel', label: 'Applies to', type: 'text', placeholder: 'e.g. All vessels' },
      { ...NOTES, label: 'Summary' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'issuer'],
    filterBy: { key: 'category', label: 'Category' },
    sort: (a, b) => (b.date || '').localeCompare(a.date || '')
  },

  notice: {
    label: 'Notices',
    short: 'Notices',
    singular: 'Notice',
    icon: 'alert',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Amendment to SOLAS Ch. V' },
      { key: 'source', label: 'Source', type: 'select', options: NOTICE_SOURCES },
      { keepCase: true, key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. MGN 654 (M)', group: 'ident' },
      { key: 'date', label: 'Date', type: 'date', group: 'ident' },
      { key: 'area', label: 'Area / subject', type: 'text', placeholder: 'e.g. North Sea, navigation warnings' },
      { ...NOTES, label: 'Summary' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'source'],
    filterBy: { key: 'source', label: 'Source' },
    sort: (a, b) => (b.date || '').localeCompare(a.date || '')
  }
};

// Order shown on the sections screen, left to right.
// 'notice' is defined above but parked: it is not listed here, so nothing
// renders it, and any records already saved under it stay untouched. Adding it
// back to this list restores both the section and its entries.
export const TAB_ORDER = ['publication', 'manual', 'local', 'synergy', 'flag', 'circular', 'sire'];
