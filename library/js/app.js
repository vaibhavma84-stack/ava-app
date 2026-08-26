import * as store from './store.js';
import * as db from './db.js';
import { TYPES, TAB_ORDER } from './schema.js';
import { search as runSearch } from './search.js';
import { isPdf, extract, describe, selfTest, STATUS } from './pdftext.js';
import { suggestFields } from './suggest.js';
import { probeAll, fetchNotices, FEEDS, SYNCABLE } from './updates.js';
import { IMO_CONVENTIONS, IMO_LIST_URL, asPublication, notHeld } from './imo.js';
import { el, $, clear, toast, formatBytes } from './ui.js';
import { icon } from './icons.js';
import { renderInto } from './viewer.js';
import { revisionStatus, revisionLabel, countDue } from './revision.js';

const APP_VERSION = '2026.09.17';

const view = {
  screen: 'home',      // home | section | search
  section: null,
  query: '',
  filter: null,        // active value of the section's filterBy field
  draft: null,
  detailId: null,
  loadingTexts: false,
  // Kept in view state: the panel is rebuilt when the list redraws, so a
  // summary held only in the DOM disappears the moment it is shown.
  lastSync: null,
  imoOpen: false
};

let lockTimer = null;

// ── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  registerServiceWorker();

  store.onChange(render);
  wireApp();

  if (await store.needsMigration()) {
    // An older library, made when Library still had a passcode.
    $('#lock').hidden = false;
    wireMigration();
    setTimeout(() => $('#migrateCode').focus(), 150);
    return;
  }

  await store.open();
  enterApp();
}

function wireMigration() {
  $('#migrateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#migrateError');
    err.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Converting…';
    try {
      const n = await store.migrate($('#migrateCode').value);
      $('#migrateCode').value = '';
      $('#lock').hidden = true;
      enterApp();
      toast(`Passcode removed — ${n} entr${n === 1 ? 'y' : 'ies'} converted`);
    } catch (ex) {
      err.textContent = ex.code === 'BAD_PASSCODE' ? 'Incorrect passcode.' : ex.message;
      err.hidden = false;
      $('#migrateCode').select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Remove the passcode';
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    if (view.draft || !$('#editor').hidden) return;
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) next.postMessage('skipWaiting');
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (e) { console.warn('SW registration failed', e); }
  });
}

function enterApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  view.screen = 'home';
  view.section = null;
  render();
}

// ── render ──────────────────────────────────────────────────────────────────

function render() {
  if (!store.isOpen()) return;
  const body = clear($('#body'));
  const searching = view.query.trim().length > 0;
  view.screen = searching ? 'search' : (view.section ? 'section' : 'home');

  $('#backBtn').hidden = view.screen === 'home';
  clear($('#backBtn'));
  if (view.screen !== 'home') $('#backBtn').append(icon('back', 20));
  $('#fab').hidden = view.screen !== 'section';

  const title = view.screen === 'search' ? 'Search'
    : view.section ? TYPES[view.section].label : 'LIBRARY';
  $('#screenTitle').textContent = title;
  $('#screenTitle').className = view.screen === 'home' ? 'brand' : 'brand small';

  if (view.screen === 'home') { renderScope(null); renderHome(body); }
  else if (view.screen === 'section') { renderScope(TYPES[view.section]); renderSection(body); }
  else { renderScope(null); renderSearch(body); }
}

/** Filter chips for a section; hidden elsewhere. */
function renderScope(def) {
  const scope = clear($('#scope'));
  if (!def?.filterBy) { scope.hidden = true; return; }
  const values = new Set();
  for (const item of store.itemsOfType(view.section)) {
    const v = item.data[def.filterBy.key];
    if (v) values.add(v);
  }
  if (!values.size) { scope.hidden = true; return; }
  scope.hidden = false;
  const add = (label, value) => scope.append(el('button', {
    class: 'scope-btn',
    'aria-pressed': String(view.filter === value),
    onclick: () => { view.filter = value; render(); }
  }, [label]));
  add('All', null);
  for (const v of [...values].sort()) add(v, v);
}

function renderHome(body) {
  const counts = store.counts();
  const grid = el('div', { class: 'sections' });
  for (const type of TAB_ORDER) {
    const def = TYPES[type];
    grid.append(el('button', {
      class: 'section-card',
      onclick: () => { view.section = type; view.filter = null; render(); $('#body').scrollTop = 0; }
    }, [
      el('span', { class: 'section-ico' }, [icon(def.icon, 24)]),
      el('h2', { class: 'section-name', text: def.label }),
      el('span', { class: 'section-count', text: `${counts[type] || 0} ${counts[type] === 1 ? 'entry' : 'entries'}` }),
      def.tracksRevision && countDue(store.itemsOfType(type))
        ? el('span', { class: 'pill pill-warn', text: `${countDue(store.itemsOfType(type))} to check` })
        : null
    ]));
  }
  body.append(grid);

  const stats = store.textStats();
  if (stats.searchable || stats.unsearchable) {
    body.append(el('p', { class: 'hint', style: 'text-align:center;margin-top:6px' }, [
      `${stats.searchable} PDF${stats.searchable === 1 ? '' : 's'} searchable`
      + (stats.unsearchable ? ` · ${stats.unsearchable} scanned, no text to search` : '')
    ]));
  }
}

