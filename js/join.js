// "Ready to join?" -- which certificates a rank on a kind of ship usually
// needs, and whether each one on file stays valid for the whole contract.
//
// The list is the STCW baseline most companies ask for, not any one flag's or
// company's rules: items a company may or may not want are marked optional,
// so a gap there is a question rather than a failure.

import { certificateCategory } from './derive.js';

const DECK_OFFICERS = ['Master', 'Chief Officer', 'Second Officer', 'Third Officer'];
const ENGINE_OFFICERS = ['Chief Engineer', 'Second Engineer', 'Third Engineer', 'Fourth Engineer', 'Electro-Technical Officer'];
const MANAGEMENT = ['Master', 'Chief Officer', 'Chief Engineer', 'Second Engineer'];

const text = (c) => `${c.title || ''} ${c.issuer || ''} ${c.refNo || ''}`.toLowerCase();
const has = (re) => (c) => re.test(text(c));

/** Which cargo a tanker type carries, for matching its tanker training. */
function tankerCargo(vesselType) {
  if (vesselType === 'Crude Oil Tanker' || vesselType === 'Product Tanker') return { word: 'oil', re: /\boil\b|petroleum/ };
  if (vesselType === 'Chemical Tanker') return { word: 'chemical', re: /chemical/ };
  if (vesselType === 'LNG Carrier' || vesselType === 'LPG Carrier') return { word: 'liquefied gas', re: /\bgas\b|lng|lpg|liquefied/ };
  return null;
}

/**
 * The checklist for a rank and ship type. Each item has an id, a label, a
 * test for whether a certificate satisfies it, and whether it is optional.
 */
export function requirementsFor(rank, vesselType) {
  const deck = DECK_OFFICERS.includes(rank);
  const engine = ENGINE_OFFICERS.includes(rank);
  const officer = deck || engine;
  const management = MANAGEMENT.includes(rank);
  const list = [];
  const add = (id, label, match, optional = false, note = '') => list.push({ id, label, match, optional, note });

  if (officer) {
    add('coc', 'Certificate of Competency', (c) => certificateCategory(c) === 'Certificate of Competency');
    add('flag', 'Flag state endorsement', has(/flag|endorsement of|\bcoe\b|recognition/), true, 'If the ship\'s flag requires one');
  }
  if (deck) add('gmdss', 'GMDSS GOC', has(/gmdss|\bgoc\b|radio operator/));
  add('bst', 'Basic Safety Training', has(/basic safety|\bbst\b|personal survival|\bpst\b|\bfpff\b|elementary first aid|\bpssr\b/));
  add('pscrb', 'Survival craft & rescue boats (PSCRB)', has(/survival craft|pscrb|rescue boat/), !officer);
  if (officer) add('aff', 'Advanced Fire Fighting', has(/advanced fire|\baff\b/));
  if (management) add('medcare', 'Medical Care', has(/medical care|\bmecare\b/));
  else if (officer) add('mfa', 'Medical First Aid', has(/medical first aid|\bmfa\b|medical care/));
  add('security', 'Security training (SAT / SDSD / SSO)', has(/security|\bsso\b|\bsdsd\b|\bsat\b/));
  if (deck) add('ecdis', 'ECDIS', has(/ecdis/));
  if (officer) add('rm', deck ? 'Bridge resource management' : 'Engine room resource management',
    has(/resource management|\bbrm\b|\bbtm\b|\berm\b|\bbrtm\b|leadership/), true);

  const cargo = tankerCargo(vesselType);
  if (cargo) {
    add('tanker-basic', `Basic ${cargo.word} tanker training`,
      (c) => cargo.re.test(text(c)) && /tanker|cargo operation|basic|advanced|\bdce\b|endorse/.test(text(c)));
    if (officer) {
      add('tanker-adv', `Advanced ${cargo.word} tanker training / DCE`,
        (c) => cargo.re.test(text(c)) && /advanced|\bdce\b|endorse/.test(text(c)));
    }
  }

  add('medical', 'Medical fitness certificate',
    (c) => certificateCategory(c) === 'Medical' && !/first aid|medical care/.test(text(c)));
  add('passport', 'Passport', has(/passport/));
  add('cdc', 'CDC / Seaman\'s book', has(/\bcdc\b|continuous discharge|seaman'?s book|seafarer'?s (identity|record) ?book|discharge book/));
  add('usvisa', 'US C1/D visa', has(/c1 ?\/ ?d|\bus visa|united states|\bvisa\b/), true, 'If trading to the US');
  add('yellowfever', 'Yellow fever vaccination', has(/yellow fever/), true, 'If trading to Africa or South America');
  return list;
}

function parse(iso) {
  return iso ? new Date(iso + 'T00:00:00Z') : null;
}

/**
 * Check the certificates on file against the checklist for a contract.
 *
 * Each result is one of:
 *   ok        valid until after the contract ends (or never expires)
 *   lapses    valid on joining, expires before the contract ends
 *   expired   already expired on the joining date
 *   missing   nothing on file matches (for an optional item: 'optional')
 */
export function checkReadiness(certificates, { rank, vesselType, joinDate, endDate }) {
  const join = parse(joinDate);
  const end = parse(endDate) || join;
  const results = requirementsFor(rank, vesselType).map((req) => {
    const matches = certificates.filter((c) => req.match(c));
    if (!matches.length) return { ...req, status: req.optional ? 'optional' : 'missing', certificate: null };
    // The one that lasts longest decides: a renewed certificate beats the old one.
    const best = matches.reduce((a, b) => {
      if (!a.expiryDate) return a;
      if (!b.expiryDate) return b;
      return b.expiryDate > a.expiryDate ? b : a;
    });
    const exp = parse(best.expiryDate);
    let status = 'ok';
    if (exp && join && exp < join) status = 'expired';
    else if (exp && end && exp < end) status = 'lapses';
    return { ...req, status, certificate: best };
  });

  // Anything else on file that runs out during the contract is worth knowing.
  const used = new Set(results.map((r) => r.certificate).filter(Boolean));
  const others = certificates.filter((c) => {
    if (used.has(c) || !c.expiryDate) return false;
    const exp = parse(c.expiryDate);
    return join && end && exp >= join && exp < end;
  });

  const count = (s) => results.filter((r) => r.status === s).length;
  return {
    results,
    others,
    ready: !results.some((r) => ['missing', 'expired', 'lapses'].includes(r.status)),
    counts: { ok: count('ok'), lapses: count('lapses'), expired: count('expired'), missing: count('missing'), optional: count('optional') }
  };
}
