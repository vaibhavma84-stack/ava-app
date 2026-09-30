// EPUB: the book format Apple Books uses.
//
// An EPUB is a zip of web pages -- one per chapter -- with a list saying what
// order they go in and what the book is called. Each chapter becomes a
// "page" here, numbered in reading order, so everything built for a PDF's
// pages -- search, export, Ask, notes, pins -- works on a book's chapters.
//
// A chapter is never shown as the web page it arrived as. Its words and its
// structure -- headings, paragraphs, lists, tables, pictures -- are copied
// into elements made here, and nothing else is: no script, no style, no link,
// no attribute but a picture's source. A book is somebody else's file, and a
// library of them should not be able to run anything.
//
// Books bought from the Books store are locked to Apple's apps and cannot be
// read here; that is said plainly rather than failing quietly.

import { readZip } from './zip.js';

export const isEpub = (file) =>
  /epub/i.test(file?.type || '') || /\.epub$/i.test(file?.name || '');

const XML = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    return new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
};

// Elements are matched by local name: EPUB is XHTML, and its tags come
// namespaced or not depending on who made the book.
const byName = (root, name) => [...root.getElementsByTagName('*')].filter((e) => e.localName === name);
const first = (root, name) => byName(root, name)[0] || null;

function resolve(base, href) {
  const parts = base.split('/').slice(0, -1);
  for (const piece of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (piece === '..') parts.pop();
    else if (piece && piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

async function openBook(blob) {
  const entries = await readZip(blob);
  const files = new Map(entries.map((e) => [e.name, e]));
  const text = async (name) => {
    const entry = files.get(name);
    if (!entry) throw new Error(`The book is missing ${name}`);
    return (await entry.read()).text();
  };
  if (files.has('META-INF/encryption.xml') && /EncryptedData/.test(await text('META-INF/encryption.xml'))) {
    const err = new Error('This book is copy-protected, as books bought from the Books store are, and can only be read in Apple Books.');
    err.locked = true;
    throw err;
  }
  const container = XML(await text('META-INF/container.xml'));
  const opfPath = first(container, 'rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Not an EPUB: it does not say where its contents are');
  const opf = XML(await text(opfPath));

  const meta = (name) => (first(opf, name)?.textContent || '').replace(/\s+/g, ' ').trim();
  const manifest = new Map(byName(opf, 'item').map((i) => [i.getAttribute('id'), {
    href: resolve(opfPath, i.getAttribute('href') || ''), type: i.getAttribute('media-type') || ''
  }]));
  const spine = byName(opf, 'itemref')
    .filter((r) => r.getAttribute('linear') !== 'no')
    .map((r) => manifest.get(r.getAttribute('idref')))
    .filter((m) => m && /html/i.test(m.type || m.href));

  return {
    files, text, spine,
    title: meta('title'), author: meta('creator'), publisher: meta('publisher'),
    date: meta('date')
  };
}

const tidy = (s) => String(s || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** A chapter's words, one block of text to a line. */
function chapterText(doc) {
  const body = first(doc, 'body') || doc.documentElement;
  const lines = [];
  const BLOCK = /^(p|h[1-6]|li|tr|div|blockquote|pre|dt|dd|figcaption|caption|section|article)$/i;
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { lines.push(child.nodeValue); continue; }
      if (child.nodeType !== 1) continue;
      if (/^(script|style|head)$/i.test(child.localName)) continue;
      if (/^(td|th)$/i.test(child.localName)) { walk(child); lines.push('\t'); continue; }
      walk(child);
      if (BLOCK.test(child.localName) || child.localName === 'br') lines.push('\n');
    }
  };
  walk(body);
  return tidy(lines.join(''));
}

function chapterTitle(doc, fallback) {
  const heading = byName(doc, 'h1')[0] || byName(doc, 'h2')[0] || byName(doc, 'h3')[0];
  const t = (heading?.textContent || first(doc, 'title')?.textContent || '').replace(/\s+/g, ' ').trim();
  return t || fallback;
}

/**
 * Read a book for the library: what it is called, and the words of each
 * chapter as a page. Returns the same shape the PDF reader does, so the
 * search and everything else take it as they are.
 */
export async function readEpub(blob) {
  try {
    const book = await openBook(blob);
    const pages = [];
    for (const [i, item] of book.spine.entries()) {
      const doc = XML(await book.text(item.href));
      const text = chapterText(doc);
      if (text) pages.push({ page: i + 1, text, title: chapterTitle(doc, `Chapter ${i + 1}`) });
    }
    return {
      ok: true, status: pages.length ? 'indexed' : 'no-text', pages, pageCount: book.spine.length,
      title: book.title, author: book.author, publisher: book.publisher, date: book.date, error: null
    };
  } catch (ex) {
    return { ok: false, status: ex.locked ? 'encrypted' : 'failed', pages: [], pageCount: 0, error: ex.message };
  }
}

// What a chapter may keep. Everything else is unwrapped to its contents, or
// dropped with them.
const KEEP = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'td', 'th', 'caption', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 'sub',
  'sup', 'br', 'hr', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'small', 'span', 'div', 'section', 'article']);
