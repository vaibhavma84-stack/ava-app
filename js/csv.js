// Import sea service or certificates from a spreadsheet saved as CSV.
//
// Columns are matched by name, loosely -- "Ship", "Vessel name" and "Vessel"
// all mean the vessel -- so a seafarer's own sheet usually works as it is.
// Dates are read the same way a scanned certificate's are (day first), and
// every row is shown before anything is saved.

import { findDates } from './scan.js';
import { RANKS, VESSEL_TYPES, CERT_CATEGORIES } from './schema.js';

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  // Excel in many locales separates with semicolons; pick whichever the header uses more.
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === sep) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some(Boolean));
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Field -> header words that mean it, most specific first.
const SEA_COLUMNS = {
  vessel: ['vessel name', 'ship name', 'name of vessel', 'name of ship', 'vessel', 'ship'],
  company: ['company', 'manager', 'managers', 'employer', 'operator', 'owner'],
  vesselType: ['vessel type', 'ship type', 'type of vessel', 'type of ship', 'type'],
  rank: ['rank', 'position', 'capacity', 'designation'],
  grt: ['grt', 'gt', 'gross tonnage', 'gross'],
  nrt: ['nrt', 'nt', 'net tonnage'],
  dwt: ['dwt', 'deadweight'],
  kw: ['kw', 'engine power', 'power', 'bhp'],
  engine: ['main engine', 'engine make', 'engine type', 'engine'],
  flag: ['flag'],
  imo: ['imo no', 'imo number', 'imo'],
  officialNumber: ['official no', 'official number', 'off no'],
  callSign: ['call sign', 'callsign'],
  signOnDate: ['sign on date', 'signed on', 'sign on', 'signon', 'date of joining', 'joining date', 'joined', 'from', 'start'],
  signOnPort: ['sign on port', 'port of joining', 'joining port', 'place of joining'],
  signOffDate: ['sign off date', 'signed off', 'sign off', 'signoff', 'date of leaving', 'leaving date', 'left', 'to', 'end'],
  signOffPort: ['sign off port', 'port of leaving', 'leaving port', 'place of leaving'],
  notes: ['notes', 'remarks', 'comments']
};

const CERT_COLUMNS = {
  title: ['certificate name', 'certificate', 'course name', 'course', 'document', 'title', 'name'],
  category: ['kind', 'category', 'type'],
  issuer: ['issued by', 'issuing authority', 'issuer', 'authority', 'place of issue'],
  refNo: ['certificate no', 'certificate number', 'cert no', 'document no', 'number', 'no', 'ref'],
  issueDate: ['date of issue', 'issue date', 'issued on', 'issued', 'issue'],
  expiryDate: ['date of expiry', 'expiry date', 'valid until', 'valid till', 'expires', 'expiry', 'validity'],
  notes: ['notes', 'remarks', 'comments']
};

const DATE_FIELDS = new Set(['signOnDate', 'signOffDate', 'issueDate', 'expiryDate']);
const NUMBER_FIELDS = new Set(['grt', 'nrt', 'dwt', 'kw']);

/**
 * Which column holds which field. A header matches the field whose words it
 * equals, else starts with; ports are checked before dates so "Sign on port"
 * is not taken as a date. Each column is used once.
 */
function mapHeaders(headers, columns) {
  const order = Object.keys(columns).sort((a, b) => /Port$/.test(b) - /Port$/.test(a));
  const map = {};
  const used = new Set();
  for (const pass of ['exact', 'prefix', 'contains']) {
    for (const field of order) {
      if (field in map) continue;
      for (const word of columns[field]) {
        const i = headers.findIndex((h, idx) => !used.has(idx) && (
          pass === 'exact' ? norm(h) === word
            : pass === 'prefix' ? norm(h).startsWith(word + ' ') || norm(h) === word
              : word.length > 3 && norm(h).includes(word)));
        if (i >= 0) { map[field] = i; used.add(i); break; }
      }
    }
  }
  return map;
}

