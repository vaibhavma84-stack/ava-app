// Alarm lists and setpoint tables, read as rows.
//
// A search for "LO inlet press" finds the page of the alarm list, and the
// snippet is a run of words out of a table with the columns gone:
// "... LO INLET PRESS LOW 2.5 bar 5 s SLD LO INLET TEMP HIGH ...". Which
// figure is the setpoint is exactly what that loses. Read with the layout
// kept, the same line is a row: the point, what it watches, the setting,
// the delay, what it does.
//
// A line is taken as a row only when it carries a figure with a unit AND says
// what kind of point it is -- an alarm word, a level (H, LL, High), or it sits
// under a header that names the columns as settings. A figure with a unit on
// its own is every specification table in a manual; an alarm word on its own
// is every paragraph about alarms. Both together is a setting.
//
// The row is not trusted further than it can be read. The raw line always
// comes with it, and the page, so what is shown can be checked where it came
// from; and a document read by text recognition says so.

const UNIT = String.raw`(?:bar\s?g?|kpa|mpa|psi|kg\/cm2|mmwc|mm\s?wc|°\s?c|º\s?c|deg\.?\s?c|℃|%|rpm|r\/min|min-1|mm|cst|ppm|m3\/h|l\/h|kw|kva|hz|v|a|sec|s|min|m)`;
// A figure and its unit: "2.5 bar", "85°C", "-5 mm", "0,15 MPa".
const VALUE = new RegExp(String.raw`(?:^|[\s(=<>≤≥:\t])([<>≤≥]?\s?-?\d{1,5}(?:[.,]\d{1,3})?)\s?(${UNIT})(?![a-z0-9])`, 'gi');
const TAG = /(?:^|[\s\t])([A-Z]{1,4}[-_ ]?\d{2,5}[A-Z]?(?:[-_.]\d{1,3})?)(?=[\s\t]|$)/;
const LEVEL = /(?:^|[\s\t(])(HH|LL|H|L|HIGH|LOW|HI|HIGH-HIGH|LOW-LOW|V\.?\s?HIGH|V\.?\s?LOW)(?=[\s\t)]|$)/i;
const ACTION = /\b(shut\s?-?down|slow\s?-?down|trip|stop|start(?:s)?\s+(?:standby|stand-by)|standby\s+start|auto\s+start|pre-?alarm|alarm|sd|sld|shd)\b/i;
const CUE = /\b(alarm|alarms|trip|shut\s?-?down|slow\s?-?down|set\s?-?point|setting|pre-?alarm|high|low|deviation|failure|abnormal|limit)\b/i;
const HEADER = /\b(set\s?-?point|setting|settings|alarm\s+(?:value|point|limit|level)|limit|tag|point\s+no\.?|channel|delay)\b/i;
const DELAY = /(?:^|[\s\t])(\d{1,3}(?:[.,]\d)?)\s?(s|sec|secs|seconds)(?![a-z0-9])/i;

const tidy = (s) => s.replace(/\s+/g, ' ').trim();

function valuesIn(text) {
  const out = [];
  VALUE.lastIndex = 0;
  for (let m = VALUE.exec(text); m; m = VALUE.exec(text)) {
    out.push({ at: m.index + m[0].indexOf(m[1]), text: tidy(`${m[1]} ${m[2]}`) });
  }
  return out;
}

/** One line of a table, taken apart. Returns null if it is not a setting. */
export function rowFrom(text, underHeader = false) {
  const line = String(text || '');
  if (line.length < 6 || line.length > 260) return null;
  const values = valuesIn(line);
  if (!values.length) return null;
  const level = LEVEL.exec(line);
  const cue = CUE.test(line);
  if (!cue && !level && !underHeader) return null;
  // A sentence under a table is the paragraph after it, not a row of it:
  // "The engine is rated 12 500 kW at 105 rpm."
  const sentence = !/\t/.test(line) && /\.\s*$/.test(line) && line.split(/\s+/).length > 6;
  if (sentence && !cue && !level) return null;

  // Seconds are the delay when there is another figure to be the setting.
  const delay = DELAY.exec(line);
  const isDelay = (v) => /^\d[\d.,]*\s?(s|sec|secs|seconds)$/i.test(v.text);
  const settings = values.length > 1 ? values.filter((v) => !isDelay(v)) : values;
  if (!settings.length) return null;

  const tag = TAG.exec(line);
  const action = ACTION.exec(line);
  // What it watches: the words of the line before its first figure, without
  // the tag -- "ME LO inlet pressure".
  const firstFigure = Math.min(...values.map((v) => v.at));
  let description = line.slice(0, firstFigure)
    .replace(tag ? tag[1] : '\u0000', ' ')
    .replace(LEVEL, ' ')
    .replace(ACTION, ' ')
    .replace(/\t/g, ' ');
  description = tidy(description).replace(/[\s:–—-]+$/, '').replace(/\s+(?:at|is|of|to|set|=)$/i, '');
  if (!/[a-z]{2,}/i.test(description)) {
    // Laid out the other way round: the figure first, the words after.
    description = tidy(line.slice(firstFigure).replace(VALUE, ' ').replace(DELAY, ' ').replace(/\t/g, ' '));
  }
  if (!/[a-z]{3,}/i.test(description)) return null;

  return {
    tag: tag ? tag[1].trim() : '',
    description: description.slice(0, 120),
    setpoint: settings.map((v) => v.text).join(' / '),
    level: level ? level[1].toUpperCase().replace(/\s+/g, '') : '',
    action: action ? tidy(action[1]).toLowerCase() : '',
    delay: delay && values.length > 1 ? `${delay[1]} s` : '',
    raw: tidy(line.replace(/\t/g, ' | '))
  };
}

