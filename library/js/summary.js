// What a run of fetching says when it finishes.
//
// Its own module because it is worth testing, and the panel it belongs to
// cannot be reached from a test: the documents are same-origin, so the service
// worker fetches them and route interception never sees the request. Making
// the sentence a function is the difference between checked and hoped.

/**
 * @param {object} run
 * @param {number} run.held      documents that came down
 * @param {number} run.bytes     what they weighed
 * @param {number} run.missing   listed, but the site holds no document
 * @param {string[]} run.failures references of the ones that would not come
 * @param {boolean} run.stopped  whether it was interrupted
 */
export function fetchSummary({ held = 0, bytes = 0, missing = 0, failures = [], stopped = false }) {
  // Which ones, not how many. "1 could not be fetched" out of 373 is a number
  // with nothing to act on: it does not say whether the connection dropped for
  // a moment or a document is gone for good, and those want different things
  // done about them.
  const named = failures.slice(0, 3).join(', ')
    + (failures.length > 3 ? ` and ${failures.length - 3} more` : '');

  return `${held} document${held === 1 ? '' : 's'} fetched, ${(bytes / 1048576).toFixed(1)} MB`
    + (missing ? ` · ${missing} not held on the site` : '')
    + (failures.length ? ` · could not fetch ${named} — tap again to retry` : '')
    + (stopped ? ' · stopped' : '');
}