const DROP = new Set(['script', 'style', 'head', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'input',
  'button', 'textarea', 'select', 'audio', 'video', 'svg', 'math', 'template', 'noscript', 'canvas']);

function copyInto(target, node, pictureFor, linkFor = () => null) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { target.append(document.createTextNode(child.nodeValue)); continue; }
    if (child.nodeType !== 1) continue;
    const name = child.localName.toLowerCase();
    if (DROP.has(name)) continue;
    if (name === 'img' || name === 'image') {
      const src = child.getAttribute('src') || child.getAttribute('href') || child.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      const url = src ? pictureFor(src) : null;
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = child.getAttribute('alt') || '';
        img.loading = 'lazy';
        target.append(img);
      }
      continue;
    }
    if (KEEP.has(name)) {
      const copy = document.createElement(name === 'section' || name === 'article' ? 'div' : name);
      if ((name === 'td' || name === 'th') && child.getAttribute('colspan')) {
        const span = Number(child.getAttribute('colspan'));
        if (span > 1 && span < 50) copy.colSpan = span;
      }
      copyInto(copy, child, pictureFor, linkFor);
      target.append(copy);
    } else if (name === 'a' && linkFor(child.getAttribute('href') || '')) {
      // A link to elsewhere in the book is kept as a place to go -- never as
      // a link, which could lead anywhere.
      const span = document.createElement('span');
      span.className = 'epub-link';
      span.dataset.goto = String(linkFor(child.getAttribute('href')));
      copyInto(span, child, pictureFor, linkFor);
      target.append(span);
    } else {
      // A link, a custom element: its words, without it.
      copyInto(target, child, pictureFor, linkFor);
    }
  }
}

/**
 * Lay a book out in the viewer: every chapter, one after another, each a
 * page marked with its number so notes, pins and find land on it. Returns a
 * teardown with setMarks and goTo, like the PDF viewer's.
 */
export async function renderEpub(container, blob, { onStatus, startPage = 1, onLink } = {}) {
  const book = await openBook(blob);
  const urls = [];
  const contents = [];
  // Which chapter each file of the book is, for following a link to it.
  const chapterOf = new Map(book.spine.map((item, i) => [item.href, i + 1]));
  onStatus?.(`${book.spine.length} chapter${book.spine.length === 1 ? '' : 's'}`);

  for (const [i, item] of book.spine.entries()) {
    const doc = XML(await book.text(item.href));
    const section = document.createElement('article');
    section.className = 'epub-chapter';
    section.dataset.page = String(i + 1);
    const pictureFor = (src) => {
      const entry = book.files.get(resolve(item.href, src));
      if (!entry) return null;
      const url = URL.createObjectURL(new Blob([], { type: 'image/png' }));
      urls.push(url);
      // Filled in when read: the placeholder keeps the order, the picture
      // arrives a moment later.
      entry.read().then((data) => {
        const real = URL.createObjectURL(data);
        urls.push(real);
        for (const img of section.querySelectorAll(`img[src="${url}"]`)) img.src = real;
      }).catch(() => {});
      return url;
    };
    const linkFor = (href) => {
      if (!href || /^[a-z][\w+.-]*:/i.test(href)) return null;
      return href.startsWith('#') ? i + 1 : chapterOf.get(resolve(item.href, href)) || null;
    };
    contents.push({ title: chapterTitle(doc, `Chapter ${i + 1}`), page: i + 1, depth: 0 });
    copyInto(section, first(doc, 'body') || doc.documentElement, pictureFor, linkFor);
    container.append(section);
  }
  const onTap = (e) => {
    const link = e.target.closest?.('.epub-link');
    if (!link || container.classList.contains('marking')) return;
    e.preventDefault();
    const at = e.target.closest('[data-page]');
    onLink?.({ page: Number(link.dataset.goto), from: Number(at?.dataset.page) || 1 });
  };
  container.addEventListener('click', onTap);
  const at = container.querySelector(`[data-page="${startPage}"]`);
  if (at && startPage > 1) at.scrollIntoView({ block: 'start' });

  const unmark = () => {
    for (const mark of container.querySelectorAll('mark.find-mark')) {
      mark.replaceWith(document.createTextNode(mark.textContent));
    }
    container.normalize();
  };
  const teardown = () => {
    container.removeEventListener('click', onTap);
    for (const url of urls) URL.revokeObjectURL(url);
  };
  teardown.pageCount = book.spine.length;
  teardown.contents = async () => contents;
  teardown.setMarks = async (marks) => {
    unmark();
    if (!marks) return;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    for (const node of nodes) {
      const spans = (marks(node.nodeValue) || []).sort((a, b) => b[0] - a[0]);
      let limit = Infinity;
      for (const [s, e] of spans) {
        // Marked from the end backwards, so earlier offsets still hold; one
        // overlapping a mark already made is left out.
        if (e > limit) continue;
        limit = s;
        const tail = node.splitText(s);
        tail.splitText(e - s);
        const mark = document.createElement('mark');
        mark.className = 'find-mark';
        mark.textContent = tail.nodeValue;
        tail.replaceWith(mark);
      }
    }
  };
  teardown.goTo = (page) => container.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' });
  return teardown;
}
