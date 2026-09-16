import * as store from './store.js';
import * as db from './db.js';
import { TYPES, TAB_ORDER } from './schema.js';
import { search as runSearch } from './search.js';
import { isPdf, extract, describe, selfTest, readLayout, STATUS } from './pdftext.js';
import { outlineFrom, equipmentFrom } from './outline.js';
import { suggestFields, titleFromFilename } from './suggest.js';
import { probeAll, fetchNotices, FEEDS, SYNCABLE } from './updates.js';
import { fetchSummary } from './summary.js';
import { IMO_CONVENTIONS, IMO_LIST_URL, asPublication, notHeld } from './imo.js';
import { el, $, clear, toast, formatBytes, titleCase } from './ui.js';
import { icon } from './icons.js';
import { renderInto } from './viewer.js';
import { revisionStatus, revisionLabel, countDue } from './revision.js';

const APP_VERSION = '2026.10.22';

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
  imoOpen: false,
  // Folded by default: what the section is for is the circulars.
  toolsOpen: false,
  // Which branches of the flag tree are open. Kept here rather than in the
  // DOM, because every render empties the body.
  openGroups: new Set(),
  // Which entry's file the viewer is showing, so a note written while reading
  // knows where to be kept.
  viewing: null,
  // A question waiting to be told where it is answered: while this is set,
  // every passage in the search results offers to be linked to it.
  linking: null,
  // Narrowing a search to one section. Cleared with the query, so a new
  // search is never quietly answered from inside the last one's filter.
  searchScope: null,
  // A run of the reader over a whole section, so the panel can show where it
  // has got to across every redraw the saving of each page causes.
  reading: null,
  // Picking several entries to set one field on all of them at once.
  selecting: false,
  selected: new Set(),
  bulk: null
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

/**
 * Ask the site what version it is serving, past every cache in the way.
 *
 * The query string is the point: a URL nothing has seen before cannot be
 * answered from the worker's cache or the browser's, so this is the truth
 * even when the worker is wedged. Which is the case worth catching — a stuck
 * worker is invisible from inside the app, and the app goes on looking
 * perfectly fine while running code from a fortnight ago.
 */
async function versionOnSite() {
  const url = new URL('version.json', location.href);
  url.searchParams.set('asked', Date.now());
  const body = await (await fetch(url.href, { cache: 'reload' })).json();
  return String(body?.version || '');
}

/**
 * Throw away the code and keep the data.
 *
 * Unregisters the workers and empties their caches, then reloads. Nothing
 * here touches the database, so entries, files and their text all survive —
 * this only discards what was downloaded from the site.
 */
async function reinstall() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations() || [];
    await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
  } catch { /* whatever fails, the reload is still worth doing */ }
  location.replace(location.pathname + '?fresh=' + Date.now());
}

/** Say so, once, when the site has moved on and this copy has not. */
async function announceIfStale() {
  if (!navigator.onLine) return;
  let onSite = '';
  try { onSite = await versionOnSite(); } catch { return; }
  if (!onSite || onSite === APP_VERSION) return;

  const bar = el('div', { class: 'panel', id: 'staleBar', style: 'margin:10px' }, [
    el('p', { class: 'hint', style: 'margin-bottom:8px',
      text: `Version ${onSite} is on the site; this is ${APP_VERSION}.` }),
    el('button', { class: 'btn btn-primary btn-block', onclick: reinstall },
      ['Update now — your entries are kept'])
  ]);
  // Above the body rather than inside it: every render empties the body, and
  // a notice that disappears the moment anything is tapped is no notice.
  const body = $('#body');
  if (body && !$('#staleBar')) body.parentNode.insertBefore(bar, body);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // Only mark it done once it is actually being done. Declining to reload
    // over an open editor used to latch this flag anyway, so the reload never
    // came — not on that change, and not on any change after it.
    if (view.draft || !$('#editor').hidden) return;
    reloading = true;
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
  // After the first render, so a slow reply never delays the app opening.
  announceIfStale();
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
  // A floating + while picking entries offers to make a new one, which is not
  // what the screen is for at that moment.
  $('#fab').hidden = view.screen !== 'section' || view.selecting;

  const title = view.screen === 'search' ? 'Search'
    : view.section ? TYPES[view.section].label : 'LIBRARY';
  $('#screenTitle').textContent = title;
  $('#screenTitle').className = view.screen === 'home' ? 'brand' : 'brand small';

  if (view.screen === 'home') { renderScope(null); renderHome(body); }
  else if (view.screen === 'section') { renderScope(TYPES[view.section]); renderSection(body); }
  // The search screen fills the scope row itself, from what its results hit.
  else renderSearch(body);
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

// ── linking a question to the clause that answers it ────────────────────────
//
// An inspector asks question 2.1 and what is needed back is the company clause
// that governs it -- not a page number in a 600-page question library. That
// link is found by searching and then kept, so it is found once.
//
// The finding reuses the search screen rather than a screen of its own: the
// section filter, the clause on each hit and the tap-to-open are all wanted
// here, and a second search built inside a sheet would be a worse copy of it.

function startLinking(item) {
  view.linking = { id: item.id, ref: item.data.refNo || '', title: item.data[TYPES[item.type].titleKey] || '' };
  $('#detail').hidden = true;
  view.detailId = null;
  // The question's own wording is the search, because it is what the company
  // document will be saying too.
  view.query = view.linking.title;
  view.searchScope = null;
  $('#search').value = view.query;
  render();
  $('#body').scrollTop = 0;
}

function stopLinking() {
  view.linking = null;
  view.query = '';
  view.searchScope = null;
  $('#search').value = '';
  render();
}

/** Already recorded, so the same passage is not filed twice. */
function alreadyLinked(question, snip) {
  return (question.data.answers || []).some((a) => a.attId === snip.attachmentId && a.page === snip.page);
}

async function linkAnswer(item, snip) {
  const question = store.getItem(view.linking.id);
  if (!question) { stopLinking(); return; }
  if (alreadyLinked(question, snip)) { toast('Already linked'); return; }

  const answers = [...(question.data.answers || []), {
    id: store.newId(),
    itemId: item.id,
    // Kept alongside the id rather than looked up each time: a link is a record
    // of what was found, and it must still read as one if the entry it points
    // at is later deleted or renamed.
    entry: item.data[TYPES[item.type].titleKey] || 'Untitled',
    section: TYPES[item.type].label,
    attId: snip.attachmentId,
    file: snip.file,
    page: snip.page,
    clause: snip.clause ? snip.clause.ref : null,
    label: snip.clause ? snip.clause.label : null
  }];
  await store.saveItem({ id: question.id, type: question.type, data: { ...question.data, answers } });
  const where = snip.clause ? `${snip.clause.ref} of ${snip.file}` : `page ${snip.page} of ${snip.file}`;
  toast(`${view.linking.ref || 'The question'} \u2190 ${where}`);
  render();
}

/** The standing banner while a question is waiting to be answered. */
function linkingBanner() {
  const question = store.getItem(view.linking.id);
  if (!question) { view.linking = null; return null; }
  const held = (question.data.answers || []).length;
  return el('div', { class: 'panel link-banner' }, [
    el('h3', { text: `Linking to ${view.linking.ref || 'a SIRE question'}` }),
    el('p', { class: 'stat-line', text: view.linking.title }),
    el('p', { class: 'hint', text: held
      ? `${held} clause${held === 1 ? '' : 's'} linked so far. Narrow to a section above, then Link the passage that answers it.`
      : 'Narrow to a section above, then Link the passage that answers it.' }),
    el('button', { class: 'btn btn-block', onclick: stopLinking }, [held ? 'Done' : 'Cancel'])
  ]);
}

/** The clauses recorded against a question, each one a way back to the page. */
function answersSection(item) {
  const answers = item.data.answers || [];
  const sec = el('div', { class: 'detail-sec' }, [el('h4', { text: 'Answered by' })]);

  if (!answers.length) {
    sec.append(el('p', { class: 'hint', text:
      'Nothing linked yet. Search the company documents for this subject and link the clause that answers it, so it is found once rather than every time.' }));
  }

  for (const answer of answers) {
    const target = store.getItem(answer.itemId);
    const att = (target?.data.attachments || []).find((a) => a.id === answer.attId);
    const row = el('div', { class: 'answer-row' }, [
      el('button', {
        class: 'answer-open', disabled: !att,
        // The entry that owns the file, not the question that points at it. A
        // note written while reading the manual belongs on the manual; without
        // this it was filed on whichever entry happened to be open, which from
        // here is always the question.
        onclick: () => att && openAttachment(att, answer.page, answer.itemId)
      }, [
        el('span', { class: 'answer-ref', text: answer.clause
          ? `${answer.clause}${answer.label ? ` \u2014 ${answer.label}` : ''}`
          : `Page ${answer.page}` }),
        el('span', { class: 'answer-where',
          text: `${answer.entry} \u00b7 ${answer.section} \u00b7 page ${answer.page}` }),
        att ? null : el('span', { class: 'hint', text: 'The document this pointed at is no longer here.' })
      ]),
      el('button', {
        class: 'del-btn', 'aria-label': 'Remove this link',
        onclick: async () => {
          const next = (item.data.answers || []).filter((a) => a.id !== answer.id);
          await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, answers: next } });
          openDetail(item.id);
        }
      }, ['\u00d7'])
    ]);
    sec.append(row);
  }

  sec.append(el('button', {
    class: 'btn btn-block', style: 'margin-top:10px',
    onclick: () => startLinking(item)
  }, [answers.length ? 'Link another clause' : 'Find where this is answered']));
  return sec;
}

