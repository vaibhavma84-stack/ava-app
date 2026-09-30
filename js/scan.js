// Turn the words read off a certificate into form fields.
//
// OCR text is untidy: lines out of order, O for 0, labels on one line and
// their values on the next. So this looks for what a certificate always has --
// dates beside words like "issue" and "expiry", a number beside "No." -- and
// fills only what it is reasonably sure of. The form shows what was filled,
// and anything left blank is typed as before.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12
};

// Certificate names worth recognising, most specific first.
const TITLES = [
  [/certificate of competen\w*/i, 'Certificate of Competency'],
  [/continuous discharge certificate|\bc\.?d\.?c\b/i, 'Continuous Discharge Certificate (CDC)'],
  [/seafarer'?s identity document|\bsid\b/i, 'Seafarer\'s Identity Document'],
  [/\bpassport\b/i, 'Passport'],
  [/yellow fever/i, 'Yellow Fever Vaccination'],
  [/gmdss|general operator'?s certificate/i, 'GMDSS General Operator\'s Certificate'],
  [/advanced (training for )?oil (and chemical )?tanker/i, 'Advanced Oil Tanker Cargo Operations'],
  [/advanced (training for )?chemical tanker/i, 'Advanced Chemical Tanker Cargo Operations'],
  [/advanced (training for )?(liquefied )?gas tanker/i, 'Advanced Liquefied Gas Tanker Cargo Operations'],
  [/(basic )?(training for )?oil and chemical tanker/i, 'Basic Oil and Chemical Tanker Cargo Operations'],
  [/(basic )?(training for )?liquefied gas tanker/i, 'Basic Liquefied Gas Tanker Cargo Operations'],
  [/dangerous cargo endorsement|\bdce\b/i, 'Dangerous Cargo Endorsement'],
  [/proficiency in survival craft|pscrb|survival craft and rescue boats/i, 'Proficiency in Survival Craft and Rescue Boats'],
  [/advanced fire ?fighting/i, 'Advanced Fire Fighting'],
  [/medical first aid/i, 'Medical First Aid'],
  [/medical care/i, 'Medical Care'],
  [/ship security officer/i, 'Ship Security Officer'],
  [/security awareness/i, 'Security Awareness Training'],
  [/designated security duties/i, 'Seafarers with Designated Security Duties'],
  [/ecdis/i, 'ECDIS'],
  [/bridge (team|resource) management/i, 'Bridge Resource Management'],
  [/engine (room )?resource management/i, 'Engine Room Resource Management'],
  [/high voltage/i, 'High Voltage Safety'],
  [/personal survival techniques/i, 'Personal Survival Techniques'],
  [/fire prevention and fire ?fighting/i, 'Fire Prevention and Fire Fighting'],
  [/elementary first aid/i, 'Elementary First Aid'],
  [/personal safety and social responsibilit/i, 'Personal Safety and Social Responsibilities'],
  [/basic safety training/i, 'STCW Basic Safety Training'],
  [/medical (fitness|examination)|fit for (sea|duty)|\bpeme\b/i, 'Medical Fitness Certificate'],
  [/\bvisa\b/i, 'Visa']
];

const ISSUE_WORDS = /(date of issue|issue date|issued on|date issued|issued|valid from|date of grant|\bissue\b)/i;
const EXPIRY_WORDS = /(date of expiry|expiry date|expiration|expires|valid until|valid till|valid up ?to|valid through|expiry|\bvalidity\b)/i;
const BIRTH_WORDS = /(date of birth|birth|\bdob\b|born)/i;

function pad(n) {
  return String(n).padStart(2, '0');
}

function isoOf(y, m, d) {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;   // 31 Feb and the like
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Common OCR slips inside numbers: O for 0, l or I for 1, S for 5. */
function digits(s) {
  return s.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5');
}

/**
 * Every date in a line of text, as ISO strings with their position. Numeric
 * dates are read day first, the way certificates outside the US write them,
 * unless the first number cannot be a day.
 */
export function findDates(line) {
  const out = [];
  const push = (index, iso) => { if (iso) out.push({ index, iso }); };
  let m;

  const numeric = /\b([0-9oOlI]{1,2})\s*[./-]\s*([0-9oOlI]{1,2})\s*[./-]\s*([0-9oOlI]{4}|[0-9oOlI]{2})\b/g;
  while ((m = numeric.exec(line))) {
    const [a, b, y] = [m[1], m[2], m[3]].map((x) => Number(digits(x)));
    push(m.index, a > 12 || b <= 12 ? isoOf(y, b, a) : isoOf(y, a, b));
  }
  const isoLike = /\b(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/g;
  while ((m = isoLike.exec(line))) push(m.index, isoOf(Number(m[1]), Number(m[2]), Number(m[3])));

  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?[\s./-]*([A-Za-z]{3,9})[\s.,/-]*(\d{4}|\d{2})\b/g;
  while ((m = dayMonth.exec(line))) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) push(m.index, isoOf(Number(m[3]), month, Number(m[1])));
  }
  const monthDay = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;
  while ((m = monthDay.exec(line))) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month) push(m.index, isoOf(Number(m[3]), month, Number(m[2])));
  }
  return out.sort((x, y) => x.index - y.index);
}