function renderSection(body) {
  const def = TYPES[view.section];
  if (view.section === 'flag') body.append(updatePanel());
  if (view.section === 'publication') body.append(conventionPanel());
  if (def.sources) body.append(sourceLinks(def.sources));
  let items = store.itemsOfType(view.section);
  if (view.filter && def.filterBy) {
    items = items.filter((i) => i.data[def.filterBy.key] === view.filter);
  }

  if (!items.length) {
    body.append(emptyState(`No ${def.label.toLowerCase()} yet`, 'Tap + to add the first entry.'));
    return;
  }

  if (def.groupBy) {
    // Group headers, e.g. manuals filed under each ship.
    const groups = new Map();
    for (const item of items) {
      const key = item.data[def.groupBy.key] || def.groupBy.blank;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const names = [...groups.keys()].sort((a, b) => {
      if (a === def.groupBy.blank) return 1;
      if (b === def.groupBy.blank) return -1;
      return a.localeCompare(b);
    });
    for (const name of names) {
      body.append(el('div', { class: 'group-head' }, [
        name, el('span', { class: 'group-count', text: String(groups.get(name).length) })
      ]));
      for (const item of groups.get(name)) body.append(cardFor(item));
    }
  } else {
    for (const item of items) body.append(cardFor(item));
  }
}

async function renderSearch(body) {
  const query = view.query;

  // Document text is decrypted on the first search of a session rather than at
  // unlock, so unlocking stays fast with a large library. The user is not asked
  // to trigger it -- searching is the trigger.
  if (!store.textsLoaded() && !view.loadingTexts) {
    view.loadingTexts = true;
    store.loadTexts()
      .catch((ex) => console.warn('Could not load document text', ex))
      .finally(() => { view.loadingTexts = false; render(); });
  }

  const texts = store.textsLoaded() ? await store.loadTexts() : null;
  const results = runSearch(query, store.allItems(), texts);

  if (!texts) {
    body.append(el('div', { class: 'panel' }, [
      el('p', { style: 'margin:0', text: 'Opening document text — searching titles and fields meanwhile…' }),
      el('div', { class: 'bar' }, [el('i', { style: 'width:60%' })])
    ]));
  }

  if (!results.length) {
    body.append(emptyState(
      texts ? 'Nothing found' : 'Nothing found yet',
      texts ? `No entry matches “${query}”.` : 'Still opening document text…'));
    return;
  }

  for (const type of TAB_ORDER) {
    const group = results.filter((r) => r.item.type === type);
    if (!group.length) continue;
    body.append(el('div', { class: 'group-head' }, [
      TYPES[type].label, el('span', { class: 'group-count', text: String(group.length) })
    ]));
    for (const result of group) {
      body.append(cardFor(result.item, result.snippets,
        { matchCount: result.matchCount, pagesWithHits: result.pagesWithHits }));
    }
  }
}

/**
 * The IMO conventions, offered from a list held in the app.
 *
 * Deliberately not a download. The conventions are a closed set that changes
 * once every few years, so fetching them would spend data at sea to be told
 * what the app already knows. The list is here; what it cannot know — which
 * amendments are in force on your ship — stays yours to fill in.
 */
function conventionPanel() {
  const held = store.itemsOfType('publication');
  const missing = notHeld(held);

  // Its own class: the source-links panel below carries the words "IMO
  // Conventions" too, and a selector that matches both is a selector that
  // will pick the wrong one.
  const panel = el('div', { class: 'panel imo-panel' }, [
    el('h3', { text: 'IMO conventions' }),
    el('p', {
      text: missing.length
        ? `${IMO_CONVENTIONS.length} conventions, held in the app. ${missing.length} not yet filed. Nothing is downloaded — add the ones you want and fill in the amendments in force from your circulars.`
        : `All ${IMO_CONVENTIONS.length} conventions are filed.`
    })
  ]);

  if (!missing.length) return panel;

  const list = el('div', { hidden: !view.imoOpen });
  for (const convention of missing) {
    const row = el('div', { class: 'stat' }, [
      el('span', {}, [
        el('strong', { text: convention.short }),
        el('span', { class: 'hint', style: 'display:block',
          text: `${convention.name} · ${convention.inForce ? `in force ${convention.inForce}` : 'not yet in force'}` })
      ])
    ]);
    const add = el('button', { class: 'btn btn-sm', text: 'Add' });
    add.addEventListener('click', async () => {
      add.disabled = true;
      await store.saveItem({ type: 'publication', data: asPublication(convention) });
      view.imoOpen = true;
      render();
    });
    row.append(add);
    list.append(row);
  }

  const toggle = el('button', { class: 'btn btn-block' },
    [view.imoOpen ? 'Hide the list' : `Add from the IMO list (${missing.length})`]);
  toggle.addEventListener('click', () => { view.imoOpen = !view.imoOpen; render(); });

  const all = el('button', { class: 'btn btn-sm btn-block', style: 'margin-top:8px' },
    [`Add all ${missing.length}`]);
  all.addEventListener('click', async () => {
    all.disabled = true;
    all.textContent = 'Adding…';
    for (const convention of missing) {
      await store.saveItem({ type: 'publication', data: asPublication(convention) });
    }
    render();
  });
  list.append(all);

  panel.append(toggle, list);
  return panel;
}

/**
 * Pull an administration's current notice list in and file it.
 *
 * Only the catalogue is fetched, never the documents: the hosts that serve the
 * PDFs refuse cross-origin reads. Each entry keeps a link to its page, which
 * opens in Safari when a particular document is wanted.
 *
 * One button per administration, and nothing behind them runs on its own —
 * on a metered connection you fetch the flag you are under, not all three.
 */
function updatePanel() {
  const out = el('div');
  const panel = el('div', { class: 'panel' }, [
    el('h3', { text: 'Update from the administration' }),
    el('p', { text: 'Fetches the current notice list for one flag and files it here. Nothing is fetched until you tap, so it never spends your data on its own. Your own entries, notes and files are left alone.' })
  ]);

  if (view.lastSync) {
    out.append(el('p', {
      class: 'hint',
      style: `color:${view.lastSync.ok ? 'var(--sage)' : 'var(--danger)'}`,
      text: view.lastSync.text
    }));
  }

  const row = el('div', { class: 'fieldrow' });
  for (const admin of SYNCABLE) {
    const button = el('button', { class: 'btn btn-sm btn-block' }, [admin]);
    button.addEventListener('click', () => syncAdmin(admin, button, out));
    row.append(el('div', {}, [button]));
  }

  panel.append(row, out);
  return panel;
}

/** Run one administration's fetch, reporting whatever actually happened. */
async function syncAdmin(admin, button, out) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '…';
  clear(out).append(el('p', { class: 'hint', text: `Contacting ${admin}…` }));

  try {
    const { notices, failed } = await fetchNotices(admin);
    const summary = await mergeNotices(notices, admin);
    // A partial result is still a result: file what came back, and say plainly
    // which classes of document did not.
    const missed = failed.length ? ` Could not read: ${failed.join('; ')}.` : '';
    view.lastSync = {
      ok: true,
      text: `${admin}: ${summary.added} new, ${summary.updated} updated, ${summary.unchanged} already held.${missed}`
    };
    render();   // redraws the list, and the panel with the summary in it
  } catch (ex) {
    view.lastSync = {
      ok: false,
      text: `${admin} could not be read: ${ex.message}. This needs a connection, and the site has to permit the app to read it.`
    };
    clear(out).append(el('p', { class: 'hint', style: 'color:var(--danger)', text: view.lastSync.text }));
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/**
 * Fold fetched notices into what is already held, matching on reference so a
 * repeat run updates rather than duplicates. Anything typed by hand — notes,
 * applies-to, attachments — is preserved; only the published fields are
 * refreshed, and a title you have rewritten yourself is left as you wrote it.
 */
async function mergeNotices(notices, admin) {
  const feed = FEEDS[admin];
  const held = store.itemsOfType('flag');
  const byRef = new Map();
  for (const item of held) {
    const key = item.data.refNo || item.data.sourceUrl;
    if (key) byRef.set(key.toUpperCase(), item);
  }

  let added = 0, updated = 0, unchanged = 0;
  for (const notice of notices) {
    const key = (notice.refNo || notice.sourceUrl || '').toUpperCase();
    const existing = key ? byRef.get(key) : null;

    if (!existing) {
      await store.saveItem({
        type: 'flag',
        data: {
          title: notice.title,
          syncTitle: notice.title,     // what the source called it, to spot edits
          flagState: admin,
          docType: notice.docType,
          refNo: notice.refNo,
          date: notice.date,
          issuer: feed.issuer,
          fileLink: notice.sourceUrl,
          sourceUrl: notice.sourceUrl,
          attachments: []
        }
      });
      added++;
      continue;
    }

    // syncTitle records what the source last called this. Its absence means
    // the entry was typed in by hand — a notice already held before the flag
    // was ever synced — so the sync attaches itself to it without rewriting
    // any of it. Panama in particular titles its circulars by filename, and
    // that must never replace a subject the owner wrote themselves.
    const mine = !existing.data.syncTitle;
    const renamed = existing.data.title !== existing.data.syncTitle;

    const next = { ...existing.data, syncTitle: notice.title };
    if (!mine && !renamed) next.title = notice.title;
    if (!mine && notice.date) next.date = notice.date;
    if (!mine) next.sourceUrl = notice.sourceUrl;

    // Blanks are filled either way: adding what was missing takes nothing away.
    if (!next.date) next.date = notice.date;
    if (!next.docType) next.docType = notice.docType;
    if (!next.issuer) next.issuer = feed.issuer;
    if (!next.sourceUrl) next.sourceUrl = notice.sourceUrl;
    if (!next.fileLink) next.fileLink = notice.sourceUrl;

    const changed = Object.keys(next).some((k) => next[k] !== existing.data[k]);
    if (!changed) { unchanged++; continue; }

    await store.saveItem({ id: existing.id, type: 'flag', data: next });
    updated++;
  }
  return { added, updated, unchanged };
}

/** Links to where an administration publishes, for verifying a held copy. */
function sourceLinks(sources) {
  const panel = el('div', { class: 'panel' }, [
    el('h3', { text: 'Check against the source' }),
    el('p', { style: 'margin-bottom:9px', text: 'Opens in Safari, so it needs a connection. Use it to confirm a notice you hold is still the current one.' })
  ]);
  for (const [admin, links] of Object.entries(sources)) {
    const row = el('div', { class: 'fieldrow', style: 'margin-bottom:8px' });
    for (const link of links) {
      row.append(el('div', {}, [
        el('a', {
          class: 'btn btn-sm btn-block link-btn',
          href: link.url, target: '_blank', rel: 'noopener noreferrer'
        }, [`${admin} ${link.label}`])
      ]));
    }
    panel.append(row);
  }
  return panel;
}

function emptyState(title, text) {
  return el('div', { class: 'empty' }, [
    el('span', { class: 'empty-mark' }, [icon('library', 38)]),
    el('h3', { text: title }),
    el('p', { text })
  ]);
}

function cardFor(item, snippets, matchInfo) {
  const def = TYPES[item.type];
  const title = item.data[def.titleKey] || 'Untitled';
  const sub = (def.listFields || []).map((k) => item.data[k]).filter(Boolean).join(' · ');
  const atts = item.data.attachments || [];

  const rev = def.tracksRevision ? revisionStatus(item.data) : null;
  const card = el('article', {
    class: 'card' + (rev && rev.state !== 'ok' ? ' due' : ''),
    onclick: () => openDetail(item.id)
  }, [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: title }),
      rev ? el('span', {
        class: 'pill ' + (rev.state === 'ok' ? 'pill-sage' : 'pill-warn'),
        text: rev.state === 'ok' ? 'Current' : rev.state === 'never' ? 'Unverified' : 'Check'
      }) : null,
      atts.length ? el('span', { class: 'pill pill-dim', text: `${atts.length} file${atts.length === 1 ? '' : 's'}` }) : null
    ])
  ]);
  if (rev) {
    card.append(el('div', { class: 'dgrid' }, [
      dcell('Revision', item.data.revision || '—', !item.data.revision),
      dcell('Status', revisionLabel(rev), rev.state === 'ok')
    ]));
  }
  if (sub) card.append(el('p', { class: 'card-sub', text: sub }));

  if (item.type === 'publication' && (item.data.correctedTo || item.data.edition)) {
    card.append(el('div', { class: 'dgrid' }, [
      dcell('Corrected to', item.data.correctedTo || '—', !item.data.correctedTo),
      dcell('Edition', item.data.edition || '—', !item.data.edition)
    ]));
  }
  if ((item.type === 'circular' || item.type === 'notice') && item.data.date) {
    card.append(el('div', { class: 'dgrid' }, [
      dcell('Date', displayDate(item.data.date)),
      dcell(item.type === 'notice' ? 'Source' : 'Category',
        item.data[item.type === 'notice' ? 'source' : 'category'] || '—')
    ]));
  }

  if (snippets?.length) card.append(matchList(item, snippets, matchInfo));
  return card;
}