/** Chips that narrow a search to one section, built from what actually hit. */
function renderSearchScope(results) {
  const scope = clear($('#scope'));
  const counts = new Map();
  for (const r of results) counts.set(r.item.type, (counts.get(r.item.type) || 0) + 1);

  // Nothing to choose between: one section, or none.
  if (counts.size < 2) {
    scope.hidden = true;
    if (view.searchScope && !counts.has(view.searchScope)) view.searchScope = null;
    return;
  }
  scope.hidden = false;
  const add = (label, value) => scope.append(el('button', {
    class: 'scope-btn',
    'aria-pressed': String(view.searchScope === value),
    onclick: () => { view.searchScope = value; render(); }
  }, [label]));
  add(`All ${results.length}`, null);
  for (const type of TAB_ORDER) {
    if (!counts.has(type)) continue;
    add(`${TYPES[type].short} ${counts.get(type)}`, type);
  }
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

/**
 * Everything that is not a circular, folded away.
 *
 * Flag Circulars had four panels stacked above the list — updating, fetching,
 * importing, and eleven links to check against the source — so reaching the
 * circulars meant scrolling past around twenty buttons. The panels each earn
 * their place; having all of them open at once does not.
 *
 * One line instead, which opens when it is wanted. What the section is for is
 * the circulars, and they now start directly under it.
 */
function toolsPanel(def, panels) {
  const open = view.toolsOpen;
  const wrap = el('div', { class: 'panel tools-panel' });

  const outstanding = view.section === 'flag'
    ? SYNCABLE.reduce((n, admin) => n + withoutDocuments(admin).length, 0)
    : 0;

  const head = el('button', {
    class: 'tools-head', 'aria-expanded': String(open),
    onclick: () => { view.toolsOpen = !view.toolsOpen; render(); }
  }, [
    el('span', { class: 'tools-title', text: 'Update, fetch and import' }),
    // A number worth seeing without opening anything: documents the site holds
    // that this phone has not taken yet.
    outstanding ? el('span', { class: 'pill pill-copper', text: `${outstanding} to fetch` }) : null,
    el('span', { class: 'tools-chevron', text: open ? '\u2212' : '+' })
  ]);
  wrap.append(head);

  if (open) {
    const inner = el('div', { class: 'tools-body' });
    for (const panel of panels) if (panel) inner.append(panel);
    wrap.append(inner);
  }
  return wrap;
}

// ── picking several at once ─────────────────────────────────────────────────
//
// A stack of manuals imported together arrives with no ship on any of them,
// and they are all for the same ship. Opening twenty entries to type "Gas
// Planet" twenty times is the work the stack import was supposed to save.
//
// Only the fields worth setting on a whole stack are offered, named by the
// section itself, and only the ones actually filled in are written -- a field
// left blank leaves each entry's own value alone rather than clearing twenty
// of them at once.

function endSelecting() {
  view.selecting = false;
  view.selected.clear();
}

function toggleSelected(id) {
  if (view.selected.has(id)) view.selected.delete(id);
  else view.selected.add(id);
  render();
}

/** The entries the list is showing right now, in the order it shows them. */
function shownItems(def) {
  let items = store.itemsOfType(view.section);
  if (view.filter && def.filterBy) {
    items = items.filter((i) => i.data[def.filterBy.key] === view.filter);
  }
  // In a tree, only what is unfolded is on the screen, and "select all shown"
  // must mean what it says.
  if (!def.collapsible || !def.groupBy) return items;
  return items.filter((item) => {
    const name = item.data[def.groupBy.key] || def.groupBy.blank;
    if (!branchOpen(groupKey(name))) return false;
    if (!def.subGroupBy) return true;
    const kind = item.data[def.subGroupBy.key] || def.subGroupBy.blank;
    return branchOpen(groupKey(`${name} \u203a ${kind}`));
  });
}

function selectBar(def) {
  if (!view.selecting) {
    return el('div', { class: 'select-bar' }, [
      el('button', {
        class: 'btn btn-sm',
        onclick: () => { view.selecting = true; render(); }
      }, ['Select several'])
    ]);
  }

  const n = view.selected.size;
  const shown = shownItems(def);
  const allShown = shown.length > 0 && shown.every((i) => view.selected.has(i.id));

  // Two rows rather than four buttons fighting for one: on a phone the third
  // one wraps onto a line of its own and the bar takes a quarter of the
  // screen, pushing the entries being picked off the bottom of it.
  return el('div', { class: 'select-bar-on' }, [
    el('div', { class: 'select-top' }, [
      el('span', { class: 'select-count', text: n ? `${n} selected` : 'Tap the ones to change' }),
      el('button', {
        class: 'btn btn-sm select-x', 'aria-label': 'Stop selecting',
        onclick: () => { endSelecting(); render(); }
      }, ['\u2715'])
    ]),
    el('div', { class: 'fieldrow' }, [
      el('div', {}, [el('button', {
        class: 'btn btn-sm btn-block',
        onclick: () => {
          if (allShown) for (const i of shown) view.selected.delete(i.id);
          else for (const i of shown) view.selected.add(i.id);
          render();
        }
      }, [allShown ? 'None' : 'All shown'])]),
      el('div', {}, [el('button', {
        class: 'btn btn-sm btn-block btn-primary', disabled: n === 0,
        onclick: () => openBulk(def)
      }, ['Set fields'])])
    ])
  ]);
}

function openBulk(def) {
  view.bulk = { type: view.section, data: {} };
  const count = view.selected.size;
  $('#bulkTitle').textContent = `${count} ${count === 1 ? def.singular.toLowerCase() : def.label.toLowerCase()}`;
  const body = clear($('#bulkBody'));
  body.append(el('p', { class: 'hint', style: 'margin:0 0 12px',
    text: 'Only what you fill in is changed. Anything left blank stays as it is on each entry.' }));
  for (const key of def.bulkFields) {
    const field = def.fields.find((f) => f.key === key);
    if (field) body.append(fieldFor(field, view.bulk));
  }
  $('#bulk').hidden = false;
  $('#bulkBody').scrollTop = 0;
}

async function applyBulk() {
  const def = TYPES[view.bulk.type];
  const changes = Object.entries(view.bulk.data)
    .filter(([, value]) => String(value ?? '').trim() !== '');
  if (!changes.length) { toast('Nothing filled in to set'); return; }

  let changed = 0;
  for (const id of view.selected) {
    const item = store.getItem(id);
    if (!item) continue;
    await store.saveItem({
      id: item.id, type: item.type,
      data: { ...item.data, ...Object.fromEntries(changes) }
    });
    changed++;
  }

  // They have just moved into a branch that is very likely shut, and a stack
  // that vanishes on being filed looks like a stack that was lost.
  if (def.groupBy) {
    const moved = Object.fromEntries(changes)[def.groupBy.key];
    if (moved) view.openGroups.add(groupKey(moved));
  }

  $('#bulk').hidden = true;
  view.bulk = null;
  endSelecting();
  const said = changes.map(([key]) => def.fields.find((f) => f.key === key)?.label || key);
  toast(`${said.join(' and ')} set on ${changed} ${changed === 1 ? 'entry' : 'entries'}`);
  render();
}

/**
 * True when a branch should show what is inside it.
 *
 * A pill filter has already narrowed the list to one class of notice, so
 * making the user open the branches again to see the handful left would be
 * asking twice for the same thing.
 */
function branchOpen(key) {
  return Boolean(view.filter) || view.openGroups.has(key);
}

/**
 * Branch keys carry their section.
 *
 * Two sections group by different things and can still land on the same word
 * -- a ship and a flag both called Panama, say -- and one open state shared
 * between them would open a branch the reader never touched.
 */
function groupKey(name) {
  return `${view.section}\u203a${name}`;
}

/** A header that opens and shuts, used at both levels of the tree. */
function branch(key, label, count, depth) {
  const open = branchOpen(key);
  return el('button', {
    class: `group-head group-head-btn depth-${depth}`,
    'aria-expanded': String(open),
    onclick: () => {
      if (open) view.openGroups.delete(key); else view.openGroups.add(key);
      render();
    }
  }, [
    el('span', { class: 'group-name', text: label }),
    el('span', { class: 'group-rule' }),
    el('span', { class: 'group-count', text: String(count) }),
    el('span', { class: 'group-chevron', text: open ? '\u2212' : '+' })
  ]);
}

/**
 * Flags, then the classes of notice inside them, then the notices.
 *
 * Fourteen hundred circulars in one list is not something anyone browses. A
 * flag holds three or four classes and a class holds a few hundred, so two
 * levels is what the numbering already implies: you look for an MGN, not for
 * a notice.
 *
 * Shut by default, and what is open is remembered while the app is open, so
 * coming back from reading a circular leaves the list where it was rather
 * than folded up again.
 */
function renderTree(body, def, groups, names) {
  const subKey = def.subGroupBy?.key;
  for (const name of names) {
    const inGroup = groups.get(name);
    body.append(branch(groupKey(name), name, inGroup.length, 1));
    if (!branchOpen(groupKey(name))) continue;

    if (!subKey) {
      for (const item of inGroup) body.append(cardFor(item));
      continue;
    }

    const kinds = new Map();
    for (const item of inGroup) {
      const kind = item.data[subKey] || def.subGroupBy.blank;
      if (!kinds.has(kind)) kinds.set(kind, []);
      kinds.get(kind).push(item);
    }
    for (const kind of [...kinds.keys()].sort((a, b) => {
      if (a === def.subGroupBy.blank) return 1;
      if (b === def.subGroupBy.blank) return -1;
      return a.localeCompare(b);
    })) {
      // Keyed by both, so opening MGN under MCA does not open it under a flag
      // that happens to use the same word for something else.
      const key = groupKey(`${name} \u203a ${kind}`);
      body.append(branch(key, kind, kinds.get(kind).length, 2));
      if (!branchOpen(key)) continue;
      for (const item of kinds.get(kind)) body.append(cardFor(item));
    }
  }
}

function renderSection(body) {
  const def = TYPES[view.section];
  const panels = [];
  if (view.section === 'flag') {
    panels.push(updatePanel(), documentPanel());
  }
  panels.push(importPanel(def));
  if (def.bulkRead) panels.push(readAllPanel(def));
  if (view.section === 'publication') panels.push(conventionPanel());
  if (def.sources) panels.push(sourceLinks(def.sources));

  // Folded only where it is genuinely in the way. Flag Circulars stacked four
  // panels and about twenty buttons above the list; Publications has three
  // panels and one of them is the convention list, which is worth having in
  // sight. A fold that hides something wanted is a worse change than the
  // crowding it fixes.
  if (view.section === 'flag') body.append(toolsPanel(def, panels));
  else for (const panel of panels) if (panel) body.append(panel);
  if (def.bulkFields && store.itemsOfType(view.section).length) body.append(selectBar(def));
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

    if (def.collapsible) { renderTree(body, def, groups, names); return; }

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
  const all = runSearch(query, store.allItems(), texts);

  // "Where in the Synergy manuals is this" is a different question from "where
  // is this anywhere", and on a library holding both a question and the
  // documents that answer it, the question's own wording outranks every
  // answer. Narrowing to a section is how the second question gets asked.
  renderSearchScope(all);
  const results = view.searchScope
    ? all.filter((r) => r.item.type === view.searchScope)
    : all;

  if (view.linking) {
    const banner = linkingBanner();
    if (banner) body.append(banner);
  }

  if (!texts) {
    body.append(el('div', { class: 'panel' }, [
      el('p', { style: 'margin:0', text: 'Opening document text — searching titles and fields meanwhile…' }),
      el('div', { class: 'bar' }, [el('i', { style: 'width:60%' })])
    ]));
  }

  if (!results.length) {
    const scoped = view.searchScope ? ` in ${TYPES[view.searchScope].label}` : '';
    body.append(emptyState(
      texts ? 'Nothing found' : 'Nothing found yet',
      texts ? `No entry matches “${query}”${scoped}.` : 'Still opening document text…'));
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
      // Its own class: the panel carries advice in a .hint too, and a result
      // that cannot be told apart from advice is a result you cannot check.
      class: 'hint sync-result',
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

  const all = el('button', { class: 'btn btn-block', style: 'margin-top:8px' }, ['Update all three']);
  all.addEventListener('click', () => syncAll(all, out));

  panel.append(row, all, el('p', {
    class: 'hint',
    text: 'All three is the larger download — around 70 KB — so it is worth doing alongside a good signal. One flag at a time is the smaller read.'
  }), out);
  return panel;
}

/**
 * Fetch one notice's document, keep it, and read its text.
 *
 * The text is the point. A PDF sitting on the phone unread is a file you
 * cannot find again; extracted, it joins the search and the whole document is
 * reachable at sea by any phrase inside it.
 */
async function downloadDocument(item, onProgress) {
  // The catalogue says which documents the mirror actually holds, so a notice
  // whose file was never fetched is never asked for. Guessing at the path
  // instead would mean a thousand requests to find out there is nothing there.
  const path = item.data.mirrorFile;
  if (!path) throw new Error('not held on the site');
  const url = new URL(`../${path}`, import.meta.url).href;

  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 404 ? 'not held on the site' : `HTTP ${response.status}`);

  const blob = await response.blob();
  const name = decodeURIComponent(url.split('/').pop());

  // GOV.UK publishes most M-notices as a page rather than a file — asked and
  // answered: of 180 MCA notices with no PDF, 179 carry their text and none
  // had a PDF that was missed. Those are mirrored as text, so there is nothing
  // to extract: the words are already the file.
  if (/\.txt$/i.test(path)) {
    const words = await blob.text();
    const descriptor = await store.storeFile(new File([blob], name, { type: 'text/plain' }));
    await store.storeText(descriptor.id, [{ page: 1, text: words }]);
    Object.assign(descriptor, {
      textPages: 1, pageCount: 1, readTo: 1,
      textStatus: STATUS.INDEXED, textError: ''
    });
    await store.saveItem({
      id: item.id, type: item.type,
      data: { ...item.data, attachments: [...(item.data.attachments || []), descriptor] }
    });
    return blob.size;
  }

  const descriptor = await store.storeFile(new File([blob], name, { type: 'application/pdf' }));

  const result = await extract(await blob.arrayBuffer(), { onProgress });
  if (result.pages.length) await store.storeText(descriptor.id, result.pages);
  Object.assign(descriptor, {
    textPages: result.pages.length, pageCount: result.pageCount,
    textStatus: result.status, textError: result.error
  });

  await store.saveItem({
    id: item.id, type: item.type,
    data: { ...item.data, attachments: [...(item.data.attachments || []), descriptor] }
  });
  return blob.size;
}

/** Notices of one flag whose document is held on the site but not yet here. */
function withoutDocuments(admin) {
  return store.itemsOfType('flag').filter((i) =>
    i.data.flagState === admin && i.data.mirrorFile && !(i.data.attachments || []).length);
}

/**
 * The documents themselves, for one flag or for all of them.
 *
 * Deliberately not one button that runs for an hour. Each document is fetched
 * and read in turn, the count says where it has got to, and it stops the
 * moment it is asked to — a download that cannot be interrupted is no use on
 * a connection that comes and goes.
 */
function documentPanel() {
  const out = el('div');
  const panel = el('div', { class: 'panel doc-panel' }, [
    el('h3', { text: 'Documents' }),
    el('p', { text: 'Fetches the circulars themselves, not just the list, and reads each one so its contents can be searched with no signal. This is the large download — do it alongside a good connection, and it can be stopped and picked up again at any point.' })
  ]);

  const counts = SYNCABLE.map((admin) => [admin, withoutDocuments(admin).length]);
  const outstanding = counts.reduce((n, [, c]) => n + c, 0);
  const anyHeld = store.itemsOfType('flag').some((i) => i.data.mirrorFile);

  // Notices are filed here, but not one of them knows where its document is.
  // That is what a list filed before the documents existed looks like, and the
  // panel used to answer it by vanishing — leaving no way to tell "there are
  // no documents" from "this phone has not been told about them".
  if (!anyHeld) {
    if (!store.itemsOfType('flag').some((i) => i.data.flagState)) return null;
    panel.append(el('p', { class: 'hint', text:
      'None of the notices filed here knows where its document is yet. Update the list above once and they will — that read also asks the site which documents it holds.' }));
    return panel;
  }
  if (!outstanding) {
    panel.append(el('p', { class: 'hint', text: 'Every notice whose document is held has it.' }));
    return panel;
  }

  const row = el('div', { class: 'fieldrow' });
  for (const [admin, count] of counts) {
    const button = el('button', {
      class: 'btn btn-sm btn-block', disabled: !count
    }, [count ? `${admin} (${count})` : admin]);
    button.addEventListener('click', () => fetchDocuments([admin], button, out));
    row.append(el('div', {}, [button]));
  }

  const all = el('button', { class: 'btn btn-block', style: 'margin-top:8px' },
    [`Fetch all ${outstanding} documents`]);
  all.addEventListener('click', () => fetchDocuments(SYNCABLE, all, out));

  panel.append(row, all, out);
  return panel;
}

let stopFetching = false;

async function fetchDocuments(admins, button, out) {
  stopFetching = false;
  const queue = admins.flatMap((admin) => withoutDocuments(admin));
  const label = button.textContent;
  button.disabled = true;

  const status = el('p', { class: 'hint', text: `0 of ${queue.length}` });
  const bar = el('div', { class: 'bar' }, [el('i')]);
  const stop = el('button', { class: 'btn btn-sm btn-block', style: 'margin-top:8px' }, ['Stop']);
  stop.addEventListener('click', () => { stopFetching = true; stop.textContent = 'Stopping…'; });
  clear(out).append(status, bar, stop);

  let done = 0, bytes = 0, missing = 0;
  // Which ones, not how many. "1 could not be fetched" out of 373 leaves you
  // with a number and no way to tell a bad minute on the connection from a
  // document that will never come — and those want different things done.
  const failures = [];
  for (const item of queue) {
    if (stopFetching) break;
    status.textContent = `${done + 1} of ${queue.length} — ${item.data.refNo}`;
    try {
      bytes += await downloadDocument(item);
    } catch (ex) {
      if (/not held/.test(ex.message)) missing++;
      else failures.push(`${item.data.refNo || item.data.title} (${ex.message})`);
    }
    done++;
    bar.firstChild.style.width = `${Math.round((done / queue.length) * 100)}%`;
  }

  const held = done - missing - failures.length;
  view.lastSync = {
    ok: held > 0,
    text: fetchSummary({ held, bytes, missing, failures, stopped: stopFetching })
  };
  button.disabled = false;
  button.textContent = label;
  render();
}

/**
 * All three, one after another.
 *
 * Run in turn rather than at once: three administrations answering together
 * is three times the demand on a connection that may barely support one. A
 * flag that refuses is named and the others still go through — the point of
 * doing them together is not having to notice which one failed.
 */
async function syncAll(button, out) {
  button.disabled = true;
  clear(out);

  let added = 0, updated = 0, unchanged = 0;
  const lines = [];

  for (const admin of SYNCABLE) {
    button.textContent = `${admin}…`;
    try {
      const { notices, failed } = await fetchNotices(admin);
      const summary = await mergeNotices(notices, admin);
      added += summary.added;
      updated += summary.updated;
      unchanged += summary.unchanged;
      lines.push(`${admin} ${summary.added}${failed.length ? ' (partial)' : ''}`);
    } catch {
      lines.push(`${admin} could not be read`);
    }
  }

  view.lastSync = {
    ok: lines.some((l) => !/could not be read/.test(l)),
    text: `${added} new, ${updated} updated, ${unchanged} already held — ${lines.join(' · ')}.`
  };
  button.disabled = false;
  button.textContent = 'Update all three';
  render();
}

/** Run one administration's fetch, reporting whatever actually happened. */
/**
 * Tell each notice where its document is.
 *
 * The lists and the documents come from different places. MCA's list is read
 * live from GOV.UK, which is the right source for it — but GOV.UK has no idea
 * where a copy sits on this site, so a list fetched from it leaves every
 * notice unable to say where its document is. Updating the list again could
 * never fix that: the list was never the thing that knew.
 *
 * The site publishes the answer separately, keyed by source URL — the one
 * field every list carries whichever source it came from. Small: tens of
 * kilobytes against the hundred-odd megabytes of documents it points at.
 */
async function applyFileIndex(admin) {
  const url = new URL(`../data/${admin.toLowerCase()}-files.json`, import.meta.url);
  url.searchParams.set('asked', Date.now());   // never a stale answer from the cache
  let index;
  try {
    const r = await fetch(url.href, { cache: 'reload' });
    if (!r.ok) return 0;
    index = await r.json();
  } catch { return 0; }
  if (!index?.files) return 0;

  let told = 0;
  for (const item of store.itemsOfType('flag')) {
    if (item.data.flagState !== admin) continue;
    const source = item.data.sourceUrl || '';
    if (!source.startsWith(index.urlPrefix || '')) continue;
    const name = index.files[source.slice((index.urlPrefix || '').length)];
    if (!name) continue;
    const held = `${index.filePrefix || ''}${name}`;
    if (item.data.mirrorFile === held) continue;
    await store.saveItem({
      id: item.id, type: item.type, data: { ...item.data, mirrorFile: held }
    });
    told++;
  }
  return told;
}

/**
 * Mark the notices the administration's list no longer carries.
 *
 * The sync never deletes — an entry here may hold your own notes and files,
 * and a list that prunes itself would take them with it. But a notice that has
 * been withdrawn then sits among the current ones looking exactly like them,
 * and a superseded copy read as current is the thing this app exists to
 * prevent.
 *
 * So it is marked, not removed. Only entries that came from a sync in the
 * first place — anything typed in by hand has no source URL and is left
 * entirely alone.
 */
async function markWithdrawn(admin, notices) {
  const current = new Set();
  for (const n of notices) {
    if (n.refNo) current.add(n.refNo.toUpperCase());
    if (n.sourceUrl) current.add(n.sourceUrl.toUpperCase());
  }

  let marked = 0;
  for (const item of store.itemsOfType('flag')) {
    if (item.data.flagState !== admin || !item.data.sourceUrl) continue;
    const known = current.has(String(item.data.refNo || '').toUpperCase())
      || current.has(String(item.data.sourceUrl || '').toUpperCase());

    if (known === !item.data.notInList) continue;   // already says the right thing
    const data = { ...item.data };
    if (known) delete data.notInList;
    else data.notInList = new Date().toISOString().slice(0, 10);
    await store.saveItem({ id: item.id, type: item.type, data });
    if (!known) marked++;
  }
  return marked;
}

async function syncAdmin(admin, button, out) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = '…';
  clear(out).append(el('p', { class: 'hint', text: `Contacting ${admin}…` }));

  try {
    const { notices, failed } = await fetchNotices(admin);
    const summary = await mergeNotices(notices, admin);
    // Whichever source the list came from, the documents are on this site, and
    // only this site knows where. Done here rather than left to the user,
    // because a notice that cannot say where its document is simply never
    // offers it and gives no hint why.
    const told = await applyFileIndex(admin);
    // Only when the whole list was read. A group that failed means notices are
    // missing from `notices` for that reason alone, and marking them withdrawn
    // on the strength of a failed read would be worse than saying nothing.
    const withdrawn = failed.length ? 0 : await markWithdrawn(admin, notices);
    // A partial result is still a result: file what came back, and say plainly
    // which classes of document did not.
    const missed = failed.length ? ` Could not read: ${failed.join('; ')}.` : '';
    view.lastSync = {
      ok: true,
      text: `${admin}: ${summary.added} new, ${summary.updated} updated, ${summary.unchanged} already held.`
        + (told ? ` ${told} now know where their document is.` : '')
        + (withdrawn ? ` ${withdrawn} no longer on the administration's list — kept, and marked.` : '')
        + missed
    };
    render();   // redraws the list, and the panel with the summary in it
  } catch (ex) {
    view.lastSync = {
      ok: false,
      text: `${admin} could not be read: ${ex.message}. This needs a connection, and the site has to permit the app to read it.`
    };
    clear(out).append(el('p', { class: 'hint sync-result', style: 'color:var(--danger)', text: view.lastSync.text }));
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
          ...(notice.file ? { mirrorFile: notice.file } : {}),
          // Panama publishes a list of the circulars it has cancelled, so for
          // those the flag says so itself rather than it being inferred from a
          // notice falling off a list.
          ...(notice.cancelled ? { cancelled: true } : {}),
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
    if (notice.file && next.mirrorFile !== notice.file) next.mirrorFile = notice.file;
    if (notice.cancelled && !next.cancelled) next.cancelled = true;

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
  const atts = item.data.attachments || [];

  // A circular is read by what kind it is and what number it carries — "Fleet
  // Alert 032/2026" is how one is asked for and how it is filed. That goes
  // above the subject rather than under it with the rest of the small print.
  const circular = item.type === 'circular';
  const kind = circular
    ? [item.data.category, item.data.refNo].filter(Boolean).join(' \u2014 ')
    : '';
  const sub = circular
    ? ''
    : (def.listFields || []).map((k) => item.data[k]).filter(Boolean).join(' \u00b7 ');

  const rev = def.tracksRevision ? revisionStatus(item.data) : null;
  const picking = view.selecting && view.screen === 'section' && item.type === view.section;
  const picked = picking && view.selected.has(item.id);
  const card = el('article', {
    class: 'card' + (rev && rev.state !== 'ok' ? ' due' : '') + (picked ? ' picked' : ''),
    ...(picking ? { 'aria-pressed': String(picked) } : {}),
    onclick: () => (picking ? toggleSelected(item.id) : openDetail(item.id))
  }, [
    kind ? el('p', { class: 'card-kind', text: kind }) : null,
    el('div', { class: 'card-head' }, [
      picking ? el('span', { class: 'tick' + (picked ? ' tick-on' : ''), text: picked ? '\u2713' : '' }) : null,
      el('h2', { class: 'card-title', text: title }),
      item.data.cancelled ? el('span', { class: 'pill pill-warn', text: 'Cancelled' }) : null,
      item.data.notInList && !item.data.cancelled
        ? el('span', { class: 'pill pill-warn', text: 'Withdrawn' }) : null,
      rev ? el('span', {
        class: 'pill ' + (rev.state === 'ok' ? 'pill-sage' : 'pill-warn'),
        text: rev.state === 'ok' ? 'Current' : rev.state === 'never' ? 'Unverified' : 'Check'
      }) : null,
      searchablePill(item.data)
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
  // The date and what it is about, side by side under the subject. Who issued
  // it is on the entry itself rather than here: on a list of circulars it is
  // nearly always the same name, so it takes a line and tells you nothing.
  // What the circular relates to is what tells one from another at a glance.
  if (circular && (item.data.date || item.data.relatedTo)) {
    card.append(el('div', { class: 'dgrid' }, [
      dcell('Date', item.data.date ? displayDate(item.data.date) : '—', !item.data.date),
      dcell('Related to', item.data.relatedTo || '—', !item.data.relatedTo)
    ]));
  }
  if (item.type === 'notice' && item.data.date) {
    card.append(el('div', { class: 'dgrid' }, [
      dcell('Date', displayDate(item.data.date)),
      dcell('Source', item.data.source || '—')
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
        onclick: (e) => { e.stopPropagation(); if (att) openAttachment(att, snip.page, item.id); }
      }, [
        // Said plainly, because a word read out of a diagram is a guess in a
        // way the document's own text is not.
        // The clause first, because that is what gets cited and what an
        // inspector is told. The page is how to get to it, and it changes with
        // every revision of the manual.
        el('span', { class: 'snippet-page', text: [
          snip.clause ? `${snip.clause.ref}${snip.clause.label ? ` \u2014 ${snip.clause.label}` : ''}` : null,
          snip.file,
          `page ${snip.page}`,
          snip.inPicture ? 'in a picture' : null
        ].filter(Boolean).join(' \u00b7 ') })
      ]);
      // Built from text nodes, so a document's own words cannot become markup.
      for (const part of snip.parts) {
        box.append(part.hit ? el('mark', { text: part.text }) : document.createTextNode(part.text));
      }
      holder.append(box);

      // A question cannot answer itself: the question library says the words
      // too, and more prominently than the manual that governs them.
      if (view.linking && item.id !== view.linking.id && item.type !== 'sire') {
        const question = store.getItem(view.linking.id);
        const had = question && alreadyLinked(question, snip);
        holder.append(el('button', {
          class: 'btn btn-sm btn-block link-btn', disabled: Boolean(had),
          onclick: (e) => { e.stopPropagation(); linkAnswer(item, snip); }
        }, [had ? 'Linked' : `Link to ${view.linking.ref || 'the question'}`]));
      }
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
    // A new search starts unnarrowed. Leaving the last one's section in place
    // would answer the new question from inside the old one's filter and say
    // nothing about it.
    view.searchScope = null;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 120);
  });
  $('#backBtn').addEventListener('click', () => {
    if (view.query) { view.query = ''; $('#search').value = ''; view.searchScope = null; }
    else { view.section = null; view.filter = null; endSelecting(); }
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
  $('#importPicker').addEventListener('change', onImportPicked);
  $('#viewerClose').addEventListener('click', closeViewer);
  $('#viewerNote').addEventListener('click', openNoteBox);
  $('#bulkCancel').addEventListener('click', () => { $('#bulk').hidden = true; view.bulk = null; });
  $('#bulkApply').addEventListener('click', applyBulk);
  for (const id of ['#detail', '#editor', '#settings', '#bulk']) {
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
    if (['attachments', 'fileLink', 'answers'].includes(f.key) || f.key === def.titleKey) continue;
    const raw = item.data[f.key];
    if (raw === undefined || raw === null || raw === '') continue;
    section.append(el('div', { class: 'stat' }, [
      el('span', { text: f.label }),
      el('span', { text: f.type === 'date' ? displayDate(raw) : String(raw) })
    ]));
    shown++;
  }
  if (shown) body.append(section);

  if (item.data.cancelled) {
    body.append(el('div', { class: 'detail-sec' }, [
      el('h4', { text: 'Cancelled by the administration' }),
      el('p', { class: 'hint', text:
        `${item.data.flagState || 'The administration'} lists this one as cancelled. It is kept here so it can be read and searched, but it is not in force — check the current circular before relying on it.` })
    ]));
  }

  if (item.data.notInList && !item.data.cancelled) {
    body.append(el('div', { class: 'detail-sec' }, [
      el('h4', { text: 'No longer on the administration\u2019s list' }),
      el('p', { class: 'hint', text:
        `This was on ${item.data.flagState || 'the administration'}\u2019s list when it was last read, and is not on it now — withdrawn, replaced, or moved. Noticed on ${displayDate(item.data.notInList)}. It is kept here with anything you added to it; check against the source before relying on it.` })
    ]));
  }

  if (def.fields.some((f) => f.type === 'answers')) body.append(answersSection(item));

  const atts = item.data.attachments || [];
  if (atts.length) {
    const sec3 = el('div', { class: 'detail-sec' }, [el('h4', { text: 'Files on this device' })]);
    for (const att of atts) {
      sec3.append(attachmentRow(att));
      const notes = pageNotesFor(item, att);
      if (notes) sec3.append(notes);
      if (isPdf(att) || /\.pdf$/i.test(att.name || '')) sec3.append(indexFor(item, att));
    }
    body.append(sec3);
  }

  // A synced notice with no file is not a failure, but it looks like one: the
  // entry simply ends at a link, and "where is the circular?" is the right
  // question to ask of it. Say which of the three reasons it is.
  if (item.type === 'flag' && !atts.length && !item.data.mirrorFile && item.data.flagState) {
    const min = /^MIN\b/i.test(item.data.docType || '') || /^MIN\b/i.test(item.data.refNo || '');
    body.append(el('div', { class: 'detail-sec' }, [
      el('h4', { text: 'No document held' }),
      // Two of these the app knows for certain — a MIN by its type, a Singapore
      // circular by its flag. The third it does not: an entry carries no file
      // path either because the site holds nothing for it or because this
      // phone's list was filed before the site held it, and from here those
      // look identical. Saying the administration publishes no document would
      // be asserting the one it cannot check, and would be wrong far more
      // often than right — every notice synced before the documents existed
      // looks exactly like this.
      // Singapore had its own line here, saying MPA published its circulars as
      // pages rather than files. It does not, and never did — the page is a
      // landing page with the PDF on it. All 552 that have one are held.
      el('p', { class: 'hint', text: min
        ? 'MINs are listed and numbered here but never downloaded, as you asked. The link below opens it at the administration, which needs a connection.'
        : 'Nothing is held on the site for this one — the administration publishes no document for it. The link below opens it at the administration, which needs a connection.' })
    ]));
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

/** A picture in its own right: a photograph, a screenshot, a scanned diagram. */
function isImage(att) {
  return /^image\//i.test(att.type || '')
    || /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i.test(att.name || '');
}

function textStatusOf(att) {
  // Older records predate textStatus and only carry a page count.
  if (att.textStatus) return att.textStatus;
  if (att.textPages > 0) return STATUS.INDEXED;
  if (att.scanned) return STATUS.NO_TEXT;
  return null;
}

/**
 * Whether the words inside an entry's files can be found by searching.
 *
 * "It has a file" and "you can find it again" are different things, and the
 * card only ever said the first. A scan is a picture of its pages until it has
 * been read, and nothing on the list said so -- you had to open each entry to
 * find out. This is what the pill on the card answers.
 *
 * Pictures are deliberately not part of the verdict. Reading them costs a few
 * seconds a page for every page, and most documents do not need it, so a card
 * marked "pictures unread" would be nagging for an evening's work the reader
 * has no reason to do. That one stays where it can be judged: on the document.
 */
function searchableState(data) {
  const atts = data.attachments || [];
  if (!atts.length) return null;
  let worst = 'yes';
  const worse = (a, b) => (['yes', 'part', 'no'].indexOf(a) > ['yes', 'part', 'no'].indexOf(b) ? a : b);
  for (const att of atts) {
    // Already nothing but words.
    if (/^text\//i.test(att.type || '') || /\.txt$/i.test(att.name || '')) continue;
    const state = textStatusOf(att);
    if (state !== STATUS.INDEXED) { worst = 'no'; continue; }
    // readTo is set by the reader alone, so it is what tells a scan stopped
    // half way from a PDF whose text was simply extracted.
    const partRead = (att.readTo || 0) > 0 && att.readTo < (att.pageCount || 1);
    if (partRead) worst = worse(worst, 'part');
  }
  return worst;
}

/** The pill that says it, or null where there is no file to say it about. */
function searchablePill(data) {
  const state = searchableState(data);
  if (!state) return null;
  const count = (data.attachments || []).length;
  const said = state === 'yes' ? 'searchable' : state === 'part' ? 'part read' : 'not searchable';
  return el('span', {
    class: 'pill ' + (state === 'yes' ? 'pill-sage' : 'pill-warn'),
    text: count > 1 ? `${count} files \u00b7 ${said}` : said
  });
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
  // Two separate things get read, and a reader who has done one needs to see
  // that it took. The words of the document are the pill above; the words
  // inside its pictures are their own, because nothing else on the screen said
  // whether that had been done -- the button simply stopped being offered.
  const picsTo = att.picturesTo || 0;
  const picsAll = picsTo > 0 && picsTo >= (att.pageCount || 1);
  const pictures = picsAll
    ? el('span', { class: 'pill pill-sage', text: 'Pictures read' })
    : picsTo > 0
      ? el('span', { class: 'pill pill-warn', text: `Pictures read to page ${picsTo}` })
      : null;
  if (status || pictures) {
    row.append(el('div', { class: 'pill-row', style: 'margin-top:8px' },
      [status, pictures].filter(Boolean)));
  }
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
    // Already nothing but words: no picture to read, no text layer to retry.
    if (/^text\//i.test(att.type || '') || /\.txt$/i.test(att.name || '')) return row;

    if (isImage(att)) {
      if (state !== STATUS.INDEXED) {
        row.append(el('button', {
          class: 'btn btn-sm btn-block', style: 'margin-top:8px',
          onclick: (e) => readPicture(att, e.target)
        }, ['Read the words in this picture']));
        row.append(el('p', { class: 'hint', style: 'margin-top:6px',
          text: 'Reads any words printed in the photograph — a nameplate, a label, a diagram — so they can be searched. The reader is about 7 MB the first time and then works offline.' }));
      }
      return row;
    }

    if (state !== STATUS.INDEXED) {
      row.append(el('button', {
        class: 'btn btn-sm btn-block', style: 'margin-top:8px',
        onclick: (e) => reReadText(att, e.target)
      }, ['Try reading the text again']));
      // A scan has no text to find however often it is asked. Reading the
      // letters out of the picture is a different thing, and costs a download.
      row.append(el('button', {
        class: 'btn btn-sm btn-block', style: 'margin-top:8px',
        onclick: (e) => readScan(att, e.target)
      }, ['Read the scan — first 3 pages']));
      row.append(el('p', { class: 'hint', style: 'margin-top:6px',
        text: 'Reads the opening pages as pictures to fill in the title and number — three, because a manual often opens on a cover sheet. The reader is about 7 MB the first time and then works offline.' }));
    }

    // Only where reading a picture is actually the way to get the text.
    //
    // readTo is set by the reader and by nothing else, so it is what separates
    // a part-read scan from a PDF whose text was simply extracted. Testing the
    // page count alone counted every ordinary PDF as unread — a document with
    // its seven pages already indexed was still offered a read it did not
    // need, which on a ship means a 6 MB download for nothing and worse text
    // than it already had.
    const partRead = (att.readTo || 0) > 0 && att.readTo < (att.pageCount || 1);
    if (state !== STATUS.INDEXED || partRead) {
      const done = att.readTo || 0;
      const total = att.pageCount || 0;
      row.append(el('button', {
        class: 'btn btn-sm btn-block', style: 'margin-top:8px',
        onclick: (e) => readWholeScan(att, e.target)
      }, [done ? `Read the rest — from page ${done + 1}` : 'Read the whole document']));
      row.append(el('p', { class: 'hint', style: 'margin-top:6px',
        text: total
          ? `Reads every page so all of it can be searched. ${total} pages at a few seconds each — it can be stopped at any point and picked up where it left off.`
          : 'Reads every page so all of it can be searched. A few seconds a page — it can be stopped at any point and picked up where it left off.' }));
    }

    // A PDF can have every word of its text and still hide words in its
    // pictures: the labels on a diagram, a scanned form pasted into a page, the
    // writing in a photograph. Those are drawn, not typed, so extraction never
    // saw them and no amount of re-reading the text will find them.
    //
    // Offered rather than done: it costs the reader download and a few seconds
    // a page, and most documents do not need it.
    const picturesDone = (att.picturesTo || 0) > 0
      && att.picturesTo >= (att.pageCount || 1);
    // Not for a scan: its pages are pictures already, and the read above has
    // been through them. Offering it here would read the same pixels twice.
    const cameFromPixels = (att.readTo || 0) > 0;
    if (state === STATUS.INDEXED && !picturesDone && !cameFromPixels) {
      const done = att.picturesTo || 0;
      row.append(el('button', {
        class: 'btn btn-sm btn-block', style: 'margin-top:8px',
        onclick: (e) => readWholeScan(att, e.target, { into: 'pictures' })
      }, [done ? `Read the rest of the pictures — from page ${done + 1}` : 'Read the pictures and diagrams too']));
      row.append(el('p', { class: 'hint', style: 'margin-top:6px',
        text: 'The text of this document is already searchable. This reads the words inside its pictures as well — labels on a diagram, writing in a photograph — which are not in the text. It can be stopped at any point.' }));
    }
  }
  return row;
}

/**
 * Read a scan's first page, and fill the entry in from what it says.
 *
 * The first page is where a document states what it is, and it is seconds
 * rather than the hour a whole manual would take. What is read is stored as
 * the file's text, so it joins the search exactly as a text PDF's would —
 * only the first page of it.
 */
async function readScan(att, button) {
  const label = button.textContent;
  button.disabled = true;

  const note = el('p', { class: 'hint', style: 'margin-top:6px', text: 'Starting…' });
  button.after(note);

  try {
    const { readOpeningPages, describeFromText } = await import('./ocr.js');
    const blob = await store.readFile(att);
    const result = await readOpeningPages(await blob.arrayBuffer(), {
      onProgress: (said) => { note.textContent = said; }
    });

    if (!result.ok) {
      toast('The reader could not make out this page');
      return;
    }
    await store.storeText(att.id, result.pages);

    const item = store.getItem(view.detailId);
    if (!item) { toast(`Read ${result.text.length} characters`); return; }

    const def = TYPES[item.type];
    const described = describeFromText(result.text, result.pageCount);
    const suggested = suggestFields(item.type, described, att.name, def.fields.map((f) => f.key));

    const data = { ...item.data };
    const filled = [];
    for (const [key, value] of Object.entries(suggested)) {
      if (String(data[key] || '').trim()) continue;      // never overwrite
      data[key] = value;
      filled.push(def.fields.find((f) => f.key === key)?.label || key);
    }
    data.attachments = (data.attachments || []).map((a) => a.id === att.id
      ? { ...a, textPages: result.pages.length, pageCount: result.pageCount,
          // How far the reader has got, so carrying on later knows where to
          // start rather than reading the opening pages again.
          readTo: result.lastPage,
          textStatus: result.status, textError: '', scanned: false }
      : a);

    await store.saveItem({ id: item.id, type: item.type, data });
    openDetail(item.id);
    toast(filled.length
      ? `Read the page — filled in ${filled.join(', ')}. Check these.`
      : 'Read the page — nothing new to fill in, but its words are searchable now');
  } catch (ex) {
    toast(`Could not read it: ${ex.message}`);
  } finally {
    note.remove();
    button.disabled = false;
    button.textContent = label;
  }
}

/**
 * Read the words in a photograph.
 *
 * One image, so there is nothing to resume and nothing to stop — it is over in
 * a few seconds. What it finds is stored as that file's text, which puts a
 * photograph of a nameplate or a diagram into the search alongside the
 * documents.
 */
async function readPicture(att, button) {
  const label = button.textContent;
  button.disabled = true;
  const note = el('p', { class: 'hint', style: 'margin-top:6px', text: 'Starting\u2026' });
  button.after(note);

  try {
    const { readImage } = await import('./ocr.js');
    const blob = await store.readFile(att);
    const result = await readImage(blob, { onProgress: (said) => { note.textContent = said; } });

    if (!result.ok) {
      toast('No words could be made out in this picture');
      return;
    }
    await store.storeText(att.id, [{ page: 1, text: result.text }]);

    const item = store.getItem(view.detailId);
    if (!item) { toast('Read the picture'); return; }
    const next = (item.data.attachments || []).map((a) => a.id === att.id
      ? { ...a, textPages: 1, pageCount: 1, readTo: 1, textStatus: STATUS.INDEXED, textError: '' }
      : a);
    await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, attachments: next } });
    openDetail(item.id);
    toast('Read the picture — its words are searchable now');
  } catch (ex) {
    toast(`Could not read it: ${ex.message}`);
  } finally {
    note.remove();
    button.disabled = false;
    button.textContent = label;
  }
}

/**
 * Read every page of a scan, and keep each one as it is read.
 *
 * A manual is an evening's work at a few seconds a page, so the one thing this
 * must not do is lose it. Each page is stored the moment it is read and how
 * far it got is recorded, which means Stop keeps everything up to that point
 * and the button afterwards says where it will resume from. Closing the app
 * mid-read costs the page in progress and nothing more.
 */
async function readPages(itemId, att, { into = 'text', onProgress, onPage, shouldStop } = {}) {
  // 'text' is a scan with no words in it at all. 'pictures' is a PDF that has
  // its text but whose diagrams and photographs carry words of their own —
  // drawn rather than typed, so extraction never saw them. Same walk over the
  // pages, kept in a different place, so one never overwrites the other.
  const mark = into === 'pictures' ? 'picturesTo' : 'readTo';

  // Whatever has already been read stays; this adds to it rather than
  // replacing it, so a resumed read does not lose the pages before it.
  const texts = await store.loadTexts();
  // Keyed by page number rather than appended, so a page read twice replaces
  // itself instead of being filed twice. A duplicated page is an index that
  // matches the same words in two places and reports the wrong count.
  const held = new Map((texts.get(att.id) || []).map((p) => [p.page, p]));
  const from = (att[mark] || 0) + 1;
  let lastKept = att[mark] || 0;

  const keep = async (upTo) => {
    const pages = [...held.values()].sort((a, b) => a.page - b.page);
    await store.storeText(att.id, pages);
    lastKept = upTo;
    // Looked up afresh each time rather than captured: a run over a whole
    // section outlives any one open document, and the entry may have been
    // edited or deleted while the reader was working through it.
    const item = store.getItem(itemId);
    if (!item) return;
    const next = (item.data.attachments || []).map((a) => a.id === att.id
      ? { ...a, textPages: held.size, [mark]: upTo, textStatus: STATUS.INDEXED, scanned: false }
      : a);
    await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, attachments: next } });
  };

  const { readAllPages } = await import('./ocr.js');
  const blob = await store.readFile(att);
  const walked = await readAllPages(await blob.arrayBuffer(), {
    from,
    shouldStop: shouldStop || (() => false),
    onProgress,
    onPage: async ({ page, text }) => {
      // Whichever half this run is filling, the other half of the page is
      // kept exactly as it was.
      const had = held.get(page) || { page, text: '' };
      held.set(page, into === 'pictures' ? { ...had, pictures: text } : { ...had, text });
      // Kept as it goes, not at the end: the end may never come.
      await keep(page);
      onPage?.(page);
    }
  });

  // A run that ends without being stopped has seen every page, including the
  // blank ones that were passed over.
  if (!walked.stopped) await keep(walked.pageCount);
  else if (walked.lastPage > lastKept) await keep(walked.lastPage);
  return { walked, lastKept };
}

/** The button on an open document: the same walk, with its own progress. */
async function readWholeScan(att, button, { into = 'text' } = {}) {
  const label = button.textContent;
  button.disabled = true;

  const note = el('p', { class: 'hint', style: 'margin-top:6px', text: 'Starting…' });
  const bar = el('div', { class: 'bar', style: 'margin-top:6px' }, [el('i')]);
  let stopped = false;
  const stop = el('button', { class: 'btn btn-sm btn-block', style: 'margin-top:8px' }, ['Stop']);
  stop.addEventListener('click', () => { stopped = true; stop.textContent = 'Stopping…'; });
  button.after(note, bar, stop);

  const itemId = view.detailId;
  let lastKept = att[into === 'pictures' ? 'picturesTo' : 'readTo'] || 0;

  try {
    const done = await readPages(itemId, att, {
      into,
      shouldStop: () => stopped,
      onProgress: (said) => { note.textContent = said; },
      onPage: (page) => {
        if (att.pageCount) bar.firstChild.style.width = `${Math.round((page / att.pageCount) * 100)}%`;
      }
    });
    const walked = done.walked;
    lastKept = done.lastKept;

    openDetail(itemId);
    const what = into === 'pictures' ? 'the pictures on ' : '';
    toast(walked.stopped
      ? `Stopped at page ${lastKept} of ${walked.pageCount} — what was read is kept`
      : `Read ${what}all ${walked.pageCount} pages${walked.blank
          ? ` — ${walked.blank} had ${into === 'pictures' ? 'no words in their pictures' : 'nothing on them'}` : ''}`);
  } catch (ex) {
    toast(`Could not read it: ${ex.message}`);
  } finally {
    note.remove(); bar.remove(); stop.remove();
    button.disabled = false;
    button.textContent = label;
  }
}

// ── reading a whole section ─────────────────────────────────────────────────
//
// Reading one document at a time means opening each entry, finding the button
// and waiting at it. A ship's manuals are dozens of documents and thousands of
// pages; nobody sits through that one at a time. This queues every document in
// a section that still has words the search cannot reach and works through
// them, keeping each page as it is read exactly as the single-document read
// does, so Stop keeps everything up to that point and starting again picks up
// where it left off.
//
// Still asked for rather than done: the reader is about 7 MB the first time
// and a few seconds a page after that, which on a ship is a decision about
// battery and time, not something to spring on anyone.

/**
 * Everything in a section a reader could still do something with.
 *
 * 'text' is what cannot be searched at all -- scans, and scans stopped part
 * way. 'pictures' is the extra: documents whose own words are already indexed
 * but whose diagrams and photographs carry words of their own.
 */
function outstandingReads(type, into) {
  const jobs = [];
  for (const item of store.itemsOfType(type)) {
    const title = item.data[TYPES[type].titleKey] || 'Untitled';
    for (const att of item.data.attachments || []) {
      // Already nothing but words.
      if (/^text\//i.test(att.type || '') || /\.txt$/i.test(att.name || '')) continue;
      const state = textStatusOf(att);
      const pageCount = att.pageCount || 0;

      if (into === 'pictures') {
        // A document whose own text is still missing is the first job, not
        // this one -- reading its pictures would leave the text unread.
        if (state !== STATUS.INDEXED || isImage(att)) continue;
        // A scan has no pictures to read separately: its pages ARE pictures,
        // and the text pass has already read them. readTo is set by the reader
        // and by nothing else, so it is what says the words came out of the
        // pixels rather than out of a text layer. Without this a read scan is
        // queued to have the same pixels read a second time, into a second
        // place, for nothing -- 61 pages of it in the count above.
        if ((att.readTo || 0) > 0) continue;
        const done = att.picturesTo || 0;
        if (done > 0 && done >= (pageCount || 1)) continue;
        jobs.push({ itemId: item.id, att, title, into, pages: Math.max((pageCount || 1) - done, 1) });
        continue;
      }

      if (isImage(att)) {
        if (state !== STATUS.INDEXED) jobs.push({ itemId: item.id, att, title, into, image: true, pages: 1 });
        continue;
      }
      const partRead = (att.readTo || 0) > 0 && att.readTo < (pageCount || 1);
      if (state === STATUS.INDEXED && !partRead) continue;
      jobs.push({
        itemId: item.id, att, title, into,
        pages: Math.max((pageCount || 1) - (att.readTo || 0), 1)
      });
    }
  }
  return jobs;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Work through the queue, one document after another. */
async function readSection(type, into) {
  // One at a time. The panel is replaced by the progress while a run is going,
  // but only in the section being read -- walk to another one and its own
  // button is still there, and two runs sharing this one piece of state would
  // each overwrite what the other was showing and stop each other.
  if (view.reading) { toast('A read is already running'); return; }

  const jobs = outstandingReads(type, into);
  if (!jobs.length) return;

  view.reading = {
    type, into, stopped: false,
    index: 0, total: jobs.length,
    title: jobs[0].title, said: 'Starting\u2026',
    page: 0, pages: jobs[0].pages
  };
  render();

  let read = 0;
  let stoppedAt = null;
  try {
    for (const [i, job] of jobs.entries()) {
      if (view.reading.stopped) break;
      Object.assign(view.reading, {
        index: i, title: job.title, pages: job.pages, page: 0, said: 'Starting\u2026'
      });
      render();

      // A photograph is one picture, not a document of pages, and it has its
      // own reader.
      if (job.image) {
        const { readImage } = await import('./ocr.js');
        const blob = await store.readFile(job.att);
        const result = await readImage(blob, {
          onProgress: (said) => { if (view.reading) { view.reading.said = said; render(); } }
        });
        if (result.ok) {
          await store.storeText(job.att.id, [{ page: 1, text: result.text }]);
          const item = store.getItem(job.itemId);
          if (item) {
            const next = (item.data.attachments || []).map((a) => a.id === job.att.id
              ? { ...a, textPages: 1, pageCount: 1, readTo: 1, textStatus: STATUS.INDEXED, textError: '' }
              : a);
            await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, attachments: next } });
          }
        }
        read++;
        continue;
      }

      const done = await readPages(job.itemId, job.att, {
        into,
        shouldStop: () => !view.reading || view.reading.stopped,
        // Redrawn as it is said, not only when a page is stored: a page takes
        // seconds, and a line that has not moved for seconds reads as stuck.
        onProgress: (said) => { if (view.reading) { view.reading.said = said; render(); } },
        onPage: (page) => { if (view.reading) view.reading.page = page; }
      });
      if (done.walked.stopped) { stoppedAt = job.title; break; }
      read++;
    }
  } catch (ex) {
    view.reading = null;
    render();
    toast(`Stopped: ${ex.message}`);
    return;
  }

  view.reading = null;
  render();
  const what = into === 'pictures' ? 'the pictures in ' : '';
  toast(stoppedAt
    ? `Stopped in ${stoppedAt} \u2014 ${plural(read, 'document', 'documents')} finished, and what was read of that one is kept`
    : `Read ${what}${plural(read, 'document', 'documents')}`);
}

/**
 * The line above the list: what is still unread here, and one button for it.
 */
function readAllPanel(def) {
  const held = store.itemsOfType(view.section)
    .reduce((n, i) => n + (i.data.attachments || []).length, 0);
  if (!held) return null;

  if (view.reading && view.reading.type === view.section) {
    const run = view.reading;
    const pct = run.pages ? Math.min(Math.round((run.page / run.pages) * 100), 100) : 0;
    return el('div', { class: 'panel read-panel' }, [
      el('h3', { text: run.into === 'pictures' ? 'Reading the pictures' : 'Reading' }),
      el('p', { class: 'stat-line', text: `${run.title} \u2014 ${run.said}` }),
      el('div', { class: 'bar' }, [el('i', { style: `width:${pct}%` })]),
      el('p', { class: 'hint', text: `Document ${run.index + 1} of ${run.total}. Each page is kept as it is read, so stopping loses nothing.` }),
      el('button', {
        class: 'btn btn-block', disabled: run.stopped,
        onclick: () => { view.reading.stopped = true; render(); }
      }, [run.stopped ? 'Stopping…' : 'Stop'])
    ]);
  }

  // A run in another section is still a run: offering a button here that can
  // only answer "already running" is worse than saying so.
  if (view.reading) {
    return el('div', { class: 'panel read-panel' }, [
      el('h3', { text: 'Reading' }),
      el('p', { class: 'stat-line',
        text: `${TYPES[view.reading.type].label} are being read. This section waits its turn.` })
    ]);
  }

  const words = outstandingReads(view.section, 'text');
  const pics = outstandingReads(view.section, 'pictures');
  if (!words.length && !pics.length) {
    // Headed "All read" rather than "Reading": on the screen those two words
    // are a sentence apart and mean the opposite thing, and this panel sits
    // exactly where the running one does.
    return el('div', { class: 'panel read-panel' }, [
      el('h3', { text: 'All read' }),
      el('p', { class: 'stat-line', style: 'color:var(--sage)',
        text: `Everything here is read \u2014 ${plural(held, 'document', 'documents')}, pictures and all.` })
    ]);
  }

  const pages = (jobs) => jobs.reduce((n, j) => n + j.pages, 0);
  const panel = el('div', { class: 'panel read-panel' }, [el('h3', { text: 'Read them all' })]);

  if (words.length) {
    panel.append(
      el('p', { class: 'stat-line',
        text: `${plural(words.length, 'document holds', 'documents hold')} words no search can reach \u2014 about ${plural(pages(words), 'page', 'pages')}.` }),
      el('button', {
        class: 'btn btn-block btn-primary',
        onclick: () => readSection(view.section, 'text')
      }, [`Read ${plural(words.length, 'document', 'documents')}`])
    );
  }

  if (pics.length) {
    panel.append(
      el('p', { class: 'stat-line', style: words.length ? 'margin-top:14px' : '',
        text: `${plural(pics.length, 'document has', 'documents have')} pictures and diagrams that have never been read \u2014 about ${plural(pages(pics), 'page', 'pages')}.` }),
      el('button', {
        class: 'btn btn-block',
        onclick: () => readSection(view.section, 'pictures')
      }, ['Read the pictures too'])
    );
  }

  panel.append(el('p', { class: 'hint',
    text: 'A few seconds a page, and the reader is about 7 MB the first time. It can be stopped at any point and picked up where it left off.' }));
  return panel;
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
async function openAttachment(att, startPage = 1, itemId = view.detailId) {
  const sheet = $('#viewer');
  const body = clear($('#viewerBody'));
  $('#viewerTitle').textContent = att.name || 'Document';
  // Which entry this file belongs to, so a note written while reading it knows
  // where to be kept. Opened from a search result there is no open entry to
  // read it off, so the caller says.
  view.viewing = { itemId, attId: att.id };
  $('#viewerNote').hidden = !itemId;
  closeNoteBox();
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
  closeNoteBox();
  view.viewing = null;
}

// ── notes written on a page ─────────────────────────────────────────────────
//
// A manual is read once and understood once, and what was understood belongs
// beside the page rather than in the reader's memory. A note is kept against
// the page it was written on, so it comes back with that page -- and it is
// searched like anything else, which is the whole of its value: the words a
// person typed are the ones most worth finding again.

/**
 * The page being looked at.
 *
 * The viewer is a scroller of page canvases, so there is no current page to
 * ask for -- it is whichever one the middle of the screen is on. Read off the
 * DOM rather than by changing the viewer, which has no reason to know.
 */
function pageInView() {
  const body = $('#viewerBody');
  const middle = body.getBoundingClientRect().top + body.clientHeight / 2;
  let best = 1;
  let nearest = Infinity;
  for (const canvas of body.querySelectorAll('canvas[data-page]')) {
    const box = canvas.getBoundingClientRect();
    if (box.bottom < middle || box.top > middle) {
      const gap = box.bottom < middle ? middle - box.bottom : box.top - middle;
      if (gap < nearest) { nearest = gap; best = Number(canvas.dataset.page); }
      continue;
    }
    return Number(canvas.dataset.page);
  }
  return best;
}

function closeNoteBox() {
  const box = $('#noteBox');
  if (box) box.remove();
}

function openNoteBox() {
  if ($('#noteBox')) { closeNoteBox(); return; }
  const item = store.getItem(view.viewing?.itemId);
  if (!item) return;
  const page = pageInView();
  const held = (item.data.pageNotes || []).filter((n) => n.attId === view.viewing.attId && n.page === page);

  const field = el('textarea', {
    class: 'field', id: 'noteText', rows: '3',
    placeholder: `A note on page ${page}…`
  });
  const box = el('div', { class: 'note-box', id: 'noteBox' }, [
    el('p', { class: 'note-page', text: `Page ${page}` }),
    ...held.map((n) => el('p', { class: 'hint note-held', text: n.text })),
    field,
    el('div', { class: 'fieldrow', style: 'margin-top:8px' }, [
      el('div', {}, [el('button', { class: 'btn btn-sm btn-block', onclick: closeNoteBox }, ['Cancel'])]),
      el('div', {}, [el('button', {
        class: 'btn btn-sm btn-block btn-primary',
        onclick: async () => {
          const text = field.value.trim();
          if (!text) { closeNoteBox(); return; }
          await savePageNote(item, view.viewing.attId, page, text);
          closeNoteBox();
          toast(`Noted on page ${page}`);
        }
      }, ['Save'])])
    ])
  ]);
  $('#viewer').querySelector('.viewer-panel').insertBefore(box, $('#viewer').querySelector('.sheet-actions'));
  field.focus();
}

async function savePageNote(item, attId, page, text) {
  const pageNotes = [...(item.data.pageNotes || []),
    { id: store.newId(), attId, page, text, at: new Date().toISOString().slice(0, 10) }];
  await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, pageNotes } });
}

