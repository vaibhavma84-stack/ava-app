// The machinery a document names, and who made it.
//
// Read from the layout-preserving pass in pdftext.js rather than from the
// flattened text the search uses: a table is only a table while its column
// boundaries survive, and they do not survive being joined with spaces. The
// size each line is set at comes with it, which is how the heading above a
// labelled maker is told from the paragraph around it.
//
// There was a contents list here too, built from the headings. On a real
// question library it made 1250 entries out of a few hundred sections -- the
// cover page line by line, and a good deal else -- and every attempt to tell a
// heading from the furniture around it cost a heading somewhere. Taken out
// rather than left half right: a contents list that cannot be trusted is worse
// than the one already printed on page 2 of the document.
//
// What is left does not guess. A document that never says who made anything
// gets an empty list, and an empty list sends you to look where a wrong maker
// sends you to order the wrong part.

/** The size the body text of a document is set at: the commonest one. */
function bodySize(pages) {
  const seen = new Map();
  for (const lines of pages) {
    for (const line of lines) {
      // Rounded to a half-point: the same paragraph is often laid out at
      // 10.999 and 11.0 and they are not two sizes.
      const key = Math.round(line.size * 2) / 2;
      seen.set(key, (seen.get(key) || 0) + line.text.length);
    }
  }
  let best = 0;
  let most = -1;
  for (const [size, weight] of seen) if (weight > most) { most = weight; best = size; }
  return best;
}

const NUMBERED = /^(\d{1,2}(?:\.\d{1,3}){0,4})[.):]?\s+(\S.*)$/;

// What a document calls the maker of something, and what it calls the thing.
const MAKER_LABEL = /\b(maker|manufacturer|make|builder|supplier|supplied by)\b\s*[:–—-]\s*/i;
const OTHER_LABEL = /\b(model|type|serial(?:\s*(?:no|number))?|capacity|rating|size|quantity|qty|swl|year|output|part(?:\s*no)?)\b\s*[:–—-]/i;
const MAKER_COLUMN = /^(maker|manufacturer|make|builder|supplier|vendor)s?$/i;
const THING_COLUMN = /^(equipment|item|machinery|description|unit|name|component|plant|system)s?$/i;
const MODEL_COLUMN = /^(model|type|part\s*no\.?|designation)s?$/i;

/** Trim a captured value back to the value, without the next label after it. */
function valueOnly(rest) {
  const next = OTHER_LABEL.exec(rest);
  let value = next ? rest.slice(0, next.index) : rest;
  // A sentence carrying on after the value: "TTS Marine. SWL 3.2 t."
  value = value.split(/(?<=[a-z0-9)])\.\s/)[0];
  return value.replace(/[\s.,;:]+$/, '').trim();
}

/**
 * The machinery a document names, and who made it.
 *
 * Two shapes, because documents use two. A labelled pair -- "Maker: Hatlapa"
 * -- takes the heading above it as the name of the thing, which is what a
 * manual's headings are. A table is read by its own header row, so a column
 * called Maker is the maker whatever order the columns are in.
 *
 * Anything said in prose is not found. "The compressor was supplied new by
 * Hatlapa in 2019" is a sentence, and picking a maker out of a sentence means
 * guessing which noun it belongs to.
 */
export function equipmentFrom(pages) {
  const body = bodySize(pages);
  const out = [];
  const seen = new Set();

  const keep = (entry) => {
    if (!entry.maker || !entry.maker.trim()) return;
    const key = `${(entry.name || '').toLowerCase()}|${entry.maker.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  for (const lines of pages) {
    let heading = null;
    let columns = null;

    for (const line of lines) {
      const cells = line.text.split('\t');

      if (cells.length > 1) {
        // A header row naming a maker column turns the rows under it into
        // entries. Without one, a table of numbers is just a table of numbers.
        const maker = cells.findIndex((c) => MAKER_COLUMN.test(c.trim()));
        if (maker !== -1) {
          columns = {
            width: cells.length,
            maker,
            thing: cells.findIndex((c) => THING_COLUMN.test(c.trim())),
            model: cells.findIndex((c) => MODEL_COLUMN.test(c.trim()))
          };
          continue;
        }
        if (columns && cells.length === columns.width) {
          keep({
            name: columns.thing !== -1 ? cells[columns.thing].trim() : heading,
            maker: cells[columns.maker].trim(),
            model: columns.model !== -1 ? cells[columns.model].trim() : null,
            page: line.page
          });
          continue;
        }
        // A table of some other shape ends the run.
        columns = null;
        continue;
      }

      columns = null;
      const numbered = NUMBERED.exec(line.text);
      const isHeading = (line.size > body + 0.4 || (numbered && line.text.length <= 70))
        && line.text.length <= 90 && !/[.,;:]$/.test(line.text);
      if (isHeading) { heading = numbered ? numbered[2].trim() : line.text; continue; }

      const label = MAKER_LABEL.exec(line.text);
      if (!label) continue;
      const rest = line.text.slice(label.index + label[0].length);
      const model = OTHER_LABEL.exec(rest);
      keep({
        name: heading,
        maker: valueOnly(rest),
        model: model && /^(model|type)/i.test(model[1])
          ? valueOnly(rest.slice(model.index + model[0].length))
          : null,
        page: line.page
      });
    }
  }
  return out;
}