const FIRST_SHOWN = 3;

/** The hits inside a document: a few at first, the rest on request. */
function matchList(item, snippets, info) {
  const wrap = el('div');

  if (info && info.matchCount > snippets.length) {
    wrap.append(el('p', { class: 'match-count' }, [
      `${info.matchCount} match${info.matchCount === 1 ? '' : 'es'} on `
      + `${info.pagesWithHits} page${info.pagesWithHits === 1 ? '' : 's'}`
    ]));
  }

  const holder = el('div');
  let shown = 0;

  const draw = (upTo) => {
    for (; shown < Math.min(upTo, snippets.length); shown++) {
      const snip = snippets[shown];
      const att = (item.data.attachments || []).find((a) => a.id === snip.attachmentId);
      const box = el('button', {
        class: 'snippet',
        // Tapping a hit opens the document at that page rather than page one.
        onclick: (e) => { e.stopPropagation(); if (att) openAttachment(att, snip.page); }
      }, [
        el('span', { class: 'snippet-page', text: `${snip.file} · page ${snip.page}` })
      ]);
      // Built from text nodes, so a document's own words cannot become markup.
      for (const part of snip.parts) {
        box.append(part.hit ? el('mark', { text: part.text }) : document.createTextNode(part.text));
      }
      holder.append(box);
    }
  };

  draw(FIRST_SHOWN);
  wrap.append(holder);

  if (snippets.length > FIRST_SHOWN) {
    const more = el('button', {
      class: 'btn btn-sm btn-block', style: 'margin-top:8px',
      onclick: (e) => {
        e.stopPropagation();
        draw(snippets.length);
        more.remove();
      }
    }, [`Show all ${snippets.length} results`]);
    wrap.append(more);
  }
  return wrap;
}

