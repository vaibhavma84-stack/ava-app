// The worker is a separate global scope, so it needs the polyfills installed
// again before the real worker module loads.
import './polyfills.mjs';
await import('./pdf.worker.min.mjs');
