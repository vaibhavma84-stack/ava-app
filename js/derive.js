// Derived values: sea time totals and certificate expiry status.

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

/**
 * Sea service days for one entry.
 *
 * Counted inclusive of both the sign-on and the sign-off day, which is how
 * sea service is reckoned on a discharge book. An entry with no sign-off date
 * is treated as still onboard and counted up to today.
 */
export function entryDays(entry) {
  const on = parseDate(entry.signOnDate);
  if (!on) return 0;
  const off = parseDate(entry.signOffDate) || todayUTC();
  if (off < on) return 0;
  return Math.floor((off - on) / MS_PER_DAY) + 1;
}

export function isOnboard(entry) {
  return Boolean(entry.signOnDate) && !entry.signOffDate;
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

/** Total sea time plus a per-rank breakdown, sorted by most time served. */
export function seaTimeSummary(entries) {
  let totalDays = 0;
  const byRankMap = new Map();

  for (const entry of entries) {
    const days = entryDays(entry);
    totalDays += days;
    const rank = entry.rank || 'Unspecified';
    const acc = byRankMap.get(rank) || { rank, days: 0, voyages: 0 };
    acc.days += days;
    acc.voyages += 1;
    byRankMap.set(rank, acc);
  }

  const byRank = [...byRankMap.values()].sort((a, b) => b.days - a.days);
  return { totalDays, byRank, voyages: entries.length };
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

export function displayDateShort(s) {
  if (!s) return '—';
  const d = parseDate(s);
  if (!d) return s;
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