function dcell(key, value, dim) {
  return el('div', { class: 'dcell' }, [
    el('span', { class: 'dkey', text: key }),
    el('span', { class: 'dval' + (dim ? ' dim' : ''), text: String(value ?? '—') })
  ]);
}

function displayDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── chrome ──────────────────────────────────────────────────────────────────

function wireApp() {
  let searchTimer = null;
  $('#search').addEventListener('input', (e) => {
    view.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 120);
  });
  $('#backBtn').addEventListener('click', () => {
    if (view.query) { view.query = ''; $('#search').value = ''; }
    else { view.section = null; view.filter = null; }
    render();
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', () => { $('#settings').hidden = true; });
  $('#detailClose').addEventListener('click', () => { $('#detail').hidden = true; view.detailId = null; });
  $('#detailEdit').addEventListener('click', () => {
    const item = store.getItem(view.detailId);
    $('#detail').hidden = true;
    if (item) openEditor(item.type, item);
  });
  $('#editorCancel').addEventListener('click', closeEditor);
  $('#editorSave').addEventListener('click', saveEditor);
  $('#fab').addEventListener('click', () => view.section && openEditor(view.section, null));
  $('#filePicker').addEventListener('change', onFilesPicked);
  $('#viewerClose').addEventListener('click', closeViewer);
  for (const id of ['#detail', '#editor', '#settings']) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id.slice(1)) e.target.hidden = true; });
  }
}

// ── detail ──────────────────────────────────────────────────────────────────

