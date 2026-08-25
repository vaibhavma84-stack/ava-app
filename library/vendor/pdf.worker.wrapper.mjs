// PDF.js runs its parsing in a worker, which is a separate global scope: a
// polyfill installed on the page does not reach it. This wrapper installs the
// stand-in first, then loads the real worker, so older WebKit that lacks
// Math.sumPrecise still parses fonts correctly rather than mis-measuring text.
if (typeof Math.sumPrecise !== 'function') {
  Math.sumPrecise = (values) => {
    let total = 0;
    for (const v of values) total += Number(v);
    return total;
  };
}
await import('./pdf.worker.min.mjs');
