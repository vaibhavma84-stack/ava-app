// Staleness of a controlled document.
//
// A company document is only trustworthy while it matches the revision the
// office holds. A copy on a phone cannot know when it was superseded, so the
// app tracks the last time you confirmed it against the company system and
// says so plainly once that check is old.

export const CHECK_DUE_DAYS = 90;
const MS_PER_DAY = 86400000;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * @returns { state: 'never' | 'due' | 'ok', days }
 *   never — no check recorded, so the revision is unverified
 *   due   — last checked longer ago than CHECK_DUE_DAYS
 *   ok    — checked recently
 */
export function revisionStatus(data, dueDays = CHECK_DUE_DAYS) {
  const checked = parseDate(data?.revisionChecked);
  if (!checked) return { state: 'never', days: null };
  const days = Math.floor((todayUTC() - checked) / MS_PER_DAY);
  return { state: days > dueDays ? 'due' : 'ok', days };
}

export function revisionLabel({ state, days }) {
  if (state === 'never') return 'Revision unverified';
  if (state === 'due') return `Check revision — ${days} days`;
  if (days === 0) return 'Checked today';
  return `Checked ${days} day${days === 1 ? '' : 's'} ago`;
}

/** How many documents in a set need re-checking against the company system. */
export function countDue(items, dueDays = CHECK_DUE_DAYS) {
  let due = 0;
  for (const item of items) {
    const { state } = revisionStatus(item.data, dueDays);
    if (state !== 'ok') due++;
  }
  return due;
}
