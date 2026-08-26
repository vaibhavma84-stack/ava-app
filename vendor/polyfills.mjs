// Built-ins PDF.js relies on that older WebKit does not carry.
//
// These are runtime APIs, not syntax, so the "legacy" PDF.js build does not
// supply them: on iOS before 17.4 the library simply calls something undefined
// and fails with "undefined is not a function". They must be installed in the
// page and, separately, inside the worker, which is its own global scope.

if (typeof Promise.withResolvers !== 'function') {
  // Safari 17.4+. PDF.js uses it throughout its request plumbing.
  Promise.withResolvers = function withResolvers() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

if (typeof Math.sumPrecise !== 'function') {
  // Exact summation; an ordinary sum is close enough for glyph metrics.
  Math.sumPrecise = (values) => {
    let total = 0;
    for (const v of values) total += Number(v);
    return total;
  };
}

if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
}

if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    value: function at(index) {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? this.length + i : i];
    },
    writable: true, configurable: true
  });
}

if (typeof globalThis.structuredClone !== 'function') {
  // Only reached for plain data; PDF.js does not clone exotic values here.
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

if (typeof ReadableStream !== 'undefined'
    && typeof Symbol !== 'undefined' && Symbol.asyncIterator
    && !ReadableStream.prototype[Symbol.asyncIterator]) {
  // Async iteration of a ReadableStream — "for await (const chunk of stream)" —
  // also arrived in Safari 17.4. PDF.js reads text content that way, so without
  // it getTextContent fails with "undefined is not a function" and no document
  // can be indexed at all.
  const asyncIterator = function ({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const { done, value } = await reader.read();
          if (done) reader.releaseLock();
          return { done, value };
        } catch (err) {
          reader.releaseLock();
          throw err;
        }
      },
      async return(value) {
        if (preventCancel) {
          reader.releaseLock();
        } else {
          const cancelled = reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; }
    };
  };
  ReadableStream.prototype[Symbol.asyncIterator] = asyncIterator;
  if (typeof ReadableStream.prototype.values !== 'function') {
    ReadableStream.prototype.values = asyncIterator;
  }
}
