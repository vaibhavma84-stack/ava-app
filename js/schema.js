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

export const CERT_CATEGORIES = [
  'Certificate of Competency', 'Endorsement', 'Training / STCW course', 'Medical', 'Travel document', 'Other'
];

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

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
  certificate: {
    label: 'Certificates',
    short: 'Certs',
    singular: 'Certificate',
    icon: 'award',
    titleKey: 'title',
    tracksExpiry: true,
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. STCW Basic Safety Training' },
      { key: 'category', label: 'Kind', type: 'select', options: CERT_CATEGORIES,
        hint: 'Decides where it goes on your CV. Left blank, AVA guesses from the title.' },
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
      { key: 'dwt', label: 'DWT', type: 'number', group: 'tonnage2' },
      { key: 'engine', label: 'Main engine', type: 'text', group: 'tonnage2', placeholder: 'e.g. MAN B&W' },
      // Two per row: four across is unusable on a phone, and "Official number"
      // is abbreviated so its label stays on one line.
      { key: 'flag', label: 'Flag', type: 'text', group: 'registry1' },
      { key: 'officialNumber', label: 'Off. No.', type: 'text', group: 'registry1' },
      { key: 'imo', label: 'IMO No.', type: 'text', group: 'registry2' },
      { key: 'callSign', label: 'Call sign', type: 'text', group: 'registry2' },
      // Full width each: a WebKit date input will not shrink below its
      // intrinsic width, so pairing one with a port field made it overlap.
      { key: 'signOnDate', label: 'Sign-on date', type: 'date' },
      { key: 'signOnPort', label: 'Sign-on port', type: 'text', placeholder: 'e.g. Singapore' },
      { key: 'signOffDate', label: 'Sign-off date', type: 'date' },
      { key: 'signOffPort', label: 'Sign-off port', type: 'text', placeholder: 'e.g. Rotterdam' },
      { key: 'letterStatus', label: 'Sea service letter', type: 'select', options: ['Received', 'Requested', 'Not yet'],
        hint: 'The company\'s letter or testimonial for this voyage. Attach it below once you have it.' },
      NOTES,
      ATTACHMENTS,
      FILE_LINK,
      { key: 'contracts', label: 'Contracts', type: 'contracts', max: 5 }
    ],
    sort: (a, b) => (b.signOnDate || '').localeCompare(a.signOnDate || '')
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
  },

  // One per vault, reached from Settings rather than a tab. It holds what the
  // CV needs that no other entry does, and the sea time goal.
  profile: {
    label: 'Profile',
    short: 'Profile',
    singular: 'Profile',
    icon: 'bookmark',
    titleKey: 'fullName',
    singleton: true,
    fields: [
      { type: 'heading', label: 'For your CV' },
      { key: 'fullName', label: 'Full name', type: 'text', placeholder: 'As in your passport' },
      { key: 'positionApplied', label: 'Position applied for', type: 'select', options: RANKS },
      { key: 'availableFrom', label: 'Available from', type: 'date' },
      { key: 'dateOfBirth', label: 'Date of birth', type: 'date', group: 'birth' },
      { key: 'placeOfBirth', label: 'Place of birth', type: 'text', group: 'birth' },
      { key: 'nationality', label: 'Nationality', type: 'text', group: 'nat' },
      { key: 'maritalStatus', label: 'Marital status', type: 'text', group: 'nat' },
      { key: 'phone', label: 'Phone', type: 'text', placeholder: 'With country code' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea', rows: 3 },
      { key: 'nearestAirport', label: 'Nearest airport', type: 'text' },
      { key: 'summary', label: 'Professional summary', type: 'textarea', rows: 5,
        placeholder: 'e.g. Chief Officer with 6 years on crude and product tankers, experienced in cargo planning, STS operations and SIRE/CDI inspections.' },
      { key: 'skills', label: 'Cargo & operational experience', type: 'textarea', rows: 5,
        hint: 'One per line — cargoes, STS, ECDIS types, inspections, PMS or cargo software.' },
      { key: 'languages', label: 'Languages', type: 'text', placeholder: 'e.g. English (fluent), Hindi' },
      { key: 'education', label: 'Education', type: 'textarea', rows: 3 },
      { key: 'references', label: 'References', type: 'textarea', rows: 4,
        hint: 'Master or superintendent: name, company, phone or email.' },
      { type: 'heading', label: 'For bio-data forms' },
      { key: 'seafarerId', label: 'National seafarer ID', type: 'text', placeholder: 'e.g. INDoS no.' },
      { key: 'nokName', label: 'Next of kin', type: 'text', group: 'nok' },
      { key: 'nokRelation', label: 'Relationship', type: 'text', group: 'nok' },
      { key: 'nokPhone', label: 'Next of kin phone', type: 'text' },
      { key: 'nokAddress', label: 'Next of kin address', type: 'textarea', rows: 2 },
      { key: 'height', label: 'Height (cm)', type: 'number', group: 'body' },
      { key: 'weight', label: 'Weight (kg)', type: 'number', group: 'body' },
      { key: 'boilerSuit', label: 'Boiler suit size', type: 'text', group: 'kit' },
      { key: 'shoeSize', label: 'Shoe size', type: 'text', group: 'kit' },
      { key: 'bloodGroup', label: 'Blood group', type: 'text', group: 'blood' },
      { key: 'religion', label: 'Religion / diet', type: 'text', group: 'blood' },
      { type: 'heading', label: 'Sea time goal' },
      { key: 'goalLabel', label: 'Working towards', type: 'text', placeholder: 'e.g. Master CoC' },
      { key: 'goalRank', label: 'Service that counts, as', type: 'select', options: RANKS,
        hint: 'Leave blank to count service in any rank.' },
      { key: 'goalMonths', label: 'Months needed', type: 'number', group: 'goal' },
      { key: 'goalSince', label: 'Counted from', type: 'date', group: 'goal' },
      { type: 'heading', label: 'Days abroad for tax' },
      { key: 'taxYearStart', label: 'Tax year starts in', type: 'select', options: MONTH_NAMES, group: 'tax' },
      { key: 'taxDaysTarget', label: 'Days abroad needed', type: 'number', group: 'tax' },
      { type: 'hint', label: 'Counts your days at sea in each tax year. Check the number your country uses for non-residence, and add any travel days yourself.' },
      { type: 'heading', label: 'Photo' },
      { key: 'attachments', label: 'Passport photo', type: 'attachments',
        hint: 'The first picture here goes on your CV. Kept encrypted on this device.' }
    ]
  }
};

export const TAB_ORDER = ['certificate', 'seatime', 'note'];

export const CONTRACT_FIELDS = [
  { key: 'company', label: 'Company / agency', type: 'text' },
  { key: 'position', label: 'Position', type: 'text' },
  { key: 'wage', label: 'Wage', type: 'text', placeholder: 'e.g. USD 4,200 / month' },
  { key: 'startDate', label: 'Start date', type: 'date', group: 'dates' },
  { key: 'endDate', label: 'End date', type: 'date', group: 'dates' },
  { key: 'notes', label: 'Notes', type: 'textarea' }
];
