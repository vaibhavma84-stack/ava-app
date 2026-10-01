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

/** The latest contract end, else the sign-off date: when a voyage is due to end. */
function plannedEnd(entry) {
  const ends = (entry.contracts || []).map((c) => parseDate(c.endDate)).filter(Boolean);
  const off = parseDate(entry.signOffDate);
  if (off) ends.push(off);
  return ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null;
}

/**
 * Days at sea in a tax year, for the residency rules that count days outside
 * the country. The tax year starts on the first of startMonth (1-12).
 *
 * served   days already at sea this tax year, each counted once
 * planned  served plus what current and planned contracts will add before
 *          the year ends; an open voyage with no end date adds nothing
 */
export function taxYearDays(entries, { startMonth = 1, target = null } = {}, today = todayUTC()) {
  const { start, end } = taxYearBounds(startMonth, today);

  const served = daysWithin(countedSegments(entries, today), start, today);

  // Project forward: each voyage runs to its planned end, and an open one
  // with no end date stops today rather than being assumed to run all year.
  const projected = entries.map((e) => {
    const endDate = plannedEnd(e);
    return { ...e, signOffDate: endDate ? iso(endDate) : e.signOffDate || iso(today) };
  });
  const planned = daysWithin(countedSegments(projected, end), start, end);

  const goal = Number(target) > 0 ? Number(target) : null;
  return {
    start: iso(start), end: iso(end), served, planned,
    target: goal,
    remaining: goal ? Math.max(0, goal - served) : null,
    plannedShort: goal ? Math.max(0, goal - planned) : null,
    daysLeftInYear: spanDays(today, end) - 1
  };
}

/**
 * Where a voyage stands today: its day number, and the end of the contract --
 * the latest contract end date, else a sign-off date still to come.
 */
