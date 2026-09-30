// Handing a PDF to PDF.js without holding all of it in memory.
//
// A scanned manual can be a few hundred megabytes. Read into memory whole it
// is that much, and PDF.js takes its own copy for its worker -- twice the
// file before a page has been drawn, and a phone's browser is closed by the
// system when it reaches its limit, which on an iPhone comes quickly. It was
// what closed the app while it read a large scan, over and over.
//
// A file kept on the phone is a Blob, and a Blob can be read a piece at a
// time. PDF.js asks for the byte ranges it needs -- the table at the end, the
// objects a page uses -- and only those are read. A small file is simply read
// whole: that is quicker, and it is not what runs out of room.

const WHOLE_UNDER = 8 * 1024 * 1024;
const FIRST_CHUNK = 256 * 1024;

/** getDocument parameters for a Blob or an ArrayBuffer. */
export async function docSource(pdfjs, input) {
  if (!(input instanceof Blob)) return { data: new Uint8Array(input) };
  if (input.size <= WHOLE_UNDER || !pdfjs.PDFDataRangeTransport) {
    return { data: new Uint8Array(await input.arrayBuffer()) };
  }
  const first = new Uint8Array(await input.slice(0, FIRST_CHUNK).arrayBuffer());
  const transport = new pdfjs.PDFDataRangeTransport(input.size, first);
  transport.requestDataRange = (begin, end) => {
    input.slice(begin, end).arrayBuffer()
      .then((buffer) => transport.onDataRange(begin, new Uint8Array(buffer)))
      .catch((ex) => console.warn('Could not read part of the file', ex));
  };
  return {
    range: transport,
    length: input.size,
    rangeChunkSize: FIRST_CHUNK,
    // Only what is asked for: no fetching the rest of the file behind it.
    disableAutoFetch: true,
    disableStream: true
  };
}
