// The shorthand of an engine room and a cargo office.
//
// An alarm list says "ME LO INLET PRESS LOW"; the manual beside it says "main
// engine lubricating oil inlet pressure". A search for either should find
// both. Each line is one abbreviation and what it stands for -- first the
// abbreviation, then every way it is written out in full.
//
// Kept to the ones that are unambiguous on a ship. "LO" is lube oil here and
// never "low": alarm lists write LOW in full, and treating LO as low would
// bury every lube oil result under every low-level alarm.

export const ABBREVIATIONS = [
  ['me', 'main engine', 'main engines'],
  ['ae', 'auxiliary engine', 'aux engine', 'auxiliary engines'],
  ['ge', 'generator engine', 'generator engines'],
  ['dg', 'diesel generator', 'diesel generators'],
  ['edg', 'emergency diesel generator', 'emergency generator'],
  ['lo', 'lube oil', 'lubricating oil', 'lub oil'],
  ['fo', 'fuel oil'],
  ['hfo', 'heavy fuel oil'],
  ['mdo', 'marine diesel oil'],
  ['mgo', 'marine gas oil'],
  ['vlsfo', 'very low sulphur fuel oil', 'very low sulfur fuel oil'],
  ['fw', 'fresh water', 'freshwater'],
  ['sw', 'sea water', 'seawater'],
  ['cw', 'cooling water'],
  ['jcw', 'jacket cooling water', 'jacket water'],
  ['cfw', 'cooling fresh water'],
  ['ht', 'high temperature'],
  ['lt', 'low temperature'],
  ['sa', 'starting air'],
  ['ca', 'control air'],
  ['tc', 'turbocharger', 'turbo charger'],
  ['ecr', 'engine control room'],
  ['ccr', 'cargo control room'],
  ['er', 'engine room'],
  ['ows', 'oily water separator'],
  ['stp', 'sewage treatment plant'],
  ['bwts', 'ballast water treatment system', 'ballast water treatment'],
  ['bw', 'ballast water'],
  ['ig', 'inert gas'],
  ['igs', 'inert gas system'],
  ['igg', 'inert gas generator'],
  ['cot', 'cargo oil tank', 'cargo oil tanks'],
  ['cop', 'cargo oil pump', 'cargo oil pumps'],
  ['cow', 'crude oil washing', 'crude oil wash'],
  ['voc', 'volatile organic compound', 'volatile organic compounds'],
  ['pv', 'pressure vacuum', 'pressure/vacuum'],
  ['hpu', 'hydraulic power unit'],
  ['esd', 'emergency shutdown', 'emergency shut down', 'emergency shut-down'],
  ['fwg', 'fresh water generator'],
  ['aux', 'auxiliary'],
  ['blr', 'boiler'],
  ['gcu', 'gas combustion unit'],
  ['bog', 'boil off gas', 'boil-off gas'],
  ['lng', 'liquefied natural gas'],
  ['lpg', 'liquefied petroleum gas'],
  ['ppe', 'personal protective equipment'],
  ['ptw', 'permit to work'],
  ['msds', 'material safety data sheet', 'safety data sheet'],
  ['sds', 'safety data sheet'],
  ['ams', 'alarm monitoring system', 'alarm and monitoring system'],
  ['ums', 'unmanned machinery space', 'unattended machinery space'],
  ['mcr', 'maximum continuous rating'],
  ['rpm', 'revolutions per minute'],
  ['vfd', 'variable frequency drive'],
  ['msb', 'main switchboard', 'main switch board'],
  ['esb', 'emergency switchboard', 'emergency switch board'],
  ['acb', 'air circuit breaker'],
  ['ups', 'uninterruptible power supply'],
  ['ecdis', 'electronic chart display and information system', 'electronic chart display'],
  ['gmdss', 'global maritime distress and safety system'],
  ['epirb', 'emergency position indicating radio beacon'],
  ['sart', 'search and rescue transponder'],
  ['ais', 'automatic identification system'],
  ['vdr', 'voyage data recorder'],
  ['sms', 'safety management system'],
  ['ism', 'international safety management'],
  ['sopep', 'shipboard oil pollution emergency plan'],
  ['smpep', 'shipboard marine pollution emergency plan']
];

// Letters an abbreviation is also written with, between its characters:
// "L.O.", "L/O", "L-O". Only for the two- and three-letter ones, where it is
// the usual way of writing them on a drawing.
function spellings(abbr) {
  if (abbr.length > 3) return [abbr];
  const chars = abbr.split('');
  return [abbr, chars.join('.') + '.', chars.join('.'), chars.join('/'), chars.join('-')];
}

const byAbbr = new Map();
const byPhrase = new Map();
for (const [abbr, ...full] of ABBREVIATIONS) {
  byAbbr.set(abbr, { abbr, spellings: spellings(abbr), full });
  for (const phrase of full) byPhrase.set(phrase, byAbbr.get(abbr));
}

/** The entry for a word typed on its own, or null. */
export const expandAbbreviation = (word) => byAbbr.get(word) || null;

/**
 * The longest phrase that starts at words[i], as [entry, length], or null.
 * "lube oil inlet" starting at "lube" finds "lube oil" and uses two words.
 */
export function phraseAt(words, i) {
  let best = null;
  for (let n = Math.min(6, words.length - i); n >= 2; n--) {
    const entry = byPhrase.get(words.slice(i, i + n).join(' '));
    if (entry) { best = [entry, n]; break; }
  }
  return best;
}