// ── a document's own contents, and the machinery it names ───────────────────
//
// Read from the layout rather than from the flattened text: a heading is
// mostly just bigger than the body, and a table is only a table while its
// column boundaries survive. Both are thrown away by the read that feeds the
// search, so this is a second pass over the file, made when it is asked for.
//
// Kept as flat lists on the entry so that a maker's name is searchable like
// anything else -- "Hatlapa" should find the manual that names it.

async function buildIndex(item, att, button) {
  const label = button.textContent;
  button.disabled = true;
  const note = el('p', { class: 'hint', style: 'margin-top:6px', text: 'Reading\u2026' });
  button.after(note);

  try {
    const blob = await store.readFile(att);
    const read = await readLayout(await blob.arrayBuffer(), {
      onProgress: (said) => { note.textContent = said; }
    });
    if (!read.ok) { toast(`Could not read it: ${read.error}`); return; }

    const contents = outlineFrom(read.pages).map((e) => ({ attId: att.id, ...e }));
    const equipment = equipmentFrom(read.pages).map((e) => ({ attId: att.id, ...e }));

    const fresh = store.getItem(item.id);
    if (!fresh) return;
    const data = { ...fresh.data };
    // Only this file's, so building the index of one document does not throw
    // away what was read from another in the same entry.
    data.contents = [...(fresh.data.contents || []).filter((c) => c.attId !== att.id), ...contents];
    data.equipment = [...(fresh.data.equipment || []).filter((e) => e.attId !== att.id), ...equipment];
    await store.saveItem({ id: item.id, type: item.type, data });
    openDetail(item.id);

    toast(contents.length || equipment.length
      ? `${contents.length} in the contents, ${equipment.length} with a maker named`
      : 'Nothing found: this document numbers no sections and names no makers');
  } catch (ex) {
    toast(`Could not read it: ${ex.message}`);
  } finally {
    note.remove();
    button.disabled = false;
    button.textContent = label;
  }
}