function openDetail(id) {
  const item = store.getItem(id);
  if (!item) return;
  view.detailId = id;
  const def = TYPES[item.type];
  $('#detailTitle').textContent = def.singular;
  const body = clear($('#detailBody'));

  body.append(el('h2', { class: 'card-title', style: 'font-size:21px;margin:0', text: item.data[def.titleKey] || 'Untitled' }));

  if (def.tracksRevision) {
    const rev = revisionStatus(item.data);
    body.append(el('div', {}, [
      el('span', { class: 'pill ' + (rev.state === 'ok' ? 'pill-sage' : 'pill-warn'), text: revisionLabel(rev) })
    ]));
    if (rev.state !== 'ok') {
      body.append(el('p', { class: 'hint', style: 'margin-top:0' },
        ['Confirm against the company system before relying on this, then update the revision-checked date.']));
    }
  }

  const section = el('div', { class: 'detail-sec' });
  let shown = 0;
  for (const f of def.fields) {
    if (['attachments', 'fileLink'].includes(f.key) || f.key === def.titleKey) continue;
    const raw = item.data[f.key];
    if (raw === undefined || raw === null || raw === '') continue;
    section.append(el('div', { class: 'stat' }, [
      el('span', { text: f.label }),
      el('span', { text: f.type === 'date' ? displayDate(raw) : String(raw) })
    ]));
    shown++;
  }
  if (shown) body.append(section);

  const atts = item.data.attachments || [];
  if (atts.length) {
    const sec3 = el('div', { class: 'detail-sec' }, [el('h4', { text: 'Files on this device' })]);
    for (const att of atts) sec3.append(attachmentRow(att));
    body.append(sec3);
  }

  if (item.data.fileLink) {
    body.append(el('div', { class: 'detail-sec' }, [
      el('h4', { text: 'Cloud link' }),
      el('a', { class: 'btn btn-block link-btn', href: item.data.fileLink, target: '_blank', rel: 'noopener noreferrer' }, ['Open link'])
    ]));
  }

  $('#detail').hidden = false;
  $('#detailBody').scrollTop = 0;
}

function textStatusOf(att) {
  // Older records predate textStatus and only carry a page count.
  if (att.textStatus) return att.textStatus;
  if (att.textPages > 0) return STATUS.INDEXED;
  if (att.scanned) return STATUS.NO_TEXT;
  return null;
}

function attachmentRow(att, onRemove) {
  const state = textStatusOf(att);
  const status =
    state === STATUS.INDEXED ? el('span', { class: 'pill pill-sage', text: `${att.textPages} pages indexed` })
    : state === STATUS.NO_TEXT ? el('span', { class: 'pill pill-warn', text: 'No text layer — scan' })
    : state === STATUS.ENCRYPTED ? el('span', { class: 'pill pill-warn', text: 'Password protected' })
    : state === STATUS.FAILED ? el('span', { class: 'pill pill-warn', text: 'Could not be read' })
    : null;

  const row = el('div', { class: 'attach' }, [
    el('div', { class: 'card-head' }, [
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'dval', style: 'font-size:14px', text: att.name }),
        el('div', { class: 'dkey', style: 'margin-top:3px', text: `${att.type || 'file'} · ${formatBytes(att.size)}` })
      ]),
      onRemove ? el('button', { class: 'del-btn', onclick: onRemove, 'aria-label': 'Remove file' }, ['×']) : null
    ])
  ]);
  if (status) row.append(el('div', { style: 'margin-top:8px' }, [status]));
  if (state === STATUS.NO_TEXT) {
    row.append(el('p', { class: 'hint', text: 'This file is a picture of its pages, so there are no words to search. Its title and fields are still searchable.' }));
  }
  if (state === STATUS.FAILED && att.textError) {
    row.append(el('p', { class: 'hint', text: att.textError }));
  }
  if (!onRemove) {
    row.append(el('div', { class: 'fieldrow', style: 'margin-top:9px' }, [
      el('div', {}, [el('button', { class: 'btn btn-sm btn-block', onclick: () => openAttachment(att) }, ['Open'])]),
      el('div', {}, [el('button', { class: 'btn btn-sm btn-block', onclick: () => shareAttachment(att) }, ['Save to Files'])])
    ]));
    if (state !== STATUS.INDEXED) {
      row.append(el('button', {
        class: 'btn btn-sm btn-block', style: 'margin-top:8px',
        onclick: (e) => reReadText(att, e.target)
      }, ['Try reading the text again']));
    }
  }
  return row;
}

/** Re-run extraction on a stored file, without needing it added again. */
async function reReadText(att, button) {
  button.disabled = true;
  button.textContent = 'Reading…';
  try {
    const blob = await store.readFile(att);
    const result = await extract(await blob.arrayBuffer());
    if (result.pages.length) await store.storeText(att.id, result.pages);

    // The descriptor lives on the record, so update and save it there.
    const item = store.getItem(view.detailId);
    if (item) {
      const next = (item.data.attachments || []).map((a) => a.id === att.id
        ? { ...a, textPages: result.pages.length, pageCount: result.pageCount,
            textStatus: result.status, textError: result.error }
        : a);
      await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, attachments: next } });
      openDetail(item.id);
    }
    toast(result.status === STATUS.INDEXED
      ? `Read ${result.pages.length} pages`
      : result.status === STATUS.NO_TEXT ? 'Still no text layer — this is a scan'
      : 'Could not read it: ' + (result.error || 'unknown reason'));
  } catch (ex) {
    toast('Could not read it: ' + ex.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Try reading the text again';
  }
}

let disposeViewer = null;