/** One cell as an ISO date, or null. */
export function csvDate(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // A bare number is an Excel serial date (days since 1899-12-30).
  if (/^\d{5}$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return findDates(v)[0]?.iso || null;
}

/** The closest of a fixed list of options, so "2/O" or "second off." still lands on a rank. */
function pickOption(value, options) {
  const v = norm(value);
  if (!v) return '';
  const exact = options.find((o) => norm(o) === v);
  if (exact) return exact;
  const aliases = {
    'c o': 'Chief Officer', 'ch off': 'Chief Officer', 'chief mate': 'Chief Officer', 'c m': 'Chief Officer',
    '2 o': 'Second Officer', '2nd officer': 'Second Officer', '2nd off': 'Second Officer', 'second mate': 'Second Officer',
    '3 o': 'Third Officer', '3rd officer': 'Third Officer', '3rd off': 'Third Officer', 'third mate': 'Third Officer',
    'c e': 'Chief Engineer', '2 e': 'Second Engineer', '2nd engineer': 'Second Engineer', '3 e': 'Third Engineer',
    '3rd engineer': 'Third Engineer', '4 e': 'Fourth Engineer', '4th engineer': 'Fourth Engineer',
    'eto': 'Electro-Technical Officer', 'capt': 'Master', 'captain': 'Master', 'd c': 'Deck Cadet', 'cadet': 'Deck Cadet',
    'ab': 'Able Seafarer', 'os': 'Ordinary Seafarer', 'bulker': 'Bulk Carrier', 'bulk': 'Bulk Carrier',
    'container ship': 'Container', 'containership': 'Container', 'crude tanker': 'Crude Oil Tanker',
    'oil tanker': 'Crude Oil Tanker', 'product': 'Product Tanker', 'chemical': 'Chemical Tanker',
    'oil chemical tanker': 'Chemical Tanker', 'lng': 'LNG Carrier', 'lpg': 'LPG Carrier', 'general cargo ship': 'General Cargo',
    'car carrier': 'PCC / PCTC', 'pctc': 'PCC / PCTC', 'pcc': 'PCC / PCTC', 'cruise': 'Passenger / Cruise', 'osv': 'Offshore / OSV'
  };
  const alias = aliases[v];
  if (alias && options.includes(alias)) return alias;
  const loose = options.find((o) => norm(o).startsWith(v) || v.startsWith(norm(o)));
  return loose || value;   // keep the sheet's own wording rather than lose it
}

/**
 * Turn parsed CSV rows into AVA entries. Decides from the headers whether the
 * sheet holds sea service or certificates. Returns the kind, the entries,
 * per-row problems, which columns were recognised, and any rows skipped as
 * already in the vault.
 */
export function rowsToEntries(rows, { existing = [], kind = null } = {}) {
  if (rows.length < 2) return { kind: null, entries: [], problems: ['The file has no rows under its header.'], columns: {} };
  const headers = rows[0];
  const sea = mapHeaders(headers, SEA_COLUMNS);
  const cert = mapHeaders(headers, CERT_COLUMNS);
  const seaScore = ['vessel', 'signOnDate', 'signOffDate', 'rank'].filter((f) => f in sea).length;
  const certScore = ['title', 'expiryDate', 'issueDate', 'refNo'].filter((f) => f in cert).length;
  kind ||= seaScore >= 2 && seaScore >= certScore ? 'seatime' : certScore >= 2 ? 'certificate' : null;
  if (!kind) {
    return { kind: null, entries: [], problems: ['Could not tell what this sheet holds. It needs columns such as Vessel, Sign on and Sign off, or Certificate and Expiry.'], columns: {} };
  }
  const map = kind === 'seatime' ? sea : cert;

  const entries = [], problems = [], skipped = [];
  const key = (d) => kind === 'seatime'
    ? `${norm(d.vessel)}|${d.signOnDate || ''}`
    : `${norm(d.title)}|${norm(d.refNo)}|${d.expiryDate || ''}`;
  const seen = new Set(existing.map(key));

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const data = {};
    for (const [field, col] of Object.entries(map)) {
      const raw = row[col] ?? '';
      if (!raw) continue;
      if (DATE_FIELDS.has(field)) {
        const d = csvDate(raw);
        if (d) data[field] = d;
        else problems.push(`Row ${line}: could not read "${raw}" as a date.`);
      } else if (NUMBER_FIELDS.has(field)) {
        const n = raw.replace(/[^\d.]/g, '');
        if (n) data[field] = n;
      } else if (field === 'rank') data.rank = pickOption(raw, RANKS);
      else if (field === 'vesselType') data.vesselType = pickOption(raw, VESSEL_TYPES);
      else if (field === 'category') { const c = pickOption(raw, CERT_CATEGORIES); if (CERT_CATEGORIES.includes(c)) data.category = c; }
      else data[field] = raw;
    }
    const required = kind === 'seatime' ? 'vessel' : 'title';
    if (!data[required]) {
      if (Object.keys(data).length) problems.push(`Row ${line}: no ${required === 'vessel' ? 'vessel name' : 'certificate name'}, skipped.`);
      return;
    }
    if (kind === 'seatime' && data.signOnDate && data.signOffDate && data.signOffDate < data.signOnDate) {
      problems.push(`Row ${line}: ${data.vessel} signs off before it signs on.`);
    }
    if (seen.has(key(data))) { skipped.push(data); return; }
    seen.add(key(data));
    entries.push(data);
  });

  const columns = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, headers[i]]));
  return { kind, entries, problems, skipped, columns };
}

/** A blank sheet with the columns AVA reads, for filling in. */
export function templateCsv(kind) {
  const heads = kind === 'certificate'
    ? ['Certificate', 'Kind', 'Number', 'Issued by', 'Issue date', 'Expiry date', 'Notes']
    : ['Vessel', 'Company', 'Vessel type', 'Rank', 'GRT', 'DWT', 'kW', 'Main engine', 'Flag', 'IMO', 'Sign on date', 'Sign on port', 'Sign off date', 'Sign off port', 'Notes'];
  const example = kind === 'certificate'
    ? ['STCW Basic Safety Training', 'Training / STCW course', 'BST-0001', 'DG Shipping', '10/06/2021', '09/06/2026', '']
    : ['MV Example', 'Example Shipping', 'Bulk Carrier', 'Second Officer', '38500', '74000', '9480', 'MAN B&W', 'Panama', '9345678', '10/01/2024', 'Singapore', '09/07/2024', 'Rotterdam', ''];
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [heads, example].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
