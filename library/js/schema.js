// Every screen in Library is generated from these definitions: the list row,
// the detail view and the edit form. Adding a field is a one-line change.

export const MANUAL_CATEGORIES = [
  'Deck', 'Engine', 'Safety', 'Cargo', 'Navigation', 'ISM / ISPS', 'MARPOL',
  'Machinery', 'Electrical', 'Company Procedures', 'Emergency', 'Other'
];

export const PUBLICATION_CATEGORIES = [
  'Chart', 'Sailing Directions', 'List of Lights', 'List of Radio Signals',
  'Tide Tables', 'Nautical Almanac', 'Notices to Mariners', 'IMO Convention',
  'Code / Guideline', 'Flag State', 'Company Manual', 'Other'
];

export const CIRCULAR_CATEGORIES = [
  'Fleet', 'Technical', 'Safety', 'Operational', 'Crewing', 'HSEQ',
  'Security', 'Environmental', 'Commercial', 'Other'
];

export const SYNERGY_DOC_TYPES = [
  'SMS Manual', 'Procedure', 'Circular', 'Form', 'Checklist', 'Policy',
  'Bulletin', 'Training', 'Fleet Instruction', 'Other'
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
      { key: 'vessel', label: 'Vessel', type: 'text', group: 'where' },
      { key: 'location', label: 'Location onboard', type: 'text', group: 'where', placeholder: 'e.g. ECR shelf 3' },
      { ...NOTES, label: 'Notes / extracted procedures' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['category'],
    // Manuals are filed by ship, then by what kind of manual they are.
    groupBy: { key: 'vessel', label: 'Vessel', blank: 'No vessel set' },
    filterBy: { key: 'category', label: 'Type' },
    sort: (a, b) => (a.category || '').localeCompare(b.category || '')
                 || (a.title || '').localeCompare(b.title || '')
  },

  publication: {
    label: 'Publications',
    short: 'Pubs',
    singular: 'Publication',
    icon: 'library',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Admiralty List of Radio Signals Vol 1' },
      { key: 'refNo', label: 'Number', type: 'text', placeholder: 'e.g. NP281(1)', group: 'ident' },
      { key: 'edition', label: 'Edition / year', type: 'text', placeholder: 'e.g. 2026', group: 'ident' },
      { key: 'category', label: 'Category', type: 'select', options: PUBLICATION_CATEGORIES },
      { key: 'publisher', label: 'Publisher', type: 'text', placeholder: 'e.g. UKHO' },
      { key: 'correctedTo', label: 'Corrected to', type: 'text', placeholder: 'e.g. NtM 12/2026' },
      { key: 'vessel', label: 'Vessel', type: 'text', group: 'where' },
      { key: 'location', label: 'Location onboard', type: 'text', group: 'where' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'edition'],
    filterBy: { key: 'category', label: 'Type' },
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
      { key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. SMS-04', group: 'ident' },
      { key: 'revision', label: 'Revision', type: 'text', placeholder: 'e.g. Rev 7', group: 'ident' },
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
    filterBy: { key: 'docType', label: 'Type' },
    sort: (a, b) => (a.docType || '').localeCompare(b.docType || '')
                 || (a.title || '').localeCompare(b.title || '')
  },

  circular: {
    label: 'Circulars',
    short: 'Circulars',
    singular: 'Circular',
    icon: 'megaphone',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Revised bunkering procedure' },
      { key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. FC-2026-014', group: 'ident' },
      { key: 'date', label: 'Date issued', type: 'date', group: 'ident' },
      { key: 'issuer', label: 'Issued by', type: 'text', placeholder: 'e.g. Fleet Technical' },
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
      { key: 'refNo', label: 'Reference', type: 'text', placeholder: 'e.g. MGN 654 (M)', group: 'ident' },
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
export const TAB_ORDER = ['publication', 'manual', 'synergy', 'circular'];