/**
 * Show a document in the app. An installed iOS web app cannot open a blob: URL
 * in a new tab, so this renders it here instead of handing it to the browser.
 */
async function openAttachment(att, startPage = 1) {
  const sheet = $('#viewer');
  const body = clear($('#viewerBody'));
  $('#viewerTitle').textContent = att.name || 'Document';
  sheet.hidden = false;
  body.append(el('p', { class: 'hint', style: 'padding:24px', text: 'Opening…' }));

  try {
    const blob = await store.readFile(att);
    disposeViewer?.();
    disposeViewer = await renderInto(body, blob, att.name, {
      startPage,
      onStatus: (text) => {
        $('#viewerTitle').textContent = startPage > 1
          ? `${att.name} · page ${startPage} of ${text.replace(/ pages?$/, '')}`
          : `${att.name} · ${text}`;
      }
    });
    $('#viewerShare').onclick = () => shareAttachment(att);
  } catch (ex) {
    clear(body).append(el('div', { class: 'empty' }, [
      el('h3', { text: 'Could not open it' }),
      el('p', { text: ex.message })
    ]));
  }
}

function closeViewer() {
  $('#viewer').hidden = true;
  disposeViewer?.();
  disposeViewer = null;
  clear($('#viewerBody'));
}

async function shareAttachment(att) {
  try {
    const blob = await store.readFile(att);
    const file = new File([blob], att.name, { type: att.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: att.name });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: att.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (ex) {
    if (ex.name !== 'AbortError') toast('Could not share: ' + ex.message);
  }
}

// ── editor ──────────────────────────────────────────────────────────────────

function openEditor(type, item) {
  view.draft = {
    id: item?.id || null,
    type,
    data: JSON.parse(JSON.stringify(item?.data || {})),
    newFiles: [],
    removed: []
  };
  if (!view.draft.data.attachments) view.draft.data.attachments = [];
  $('#editorTitle').textContent = (item ? 'Edit ' : 'New ') + TYPES[type].singular.toLowerCase();
  renderEditor();
  $('#editor').hidden = false;
  $('#editorBody').scrollTop = 0;
}

function closeEditor() { $('#editor').hidden = true; view.draft = null; }

function renderEditor() {
  const draft = view.draft;
  const def = TYPES[draft.type];
  const body = clear($('#editorBody'));

  let i = 0;
  while (i < def.fields.length) {
    const f = def.fields[i];
    if (f.group) {
      const run = [];
      while (i < def.fields.length && def.fields[i].group === f.group) run.push(def.fields[i++]);
      body.append(el('div', { class: 'fieldrow' }, run.map((g) => el('div', {}, [fieldFor(g, draft)]))));
    } else {
      body.append(fieldFor(f, draft));
      i++;
    }
  }

  if (draft.id) {
    body.append(el('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        if (!confirm('Delete this entry and its files permanently?')) return;
        await store.deleteItem(draft.id);
        closeEditor();
        toast('Deleted');
      }
    }, ['Delete entry']));
  }
}

function fieldFor(f, draft) {
  if (f.type === 'attachments') return attachmentsEditor(draft, f);
  const wrap = el('div', {}, [el('label', { class: 'label', text: f.label })]);
  const value = draft.data[f.key] ?? '';

  if (f.type === 'textarea') {
    wrap.append(el('textarea', {
      class: 'field', 'data-field': f.key, placeholder: f.placeholder || '',
      oninput: (e) => { draft.data[f.key] = e.target.value; }
    }, [value]));
  } else if (f.type === 'select') {
    // A field can narrow its options based on another field's value.
    const options = f.optionsBy
      ? (f.optionsBy.map[draft.data[f.optionsBy.key]] || f.options)
      : f.options;
    // Changing a controlling field has to redraw the fields it controls.
    const controls = TYPES[draft.type].fields.some((other) => other.optionsBy?.key === f.key);

    const sel = el('select', {
      class: 'field', 'data-field': f.key,
      onchange: (e) => {
        draft.data[f.key] = e.target.value;
        if (controls) {
          // A type that does not exist under the new administration is dropped
          // rather than left behind as a stale value.
          for (const other of TYPES[draft.type].fields) {
            if (other.optionsBy?.key !== f.key) continue;
            const allowed = other.optionsBy.map[e.target.value] || other.options;
            if (draft.data[other.key] && !allowed.includes(draft.data[other.key])) {
              delete draft.data[other.key];
            }
          }
          renderEditor();
        }
      }
    });
    sel.append(el('option', { value: '' }, ['—']));
    for (const opt of options) sel.append(el('option', { value: opt, selected: value === opt }, [opt]));
    if (value && !options.includes(value)) sel.append(el('option', { value, selected: true }, [value]));
    wrap.append(sel);
  } else {
    wrap.append(el('input', {
      class: 'field', 'data-field': f.key,
      type: f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text',
      value, placeholder: f.placeholder || '',
      oninput: (e) => { draft.data[f.key] = e.target.value; }
    }));
  }
  if (f.hint) wrap.append(el('p', { class: 'hint', text: f.hint }));
  return wrap;
}