/** A list that opens the document where the entry is, folded if it is long. */
function pageList(rows, draw, onOpen) {
  const FIRST = 8;
  const holder = el('div', {});
  let shown = 0;
  const fill = (upTo) => {
    for (; shown < Math.min(upTo, rows.length); shown++) {
      const row = rows[shown];
      holder.append(el('button', {
        class: `answer-open index-row depth-${row.level ?? 0}`,
        onclick: () => onOpen(row)
      }, draw(row)));
    }
  };
  fill(FIRST);
  const wrap = el('div', { class: 'index-list' }, [holder]);
  if (rows.length > FIRST) {
    const more = el('button', {
      class: 'btn btn-sm btn-block', style: 'margin-top:8px',
      onclick: () => { fill(rows.length); more.remove(); }
    }, [`Show all ${rows.length}`]);
    wrap.append(more);
  }
  return wrap;
}

/** What was read out of a file: its contents, and the makers it names. */
function indexFor(item, att) {
  const contents = (item.data.contents || []).filter((c) => c.attId === att.id);
  const equipment = (item.data.equipment || []).filter((e) => e.attId === att.id);
  const built = contents.length || equipment.length;

  const wrap = el('div', { class: 'index-block' });

  if (contents.length) {
    wrap.append(el('p', { class: 'dkey', text: `Contents \u00b7 ${contents.length}` }));
    wrap.append(pageList(contents,
      (row) => [
        el('span', { class: 'answer-ref', text: [row.ref, row.title].filter(Boolean).join(' ') }),
        el('span', { class: 'answer-where', text: `page ${row.page}` })
      ],
      (row) => openAttachment(att, row.page, item.id)));
  }

  if (equipment.length) {
    wrap.append(el('p', { class: 'dkey', style: 'margin-top:12px', text: `Equipment \u00b7 ${equipment.length}` }));
    wrap.append(pageList(equipment,
      (row) => [
        el('span', { class: 'answer-ref', text: row.name || row.maker }),
        el('span', { class: 'answer-where', text: [
          row.name ? row.maker : null, row.model, `page ${row.page}`
        ].filter(Boolean).join(' \u00b7 ') })
      ],
      (row) => openAttachment(att, row.page, item.id)));
  }

  wrap.append(el('button', {
    class: 'btn btn-sm btn-block', style: 'margin-top:10px',
    onclick: (e) => buildIndex(item, att, e.target)
  }, [built ? 'Read the index again' : 'Read the index and the makers']));

  if (!built) {
    wrap.append(el('p', { class: 'hint', style: 'margin-top:6px', text:
      'Lists the numbered sections with their pages, and anything the document says the maker of. '
      + 'What is written in a sentence rather than labelled or tabled is not found \u2014 a maker picked '
      + 'out of prose is a guess about which thing it belongs to.' }));
  }
  return wrap;
}

