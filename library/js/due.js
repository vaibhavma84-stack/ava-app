// Documents with a date to be looked at again by.
//
// A circular to be reviewed, a publication that expires, an MI to be re-read:
// each carries a review or expiry date, and the ones coming up are listed on
// the home screen a month ahead -- and stay listed once the date has passed,
// until the date is moved on or cleared, because a date that has passed
// quietly is exactly the one that matters.

export const DUE_AHEAD_DAYS = 30;
const MS_PER_DAY = 86400000;

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function todayUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * @returns { state: 'overdue' | 'today' | 'soon' | 'later' | null, days }
 *   days until the date: negative once it has passed.
 */
export function dueStatus(date, { now = new Date(), ahead = DUE_AHEAD_DAYS } = {}) {
  const d = parseDate(date);
  if (!d) return { state: null, days: null };
  const days = Math.round((d - todayUTC(now)) / MS_PER_DAY);
  const state = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= ahead ? 'soon' : 'later';
  return { state, days };
}

export function dueLabel({ state, days }) {
  if (state === 'overdue') return `Overdue ${-days} day${days === -1 ? '' : 's'}`;
  if (state === 'today') return 'Due today';
  if (state === 'soon' || state === 'later') return `Due in ${days} day${days === 1 ? '' : 's'}`;
  return '';
}

/** Entries due within the month or overdue, the most pressing first. */
export function dueSoon(items, options = {}) {
  return items
    .map((item) => ({ item, ...dueStatus(item.data?.reviewBy, options) }))
    .filter((d) => d.state && d.state !== 'later')
    .sort((a, b) => a.days - b.days);
}