const LABEL = /date|valid|expir|issue|birth|examination|grant/i;
const isLabelOnly = (line) => LABEL.test(line) && !findDates(line).length;

/**
 * The date that belongs to a label: on the same line after it, else on the
 * line below. Where labels are stacked above their values ("Date of issue",
 * "Date of expiry", then two dates), the second label takes the second date.
 */
function dateNear(lines, words) {
  for (let i = 0; i < lines.length; i++) {
    const hit = words.exec(lines[i]);
    if (!hit) continue;
    const after = findDates(lines[i]).filter((d) => d.index >= hit.index);
    if (after.length) return after[0].iso;
    if (!isLabelOnly(lines[i])) continue;
    let first = i, last = i;
    while (first > 0 && isLabelOnly(lines[first - 1])) first--;
    while (last + 1 < lines.length && isLabelOnly(lines[last + 1])) last++;
    const value = lines[last + 1 + (i - first)];
    const dates = value ? findDates(value) : [];
    if (dates.length) return dates[0].iso;
  }
  return null;
}

function findNumber(lines) {
  const labelled = /(certificate|cert|passport|document|licen[cs]e|serial|reg(istration)?|ref(erence)?|cdc|indos)\.?\s*(no|number|n°|#)\.?\s*[:.-]?\s*([A-Z0-9][A-Z0-9/ .-]{2,24}[A-Z0-9])/i;
  const bare = /\b(no|number|n°)\.?\s*[:.-]\s*([A-Z0-9][A-Z0-9/.-]{2,24})/i;
  for (const line of lines) {
    const m = labelled.exec(line);
    if (m) return m[5].replace(/\s{2,}.*/, '').trim();
  }
  for (const line of lines) {
    const m = bare.exec(line);
    if (m && /\d/.test(m[2])) return m[2].trim();
  }
  // A passport's machine-readable line starts P< and carries its number.
  const mrz = lines.find((l) => /^P[<A-Z][A-Z]{3}/.test(l.replace(/\s/g, '')));
  if (mrz) {
    const next = lines[lines.indexOf(mrz) + 1];
    const num = next && /^([A-Z0-9<]{9})/.exec(next.replace(/\s/g, ''));
    if (num) return num[1].replace(/</g, '');
  }
  return null;
}

// Most specific first: a certificate names its government and its
// maritime authority, and the authority is the issuer.
const ISSUERS = [
  /directorate general of shipping|\bdg shipping\b/i,
  /maritime and coastguard agency|maritime (?:authority|administration|industry authority)[a-z ]*|\bmarina\b|coast ?guard|register of shipping and seamen/i,
  /ministry of [a-z ]+/i,
  /(?:government|republic) of [a-z ]+/i
];

function titleCase(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Of|And|The|For)\b/g, (w) => w.toLowerCase())
    .replace(/^Dg /, 'DG ');
}

function findIssuer(lines) {
  for (const re of ISSUERS) {
    for (const line of lines) {
      const m = re.exec(line);
      if (m) return titleCase(m[0]);
    }
  }
  return null;
}

/**
 * Suggested fields from OCR text: title, refNo, issuer, issueDate, expiryDate.
 * Only what was found is returned.
 */
export function parseCertificateText(raw) {
  const lines = String(raw || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join(' ');
  const out = {};

  for (const [re, title] of TITLES) {
    if (re.test(all)) { out.title = title; break; }
  }

  let issue = dateNear(lines, ISSUE_WORDS);
  let expiry = dateNear(lines, EXPIRY_WORDS);

  // Without labels, the earliest date is taken as issue and the latest as
  // expiry -- but never a date of birth.
  if (!issue || !expiry) {
    const birth = dateNear(lines, BIRTH_WORDS);
    const dates = [...new Set(lines.flatMap((l) => findDates(l).map((d) => d.iso)))]
      .filter((d) => d !== birth && d !== issue && d !== expiry)
      .sort();
    if (!issue && !expiry && dates.length >= 2) { issue = dates[0]; expiry = dates[dates.length - 1]; }
    else if (!issue && expiry) issue = dates.filter((d) => d < expiry)[0] || null;
    else if (issue && !expiry) expiry = dates.filter((d) => d > issue).pop() || null;
  }
  if (issue && expiry && expiry < issue) [issue, expiry] = [expiry, issue];
  if (issue) out.issueDate = issue;
  if (expiry) out.expiryDate = expiry;

  const number = findNumber(lines);
  if (number) out.refNo = number;
  const issuer = findIssuer(lines);
  if (issuer) out.issuer = issuer;
  return out;
}
