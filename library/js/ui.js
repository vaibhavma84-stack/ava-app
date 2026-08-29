// Shared with AVA (../../js/). Kept as a copy so the two apps stay
// independent; any fix here must be applied there as well.
// Small DOM helpers. User data always goes through textContent or .value, never
// innerHTML, so a note containing markup can never become markup.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;           // only ever called with literals
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel) => document.querySelector(sel);

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function formatBytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v < 10 ? 1 : 0) + ' ' + units[i];
}

let toastTimer = null;
export function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2400);
}

/**
 * Capitalise each word, leaving the small ones alone.
 *
 * Only words typed entirely in lower case are touched. Anything already
 * carrying a capital is left exactly as it was — so MARPOL stays MARPOL, PSC
 * stays PSC, and a subject typed in capitals is not quietly rewritten. The
 * rule only ever adds a capital; it never removes one, which is what makes it
 * safe to apply to a field the moment it is left.
 */
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'off', 'on', 'onto', 'or', 'per', 'the', 'to', 'up', 'via',
  'with', 'vs'
]);

const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv)$/;

export function titleCase(text) {
  const words = String(text || '').split(/(\s+)/);
  const lastWord = words.reduce((last, w, i) => (w.trim() ? i : last), -1);
  const firstWord = words.findIndex((w) => w.trim());

  return words.map((word, i) => {
    if (!word.trim()) return word;
    // Leave anything the writer has already capitalised, anywhere in it.
    if (/[A-Z]/.test(word)) return word;

    // Annex vi reads as Annex VI, not Annex Vi.
    const bare = word.replace(/[^a-z]/g, '');
    if (bare && ROMAN.test(bare)) return word.replace(bare, bare.toUpperCase());

    const small = SMALL_WORDS.has(bare);
    if (small && i !== firstWord && i !== lastWord) return word;
    return word.replace(/[a-z]/, (c) => c.toUpperCase());
  }).join('');
}