// A cell too long for its column wraps, and the row comes out of the page as
// three lines: the tops of the wrapped cells, the line with the figures, and
// their bottoms --
//
//     TE-      ME jacket cooling water   Slow
//     H        90 °C    10 s
//     2201     outlet temp               down
//
// When the line above and the line below have the same number of cells, they
// are the two halves of the same cells and are put back together pairwise:
// "TE-2201", "ME jacket cooling water outlet temp", "Slow down". Otherwise
// they are simply read along with the line.
function isFragment(line, row) {
  if (!line || line.page !== row.page || line.text.length > 80) return false;
  if (valuesIn(line.text).length || HEADER.test(line.text)) return false;
  if (line.y === undefined || row.y === undefined) return false;
  return Math.abs(line.y - row.y) <= Math.max(row.size, 6) * 1.9;
}

function rejoin(above, main, below) {
  const top = above ? above.text.split('\t') : [];
  const bottom = below ? below.text.split('\t') : [];
  let cells;
  if (top.length && top.length === bottom.length) {
    cells = top.map((t, i) => (/-$/.test(t) ? t + bottom[i] : `${t} ${bottom[i]}`));
  } else {
    cells = [...top, ...bottom];
  }
  return [...cells, main.text].join('\t');
}

/**
 * Every setting a document states, from its pages of lines.
 *
 * `pages` is what readLayout gives -- an array per page of { page, text }
 * lines, cells separated by tabs -- or the same shape built from a scan's
 * text, one line per line.
 */
export function alarmsFrom(pages) {
  const rows = [];
  for (const lines of pages) {
    let underHeader = false;
    let sinceHeader = 0;
    const used = new Set();
    for (const [i, line] of lines.entries()) {
      if (used.has(i)) continue;
      const text = line.text || '';
      // A header row names the columns and carries no figures of its own.
      if (HEADER.test(text) && !valuesIn(text).length && text.length < 200) {
        underHeader = true;
        sinceHeader = 0;
        continue;
      }
      if (!valuesIn(text).length) {
        if (underHeader && ++sinceHeader > 6) underHeader = false;
        continue;
      }
      const above = !used.has(i - 1) && isFragment(lines[i - 1], line) ? lines[i - 1] : null;
      let below = isFragment(lines[i + 1], line) ? lines[i + 1] : null;
      // A short line between two rows could be the bottom of this one or the
      // top of the next. It goes to whichever it is nearer; on a tie, to this
      // row only if it completes this row's own top half.
      const next = lines[i + 2];
      if (below && next && valuesIn(next.text).length && isFragment(below, next)) {
        const toThis = Math.abs(below.y - line.y);
        const toNext = Math.abs(below.y - next.y);
        const pairs = above && above.text.split('\t').length === below.text.split('\t').length;
        if (toNext < toThis || (toNext === toThis && !pairs)) below = null;
      }
      const whole = above || below ? rejoin(above, line, below) : text;
      const row = rowFrom(whole, underHeader) || (whole !== text ? rowFrom(text, underHeader) : null);
      if (row) {
        rows.push({ page: line.page, ...row });
        sinceHeader = 0;
        if (above) used.add(i - 1);
        if (below) used.add(i + 1);
      } else if (underHeader && ++sinceHeader > 6) {
        // A table ends where its rows stop.
        underHeader = false;
      }
    }
  }
  // The same setting printed twice on a page -- a repeated header, a legend --
  // is one row.
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.page}|${r.raw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A scan's stored text, shaped as lines the way readLayout gives them. */
export function linesFromText(pages) {
  return (pages || []).map((p) => (p.text || '').split(/\n+/)
    .map((t) => ({ page: p.page, text: t.trim() }))
    .filter((l) => l.text.length > 1));
}

/** Everything about a row a search should see. */
export const rowText = (r) => [r.tag, r.description, r.setpoint, r.level, r.action, r.raw].join(' ').toLowerCase();
