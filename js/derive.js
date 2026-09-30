// Derived values: sea time totals and certificate expiry status.

import { CERT_CATEGORIES } from './schema.js';

const MS_PER_DAY = 86400000;

function parseDate(s) {
  if (!s) return null;
  // Date-only strings parse as UTC, so compare everything in UTC and stay DST-proof.
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function spanDays(from, to) {
  return to < from ? 0 : Math.floor((to - from) / MS_PER_DAY) + 1;
}

/**
 * The days an entry has actually been served: sign-on to sign-off, but never
 * past today. A sign-off still in the future is a planned date, not service.
 * Returns null for an entry with no usable sign-on, or one not yet started.
 */
function servedRange(entry, today = todayUTC()) {
  const on = parseDate(entry.signOnDate);
  if (!on || on > today) return null;
  const planned = parseDate(entry.signOffDate);
  const off = !planned || planned > today ? today : planned;
  if (off < on) return null;
  return { on, off };
}

/**
 * Sea service days for one entry.
 *
 * Counted inclusive of both the sign-on and the sign-off day, which is how
 * sea service is reckoned on a discharge book. An entry with no sign-off date
 * is treated as still onboard and counted up to today.
 */
export function entryDays(entry, today = todayUTC()) {
  const r = servedRange(entry, today);
  return r ? spanDays(r.on, r.off) : 0;
}

/** Onboard now: signed on, and either no sign-off or one still to come. */
export function isOnboard(entry, today = todayUTC()) {
  const on = parseDate(entry.signOnDate);
  if (!on || on > today) return false;
  const off = parseDate(entry.signOffDate);
  return !off || off >= today;
}

/** "X mo Y d" using 30-day months, the convention used on sea service letters. */
export function formatDuration(days) {
  if (!days) return '0 d';
  const months = Math.floor(days / 30);
  const rem = days % 30;
  if (!months) return `${rem} d`;
  if (!rem) return `${months} mo`;
  return `${months} mo ${rem} d`;
}

/**
 * Serve every entry's days once only. Entries are walked in sign-on order and
 * a day already claimed by an earlier entry is not counted again, so two
 * overlapping voyages (usually a mistyped date) cannot inflate the total.
 *
 * Returns one segment per entry that counts: the entry, its first and last
 * counted day, and how many of its days were already claimed.
 */
function countedSegments(entries, today) {
  const ranged = entries
    .map((entry) => ({ entry, range: servedRange(entry, today) }))
    .filter((x) => x.range)
    .sort((a, b) => a.range.on - b.range.on);

  let coveredTo = null;
  const out = [];
  for (const { entry, range } of ranged) {
    const from = coveredTo && coveredTo >= range.on ? addDays(coveredTo, 1) : range.on;
    const full = spanDays(range.on, range.off);
    const counted = spanDays(from, range.off);
    out.push({ entry, from, to: range.off, days: counted, overlap: full - counted });
    if (!coveredTo || range.off > coveredTo) coveredTo = range.off;
  }
  return out;
}

/** Days of the counted segments that fall between two dates, inclusive. */
function daysWithin(segments, from, to, keep = () => true) {
  let total = 0;
  for (const s of segments) {
    if (!s.days || !keep(s.entry)) continue;
    const a = s.from > from ? s.from : from;
    const b = s.to < to ? s.to : to;
    total += spanDays(a, b);
  }
  return total;
}

export const TANKER_TYPES = ['Crude Oil Tanker', 'Product Tanker', 'Chemical Tanker', 'LNG Carrier', 'LPG Carrier'];

function breakdown(segments, keyOf) {
  const map = new Map();
  for (const s of segments) {
    const key = keyOf(s.entry);
    const acc = map.get(key) || { key, days: 0, voyages: 0 };
    acc.days += s.days;
    acc.voyages += 1;
    map.set(key, acc);
  }
  return [...map.values()].sort((a, b) => b.days - a.days);
}

/**
 * Total sea time with breakdowns by rank and vessel type, sorted by most time
 * served. Overlapping days are counted once, against the earlier voyage.
 */
export function seaTimeSummary(entries, today = todayUTC()) {
  const segments = countedSegments(entries, today);
  const totalDays = segments.reduce((n, s) => n + s.days, 0);
  const byRank = breakdown(segments, (e) => e.rank || 'Unspecified')
    .map(({ key, ...rest }) => ({ rank: key, ...rest }));
  const byType = breakdown(segments, (e) => e.vesselType || 'Unspecified')
    .map(({ key, ...rest }) => ({ type: key, ...rest }));
  const tankerDays = segments
    .filter((s) => TANKER_TYPES.includes(s.entry.vesselType))
    .reduce((n, s) => n + s.days, 0);
  const overlapDays = segments.reduce((n, s) => n + s.overlap, 0);
  return { totalDays, byRank, byType, tankerDays, overlapDays, voyages: entries.length };
}

/**
 * Pairs of entries whose served dates overlap, with the shared day count.
 * Works on the raw entries so every clash is reported, not just the first.
 */
export function findOverlaps(entries, today = todayUTC()) {
  const ranged = entries
    .map((entry) => ({ entry, range: servedRange(entry, today) }))
    .filter((x) => x.range)
    .sort((a, b) => a.range.on - b.range.on);
  const out = [];
  for (let i = 0; i < ranged.length; i++) {
    for (let j = i + 1; j < ranged.length; j++) {
      const a = ranged[i].range, b = ranged[j].range;
      if (b.on > a.off) break;
      const days = spanDays(b.on, a.off < b.off ? a.off : b.off);
      if (days > 0) out.push({ a: ranged[i].entry, b: ranged[j].entry, days });
    }
  }
  return out;
}

/**
 * STCW revalidation (Reg. I/11, Section A-I/11): at least 12 months of sea
 * service in the preceding five years, or 3 months in the preceding six months.
 * Months are 30 days, matching the rest of AVA's arithmetic.
 */
export function revalidationStatus(entries, today = todayUTC()) {
  const segments = countedSegments(entries, today);
  const fiveYears = new Date(Date.UTC(today.getUTCFullYear() - 5, today.getUTCMonth(), today.getUTCDate()));
  const sixMonths = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, today.getUTCDate()));
  const last5y = daysWithin(segments, addDays(fiveYears, 1), today);
  const last6m = daysWithin(segments, addDays(sixMonths, 1), today);
  const need5y = 12 * 30, need6m = 3 * 30;
  return {
    last5y, last6m, need5y, need6m,
    met: last5y >= need5y || last6m >= need6m,
    short5y: Math.max(0, need5y - last5y)
  };
}

