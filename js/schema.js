// Every screen in AVA is generated from these definitions: the list row, the
// detail view, and the edit form. Adding a field is a one-line change here.

export const VESSEL_TYPES = [
  'Bulk Carrier', 'Container', 'Crude Oil Tanker', 'Product Tanker', 'Chemical Tanker',
  'LNG Carrier', 'LPG Carrier', 'General Cargo', 'Ro-Ro', 'PCC / PCTC',
  'Passenger / Cruise', 'Offshore / OSV', 'Tug', 'Dredger', 'Other'
];

export const RANKS = [
  'Master', 'Chief Officer', 'Second Officer', 'Third Officer', 'Deck Cadet',
  'Chief Engineer', 'Second Engineer', 'Third Engineer', 'Fourth Engineer', 'Engine Cadet',
  'Electro-Technical Officer', 'Bosun', 'Able Seafarer', 'Ordinary Seafarer',
  'Fitter', 'Oiler', 'Wiper', 'Chief Cook', 'Steward', 'Other'
];

export const PUBLICATION_CATEGORIES = [
  'Chart', 'Sailing Directions', 'List of Lights', 'List of Radio Signals',
  'Tide Tables', 'Nautical Almanac', 'Notices to Mariners', 'IMO Convention',
  'Code / Guideline', 'Flag State', 'Company Manual', 'Other'
];

export const MANUAL_CATEGORIES = [
  'Deck', 'Engine', 'Safety', 'Cargo', 'Navigation', 'ISM / ISPS', 'MARPOL',
  'Machinery', 'Electrical', 'Company Procedures', 'Emergency', 'Other'
];

const FILE_LINK = {
  key: 'fileLink', label: 'Cloud link', type: 'url',
  placeholder: 'https://… (iCloud or Drive)',
  hint: 'For documents too large to keep on the phone — links out to iCloud Drive, Google Drive or Dropbox.'
};

const ATTACHMENTS = {
  key: 'attachments', label: 'Files on this device', type: 'attachments',
  hint: 'Scans, PDFs and photos, encrypted and stored inside AVA. Available with no signal.'
};

const NOTES = { key: 'notes', label: 'Notes', type: 'textarea' };

export const TYPES = {
  manual: {
    label: 'Ship Manuals',
    short: 'Manuals',
    singular: 'Manual',
    icon: 'book',
    titleKey: 'title',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Main Engine Operating Manual' },
      { key: 'category', label: 'Category', type: 'select', options: MANUAL_CATEGORIES },
      { key: 'vessel', label: 'Vessel', type: 'text', placeholder: 'e.g. MV Northern Star' },
      { key: 'location', label: 'Location', type: 'text', placeholder: 'e.g. ECR bookshelf, folder 3' },
      { ...NOTES, label: 'Notes / extracted procedures', hint: 'Paste the procedures or key figures you actually need at hand.' },
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['category', 'vessel', 'location'],
    sort: (a, b) => (a.title || '').localeCompare(b.title || '')
  },

  certificate: {
    label: 'Certificates',
    short: 'Certs',
    singular: 'Certificate',
    icon: 'award',
    titleKey: 'title',
    tracksExpiry: true,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. STCW Basic Safety Training' },
      { key: 'issuer', label: 'Issuer', type: 'text', placeholder: 'e.g. DG Shipping' },
      { key: 'refNo', label: 'Reference no.', type: 'text' },
      { key: 'issueDate', label: 'Issue date', type: 'date' },
      { key: 'expiryDate', label: 'Expiry date', type: 'date' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['issuer', 'refNo'],
    // Soonest expiry first; undated entries sink to the bottom.
    sort: (a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999')
  },

  seatime: {
    label: 'Sea Time',
    short: 'Sea Time',
    singular: 'Sea time entry',
    icon: 'anchor',
    titleKey: 'vessel',
    fields: [
      { key: 'vessel', label: 'Vessel', type: 'text', required: true, placeholder: 'e.g. MV Northern Star' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'vesselType', label: 'Vessel type', type: 'select', options: VESSEL_TYPES },
      { key: 'rank', label: 'Rank', type: 'select', options: RANKS },
      { key: 'grt', label: 'GRT', type: 'number', group: 'tonnage' },
      { key: 'nrt', label: 'NRT', type: 'number', group: 'tonnage' },
      { key: 'kw', label: 'KW', type: 'number', group: 'tonnage' },
      // Two per row: four across is unusable on a phone, and "Official number"
      // is abbreviated so its label stays on one line.
      { key: 'flag', label: 'Flag', type: 'text', group: 'registry1' },
      { key: 'officialNumber', label: 'Off. No.', type: 'text', group: 'registry1' },
      { key: 'imo', label: 'IMO No.', type: 'text', group: 'registry2' },
      { key: 'callSign', label: 'Call sign', type: 'text', group: 'registry2' },
      { key: 'signOnDate', label: 'Sign-on date', type: 'date', group: 'signon' },
      { key: 'signOnPort', label: 'Sign-on port', type: 'text', group: 'signon' },
      { key: 'signOffDate', label: 'Sign-off date', type: 'date', group: 'signoff' },
      { key: 'signOffPort', label: 'Sign-off port', type: 'text', group: 'signoff' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK,
      { key: 'contracts', label: 'Contracts', type: 'contracts', max: 5 }
    ],
    sort: (a, b) => (b.signOnDate || '').localeCompare(a.signOnDate || '')
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
      { key: 'correctedTo', label: 'Corrected to', type: 'text', placeholder: 'e.g. NtM 12/2026', group: 'status' },
      { key: 'vessel', label: 'Vessel', type: 'text', group: 'status' },
      { key: 'location', label: 'Location onboard', type: 'text', placeholder: 'e.g. Chart room' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK
    ],
    listFields: ['refNo', 'edition', 'vessel'],
    sort: (a, b) => (a.title || '').localeCompare(b.title || '')
  },

  note: {
    label: 'Important Notes',
    short: 'Notes',
    singular: 'Note',
    icon: 'bookmark',
    titleKey: 'title',
    pinnable: true,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Note', type: 'textarea', rows: 10 },
      ATTACHMENTS,
      FILE_LINK
    ],
    sort: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  }
};

export const TAB_ORDER = ['manual', 'certificate', 'seatime', 'publication', 'note'];

export const CONTRACT_FIELDS = [
  { key: 'company', label: 'Company / agency', type: 'text' },
  { key: 'position', label: 'Position', type: 'text' },
  { key: 'wage', label: 'Wage', type: 'text', placeholder: 'e.g. USD 4,200 / month' },
  { key: 'startDate', label: 'Start date', type: 'date', group: 'dates' },
  { key: 'endDate', label: 'End date', type: 'date', group: 'dates' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];