export function voyageProgress(entry, today = todayUTC()) {
  if (!isOnboard(entry, today)) return null;
  const on = parseDate(entry.signOnDate);
  const end = plannedEnd(entry);
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

/** The tax year (starting on the 1st of startMonth, 1-12) that a date falls in. */
function taxYearBounds(startMonth, date) {
  const m = Math.min(12, Math.max(1, Number(startMonth) || 1)) - 1;
  let startYear = date.getUTCFullYear();
  if (date.getUTCMonth() < m) startYear--;
  return {
    start: new Date(Date.UTC(startYear, m, 1)),
    end: addDays(new Date(Date.UTC(startYear + 1, m, 1)), -1)
  };
}

// ── time at home ──────────────────────────────────────────────────────────

const average = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * Where you stand between ships: days at home since the last sign-off, your
 * usual time aboard and at home (from completed voyages), and the next
 * joining -- a planned voyage if one is entered, else an estimate from the
 * usual leave.
 */
export function leaveStatus(entries, today = todayUTC()) {
  const voyages = entries
    .map((e) => ({ on: parseDate(e.signOnDate), off: parseDate(e.signOffDate), entry: e }))
    .filter((v) => v.on)
    .sort((a, b) => a.on - b.on);
  const done = voyages.filter((v) => v.off && v.off <= today && v.off >= v.on);
  const tours = done.map((v) => spanDays(v.on, v.off));
  const gaps = [];
  for (let i = 1; i < done.length; i++) {
    const gap = Math.round((done[i].on - done[i - 1].off) / MS_PER_DAY) - 1;
    if (gap > 0) gaps.push(gap);
  }
  const onboard = voyages.some((v) => isOnboard(v.entry, today));
  const last = done[done.length - 1] || null;
  const next = voyages.find((v) => v.on > today) || null;
  const usualLeave = average(gaps.slice(-4));
  const status = {
    onboard,
    usualTour: average(tours.slice(-4)),
    usualLeave,
    lastSignOff: last ? iso(last.off) : null,
    daysHome: !onboard && last ? Math.round((today - last.off) / MS_PER_DAY) : null,
    nextJoin: next ? iso(next.on) : null,
    nextVessel: next ? next.entry.vessel || '' : null,
    daysToJoin: next ? Math.round((next.on - today) / MS_PER_DAY) : null,
    expectedJoin: null
  };
  if (!onboard && !next && last && usualLeave) status.expectedJoin = iso(addDays(last.off, usualLeave + 1));
  return status;
}

// ── earnings ──────────────────────────────────────────────────────────────

const CURRENCY_WORDS = { '$': 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', 'RS': 'INR', 'RS.': 'INR' };

/**
 * Read a wage typed as free text: "USD 4,200 / month", "$150 per day",
 * "4200 EUR". The period defaults to monthly. Returns null if no amount.
 */
export function parseWage(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const amount = /(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/i.exec(t);
  if (!amount) return null;
  let value = Number(amount[1].replace(/,/g, ''));
  if (amount[2]) value *= 1000;
  if (!value) return null;
  const code = /\b([A-Z]{3})\b/.exec(t.toUpperCase().replace(/\b(PER|DAY|MONTH|WEEK|YEAR|PCM|BASIC|WAGE|TOTAL|NET)\b/g, ''));
  const symbol = /(US\$|\$|€|£|₹|\bRS\.?)/i.exec(t);
  const currency = code ? code[1] : symbol ? CURRENCY_WORDS[symbol[1].toUpperCase()] : '';
  const period = /\b(day|daily|per diem)\b/i.test(t) ? 'day' : /\b(year|annum|annual)/i.test(t) ? 'year' : 'month';
  return { amount: value, currency, period };
}

function dailyRate({ amount, period }) {
  if (period === 'day') return amount;
  if (period === 'year') return amount / 365;
  return (amount * 12) / 365;
}

/**
 * Pay from each contract with a wage: what has been earned so far and what
 * the whole contract comes to. A contract's dates default to its voyage's.
 * Approximate: a monthly wage is spread over the year's days.
 */
export function contractEarnings(entries, today = todayUTC()) {
  const out = [];
  for (const e of entries) {
    for (const c of e.contracts || []) {
      const wage = parseWage(c.wage);
      if (!wage) continue;
      const start = parseDate(c.startDate) || parseDate(e.signOnDate);
      const end = parseDate(c.endDate) || parseDate(e.signOffDate);
      if (!start) continue;
      const rate = dailyRate(wage);
      const servedTo = end && end < today ? end : today;
      const earnedDays = start > today ? 0 : spanDays(start, servedTo);
      out.push({
        vessel: e.vessel || '', company: c.company || e.company || '', wage,
        start: iso(start), end: end ? iso(end) : null, rate,
        earned: Math.round(rate * earnedDays),
        total: end ? Math.round(rate * spanDays(start, end)) : null
      });
    }
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}

/** Earnings inside the current tax year, by currency: earned so far and expected by its end. */
export function earningsThisTaxYear(entries, { startMonth = 1 } = {}, today = todayUTC()) {
  const { start, end } = taxYearBounds(startMonth, today);
  const totals = {};
  for (const c of contractEarnings(entries, today)) {
    const cs = parseDate(c.start), ce = c.end ? parseDate(c.end) : today;
    const a = cs > start ? cs : start;
    const earnedTo = ce < today ? ce : today;
    const plannedTo = ce < end ? ce : end;
    const t = totals[c.wage.currency || '—'] ||= { currency: c.wage.currency || '', earned: 0, expected: 0 };
    t.earned += Math.round(c.rate * spanDays(a, earnedTo < end ? earnedTo : end));
    t.expected += Math.round(c.rate * spanDays(a, plannedTo));
  }
  return { start: iso(start), end: iso(end), totals: Object.values(totals) };
}

// ── sea service letters ───────────────────────────────────────────────────

/** Completed voyages with and without a sea service letter on file. */
export function letterStatus(entries, today = todayUTC()) {
  const done = entries.filter((e) => e.signOnDate && e.signOffDate && parseDate(e.signOffDate) <= today);
  const has = (e) => e.letterStatus === 'Received';
  return {
    total: done.length,
    received: done.filter(has).length,
    missing: done.filter((e) => !has(e)).sort((a, b) => (b.signOnDate || '').localeCompare(a.signOnDate || ''))
  };
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
  if (/medical (first aid|care)|\bmfa\b|\bmecare\b/.test(t)) return 'Training / STCW course';
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
    const end = plannedEnd(v);
    if (!end || end < today) continue;
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
