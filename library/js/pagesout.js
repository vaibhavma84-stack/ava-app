// Pages out of a document, and a document out of photographs.
//
// Sharing three pages of a manual should not mean sending all three hundred.
// The pages are copied into a new PDF with their text as it was -- still
// sharp, still searchable, and small. A manual too big to open whole on a
// phone is not opened whole: its pages are drawn as pictures instead, which
// is heavier but never runs the phone out of memory.
//
// A camera scan is the other way round: photographs, one to a page, made into
// a PDF the library keeps like any other.

let lib = null;
const pdfLib = async () => lib || (lib = await import('../../vendor/pdf-lib.mjs'));

// Past this, the whole file is not loaded into memory to copy pages from it.
const WHOLE_LIMIT = 60 * 1024 * 1024;

/**
 * "12-14, 20" -> [12, 13, 14, 20], within 1..count. Null if it names no page.
 */
export function parsePages(text, count) {
  const out = new Set();
  for (const part of String(text || '').split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(part.replace(/^p\.?/i, ''));
    if (!m) return null;
    let a = Number(m[1]);
    let b = Number(m[2] || m[1]);
    if (a > b) [a, b] = [b, a];
    for (let p = Math.max(1, a); p <= Math.min(count, b); p++) out.add(p);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

/** "12–14, 20": for naming the file. */
export function pagesLabel(pages) {
  const parts = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j;
  }
  return parts.join(',');
}

/** A new PDF holding only the given pages (numbered from 1). */
export async function extractPages(blob, pages, { renderPage } = {}) {
  const { PDFDocument } = await pdfLib();
  if (blob.size <= WHOLE_LIMIT || !renderPage) {
    try {
      const src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, pages.map((p) => p - 1));
      for (const page of copied) out.addPage(page);
      return new Blob([await out.save()], { type: 'application/pdf' });
    } catch (ex) {
      // An encrypted or damaged file cannot be taken apart; its pages can
      // still be drawn.
      if (!renderPage) throw ex;
    }
  }
  const shots = [];
  for (const p of pages) shots.push(await renderPage(p));
  return pdfFromImages(shots);
}

/**
 * A PDF of pictures, one to a page, each page the picture's own shape at
 * about 150 dots to the inch -- an A4 photograph comes out A4.
 */
export async function pdfFromImages(images) {
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.create();
  for (const image of images) {
    const bytes = new Uint8Array(await image.arrayBuffer());
    const embedded = /png/i.test(image.type) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const scale = 72 / 150;
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    const page = doc.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
  }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

/**
 * A photograph of a page, made to read like one: turned to grey, and its
 * levels stretched so the paper is white and the print black, whatever the
 * light was. At most 1700 pixels on its long side -- plenty to read, and a
 * fraction of what a phone's camera takes.
 */
export async function preparePhoto(file, { documentLook = true, longSide = 1700 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const source = bitmap || await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the photograph'));
    img.src = URL.createObjectURL(file);
  });
  const sw = source.width;
  const sh = source.height;
  const k = Math.min(1, longSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: documentLook });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();
  if (documentLook) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      d[i] = g;
      hist[g]++;
    }
    // The darkest and lightest few percent set black and white.
    const total = d.length / 4;
    let lo = 0;
    let hi = 255;
    for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
    for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.10; hi--);
    const span = Math.max(hi - lo, 40);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}