function attachmentsEditor(draft, f) {
  const wrap = el('div', {}, [el('label', { class: 'label', text: f.label })]);
  for (const att of draft.data.attachments) {
    wrap.append(attachmentRow(att, () => {
      draft.data.attachments = draft.data.attachments.filter((a) => a.id !== att.id);
      draft.removed.push(att);
      renderEditor();
    }));
  }
  draft.newFiles.forEach((file, idx) => {
    wrap.append(el('div', { class: 'attach', style: 'border-left-color:var(--sage)' }, [
      el('div', { class: 'card-head' }, [
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', { class: 'dval', style: 'font-size:14px', text: file.name }),
          el('div', { class: 'dkey', style: 'margin-top:3px', text: `${formatBytes(file.size)} · encrypted on save` })
        ]),
        el('button', {
          class: 'del-btn', 'aria-label': 'Remove file',
          onclick: () => { draft.newFiles.splice(idx, 1); renderEditor(); }
        }, ['×'])
      ])
    ]));
  });
  wrap.append(el('button', { class: 'btn btn-block', onclick: () => $('#filePicker').click() }, ['+ Add files']));
  if (f.hint) wrap.append(el('p', { class: 'hint', text: f.hint }));
  return wrap;
}

async function onFilesPicked(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length || !view.draft) return;
  view.draft.newFiles.push(...files);
  renderEditor();

  // Fill in what the PDF can tell us about itself. Only the first page is read,
  // so this is quick, and only empty fields are touched -- anything already
  // typed is left exactly as it is.
  const pdf = files.find(isPdf);
  if (pdf) await fillFromPdf(pdf);
}

async function fillFromPdf(file) {
  const draft = view.draft;
  if (!draft) return;
  const def = TYPES[draft.type];
  const status = el('p', { class: 'hint', text: `Reading details from ${file.name}…` });
  $('#editorBody').prepend(status);

  try {
    const described = await describe(await file.arrayBuffer());
    if (!draft || !described.ok) return;

    const keys = def.fields.map((f) => f.key);
    const suggested = suggestFields(draft.type, described, file.name, keys);

    const filled = [];
    for (const [key, value] of Object.entries(suggested)) {
      if (String(draft.data[key] || '').trim()) continue;   // never overwrite
      draft.data[key] = value;
      filled.push(def.fields.find((f) => f.key === key)?.label || key);
    }

    renderEditor();
    if (filled.length) {
      // Say what was guessed, so it gets checked rather than trusted.
      $('#editorBody').prepend(el('div', { class: 'panel', style: 'border-color:var(--copper-dim)' }, [
        el('h3', { text: 'Filled in from the PDF' }),
        el('p', { style: 'margin:0', text: `${filled.join(', ')} — check these and correct anything wrong.` })
      ]));
    }
  } catch (ex) {
    console.warn('Could not read details from the PDF', ex);
  } finally {
    status.remove();
  }
}