/**
 * Progress towards a sea time goal: service in one rank (any rank if blank),
 * counted from a date (all time if blank), against a target in months.
 */
export function goalProgress(entries, goal, today = todayUTC()) {
  const months = Number(goal?.goalMonths);
  if (!months || months <= 0) return null;
  const need = Math.round(months * 30);
  const since = parseDate(goal.goalSince) || new Date(0);
  const segments = countedSegments(entries, today);
  const served = daysWithin(segments, since, today, (e) => !goal.goalRank || e.rank === goal.goalRank);
  return { served, need, remaining: Math.max(0, need - served), done: served >= need, fraction: Math.min(1, served / need) };
}

/**
 * Where a voyage stands today: its day number, and the end of the contract --
 * the latest contract end date, else a sign-off date still to come.
 */
export function voyageProgress(entry, today = todayUTC()) {
  if (!isOnboard(entry, today)) return null;
  const on = parseDate(entry.signOnDate);
  const ends = (entry.contracts || []).map((c) => parseDate(c.endDate)).filter(Boolean);
  const off = parseDate(entry.signOffDate);
  if (off) ends.push(off);
  const end = ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;
  return {
    day: spanDays(on, today),
    endDate: end ? iso(end) : null,
    daysLeft: end ? Math.round((end - today) / MS_PER_DAY) : null
  };
}

/**
 * Problems with an entry's own dates, as sentences for the editor to show.
 * Blocking problems make the entry wrong; the rest are worth a second look.
 */
