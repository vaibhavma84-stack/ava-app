// Read the words off a photo or PDF of a certificate, on the phone.
//
// Uses the same Tesseract build the Library vendors under vendor/ocr. It is
// several megabytes, so it loads only when a scan is asked for; once loaded
// with a connection, the service worker keeps it for use at sea.

const ENGINE = new URL('../vendor/ocr/', import.meta.url).href;
const MAX_SIDE = 2200;   // plenty for print; a 12 MP photo only slows the read

let tesseract = null;

async function engine() {
  if (tesseract) return tesseract;
  tesseract = (async () => {
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${ENGINE}tesseract.min.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('The text reader could not be loaded. Connect once so it can be saved for offline use.'));
        document.head.append(script);
      });
    }
    if (!window.Tesseract) throw new Error('The text reader did not start');
    return window.Tesseract;
  })();
  try {
    return await tesseract;
  } catch (ex) {
    tesseract = null;
    throw ex;
  }
}

/** Draw a picture onto a canvas no bigger than MAX_SIDE, on white. */
async function imageCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That picture could not be opened'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The first page of a PDF: its own text if it has any (a digital
 * certificate), otherwise the page drawn as a picture to be read.
 */
async function pdfFirstPage(blob) {
  await import('../vendor/polyfills.mjs');
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.wrapper.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    // Rebuild lines from the text runs so labels and values keep their rows.
    let text = '', lastY = null;
    for (const item of content.items) {
      const y = Math.round(item.transform?.[5] ?? 0);
      if (lastY !== null && Math.abs(y - lastY) > 3) text += '\n';
      else if (text && !text.endsWith(' ')) text += ' ';
      text += item.str;
      lastY = y;
    }
    if (text.replace(/\s/g, '').length > 40) return { text };
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    return { canvas };
  } finally {
    doc.destroy();
  }
}

/** Text from a photo or PDF. onStatus gets short progress messages. */
export async function readDocument(blob, name = '', { onStatus } = {}) {
  let canvas;
  if (blob.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    onStatus?.('Opening PDF…');
    const page = await pdfFirstPage(blob);
    if (page.text) return page.text;
    canvas = page.canvas;
  } else {
    canvas = await imageCanvas(blob);
  }

  onStatus?.('Loading reader…');
  const Tesseract = await engine();
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${ENGINE}worker.min.js`,
    corePath: ENGINE,
    langPath: ENGINE,
    gzip: true,
    logger: (m) => {
      if (m?.status === 'recognizing text') onStatus?.(`Reading… ${Math.round((m.progress || 0) * 100)}%`);
    }
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    await worker.terminate().catch(() => {});
    canvas.width = canvas.height = 0;
  }
}