async function saveEditor() {
  const draft = view.draft;
  if (!draft) return;
  const def = TYPES[draft.type];
  const required = def.fields.find((f) => f.required && !String(draft.data[f.key] || '').trim());
  if (required) return toast(`${required.label} is required`);

  const btn = $('#editorSave');
  btn.disabled = true;
  const progress = el('div', { class: 'bar' }, [el('i')]);
  const status = el('p', { class: 'hint', style: 'margin:0 0 4px' }, ['Saving…']);
  $('#editorBody').prepend(el('div', { class: 'panel', id: 'saveProgress' }, [status, progress]));

  try {
    for (const file of draft.newFiles) {
      status.textContent = `Encrypting ${file.name}…`;
      btn.textContent = 'Saving…';
      const descriptor = await store.storeFile(file);

      // Read the text out of PDFs so their contents become searchable.
      if (isPdf(file)) {
        status.textContent = `Reading text from ${file.name}…`;
        const buffer = await file.arrayBuffer();
        const result = await extract(buffer, {
          onProgress: (page, total) => {
            progress.firstChild.style.width = `${Math.round((page / total) * 100)}%`;
            status.textContent = `Reading ${file.name} — page ${page} of ${total}`;
          }
        });
        if (result.pages.length) await store.storeText(descriptor.id, result.pages);
        descriptor.textPages = result.pages.length;
        descriptor.pageCount = result.pageCount;
        descriptor.textStatus = result.status;
        descriptor.textError = result.error;
      }
      draft.data.attachments.push(descriptor);
      progress.firstChild.style.width = '0';
    }

    for (const att of draft.removed) await store.removeFile(att).catch(() => {});

    const saved = await store.saveItem({ id: draft.id, type: draft.type, data: draft.data });
    closeEditor();
    const scanned = draft.newFiles.length && draft.data.attachments.some((a) => a.scanned);
    toast(scanned ? 'Saved — one file is a scan, so its text is not searchable' : 'Saved');
    if (view.detailId === saved.id) openDetail(saved.id);
  } catch (ex) {
    toast('Save failed: ' + ex.message);
  } finally {
    $('#saveProgress')?.remove();
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ── settings ────────────────────────────────────────────────────────────────

async function openSettings() {
  const body = clear($('#settingsBody'));
  const est = await db.storageEstimate();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const counts = store.counts();
  const stats = store.textStats();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const box = el('div', { class: 'panel' }, [el('h3', { text: 'This device' })]);
  box.append(el('div', { class: 'stat' }, [el('span', { text: 'Entries' }), el('span', { text: String(total) })]));
  for (const type of TAB_ORDER) {
    if (counts[type]) box.append(el('div', { class: 'stat' }, [el('span', { text: TYPES[type].label }), el('span', { text: String(counts[type]) })]));
  }
  box.append(el('div', { class: 'stat' }, [el('span', { text: 'Files stored' }), el('span', { text: formatBytes(store.attachmentBytes()) })]));
  box.append(el('div', { class: 'stat' }, [el('span', { text: 'Searchable PDFs' }), el('span', { text: String(stats.searchable) })]));
  if (stats.unsearchable) {
    box.append(el('div', { class: 'stat' }, [el('span', { text: 'Scans without text' }), el('span', { text: String(stats.unsearchable) })]));
  }
  box.append(el('div', { class: 'stat' }, [el('span', { text: 'Space used' }), el('span', { text: est ? formatBytes(est.usage) : 'unknown' })]));
  box.append(el('div', { class: 'stat' }, [
    el('span', { text: 'Storage protected' }),
    el('span', {}, [el('span', { class: 'pill ' + (persisted ? 'pill-sage' : 'pill-warn'), text: persisted ? 'Persistent' : 'Best effort' })])
  ]));
  box.append(el('div', { class: 'stat' }, [
    el('span', { text: 'Installed' }),
    el('span', {}, [el('span', { class: 'pill ' + (installed ? 'pill-sage' : 'pill-warn'), text: installed ? 'Yes' : 'Not yet' })])
  ]));
  if (!installed) box.append(el('p', { class: 'hint', text: 'In Safari: Share → Add to Home Screen.' }));
  body.append(box);

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Backup' }),
    el('p', { text: 'Saves your records and their indexed text. The PDFs themselves are left out — a library of them is far too large for a single file, and you hold those elsewhere. Re-attach files after restoring.' }),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:8px', onclick: doExport }, ['Export records']),
    el('button', { class: 'btn btn-block', onclick: () => $('#backupPicker').click() }, ['Restore records'])
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Bring records from AVA' }),
    el('p', { text: 'Takes a handover file exported from AVA. Fields come across; files do not, so re-attach the PDFs here.' }),
    el('button', { class: 'btn btn-block', onclick: () => $('#backupPicker').click() }, ['Import handover file'])
  ]));

  // Distinguishes "the engine is broken on this device" from "your PDFs are
  // scans" — two problems that look identical from the outside.
  const testOut = el('p', { class: 'hint', style: 'margin:0' }, ['Not run yet.']);
  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'PDF reading' }),
    el('p', { text: 'Runs a built-in PDF through the reader to check it works on this iPhone. If this passes but your own files find no text, those files are scans.' }),
    el('button', {
      class: 'btn btn-block', style: 'margin-bottom:10px',
      onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Testing…';
        testOut.textContent = 'Running…';
        const r = await selfTest();
        testOut.textContent = r.ok
          ? `Working. Read ${r.chars} characters from the test file.`
          : `Failed (${r.status})${r.error ? ': ' + r.error : ''}`;
        testOut.style.color = r.ok ? 'var(--sage)' : 'var(--danger)';
        e.target.disabled = false;
        e.target.textContent = 'Test PDF reading';
      }
    }, ['Test PDF reading']),
    testOut
  ]));

  // Whether an administration can be pulled in depends on headers only a real
  // device with a connection can reveal, and each one answers differently.
  const feedOut = el('div');
  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Fetching flag notices' }),
    el('p', { text: 'Checks which administrations this iPhone can read directly from the app. Needs a connection, and fetches only listings — no documents.' }),
    el('button', {
      class: 'btn btn-block', style: 'margin-bottom:10px',
      onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Checking…';
        clear(feedOut).append(el('p', { class: 'hint', text: 'Contacting each administration…' }));
        const reports = await probeAll();
        clear(feedOut);
        for (const report of reports) {
          feedOut.append(el('p', {
            class: 'hint',
            style: `color:${report.canList ? 'var(--sage)' : 'var(--danger)'};margin-top:8px`,
            text: report.verdict
          }));
          for (const r of report.results) {
            feedOut.append(el('div', { class: 'stat' }, [
              el('span', { text: r.label }),
              el('span', { text: `${r.ok ? 'ok' : 'blocked'} · ${r.detail}` })
            ]));
          }
        }
        e.target.disabled = false;
        e.target.textContent = 'Check again';
      }
    }, ['Check which flags can be fetched']),
    feedOut
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Build' }),
    el('div', { class: 'stat' }, [el('span', { text: 'App version' }), el('span', { text: APP_VERSION })]),
    el('button', {
      class: 'btn btn-block', style: 'margin-top:10px',
      onclick: async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update().catch(() => {});
        toast('Checked for updates');
      }
    }, ['Check for updates'])
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Erase' }),
    el('p', { text: 'Deletes every entry and every stored file. There is no recovery.' }),
    el('button', { class: 'btn btn-danger btn-block', onclick: doErase }, ['Erase everything'])
  ]));

  $('#settings').hidden = false;
  $('#settingsBody').scrollTop = 0;
}

async function shareJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (ex) { if (ex.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

async function doExport() {
  const payload = await store.exportRecords();
  const stamp = new Date().toISOString().slice(0, 10);
  if (await shareJSON(payload, `library-records-${stamp}.json`)) toast('Records exported — save to Files');
}

async function onBackupPicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { return toast('That file is not valid JSON'); }

  try {
    const n = await store.importRecords(payload);
    $('#settings').hidden = true;
    render();
    toast(`Brought ${n} record${n === 1 ? '' : 's'} in`);
  } catch (ex) {
    toast(ex.message);
  }
}

async function doErase() {
  if (!confirm('Erase the entire library? Every entry and file is deleted permanently.')) return;
  if (prompt('Type ERASE to confirm:') !== 'ERASE') return toast('Cancelled');
  await store.eraseVault();
  location.reload();
}

boot();