/** The notes written on a file, under it, each a way back to its page. */
function pageNotesFor(item, att) {
  const notes = (item.data.pageNotes || [])
    .filter((n) => n.attId === att.id)
    .sort((a, b) => a.page - b.page);
  if (!notes.length) return null;

  const wrap = el('div', { class: 'page-notes' }, [
    el('p', { class: 'dkey', text: `${notes.length} note${notes.length === 1 ? '' : 's'}` })
  ]);
  for (const note of notes) {
    wrap.append(el('div', { class: 'answer-row' }, [
      el('button', {
        class: 'answer-open',
        onclick: () => openAttachment(att, note.page, item.id)
      }, [
        el('span', { class: 'answer-ref', text: `Page ${note.page}` }),
        el('span', { class: 'answer-where', text: note.text })
      ]),
      el('button', {
        class: 'del-btn', 'aria-label': 'Remove this note',
        onclick: async () => {
          const next = (item.data.pageNotes || []).filter((n) => n.id !== note.id);
          await store.saveItem({ id: item.id, type: item.type, data: { ...item.data, pageNotes: next } });
          openDetail(item.id);
        }
      }, ['\u00d7'])
    ]));
  }
  return wrap;
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
      const control = fieldFor(f, draft);
      if (control) body.append(control);
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
  // Built by searching and linking, on the entry rather than in the form: a
  // clause reference retyped into a box is the thing this exists to avoid.
  if (f.type === 'answers') return null;
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
    // Names and subjects read as titles; references do not. "MSN 1905 (M+F)"
    // must stay exactly as it is, so a field carrying a code says so and is
    // left alone. Applied when the field is left rather than while typing,
    // which would fight the keyboard mid-word.
    const cased = f.type === 'text' && !f.keepCase;

    // A ship's name is typed on every manual, every publication and every
    // procedure aboard her, and it has to match exactly or the entry files
    // itself under a second ship one letter different. Offer what is already
    // in use; it stays a text field, so a new ship is just typed.
    let listId = null;
    if (f.suggestFrom) {
      const seen = new Set();
      for (const item of store.itemsOfType(draft.type)) {
        const v = item.data[f.key];
        if (v) seen.add(v);
      }
      if (seen.size) {
        listId = `suggest-${draft.type}-${f.key}`;
        const list = el('datalist', { id: listId });
        for (const v of [...seen].sort()) list.append(el('option', { value: v }));
        wrap.append(list);
      }
    }

    wrap.append(el('input', {
      class: 'field', 'data-field': f.key,
      type: f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text',
      value, placeholder: f.placeholder || '',
      ...(listId ? { list: listId } : {}),
      ...(cased ? { autocapitalize: 'words' } : {}),
      oninput: (e) => { draft.data[f.key] = e.target.value; },
      ...(cased ? {
        onblur: (e) => {
          const next = titleCase(e.target.value);
          if (next !== e.target.value) { e.target.value = next; draft.data[f.key] = next; }
        }
      } : {})
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

/** Bringing a stack of documents in at once, rather than one at a time. */
function importPanel(def) {
  const panel = el('div', { class: 'panel import-panel' }, [
    el('h3', { text: `Import ${def.label.toLowerCase()}` }),
    el('p', { text: 'Choose several PDFs at once. Each becomes its own entry, filled in from the document and read so its contents can be searched with no signal.' })
  ]);
  panel.append(el('button', {
    class: 'btn btn-block', onclick: () => $('#importPicker').click()
  }, ['Choose files']));
  return panel;
}

/**
 * Bring in a stack of circulars at once.
 *
 * One entry per file, filled in from the document the same way a single one
 * is, and its text read so it joins the search. Adding a folder's worth one
 * at a time is the same six taps repeated a hundred times, and the app
 * already knows how to read each of them.
 *
 * Nothing is guessed silently: what each entry was filled in with is on the
 * entry, to be corrected. A file that cannot be read still becomes an entry,
 * titled from its filename, rather than being dropped.
 */
async function onImportPicked(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length || !view.section) return;

  const type = view.section;
  const def = TYPES[type];
  const keys = def.fields.map((f) => f.key);

  const status = el('p', { class: 'hint', text: `0 of ${files.length}` });
  const bar = el('div', { class: 'bar' }, [el('i')]);
  let stopped = false;
  const stop = el('button', { class: 'btn btn-sm btn-block', style: 'margin-top:8px' }, ['Stop']);
  stop.addEventListener('click', () => { stopped = true; stop.textContent = 'Stopping…'; });
  const panel = el('div', { class: 'panel', id: 'importProgress' }, [status, bar, stop]);
  $('#body').prepend(panel);

  let added = 0, unreadable = 0;
  for (const [i, file] of files.entries()) {
    if (stopped) break;
    status.textContent = `${i + 1} of ${files.length} — ${file.name}`;
    try {
      const buffer = await file.arrayBuffer();
      const descriptor = await store.storeFile(file);

      let data = { attachments: [] };
      if (isPdf(file)) {
        const described = await describe(buffer.slice(0));
        if (described.ok) data = { ...data, ...suggestFields(type, described, file.name, keys) };

        const read = await extract(buffer);
        if (read.pages.length) await store.storeText(descriptor.id, read.pages);
        Object.assign(descriptor, {
          textPages: read.pages.length, pageCount: read.pageCount,
          textStatus: read.status, textError: read.error
        });
        if (read.status !== STATUS.INDEXED) unreadable++;
      }

      // Never nameless: a document that says nothing about itself is still
      // findable by what it was called.
      if (!String(data[def.titleKey] || '').trim()) data[def.titleKey] = titleFromFilename(file.name);
      data.attachments = [descriptor];

      await store.saveItem({ type, data });
      added++;
    } catch (ex) {
      console.warn('Could not import', file.name, ex);
    }
    bar.firstChild.style.width = `${Math.round(((i + 1) / files.length) * 100)}%`;
  }

  panel.remove();
  render();
  toast(`${added} imported${unreadable ? ` — ${unreadable} had no text to search` : ''}`
    + (stopped ? ' · stopped' : ''));
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
  // Fields a section can work out for itself, so they are not asked for twice.
  def.derive?.(draft.data);
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

  const versionOut = el('div');
  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Build' }),
    el('div', { class: 'stat' }, [el('span', { text: 'App version' }), el('span', { text: APP_VERSION })]),
    versionOut,
    el('button', {
      class: 'btn btn-block', style: 'margin-top:10px',
      // "Checked for updates" said nothing about whether there was one, which
      // is the only thing worth knowing. This asks the site directly what
      // version it is serving and compares it with what is running.
      onclick: async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Checking…';
        clear(versionOut);
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          await reg?.update().catch(() => {});

          const onSite = await versionOnSite() || 'unknown';

          if (onSite === APP_VERSION) {
            versionOut.append(el('p', { class: 'hint', style: 'color:var(--sage)',
              text: `Up to date — the site is serving ${onSite} too.` }));
          } else {
            // Not a suggestion to close and reopen: that is what has already
            // failed if it has come to this. Offer the reset instead.
            versionOut.append(el('p', { class: 'hint',
              text: `The site is serving ${onSite}. This copy is ${APP_VERSION}.` }));
            versionOut.append(el('button', {
              class: 'btn btn-primary btn-block', style: 'margin-top:8px', onclick: reinstall
            }, ['Update now — your entries are kept']));
          }
        } catch (ex) {
          versionOut.append(el('p', { class: 'hint', style: 'color:var(--danger)',
            text: `Could not check: ${ex.message}. This needs a connection.` }));
        } finally {
          e.target.disabled = false;
          e.target.textContent = 'Check for updates';
        }
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
