// iCalendar (RFC 5545) export.
//
// No web API can write into Apple Calendar directly, so AVA emits a standard
// .ics file and hands it to iOS through the share sheet. Calendar then offers
// "Add All Events". Everything here is generated on-device; nothing is uploaded.

import { TYPES } from './schema.js';
import { expiryStatus } from './derive.js';

const PRODID = '-//AVA//Offline Vault//EN';

/** RFC 5545 text escaping: backslash, semicolon, comma and newline. */
function esc(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** YYYY-MM-DD -> YYYYMMDD. */
function dateOnly(iso) {
  return String(iso || '').replace(/-/g, '');
}

/** All-day DTEND is exclusive, so the end date is the day after the last day. */
function dayAfter(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Fold lines at 75 octets, per spec — some calendar clients are strict about it. */
function fold(line) {
  if (line.length <= 75) return line;
  const out = [];
  let rest = line;
  out.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) out.push(' ' + rest);
  return out.join('\r\n');
}

function buildEvent({ uid, summary, description, location, start, end, alarms }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp()}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${esc(summary)}`
  ];
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (location) lines.push(`LOCATION:${esc(location)}`);
  lines.push('TRANSP:TRANSPARENT');

  for (const alarm of alarms || []) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${alarm.trigger}`,
      `DESCRIPTION:${esc(alarm.text || summary)}`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

function wrap(eventLines) {
  const all = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...eventLines,
    'END:VCALENDAR'
  ];
  return all.map(fold).join('\r\n') + '\r\n';
}

/**
 * A certificate expiry as an all-day event, with reminders 90 and 30 days out
 * and one on the day itself — the lead times that actually matter for renewal.
 */
export function certificateEvent(item) {
  const d = item.data;
  if (!d.expiryDate) return null;
  const detail = [
    d.issuer ? `Issuer: ${d.issuer}` : null,
    d.refNo ? `Reference: ${d.refNo}` : null,
    d.notes || null,
    'Added from AVA'
  ].filter(Boolean).join('\n');

  return buildEvent({
    uid: `cert-${item.id}@ava`,
    summary: `Expires: ${d.title || 'Certificate'}`,
    description: detail,
    start: dateOnly(d.expiryDate),
    end: dayAfter(d.expiryDate),
    alarms: [
      { trigger: '-P90D', text: `${d.title} expires in 90 days` },
      { trigger: '-P30D', text: `${d.title} expires in 30 days` },
      { trigger: 'PT9H', text: `${d.title} expires today` }
    ]
  });
}

/**
 * A voyage as one multi-day event spanning sign-on to sign-off. An entry with no
 * sign-off is still onboard, so it gets a single-day sign-on marker instead.
 */
export function seaTimeEvent(item) {
  const d = item.data;
  if (!d.signOnDate) return null;
  const onboard = !d.signOffDate;
  const detail = [
    d.rank ? `Rank: ${d.rank}` : null,
    d.company ? `Company: ${d.company}` : null,
    d.vesselType ? `Type: ${d.vesselType}` : null,
    d.imo ? `IMO: ${d.imo}` : null,
    d.signOnPort ? `Sign-on port: ${d.signOnPort}` : null,
    d.signOffPort ? `Sign-off port: ${d.signOffPort}` : null,
    'Added from AVA'
  ].filter(Boolean).join('\n');

  return buildEvent({
    uid: `seatime-${item.id}@ava`,
    summary: onboard
      ? `Sign on: ${d.vessel || 'Vessel'}${d.rank ? ` (${d.rank})` : ''}`
      : `${d.vessel || 'Vessel'}${d.rank ? ` — ${d.rank}` : ''}`,
    description: detail,
    location: d.signOnPort || '',
    start: dateOnly(d.signOnDate),
    end: onboard ? dayAfter(d.signOnDate) : dayAfter(d.signOffDate),
    alarms: onboard ? [] : [{ trigger: '-P14D', text: `Sign off from ${d.vessel} in 14 days` }]
  });
}

export function eventFor(item) {
  if (item.type === 'certificate') return certificateEvent(item);
  if (item.type === 'seatime') return seaTimeEvent(item);
  return null;
}

/** One entry as a calendar file. */
export function icsForItem(item) {
  const ev = eventFor(item);
  return ev ? wrap(ev) : null;
}

/** Every dated entry of a type in a single file, for a one-shot import. */
export function icsForItems(items) {
  const events = [];
  let count = 0;
  for (const item of items) {
    const ev = eventFor(item);
    if (ev) { events.push(...ev); count++; }
  }
  return count ? { ics: wrap(events), count } : null;
}

/** Certificates worth putting in a calendar: anything with an expiry date. */
export function datedCertificates(items) {
  return items.filter((i) => i.data.expiryDate && expiryStatus(i.data.expiryDate).state !== 'none');
}

export function calendarFileName(item) {
  const label = TYPES[item.type]?.singular || 'entry';
  const title = (item.data.title || item.data.vessel || label)
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  return `ava-${title || 'entry'}.ics`;
}
