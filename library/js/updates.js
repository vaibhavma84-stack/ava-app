// Fetching notices straight from an administration.
//
// A browser will only read another site's response if that site sends CORS
// headers permitting it. GOV.UK's content and search APIs are public, but
// whether they allow a cross-origin read from this app — and whether the PDFs
// on assets.publishing.service.gov.uk do — cannot be settled from anywhere but
// a device with a connection.
//
// So this probes first and reports exactly what happened, rather than a feature
// that silently does nothing at sea.

const COLLECTION = 'https://www.gov.uk/api/content/government/collections/merchant-shipping-notices-msns';
const SEARCH = 'https://www.gov.uk/api/search.json'
  + '?filter_organisations=maritime-and-coastguard-agency'
  + '&q=merchant%20shipping%20notice&count=5&fields=title,link,public_timestamp';

async function attempt(label, url, read) {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' });
    const ms = Date.now() - started;
    if (!response.ok) {
      return { label, ok: false, status: response.status, ms, detail: `HTTP ${response.status}` };
    }
    const detail = await read(response);
    return { label, ok: true, status: response.status, ms, detail };
  } catch (ex) {
    // A CORS refusal surfaces as a TypeError with no status at all.
    return {
      label, ok: false, status: 0, ms: Date.now() - started,
      detail: `${ex?.name || 'Error'}: ${String(ex?.message || ex)}`.slice(0, 120),
      likelyCors: ex?.name === 'TypeError'
    };
  }
}

/** Try each route the feature would need, and report what the device can reach. */
export async function probeMcaFeed() {
  const results = [];

  results.push(await attempt('Collection API', COLLECTION, async (r) => {
    const data = await r.json();
    const groups = data?.details?.collection_groups || [];
    const linked = data?.links?.documents || [];
    const count = linked.length || groups.reduce((n, g) => n + (g.contents?.length || 0), 0);
    return `${count} documents listed`;
  }));

  results.push(await attempt('Search API', SEARCH, async (r) => {
    const data = await r.json();
    const first = data?.results?.[0];
    return `${data?.total ?? 0} results${first ? `, e.g. "${String(first.title).slice(0, 48)}"` : ''}`;
  }));

  // Only worth testing a PDF host if a listing came back with one to try.
  const listing = results.find((r) => r.ok && r.label === 'Search API');
  if (listing) {
    results.push(await attempt('Asset host', 'https://assets.publishing.service.gov.uk/', async (r) =>
      `reachable (HTTP ${r.status})`));
  }

  const canList = results.some((r) => r.ok);
  return {
    results,
    canList,
    verdict: canList
      ? 'Listings can be fetched on this device.'
      : 'This device cannot read GOV.UK directly from the app — see the detail below.'
  };
}