export function validateSeaTime(entry, others = [], today = todayUTC()) {
  const errors = [], warnings = [];
  const on = parseDate(entry.signOnDate), off = parseDate(entry.signOffDate);
  if (entry.signOffDate && !entry.signOnDate) errors.push('A sign-off date needs a sign-on date.');
  if (on && off && off < on) errors.push('Sign-off is before sign-on.');
  if (on && on > today) warnings.push('Sign-on is in the future, so it counts no sea time yet.');
  (entry.contracts || []).forEach((c, i) => {
    const a = parseDate(c.startDate), b = parseDate(c.endDate);
    if (a && b && b < a) errors.push(`Contract ${i + 1} ends before it starts.`);
  });
  if (!errors.length) {
    for (const { a, b, days } of findOverlaps([entry, ...others], today)) {
      if (a !== entry && b !== entry) continue;
      const other = a === entry ? b : a;
      warnings.push(`Overlaps ${other.vessel || 'another voyage'} by ${days} day${days === 1 ? '' : 's'}. Those days are only counted once.`);
    }
  }
  return { errors, warnings };
}

export const EXPIRY_WARNING_DAYS = 90;

/**
 * Expiry state for a certificate.
 * Returns one of: none | expired | soon | ok, with days remaining (negative if past).
 */
export function expiryStatus(expiryDate) {
  const exp = parseDate(expiryDate);
  if (!exp) return { state: 'none', days: null };
  const days = Math.round((exp - todayUTC()) / MS_PER_DAY);
  if (days < 0) return { state: 'expired', days };
  if (days <= EXPIRY_WARNING_DAYS) return { state: 'soon', days };
  return { state: 'ok', days };
}

export function expiryLabel({ state, days }) {
  if (state === 'expired') {
    const n = Math.abs(days);
    return n === 0 ? 'Expires today' : `Expired ${n} day${n === 1 ? '' : 's'} ago`;
  }
  if (state === 'soon') return days === 0 ? 'Expires today' : `${days} day${days === 1 ? '' : 's'} left`;
  if (state === 'ok') return `${days} days left`;
  return 'No expiry date';
}

/**
 * Which kind of certificate this is: the category chosen in the editor, or a
 * guess from its title for entries made before there was a choice.
 */
export function certificateCategory(data) {
  if (data.category && CERT_CATEGORIES.includes(data.category)) return data.category;
  const t = `${data.title || ''} ${data.issuer || ''}`.toLowerCase();
  if (/passport|visa|\bcdc\b|continuous discharge|seaman|seafarer'?s (identity|book)|discharge book|\bsid\b/.test(t)) return 'Travel document';
  if (/medical|\bpeme\b|yellow fever|vaccin|drug|alcohol|\bd ?& ?a\b/.test(t)) return 'Medical';
  if (/endorse|\bdce\b|dangerous cargo|\bgmdss\b|\bgoc\b|flag state/.test(t)) return 'Endorsement';
  if (/competen|\bcoc\b/.test(t)) return 'Certificate of Competency';
  return 'Training / STCW course';
}

/**
 * Certificates that lapse while you are away: for every voyage running now or
 * still to come, any certificate whose expiry falls between today and the end
 * of that voyage's contract.
 */
export function expiriesDuringVoyages(certificates, voyages, today = todayUTC()) {
  const out = [];
  for (const v of voyages) {
    const on = parseDate(v.signOnDate);
    if (!on) continue;
    const ends = (v.contracts || []).map((c) => parseDate(c.endDate)).filter(Boolean);
    const off = parseDate(v.signOffDate);
    if (off) ends.push(off);
    if (!ends.length) continue;
    const end = ends.reduce((a, b) => (b > a ? b : a));
    if (end < today) continue;
    const from = on > today ? on : today;
    for (const c of certificates) {
      const exp = parseDate(c.expiryDate);
      if (exp && exp >= from && exp <= end) {
        out.push({ certificate: c, voyage: v, expiryDate: iso(exp), endDate: iso(end) });
      }
    }
  }
  return out.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

/** Formats an ISO date (or YYYY-MM month) for display. */
export function displayDate(s) {
  if (!s) return '—';
  if (/^\d{4}-\d{2}$/.test(s)) {
    const d = new Date(s + '-01T00:00:00Z');
    return isNaN(d) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  const d = parseDate(s);
  if (!d) return s;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Compact but unambiguous: a two-digit year is guesswork on a service record. */
export function displayDateShort(s) {
  if (!s) return '—';
  const d = parseDate(s);
  if (!d) return s;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
