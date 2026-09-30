import * as store from './store.js';
import * as db from './db.js';
import * as sec from './crypto.js';
import { TYPES, TAB_ORDER, CONTRACT_FIELDS, RANKS, VESSEL_TYPES, MONTH_NAMES } from './schema.js';
import {
  entryDays, isOnboard, formatDuration, seaTimeSummary, expiryStatus, expiryLabel, displayDate, displayDateShort,
  findOverlaps, revalidationStatus, TANKER_TYPES, taxYearDays, goalProgress, voyageProgress, validateSeaTime, expiriesDuringVoyages, certificateCategory
} from './derive.js';
import { el, $, clear, toast, formatBytes } from './ui.js';
import { icon } from './icons.js';
import { renderInto } from './viewer.js';
import { icsForItem, icsForItems, datedCertificates, calendarFileName, eventFor } from './calendar.js';
import { buildCv, buildSeaServiceStatement } from './cv.js';
import { buildCvDocx } from './docx.js';
import { checkReadiness } from './join.js';
import { parseCertificateText } from './scan.js';
import * as faceid from './faceid.js';

const AUTOLOCK_DEFAULT_MS = 5 * 60 * 1000;
const APP_VERSION = '2026.09.30b';
const BACKUP_NUDGE_DAYS = 30;

const view = {
  tab: 'certificate',
  query: '',
  draft: null,
  detailId: null,
  autolockMs: AUTOLOCK_DEFAULT_MS,
  // 'numeric' shows the iOS number pad; 'text' the full keyboard. Remembered
  // per vault, because a numeric pad cannot type an existing letter passcode.
  passStyle: 'text',
  lastBackupAt: null,
  backupSnoozeUntil: 0
};

/**
 * Point a field at the right iOS keyboard. inputmode drives it on current iOS;
 * the pattern is a long-standing fallback for older WebKit.
 */
function applyKeyboard(input, style) {
  if (style === 'numeric') {
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('pattern', '[0-9]*');
  } else {
    input.removeAttribute('inputmode');
    input.removeAttribute('pattern');
  }
}

let lockTimer = null;

// ── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  registerServiceWorker();
  view.autolockMs = (await db.getMeta('autolockMs')) ?? AUTOLOCK_DEFAULT_MS;
  // Existing vaults predate this setting, so default them to the full keyboard.
  view.passStyle = (await db.getMeta('passcodeStyle')) ?? 'text';
  view.lastBackupAt = (await db.getMeta('lastBackupAt')) ?? null;
  view.backupSnoozeUntil = (await db.getMeta('backupSnoozeUntil')) ?? 0;

  const ready = await store.isInitialized();
  $('#lock').hidden = false;
  $('#unlockForm').hidden = !ready;
  $('#setupForm').hidden = ready;
  $('#lockSub').textContent = ready ? 'Enter your passcode' : 'Everything stays on this iPhone';
  applyKeyboard($('#unlockCode'), view.passStyle);
  syncKeyboardToggle();
  $('#faceIdBtn').hidden = !(ready && await store.faceIdEnabled());
  // With Face ID on, the keyboard would only cover the button.
  if (ready && $('#faceIdBtn').hidden) setTimeout(() => $('#unlockCode').focus(), 150);

  store.onChange(render);
  wireLock();
  wireApp();
  wireAutoLock();
}

/**
 * Register the worker and make updates actually land.
 *
 * updateViaCache:'none' stops the browser serving sw.js itself from the HTTP
 * cache, which was letting an installed app miss new versions entirely. When a
 * new worker takes control the page reloads once, so a fix applies on the
 * launch it arrives rather than the one after.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    // Never interrupt someone mid-edit; the next launch will pick it up.
    if (view.draft || !$('#editor').hidden) return;
    location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            next.postMessage('skipWaiting');
          }
        });
      });
      // Also check on every foreground, so a long-lived install still updates.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  });
}

// ── lock ────────────────────────────────────────────────────────────────────

function wireLock() {
  $('#unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#unlockError');
    err.hidden = true;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Unlocking…';
    try {
      await store.unlock($('#unlockCode').value);
      $('#unlockCode').value = '';
      enterApp();
    } catch (ex) {
      err.textContent = ex.code === 'BAD_PASSCODE' ? 'Incorrect passcode.' : ex.message;
      err.hidden = false;
      $('#unlockCode').select();
    } finally {
      btn.disabled = false; btn.textContent = 'Unlock';
    }
  });

  $('#faceIdBtn').addEventListener('click', async () => {
    const err = $('#unlockError');
    err.hidden = true;
    const btn = $('#faceIdBtn');
    btn.disabled = true;
    try {
      await store.unlockWithFaceId();
      enterApp();
    } catch (ex) {
      if (ex.code !== 'CANCELLED') { err.textContent = ex.message; err.hidden = false; }
      if (ex.code === 'STALE') { await store.disableFaceId(); btn.hidden = true; }
    } finally {
      btn.disabled = false;
    }
  });

  // Escape hatch: swap keyboards if the remembered style is wrong for this vault.
  $('#kbToggle').addEventListener('click', () => {
    view.passStyle = view.passStyle === 'numeric' ? 'text' : 'numeric';
    // Switch the field first so the keyboard responds instantly; the write to
    // disk is not something the tap should wait on.
    applyKeyboard($('#unlockCode'), view.passStyle);
    syncKeyboardToggle();
    $('#unlockCode').focus();
    db.setMeta('passcodeStyle', view.passStyle).catch(() => {});
  });

  for (const [id, style] of [['#segText', 'text'], ['#segPin', 'numeric']]) {
    $(id).addEventListener('click', () => {
      view.passStyle = style;
      $('#segText').setAttribute('aria-checked', String(style === 'text'));
      $('#segPin').setAttribute('aria-checked', String(style === 'numeric'));
      for (const field of ['#setupCode', '#setupCode2']) {
        applyKeyboard($(field), style);
        $(field).value = '';
      }
      $('#setupCode').placeholder = style === 'numeric' ? 'Choose a PIN (8+ digits)' : 'Choose a passcode';
      $('#setupCode2').placeholder = style === 'numeric' ? 'Confirm PIN' : 'Confirm passcode';
      $('#strengthFill').style.width = '0';
      $('#strengthLabel').textContent = style === 'numeric' ? 'Enter a PIN' : 'Enter a passcode';
      $('#setupCode').focus();
    });
  }

  $('#setupCode').addEventListener('input', (e) => {
    const { score, label } = sec.passcodeStrength(e.target.value);
    const fill = $('#strengthFill');
    fill.style.width = (score / 5 * 100) + '%';
    fill.style.background = score <= 1 ? 'var(--danger)' : score <= 3 ? 'var(--amber)' : 'var(--teal)';
    $('#strengthLabel').textContent = label;
  });

  $('#setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#setupError');
    err.hidden = true;
    const a = $('#setupCode').value, b = $('#setupCode2').value;
    const numeric = view.passStyle === 'numeric';
    if (numeric && !/^\d+$/.test(a)) {
      err.textContent = 'A PIN must be digits only.'; err.hidden = false; return;
    }
    // A digit-only secret has far less entropy per character, so it needs length.
    const min = numeric ? 8 : 6;
    if (a.length < min) {
      err.textContent = numeric ? 'Use at least 8 digits.' : 'Use at least 6 characters.';
      err.hidden = false; return;
    }
    if (a !== b) { err.textContent = 'The two passcodes do not match.'; err.hidden = false; return; }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await store.initialize(a);
      await db.setMeta('passcodeStyle', view.passStyle);
      applyKeyboard($('#unlockCode'), view.passStyle);
      syncKeyboardToggle();
      $('#setupCode').value = $('#setupCode2').value = '';
      enterApp();
      toast('Vault created');
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Create vault';
    }
  });

  for (const id of ['#restoreBtn', '#restoreBtn2']) {
    $(id).addEventListener('click', () => $('#backupPicker').click());
  }
  $('#backupPicker').addEventListener('change', onBackupPicked);
}

function syncKeyboardToggle() {
  $('#kbToggle').textContent = view.passStyle === 'numeric' ? 'Use full keyboard' : 'Use number pad';
}

function enterApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  renderNav();
  render();
  resetLockTimer();
}

function lockNow() {
  store.lock();
  for (const s of ['#detail', '#editor', '#settings', '#tool']) $(s).hidden = true;
  closeViewer();
  store.faceIdEnabled().then((on) => { $('#faceIdBtn').hidden = !on; }).catch(() => {});
  view.query = ''; view.draft = null; view.detailId = null;
  $('#search').value = '';
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#setupForm').hidden = true;
  $('#unlockForm').hidden = false;
  $('#unlockError').hidden = true;
  $('#lockSub').textContent = 'Enter your passcode';
  clearTimeout(lockTimer);
}

function wireAutoLock() {
  for (const evt of ['pointerdown', 'keydown', 'focusin']) {
    document.addEventListener(evt, () => resetLockTimer(), { passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') resetLockTimer();
  });
}

function resetLockTimer() {
  clearTimeout(lockTimer);
  if (!store.isUnlocked() || view.autolockMs === 0) return;
  lockTimer = setTimeout(() => {
    if (store.isUnlocked()) { lockNow(); toast('Locked'); }
  }, view.autolockMs);
}

// ── navigation ──────────────────────────────────────────────────────────────

function renderNav() {
  const nav = clear($('#nav'));
  for (const type of TAB_ORDER) {
    const def = TYPES[type];
    const btn = el('button', {
      class: 'nav-btn',
      'aria-current': view.tab === type && !view.query ? 'page' : null,
      'data-tab': type,
      onclick: () => {
        view.tab = type;
        if (view.query) { view.query = ''; $('#search').value = ''; }
        renderNav(); render();
        $('#list').scrollTop = 0;
      }
    }, [
      el('span', { class: 'nav-ico' }, [icon(def.icon, 21)]),
      el('span', { class: 'nav-lab', text: def.short })
    ]);
    if (type === 'certificate') {
      const alerts = store.itemsOfType('certificate')
        .filter((i) => ['expired', 'soon'].includes(expiryStatus(i.data.expiryDate).state)).length;
      if (alerts) btn.append(el('span', { class: 'nav-badge mono', text: String(alerts) }));
    }
    nav.append(btn);
  }
}

// ── list ────────────────────────────────────────────────────────────────────

function render() {
  if (!store.isUnlocked()) return;
  renderNav();
  const list = clear($('#list'));
  $('#screenTitle').textContent = view.query ? 'Search results' : TYPES[view.tab].label;
  const nudge = backupNudge();
  if (nudge) list.append(nudge);
  if (view.query) renderSearch(list);
  else renderTab(list, view.tab);
}

function renderTab(list, type) {
  const items = store.itemsOfType(type);

  if (type === 'seatime') {
    list.append(seaTimeSummaryPanel(items));
    for (const panel of seaTimeChecks(items)) list.append(panel);
  }
  if (type === 'certificate') {
    const clash = expiryClashPanel();
    if (clash) list.append(clash);
    if (items.length) list.append(joinLink());
  }

  if (!items.length) {
    list.append(emptyState(`No ${TYPES[type].label.toLowerCase()} yet`, 'Tap + to add the first entry.'));
    return;
  }
  for (const item of items) list.append(rowFor(item));
}

/**
 * A reminder to back up, shown on every tab while it is due: when nothing has
 * ever been backed up, or the last backup is a month old and entries have
 * changed since. "Later" quietens it for three days.
 */
function backupNudge() {
  const items = store.allItems();
  if (!items.length || Date.now() < view.backupSnoozeUntil) return null;
  const last = view.lastBackupAt;
  const changed = last ? items.filter((i) => i.updatedAt > last).length : items.length;
  if (!changed) return null;
  const ageDays = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (last && ageDays < BACKUP_NUDGE_DAYS) return null;
  const text = last
    ? `Last backup ${ageDays} days ago, and ${changed} entr${changed === 1 ? 'y has' : 'ies have'} changed since. This iPhone holds the only copy.`
    : `${changed} entr${changed === 1 ? 'y' : 'ies'} and no backup yet. This iPhone holds the only copy.`;
  return el('div', { class: 'check check-warn backup-nudge' }, [
    el('div', { class: 'check-head' }, [el('span', { class: 'summary-label', text: 'Back up your vault' })]),
    el('p', { class: 'check-text', text }),
    el('div', { class: 'fieldrow', style: 'margin-top:10px' }, [
      el('div', {}, [el('button', { class: 'btn btn-primary btn-sm btn-block', onclick: doExportEncrypted }, ['Back up now'])]),
      el('div', {}, [el('button', {
        class: 'btn btn-sm btn-block',
        onclick: async () => {
          view.backupSnoozeUntil = Date.now() + 3 * 86400000;
          await db.setMeta('backupSnoozeUntil', view.backupSnoozeUntil);
          render();
        }
      }, ['Later'])])
    ])
  ]);
}

function renderSearch(list) {
  const hits = store.search(view.query, null);
  if (!hits.length) {
    list.append(emptyState('Nothing found', `No entry matches “${view.query}”.`));
    return;
  }
  // Grouped by section, in tab order.
  for (const type of TAB_ORDER) {
    const group = hits.filter((i) => i.type === type);
    if (!group.length) continue;
    group.sort((a, b) => TYPES[type].sort ? (TYPES[type].sort(a.data, b.data) || 0) : b.updatedAt - a.updatedAt);
    list.append(el('div', { class: 'group-head' }, [
      TYPES[type].label,
      el('span', { class: 'group-count', text: String(group.length) })
    ]));
    for (const item of group) list.append(rowFor(item));
  }
}

function emptyState(title, body) {
  return el('div', { class: 'empty' }, [
    el('span', { class: 'empty-mark' }, [icon('anchor', 40)]),
    el('h3', { text: title }),
    el('p', { text: body })
  ]);
}

function rowFor(item) {
  if (item.type === 'seatime') return seaTimeRow(item);
  if (item.type === 'certificate') return certificateRow(item);
  return genericRow(item);
}

function cardShell(item, classes, children) {
  return el('article', {
    class: 'card' + (classes ? ' ' + classes : ''),
    onclick: () => openDetail(item.id)
  }, children);
}

function attachCount(item) {
  const n = (item.data.attachments || []).length;
  return n ? el('span', { class: 'pill pill-dim', text: `${n} file${n === 1 ? '' : 's'}` }) : null;
}

function genericRow(item) {
  const def = TYPES[item.type];
  const title = item.data[def.titleKey] || 'Untitled';
  const subParts = (def.listFields || []).map((k) => item.data[k]).filter(Boolean);

  const head = el('div', { class: 'card-head' }, [
    el('h2', { class: 'card-title', text: title }),
    item.pinned ? el('span', { class: 'pill pill-brass', text: 'Pinned' }) : null,
    attachCount(item)
  ]);

  const card = cardShell(item, item.pinned ? 'pinned' : '', [head]);

  if (subParts.length) {
    card.append(el('p', { class: 'card-sub', text: subParts.join(' · ') }));
  } else if (item.type === 'note' && item.data.body) {
    card.append(el('p', { class: 'card-sub', text: item.data.body.slice(0, 120) }));
  }
  return card;
}

function certificateRow(item) {
  const { state } = expiryStatus(item.data.expiryDate);
  const status = expiryStatus(item.data.expiryDate);
  const pillClass = state === 'expired' ? 'pill-danger' : state === 'soon' ? 'pill-amber' : state === 'ok' ? 'pill-teal' : 'pill-dim';

  const card = cardShell(item, state === 'expired' ? 'expired' : state === 'soon' ? 'soon' : '', [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: item.data.title || 'Untitled' }),
      el('span', { class: 'pill ' + pillClass, text: state === 'expired' ? 'Expired' : state === 'soon' ? 'Expiring' : state === 'ok' ? 'Valid' : 'No expiry' }),
      attachCount(item)
    ])
  ]);
  const sub = [item.data.issuer, item.data.refNo].filter(Boolean).join(' · ');
  if (sub) card.append(el('p', { class: 'card-sub', text: sub }));
  card.append(el('div', { class: 'dgrid two' }, [
    dcell('Expires', displayDateShort(item.data.expiryDate)),
    dcell('Status', expiryLabel(status), state === 'ok' || state === 'none')
  ]));
  return card;
}

/** Sea time list rows stay deliberately sparse — full detail opens on tap. */
function seaTimeRow(item) {
  const d = item.data;
  const onboard = isOnboard(d);
  const card = cardShell(item, onboard ? 'onboard' : '', [
    el('div', { class: 'card-head' }, [
      el('h2', { class: 'card-title', text: d.vessel || 'Unnamed vessel' }),
      onboard ? el('span', { class: 'pill pill-teal', text: 'Onboard' }) : null,
      attachCount(item)
    ]),
    el('p', { class: 'card-sub', text: [d.rank, d.vesselType].filter(Boolean).join(' · ') || '—' }),
    el('div', { class: 'dgrid two' }, [
      dcell('Sign on', displayDateShort(d.signOnDate)),
      dcell('Sign off', onboard && !d.signOffDate ? 'Onboard' : displayDateShort(d.signOffDate))
    ]),
    el('div', { class: 'dgrid' }, [
      dcell('GRT', d.grt || '—'),
      dcell('NRT', d.nrt || '—'),
      dcell('KW', d.kw || '—')
    ])
  ]);
  const progress = voyageProgress(d);
  if (progress) card.append(el('p', { class: 'voyage-count', text: voyageCountText(progress) }));
  return card;
}

/** "Day 87 onboard · 33 days to contract end" */
function voyageCountText({ day, daysLeft, endDate }) {
  const parts = [`Day ${day} onboard`];
  if (daysLeft === null) parts.push('no contract end set');
  else if (daysLeft > 0) parts.push(`${daysLeft} day${daysLeft === 1 ? '' : 's'} to contract end (${displayDateShort(endDate)})`);
  else if (daysLeft === 0) parts.push('contract ends today');
  else parts.push(`contract ended ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`);
  return parts.join(' · ');
}

function dcell(key, value, dim) {
  return el('div', { class: 'dcell' }, [
    el('span', { class: 'dkey', text: key }),
    el('span', { class: 'dval' + (dim ? ' dim' : ''), text: String(value ?? '—') })
  ]);
}

function seaTimeSummaryPanel(items) {
  const data = items.map((i) => i.data);
  const { totalDays, byRank, byType, tankerDays, overlapDays, voyages } = seaTimeSummary(data);
  const panel = el('div', { class: 'summary' }, [
    el('div', { class: 'summary-top' }, [
      el('div', {}, [
        el('div', { class: 'summary-label', text: 'Total sea time' }),
        el('div', { class: 'summary-total', text: formatDuration(totalDays) })
      ]),
      el('div', { style: 'text-align:right' }, [
        el('div', { class: 'summary-label', text: 'Voyages' }),
        el('div', { class: 'summary-total', style: 'font-size:19px', text: String(voyages) })
      ])
    ]),
    el('div', { class: 'summary-days', text: `${totalDays} days total · 30-day months` + (overlapDays ? ` · ${overlapDays} overlapping days counted once` : '') })
  ]);

  const max = byRank.length ? byRank[0].days : 0;
  for (const r of byRank) {
    panel.append(el('div', { class: 'rank-row' }, [
      el('span', { class: 'rank-name', text: r.rank }),
      el('span', { class: 'rank-bar', style: `width:${max ? Math.max(6, (r.days / max) * 64) : 0}px` }),
      el('span', { class: 'rank-days', text: formatDuration(r.days) })
    ]));
  }

  // By ship type, for endorsements that ask for time on a kind of ship.
  if (byType.length > 1 || tankerDays) {
    panel.append(el('div', { class: 'summary-label summary-sub', text: 'By ship type' }));
    const typeMax = byType.length ? byType[0].days : 0;
    const rows = byType.map((t) => [t.type, t.days]);
    if (tankerDays && byType.filter((t) => TANKERS.has(t.type)).length > 1) rows.push(['All tankers', tankerDays]);
    for (const [label, days] of rows) {
      panel.append(el('div', { class: 'kind-row' }, [
        el('span', { class: 'rank-name', text: label }),
        el('span', { class: 'rank-bar', style: `width:${typeMax ? Math.max(6, Math.min(1, days / typeMax) * 64) : 0}px` }),
        el('span', { class: 'rank-days', text: formatDuration(days) })
      ]));
    }
  }
  return panel;
}

const TANKERS = new Set(TANKER_TYPES);

function profileItem() {
  return store.itemsOfType('profile')[0] || null;
}

/**
 * The cards under the sea time total: overlapping voyages, STCW revalidation,
 * the goal being worked towards, and certificates that lapse mid-contract.
 */
function seaTimeChecks(items) {
  const data = items.map((i) => i.data);
  const out = [];

  const overlaps = findOverlaps(data);
  if (overlaps.length) {
    const box = el('div', { class: 'check check-warn' }, [
      el('div', { class: 'check-head' }, [
        el('span', { class: 'summary-label', text: 'Overlapping voyages' }),
        el('span', { class: 'pill pill-amber', text: `${overlaps.length}` })
      ]),
      el('p', { class: 'check-text', text: 'These dates overlap, usually from a mistyped date. The shared days are counted once, against the earlier voyage.' })
    ]);
    for (const { a, b, days } of overlaps) {
      box.append(el('p', { class: 'check-line mono', text: `${a.vessel || '—'} ↔ ${b.vessel || '—'}: ${days} day${days === 1 ? '' : 's'}` }));
    }
    out.push(box);
  }

  if (data.some((d) => entryDays(d) > 0)) {
    const r = revalidationStatus(data);
    const coc = store.itemsOfType('certificate')
      .filter((c) => certificateCategory(c.data) === 'Certificate of Competency' && c.data.expiryDate)
      .sort((a, b) => a.data.expiryDate.localeCompare(b.data.expiryDate))[0];
    const box = el('div', { class: 'check' + (r.met ? '' : ' check-warn') }, [
      el('div', { class: 'check-head' }, [
        el('span', { class: 'summary-label', text: 'CoC revalidation' }),
        el('span', { class: 'pill ' + (r.met ? 'pill-teal' : 'pill-amber'), text: r.met ? 'Sea time met' : 'Short' })
      ]),
      el('div', { class: 'dgrid two' }, [
        dcell('Last 5 years', `${formatDuration(r.last5y)} / 12 mo`),
        dcell('Last 6 months', `${formatDuration(r.last6m)} / 3 mo`)
      ])
    ]);
    if (coc) {
      box.append(el('p', { class: 'check-text', text: `${coc.data.title}: ${expiryLabel(expiryStatus(coc.data.expiryDate)).toLowerCase()} (${displayDateShort(coc.data.expiryDate)}).` }));
    }
    box.append(el('p', { class: 'hint', text: r.met
      ? 'STCW I/11: 12 months in the last 5 years, or 3 months in the last 6. Your administration may also accept other routes.'
      : `STCW I/11 needs 12 months in the last 5 years (${formatDuration(r.short5y)} to go), or 3 months in the last 6. Your administration may accept other routes.` }));
    out.push(box);
  }

  const profile = profileItem();
  const goal = goalProgress(data, profile?.data);
  if (goal) {
    const p = profile.data;
    const scope = [p.goalRank ? `as ${p.goalRank}` : 'in any rank', p.goalSince ? `since ${displayDateShort(p.goalSince)}` : ''].filter(Boolean).join(' ');
    out.push(el('div', { class: 'check', onclick: () => openEditor('profile', profileItem()) }, [
      el('div', { class: 'check-head' }, [
        el('span', { class: 'summary-label', text: p.goalLabel || 'Sea time goal' }),
        el('span', { class: 'pill ' + (goal.done ? 'pill-teal' : 'pill-brass'), text: goal.done ? 'Done' : `${Math.floor(goal.fraction * 100)}%` })
      ]),
      el('div', { class: 'goal-bar' }, [el('i', { style: `width:${(goal.fraction * 100).toFixed(1)}%` })]),
      el('p', { class: 'check-text mono', text: `${formatDuration(goal.served)} of ${formatDuration(goal.need)} ${scope}` }),
      el('p', { class: 'hint', text: goal.done ? 'Sea time for this goal is complete.' : `${formatDuration(goal.remaining)} (${goal.remaining} days) still to serve.` })
    ]));
  } else {
    out.push(el('button', {
      class: 'btn btn-ghost btn-sm goal-link',
      onclick: () => openEditor('profile', profileItem())
    }, ['Set a sea time goal for your next CoC']));
  }

  const tax = taxPanel(data);
  if (tax) out.push(tax);

  const clash = expiryClashPanel();
  if (clash) out.push(clash);
  out.push(joinLink());
  return out;
}

function joinLink() {
  return el('button', { class: 'btn btn-teal btn-block', onclick: () => openJoin() }, ['Ready to join? Check certificates']);
}

/** Days at sea in the current tax year, against the target set in the profile. */
function taxPanel(data) {
  const p = profileItem()?.data;
  if (!p?.taxYearStart && !p?.taxDaysTarget) {
    return el('button', {
      class: 'btn btn-ghost btn-sm goal-link',
      onclick: () => openEditor('profile', profileItem())
    }, ['Track days abroad per tax year']);
  }
  const startMonth = Math.max(1, MONTH_NAMES.indexOf(p.taxYearStart) + 1);
  const t = taxYearDays(data, { startMonth, target: p.taxDaysTarget });
  const met = t.target && t.served >= t.target;
  const onTrack = t.target && !met && t.planned >= t.target;
  const box = el('div', { class: 'check' + (t.target && !met && !onTrack ? ' check-warn' : ''), onclick: () => openEditor('profile', profileItem()) }, [
    el('div', { class: 'check-head' }, [
      el('span', { class: 'summary-label', text: 'Days abroad this tax year' }),
      t.target ? el('span', { class: 'pill ' + (met ? 'pill-teal' : onTrack ? 'pill-brass' : 'pill-amber'), text: met ? 'Met' : onTrack ? 'On track' : 'Short' }) : null
    ]),
    el('div', { class: 'dgrid two' }, [
      dcell('At sea so far', t.target ? `${t.served} / ${t.target} days` : `${t.served} days`),
      dcell('With planned contracts', `${t.planned} days`)
    ])
  ]);
  if (t.target) box.append(el('div', { class: 'goal-bar' }, [el('i', { style: `width:${Math.min(100, (t.served / t.target) * 100).toFixed(1)}%` })]));
  box.append(el('p', { class: 'hint', text: `Tax year ${displayDateShort(t.start)} – ${displayDateShort(t.end)} · ${t.daysLeftInYear} days left in it.`
    + (t.target && !met ? ` ${t.remaining} more days needed${onTrack ? '; your planned contracts cover it' : t.plannedShort ? `, ${t.plannedShort} beyond what is planned` : ''}.` : '')
    + ' Travel days to and from the ship are not included.' }));
  return box;
}

/** Certificates whose expiry falls before the end of a current or planned contract. */
function expiryClashPanel() {
  const clashes = expiriesDuringVoyages(
    store.itemsOfType('certificate').map((c) => c.data),
    store.itemsOfType('seatime').map((v) => v.data)
  );
  if (!clashes.length) return null;
  const box = el('div', { class: 'check check-danger' }, [
    el('div', { class: 'check-head' }, [
      el('span', { class: 'summary-label', text: 'Expires during a contract' }),
      el('span', { class: 'pill pill-danger', text: String(clashes.length) })
    ])
  ]);
  for (const c of clashes) {
    box.append(el('p', { class: 'check-line', text: `${c.certificate.title || 'Certificate'} expires ${displayDateShort(c.expiryDate)}, before ${c.voyage.vessel || 'the voyage'} ends ${displayDateShort(c.endDate)}.` }));
  }
  box.append(el('p', { class: 'hint', text: 'Renew before joining, or plan the renewal ashore.' }));
  return box;
}

// ── chrome wiring ───────────────────────────────────────────────────────────

function wireApp() {
  $('#search').addEventListener('input', (e) => { view.query = e.target.value; render(); });
  $('#lockBtn').addEventListener('click', lockNow);
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
  $('#fab').addEventListener('click', () => openEditor(view.query ? view.tab : view.tab, null));
  $('#filePicker').addEventListener('change', onFilesPicked);
  $('#scanPicker').addEventListener('change', onScanPicked);
  $('#toolClose').addEventListener('click', () => { $('#tool').hidden = true; });
  $('#viewerClose').addEventListener('click', closeViewer);

  for (const id of ['#detail', '#editor', '#settings', '#tool']) {
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

  const heading = item.data[def.titleKey] || 'Untitled';
  body.append(el('h2', { class: 'card-title', style: 'font-size:21px;margin:0', text: heading }));

  if (item.type === 'certificate') {
    const st = expiryStatus(item.data.expiryDate);
    const cls = st.state === 'expired' ? 'pill-danger' : st.state === 'soon' ? 'pill-amber' : st.state === 'ok' ? 'pill-teal' : 'pill-dim';
    body.append(el('div', {}, [el('span', { class: 'pill ' + cls, text: expiryLabel(st) })]));
  }
  if (item.type === 'seatime') {
    const days = entryDays(item.data);
    const progress = voyageProgress(item.data);
    body.append(el('div', { class: 'summary' }, [
      el('div', { class: 'summary-label', text: isOnboard(item.data) ? 'Sea time so far' : 'Sea time this voyage' }),
      el('div', { class: 'summary-total', text: formatDuration(days) }),
      el('div', { class: 'summary-days', text: `${days} days` }),
      progress ? el('div', { class: 'voyage-count', text: voyageCountText(progress) }) : null
    ]));
    const others = store.itemsOfType('seatime').filter((i) => i.id !== item.id).map((i) => i.data);
    for (const w of validateSeaTime(item.data, others).warnings) {
      body.append(el('p', { class: 'check-line warn-line', text: w }));
    }
  }

  // Plain field readout, skipping the specials handled below.
  const section = el('div', { class: 'detail-sec' });
  let shown = 0;
  for (const f of def.fields) {
    if (['attachments', 'contracts', 'fileLink'].includes(f.key)) continue;
    if (f.key === def.titleKey) continue;
    const raw = item.data[f.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = f.type === 'date' ? displayDate(raw)
      : f.type === 'month' ? displayDate(raw)
      : String(raw);
    section.append(el('div', { class: 'stat' }, [
      el('span', { text: f.label }),
      el('span', { text: value })
    ]));
    shown++;
  }
  if (shown) body.append(section);

  if (item.type === 'seatime' && (item.data.contracts || []).length) {
    const sec2 = el('div', { class: 'detail-sec' }, [el('h4', { text: 'Contracts' })]);
    item.data.contracts.forEach((c, i) => {
      const box = el('div', { class: 'contract' }, [
        el('div', { class: 'contract-num', text: `Contract ${i + 1}` })
      ]);
      for (const cf of CONTRACT_FIELDS) {
        if (!c[cf.key]) continue;
        box.append(el('div', { class: 'stat' }, [
          el('span', { text: cf.label }),
          el('span', { text: cf.type === 'date' ? displayDate(c[cf.key]) : String(c[cf.key]) })
        ]));
      }
      sec2.append(box);
    });
    body.append(sec2);
  }

  const atts = item.data.attachments || [];
  if (atts.length) {
    const sec3 = el('div', { class: 'detail-sec' }, [el('h4', { text: 'Files on this device' })]);
    for (const att of atts) sec3.append(attachmentRow(att));
    body.append(sec3);
  }

  if (item.data.fileLink) {
    body.append(el('div', { class: 'detail-sec' }, [
      el('h4', { text: 'Cloud link' }),
      el('a', {
        class: 'btn btn-teal btn-block link-btn',
        href: item.data.fileLink, target: '_blank', rel: 'noopener noreferrer'
      }, ['Open link'])
    ]));
  }

  const actions = el('div', { class: 'detail-sec' }, []);
  if (eventFor(item)) {
    actions.append(el('button', {
      class: 'btn btn-teal btn-block',
      onclick: () => addToCalendar(item)
    }, [item.type === 'certificate' ? 'Add expiry to Calendar' : 'Add voyage to Calendar']));
  }
  if (def.pinnable) {
    actions.append(el('button', {
      class: 'btn btn-block', style: 'margin-top:8px',
      onclick: async () => { await store.togglePin(item.id); openDetail(item.id); }
    }, [item.pinned ? 'Unpin' : 'Pin to top']));
  }
  // Skip the section entirely when neither action applies, rather than leaving
  // an empty bordered block.
  if (actions.childElementCount) body.append(actions);

  $('#detail').hidden = false;
  $('#detailBody').scrollTop = 0;
}

function attachmentRow(att, onRemove) {
  const row = el('div', { class: 'contract', style: 'border-left-color:var(--brass);border-color:var(--brass-dim)' }, [
    el('div', { class: 'card-head' }, [
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { class: 'dval', style: 'font-size:14px', text: att.name }),
        el('div', { class: 'dkey', style: 'margin-top:3px', text: `${att.type || 'file'} · ${formatBytes(att.size)}` })
      ]),
      onRemove ? el('button', { class: 'del-btn', onclick: onRemove, 'aria-label': 'Remove file' }, ['×']) : null
    ])
  ]);
  if (!onRemove) {
    row.append(el('div', { class: 'fieldrow', style: 'margin-top:9px' }, [
      el('div', {}, [el('button', { class: 'btn btn-sm btn-block', onclick: () => openAttachment(att) }, ['Open'])]),
      el('div', {}, [el('button', { class: 'btn btn-sm btn-block', onclick: () => shareAttachment(att) }, ['Save to Files'])])
    ]));
  }
  return row;
}

let disposeViewer = null;

/**
 * Show a document in the app. An installed iOS web app cannot open a blob: URL
 * in a new tab -- the old Open button silently did nothing -- so it is rendered
 * here instead.
 */
async function openAttachment(att) {
  const body = clear($('#viewerBody'));
  $('#viewerTitle').textContent = att.name || 'Document';
  $('#viewer').hidden = false;
  body.append(el('p', { class: 'hint', style: 'padding:24px', text: 'Opening…' }));
  try {
    const blob = await store.readFile(att);
    disposeViewer?.();
    disposeViewer = await renderInto(body, blob, att.name, {
      onStatus: (text) => { $('#viewerTitle').textContent = `${att.name} · ${text}`; }
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

/**
 * Hand the decrypted file to iOS. The share sheet is the reliable route out of a
 * standalone PWA -- it offers "Save to Files", Mail, AirDrop and the rest.
 * Falls back to a download link where the Web Share API is unavailable.
 */
async function shareAttachment(att) {
  try {
    await shareBlob(await store.readFile(att), att.name, att.type);
  } catch (ex) {
    toast('Could not share: ' + ex.message);
  }
}

// ── editor ──────────────────────────────────────────────────────────────────

function openEditor(type, item) {
  const def = TYPES[type];
  view.draft = {
    id: item?.id || null,
    type,
    pinned: item?.pinned || false,
    data: JSON.parse(JSON.stringify(item?.data || {})),
    newFiles: [],
    removed: []
  };
  if (!view.draft.data.attachments) view.draft.data.attachments = [];
  if (type === 'seatime' && !view.draft.data.contracts) view.draft.data.contracts = [];
  $('#editorTitle').textContent = (item?.id ? 'Edit ' : 'New ') + def.singular.toLowerCase();
  renderEditor();
  $('#editor').hidden = false;
  $('#editorBody').scrollTop = 0;
}

function closeEditor() {
  $('#editor').hidden = true;
  view.draft = null;
}

function renderEditor() {
  const draft = view.draft;
  const def = TYPES[draft.type];
  const body = clear($('#editorBody'));

  if (draft.type === 'certificate') {
    body.append(el('div', { class: 'scan-box' }, [
      el('button', { class: 'btn btn-teal btn-block', id: 'scanBtn', onclick: () => $('#scanPicker').click() },
        [draft.scanning ? 'Reading…' : 'Scan certificate (photo or PDF)']),
      el('p', { class: 'hint', id: 'scanStatus', text: draft.scanNote || 'Fills in the title, number, issuer and dates it can read. Nothing leaves the phone.' })
    ]));
  }

  // Fields sharing a `group` render side by side.
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

  if (def.pinnable) {
    body.append(el('button', {
      class: 'btn btn-block',
      onclick: () => { draft.pinned = !draft.pinned; renderEditor(); }
    }, [draft.pinned ? 'Pinned — tap to unpin' : 'Pin to top']));
  }

  if (draft.type === 'seatime') {
    const others = store.itemsOfType('seatime').filter((i) => i.id !== draft.id).map((i) => i.data);
    const { errors, warnings } = validateSeaTime(draft.data, others);
    body.append(fillChecks(el('div', { id: 'editorChecks' }), errors, warnings));
  }

  if (draft.id && !def.singleton) {
    body.append(el('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        if (!confirm('Delete this entry permanently?')) return;
        await store.deleteItem(draft.id);
        closeEditor();
        toast('Deleted');
      }
    }, ['Delete entry']));
  }
}

function fillChecks(box, errors, warnings) {
  clear(box);
  for (const e of errors) box.append(el('p', { class: 'check-line err-line', text: e }));
  for (const w of warnings) box.append(el('p', { class: 'check-line warn-line', text: w }));
  return box;
}

/** Re-check a voyage's dates as they are typed, without redrawing the form. */
function refreshEditorChecks() {
  const draft = view.draft;
  const box = $('#editorChecks');
  if (!draft || draft.type !== 'seatime' || !box) return;
  const others = store.itemsOfType('seatime').filter((i) => i.id !== draft.id).map((i) => i.data);
  const { errors, warnings } = validateSeaTime(draft.data, others);
  fillChecks(box, errors, warnings);
}

function fieldFor(f, draft) {
  if (f.type === 'heading') return el('h4', { class: 'editor-heading', text: f.label });
  if (f.type === 'hint') return el('p', { class: 'hint', style: 'margin-top:-6px', text: f.label });
  if (f.type === 'contracts') return contractsEditor(draft, f);
  if (f.type === 'attachments') return attachmentsEditor(draft, f);

  const wrap = el('div', {}, [el('label', { class: 'label', text: f.label })]);
  const value = draft.data[f.key] ?? '';

  if (f.type === 'textarea') {
    wrap.append(el('textarea', {
      class: 'field',
      'data-field': f.key,
      style: f.rows ? `min-height:${f.rows * 22}px` : null,
      placeholder: f.placeholder || '',
      oninput: (e) => { draft.data[f.key] = e.target.value; }
    }, [value]));
  } else if (f.type === 'select') {
    const sel = el('select', { class: 'field', 'data-field': f.key, onchange: (e) => { draft.data[f.key] = e.target.value; } });
    sel.append(el('option', { value: '' }, ['—']));
    for (const opt of f.options) {
      sel.append(el('option', { value: opt, selected: value === opt }, [opt]));
    }
    // Preserve a value that predates a change to the option list.
    if (value && !f.options.includes(value)) sel.append(el('option', { value, selected: true }, [value]));
    wrap.append(sel);
  } else {
    wrap.append(el('input', {
      class: 'field',
      'data-field': f.key,
      type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : f.type === 'url' ? 'url' : 'text',
      inputmode: f.type === 'number' ? 'decimal' : null,
      step: f.step || null,
      value,
      placeholder: f.placeholder || '',
      oninput: (e) => { draft.data[f.key] = e.target.value; },
      onchange: f.type === 'date' ? refreshEditorChecks : null
    }));
  }
  if (f.hint) wrap.append(el('p', { class: 'hint', text: f.hint }));
  return wrap;
}

function contractsEditor(draft, f) {
  const contracts = draft.data.contracts;
  const wrap = el('div', {}, [
    el('label', { class: 'label', text: `${f.label} (${contracts.length}/${f.max})` }),
    el('p', { class: 'hint', style: 'margin:0 0 10px', text: 'For a vessel served under more than one contract or agency.' })
  ]);

  contracts.forEach((c, idx) => {
    const box = el('div', { class: 'contract' }, [
      el('div', { class: 'card-head' }, [
        el('span', { class: 'contract-num', text: `Contract ${idx + 1}` }),
        el('button', {
          class: 'del-btn', 'aria-label': 'Remove contract',
          onclick: () => { contracts.splice(idx, 1); renderEditor(); }
        }, ['×'])
      ])
    ]);
    let i = 0;
    while (i < CONTRACT_FIELDS.length) {
      const cf = CONTRACT_FIELDS[i];
      if (cf.group) {
        const run = [];
        while (i < CONTRACT_FIELDS.length && CONTRACT_FIELDS[i].group === cf.group) run.push(CONTRACT_FIELDS[i++]);
        box.append(el('div', { class: 'fieldrow' }, run.map((g) => el('div', {}, [contractField(g, c)]))));
      } else {
        box.append(contractField(cf, c));
        i++;
      }
    }
    wrap.append(box);
  });

  if (contracts.length < f.max) {
    wrap.append(el('button', {
      class: 'btn btn-block',
      onclick: () => { contracts.push({}); renderEditor(); }
    }, ['+ Add contract']));
  } else {
    wrap.append(el('p', { class: 'hint', text: `Maximum of ${f.max} contracts per entry.` }));
  }
  return wrap;
}

function contractField(cf, contract) {
  const wrap = el('div', { style: 'margin-bottom:9px' }, [el('label', { class: 'label', text: cf.label })]);
  if (cf.type === 'textarea') {
    wrap.append(el('textarea', {
      class: 'field', style: 'min-height:64px',
      'data-contract-field': cf.key,
      oninput: (e) => { contract[cf.key] = e.target.value; }
    }, [contract[cf.key] || '']));
  } else {
    wrap.append(el('input', {
      class: 'field',
      'data-contract-field': cf.key,
      type: cf.type === 'date' ? 'date' : 'text',
      value: contract[cf.key] || '',
      placeholder: cf.placeholder || '',
      oninput: (e) => { contract[cf.key] = e.target.value; },
      onchange: cf.type === 'date' ? refreshEditorChecks : null
    }));
  }
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
    wrap.append(el('div', { class: 'contract', style: 'border-left-color:var(--teal)' }, [
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

/**
 * Read a photographed or PDF certificate and fill the empty fields from it.
 * Typed values are never overwritten, and the scan is kept as an attachment.
 */
async function onScanPicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  const draft = view.draft;
  if (!file || !draft || draft.type !== 'certificate') return;
  const status = (text) => { const n = $('#scanStatus'); if (n) n.textContent = text; };
  draft.scanning = true;
  $('#scanBtn').textContent = 'Reading…';
  $('#scanBtn').disabled = true;
  try {
    const { readDocument } = await import('./ocr.js');
    const text = await readDocument(file, file.name, { onStatus: status });
    const found = parseCertificateText(text);
    const labels = { title: 'title', refNo: 'number', issuer: 'issuer', issueDate: 'issue date', expiryDate: 'expiry date' };
    const filled = [];
    for (const [key, value] of Object.entries(found)) {
      if (!String(draft.data[key] || '').trim()) { draft.data[key] = value; filled.push(labels[key]); }
    }
    if (!draft.newFiles.some((f) => f.name === file.name && f.size === file.size)) draft.newFiles.push(file);
    draft.scanNote = filled.length
      ? `Filled ${filled.join(', ')} from the scan — check them against the certificate. The scan is attached.`
      : 'Could not read the details clearly. The scan is attached; type the details in.';
  } catch (ex) {
    draft.scanNote = `Could not read it: ${ex.message}`;
  } finally {
    draft.scanning = false;
    if (view.draft === draft) renderEditor();
  }
}

function onFilesPicked(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length || !view.draft) return;
  view.draft.newFiles.push(...files);
  renderEditor();
}

async function saveEditor() {
  const draft = view.draft;
  if (!draft) return;
  const def = TYPES[draft.type];

  const required = def.fields.find((f) => f.required && !String(draft.data[f.key] || '').trim());
  if (required) return toast(`${required.label} is required`);

  if (draft.type === 'seatime') {
    const others = store.itemsOfType('seatime').filter((i) => i.id !== draft.id).map((i) => i.data);
    const { errors, warnings } = validateSeaTime(draft.data, others);
    if (errors.length) return toast(errors[0]);
    if (warnings.length && !confirm(`${warnings.join('\n')}\n\nSave anyway?`)) return;
  }

  const btn = $('#editorSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    for (const file of draft.newFiles) {
      draft.data.attachments.push(await store.storeFile(file));
    }
    for (const att of draft.removed) {
      await store.removeFile(att).catch(() => {});
    }
    // Contracts with nothing in them are noise; drop them.
    if (draft.data.contracts) {
      draft.data.contracts = draft.data.contracts.filter((c) => Object.values(c).some((v) => String(v || '').trim()));
    }
    const saved = await store.saveItem({ id: draft.id, type: draft.type, data: draft.data, pinned: draft.pinned });
    closeEditor();
    toast('Saved');
    if (view.detailId === saved.id) openDetail(saved.id);
  } catch (ex) {
    toast('Save failed: ' + ex.message);
  } finally {
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
  const c = store.counts();
  const total = Object.values(c).reduce((a, b) => a + b, 0);

  const stats = el('div', { class: 'panel' }, [el('h3', { text: 'This device' })]);
  stats.append(el('div', { class: 'stat' }, [el('span', { text: 'Entries' }), el('span', { text: String(total) })]));
  for (const type of TAB_ORDER) {
    if (!c[type]) continue;
    stats.append(el('div', { class: 'stat' }, [el('span', { text: TYPES[type].label }), el('span', { text: String(c[type]) })]));
  }
  stats.append(el('div', { class: 'stat' }, [el('span', { text: 'Files stored' }), el('span', { text: formatBytes(store.attachmentBytes()) })]));
  stats.append(el('div', { class: 'stat' }, [el('span', { text: 'Space used' }), el('span', { text: est ? formatBytes(est.usage) : 'unknown' })]));
  stats.append(el('div', { class: 'stat' }, [
    el('span', { text: 'Storage protected' }),
    el('span', {}, [el('span', { class: 'pill ' + (persisted ? 'pill-teal' : 'pill-amber'), text: persisted ? 'Persistent' : 'Best effort' })])
  ]));
  stats.append(el('div', { class: 'stat' }, [
    el('span', { text: 'Installed to Home Screen' }),
    el('span', {}, [el('span', { class: 'pill ' + (installed ? 'pill-teal' : 'pill-amber'), text: installed ? 'Yes' : 'Not yet' })])
  ]));
  if (!installed) {
    stats.append(el('p', { class: 'hint', text: 'In Safari: Share → Add to Home Screen. Installing is what stops iOS clearing your data when the app sits unused.' }));
  }
  body.append(stats);

  const lockPanel = el('div', { class: 'panel' }, [
    el('h3', { text: 'Auto-lock' }),
    el('p', { text: 'Lock the vault after a period without interaction.' })
  ]);
  const select = el('select', {
    class: 'field',
    onchange: async (e) => {
      view.autolockMs = Number(e.target.value);
      await db.setMeta('autolockMs', view.autolockMs);
      resetLockTimer();
      toast('Auto-lock updated');
    }
  });
  for (const [ms, label] of [[60000, '1 minute'], [300000, '5 minutes'], [900000, '15 minutes'], [3600000, '1 hour'], [0, 'Never']]) {
    select.append(el('option', { value: String(ms), selected: view.autolockMs === ms }, [label]));
  }
  lockPanel.append(select);
  body.append(lockPanel);

  body.append(await faceIdPanel());

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Passcode' }),
    el('p', { text: 'Changing it re-wraps the encryption key, so it is instant — your data is not re-encrypted. You can switch between a passphrase and a number PIN here.' }),
    el('button', { class: 'btn btn-block', onclick: changePasscodeFlow }, ['Change passcode']),
    el('div', { id: 'passcodePanel', style: 'margin-top:12px' })
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Backup' }),
    el('p', { text: 'This device holds the only copy. Export regularly and keep the file in iCloud Drive — the backup is encrypted, so cloud storage is safe.' }),
    el('div', { class: 'stat', style: 'margin-bottom:10px' }, [
      el('span', { text: 'Last backup' }),
      el('span', { text: view.lastBackupAt ? new Date(view.lastBackupAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never' })
    ]),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:8px', onclick: doExportEncrypted }, ['Export encrypted backup']),
    el('button', { class: 'btn btn-block', style: 'margin-bottom:8px', onclick: () => $('#backupPicker').click() }, ['Restore from backup']),
    el('button', { class: 'btn btn-block', onclick: doExportPlain }, ['Export readable copy'])
  ]));

  const profile = profileItem();
  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Profile & CV' }),
    el('p', { text: profile?.data.fullName
      ? `CVs are made from your profile, certificates and sea time. Profile: ${profile.data.fullName}.`
      : 'Add your name and particulars once; the CV fills in the rest from your certificates and sea time.' }),
    el('button', { class: 'btn btn-block', style: 'margin-bottom:8px', onclick: () => { $('#settings').hidden = true; openEditor('profile', profileItem()); } },
      [profile ? 'Edit profile' : 'Set up profile']),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:8px', onclick: openCvTool }, ['Create CV (PDF or Word)']),
    el('button', { class: 'btn btn-block', onclick: makeStatement }, ['Sea service record (PDF)'])
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Calendar' }),
    el('p', { text: 'Sends a standard calendar file to the iOS share sheet — choose Calendar to add the events. Certificate expiries carry reminders at 90 and 30 days.' }),
    el('button', {
      class: 'btn btn-block', style: 'margin-bottom:8px',
      onclick: () => exportCalendar(datedCertificates(store.itemsOfType('certificate')),
        'ava-certificate-expiries.ics', 'No certificates have an expiry date yet')
    }, ['Export all certificate expiries']),
    el('button', {
      class: 'btn btn-block',
      onclick: () => exportCalendar(store.itemsOfType('seatime'),
        'ava-voyages.ics', 'No voyages have a sign-on date yet')
    }, ['Export all voyages'])
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Erase' }),
    el('p', { text: 'Deletes the vault and every entry permanently. There is no recovery.' }),
    el('button', { class: 'btn btn-danger btn-block', onclick: doErase }, ['Erase everything'])
  ]));

  const build = el('span', { text: '—' });
  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Build' }),
    el('div', { class: 'stat' }, [el('span', { text: 'App version' }), el('span', { text: APP_VERSION })]),
    el('div', { class: 'stat' }, [el('span', { text: 'Offline cache' }), build]),
    el('button', {
      class: 'btn btn-block', style: 'margin-top:10px',
      onclick: async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update().catch(() => {});
        toast('Checked for updates');
      }
    }, ['Check for updates'])
  ]));
  // Ask the worker which shell version is actually serving this launch.
  if (navigator.serviceWorker?.controller) {
    const channel = new MessageChannel();
    navigator.serviceWorker.controller.postMessage('version');
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.version) build.textContent = e.data.version;
    }, { once: true });
    void channel;
  }

  body.append(el('p', { class: 'hint', style: 'text-align:center' },
    ['AVA keeps data only on this device and makes no network requests once loaded.']));

  $('#settings').hidden = false;
  $('#settingsBody').scrollTop = 0;
}

async function faceIdPanel() {
  const panel = el('div', { class: 'panel' }, [el('h3', { text: 'Face ID' })]);
  if (!(await faceid.available())) {
    panel.append(el('p', { text: 'Face ID or Touch ID is not available to AVA on this device.' }));
    return panel;
  }
  const on = await store.faceIdEnabled();
  panel.append(el('p', { text: on
    ? 'On. The lock screen offers Face ID; your passcode still works, and is needed after a restore.'
    : 'Unlock with Face ID instead of typing the passcode. The passcode keeps working. Needs iOS 18 or later.' }));
  panel.append(el('button', {
    class: 'btn btn-block' + (on ? '' : ' btn-teal'),
    onclick: async (e) => {
      e.target.disabled = true;
      try {
        if (on) {
          await store.disableFaceId();
          toast('Face ID turned off');
        } else {
          await store.enableFaceId();
          toast('Face ID turned on');
        }
      } catch (ex) {
        if (ex.code !== 'CANCELLED') toast(ex.message);
      }
      openSettings();
    }
  }, [on ? 'Turn off Face ID' : 'Turn on Face ID']));
  return panel;
}

// ── tool sheet: ready to join, create CV ────────────────────────────────────

function openTool(title, fill) {
  $('#toolTitle').textContent = title;
  fill(clear($('#toolBody')));
  $('#tool').hidden = false;
  $('#toolBody').scrollTop = 0;
}

function addMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Sensible starting values: the next planned voyage, else the last one's rank and type. */
function joinDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const voyages = store.itemsOfType('seatime').map((i) => i.data);
  const upcoming = voyages.filter((v) => v.signOnDate && v.signOnDate > today).sort((a, b) => a.signOnDate.localeCompare(b.signOnDate))[0];
  const latest = voyages.filter((v) => v.signOnDate).sort((a, b) => b.signOnDate.localeCompare(a.signOnDate))[0];
  const base = upcoming || latest || {};
  const joinDate = upcoming?.signOnDate || today;
  const ends = (upcoming?.contracts || []).map((c) => c.endDate).filter(Boolean);
  if (upcoming?.signOffDate) ends.push(upcoming.signOffDate);
  return {
    rank: profileItem()?.data.positionApplied || base.rank || 'Chief Officer',
    vesselType: base.vesselType || 'Bulk Carrier',
    joinDate,
    endDate: ends.sort().pop() || addMonths(joinDate, 6)
  };
}

const JOIN_ICONS = { ok: '✓', lapses: '!', expired: '✕', missing: '✕', optional: '?' };

function openJoin() {
  const opts = joinDefaults();
  openTool('Ready to join?', (body) => {
    const results = el('div', { class: 'join-results' });
    const select = (key, options) => {
      const sel = el('select', { class: 'field', 'data-join': key, onchange: (e) => { opts[key] = e.target.value; draw(); } });
      for (const o of options) sel.append(el('option', { value: o, selected: o === opts[key] }, [o]));
      return sel;
    };
    const date = (key) => el('input', { class: 'field', type: 'date', 'data-join': key, value: opts[key], onchange: (e) => { opts[key] = e.target.value; draw(); } });

    body.append(
      el('p', { class: 'hint', style: 'margin:0', text: 'The STCW certificates most companies ask for, checked against your own. A company or flag may want others.' }),
      el('div', { class: 'fieldrow' }, [
        el('div', {}, [el('label', { class: 'label', text: 'Rank' }), select('rank', RANKS)]),
        el('div', {}, [el('label', { class: 'label', text: 'Ship type' }), select('vesselType', VESSEL_TYPES)])
      ]),
      el('div', {}, [el('label', { class: 'label', text: 'Joining' }), date('joinDate')]),
      el('div', {}, [el('label', { class: 'label', text: 'Contract ends' }), date('endDate')]),
      results
    );

    function draw() {
      clear(results);
      const certs = store.itemsOfType('certificate').map((i) => i.data);
      const r = checkReadiness(certs, opts);
      const problems = r.counts.missing + r.counts.expired + r.counts.lapses;
      results.append(el('div', { class: 'check ' + (r.ready ? '' : 'check-warn') }, [
        el('div', { class: 'check-head' }, [
          el('span', { class: 'summary-label', text: r.ready ? 'Ready to join' : 'Not ready yet' }),
          el('span', { class: 'pill ' + (r.ready ? 'pill-teal' : 'pill-amber'), text: r.ready ? `${r.counts.ok} valid` : `${problems} to sort` })
        ]),
        el('p', { class: 'check-text', text: r.ready
          ? `Everything required stays valid until ${displayDateShort(opts.endDate)}.`
          : 'Missing or expiring items are listed first. Tap one that is missing to add it.' })
      ]));

      const order = { missing: 0, expired: 1, lapses: 2, optional: 3, ok: 4 };
      for (const item of [...r.results].sort((a, b) => order[a.status] - order[b.status])) {
        const c = item.certificate;
        const detail = item.status === 'missing' ? 'Not on file'
          : item.status === 'optional' ? (item.note || 'Optional') + ' · not on file'
          : item.status === 'expired' ? `${c.title} expired ${displayDateShort(c.expiryDate)}`
          : item.status === 'lapses' ? `${c.title} expires ${displayDateShort(c.expiryDate)}, before the contract ends`
          : `${c.title}${c.expiryDate ? ` · valid to ${displayDateShort(c.expiryDate)}` : ' · no expiry'}`;
        results.append(el('div', {
          class: `join-row join-${item.status}`,
          onclick: item.status === 'missing' || item.status === 'optional'
            ? () => { $('#tool').hidden = true; openEditor('certificate', { data: { title: item.label } }); }
            : null
        }, [
          el('span', { class: 'join-icon', text: JOIN_ICONS[item.status] }),
          el('div', { class: 'join-text' }, [
            el('div', { class: 'join-label', text: item.label + (item.optional ? ' (optional)' : '') }),
            el('div', { class: 'join-detail', text: detail })
          ])
        ]));
      }
      if (r.others.length) {
        results.append(el('p', { class: 'check-line warn-line', text: `Also expiring during the contract: ${r.others.map((c) => `${c.title} (${displayDateShort(c.expiryDate)})`).join(', ')}.` }));
      }
    }
    draw();
  });
}

/**
 * Choose what goes on the CV, then make it as a PDF or a Word document.
 * Unticked entries are remembered on the profile for next time.
 */
function openCvTool() {
  const profile = profileItem();
  if (!profile?.data.fullName) {
    toast('Add your name to the profile first');
    $('#settings').hidden = true;
    return openEditor('profile', profile);
  }
  const excluded = new Set(profile.data.cvExclude || []);
  openTool('Create CV', (body) => {
    const tick = (item, label, sub) => el('label', { class: 'tick-row' }, [
      el('input', {
        type: 'checkbox', checked: !excluded.has(item.id), 'data-cv': item.id,
        onchange: (e) => { if (e.target.checked) excluded.delete(item.id); else excluded.add(item.id); }
      }),
      el('span', { class: 'tick-text' }, [el('span', { text: label }), sub ? el('span', { class: 'tick-sub', text: sub }) : null])
    ]);

    body.append(el('p', { class: 'hint', style: 'margin:0', text: 'Untick anything this application does not need. Your choice is kept for next time.' }));
    const certs = store.itemsOfType('certificate');
    if (certs.length) {
      body.append(el('h4', { class: 'editor-heading', text: 'Certificates' }));
      for (const c of [...certs].sort((a, b) => certificateCategory(a.data).localeCompare(certificateCategory(b.data)))) {
        const st = expiryStatus(c.data.expiryDate);
        body.append(tick(c, c.data.title || 'Untitled', `${certificateCategory(c.data)}${st.state === 'expired' ? ' · expired' : ''}`));
      }
    }
    const voyages = store.itemsOfType('seatime');
    if (voyages.length) {
      body.append(el('h4', { class: 'editor-heading', text: 'Sea service' }));
      for (const v of voyages) {
        body.append(tick(v, v.data.vessel || 'Unnamed vessel', [v.data.rank, displayDateShort(v.data.signOnDate)].filter(Boolean).join(' · ')));
      }
    }

    const make = async (format, btn) => {
      btn.disabled = true;
      try {
        await store.saveItem({ id: profile.id, data: { cvExclude: [...excluded] } });
        await makeCv(format, excluded);
      } finally {
        btn.disabled = false;
      }
    };
    body.append(el('div', { class: 'fieldrow', style: 'margin-top:6px' }, [
      el('div', {}, [el('button', { class: 'btn btn-primary btn-block', onclick: (e) => make('pdf', e.target) }, ['PDF'])]),
      el('div', {}, [el('button', { class: 'btn btn-block', onclick: (e) => make('docx', e.target) }, ['Word'])])
    ]));
  });
}

function changePasscodeFlow() {
  const panel = $('#passcodePanel');
  if (!panel) return;
  clear(panel);

  // The new passcode's style is chosen here; the current one still uses the
  // style the vault was created with.
  let newStyle = view.passStyle;

  const current = el('input', { class: 'field', type: 'password', placeholder: 'Current passcode',
    autocomplete: 'current-password' });
  applyKeyboard(current, view.passStyle);

  const next = el('input', { class: 'field', type: 'password', autocomplete: 'new-password' });
  const confirmField = el('input', { class: 'field', type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'lock-error', hidden: true });

  const segText = el('button', { type: 'button', class: 'seg', 'aria-checked': String(newStyle === 'text') }, ['Passphrase']);
  const segPin = el('button', { type: 'button', class: 'seg', 'aria-checked': String(newStyle === 'numeric') }, ['Number PIN']);

  const applyStyle = (style) => {
    newStyle = style;
    segText.setAttribute('aria-checked', String(style === 'text'));
    segPin.setAttribute('aria-checked', String(style === 'numeric'));
    for (const field of [next, confirmField]) {
      applyKeyboard(field, style);
      field.value = '';
    }
    next.placeholder = style === 'numeric' ? 'New PIN (8+ digits)' : 'New passcode';
    confirmField.placeholder = style === 'numeric' ? 'Confirm PIN' : 'Confirm passcode';
  };
  segText.addEventListener('click', () => applyStyle('text'));
  segPin.addEventListener('click', () => applyStyle('numeric'));
  applyStyle(newStyle);

  const save = el('button', { class: 'btn btn-primary btn-block' }, ['Change passcode']);
  save.addEventListener('click', async () => {
    error.hidden = true;
    const numeric = newStyle === 'numeric';
    if (numeric && !/^\d+$/.test(next.value)) return showErr(error, 'A PIN must be digits only.');
    const min = numeric ? 8 : 6;
    if (next.value.length < min) {
      return showErr(error, numeric ? 'Use at least 8 digits.' : 'Use at least 6 characters.');
    }
    if (next.value !== confirmField.value) return showErr(error, 'The two entries do not match.');

    save.disabled = true;
    save.textContent = 'Changing…';
    try {
      await store.changePasscode(current.value, next.value);
      await db.setMeta('passcodeStyle', newStyle);
      view.passStyle = newStyle;
      applyKeyboard($('#unlockCode'), newStyle);
      syncKeyboardToggle();
      clear(panel);
      openSettings();
      toast('Passcode changed');
    } catch (ex) {
      showErr(error, ex.code === 'BAD_PASSCODE' ? 'Current passcode is wrong.' : ex.message);
      save.disabled = false;
      save.textContent = 'Change passcode';
    }
  });

  const cancel = el('button', { class: 'btn btn-block', onclick: () => clear(panel) }, ['Cancel']);

  panel.append(
    el('label', { class: 'label', text: 'Current' }), current,
    el('label', { class: 'label', style: 'margin-top:12px', text: 'New passcode type' }),
    el('div', { class: 'segment' }, [segText, segPin]),
    el('label', { class: 'label', style: 'margin-top:12px', text: 'New' }), next,
    el('div', { style: 'height:8px' }), confirmField,
    error,
    el('div', { style: 'height:10px' }), save,
    el('div', { style: 'height:8px' }), cancel
  );
  current.focus();
}

async function shareOrDownload(payload, filename) {
  return shareText(JSON.stringify(payload, null, 2), filename, 'application/json');
}

/**
 * Hand a generated file to iOS. The share sheet is the only reliable way out of
 * a standalone PWA, and for .ics it is what surfaces "Add All Events".
 */
async function shareText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (ex) {
      if (ex.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

/**
 * The profile's first picture as a portrait JPEG for the CV. Whatever the phone
 * saved (HEIC, PNG, a huge JPEG) is redrawn through a canvas, cropped to 3:4.
 */
async function profilePhotoJpeg(profile) {
  const att = (profile?.data.attachments || []).find((a) => (a.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(a.name || ''));
  if (!att) return null;
  const blob = await store.readFile(att);
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('The photo could not be read'));
      i.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cropW = Math.min(w, h * 0.75), cropH = cropW / 0.75;
    const canvas = document.createElement('canvas');
    canvas.width = 450; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, (w - cropW) / 2, Math.max(0, (h - cropH) / 3), cropW, cropH, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return new Uint8Array(await jpeg.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fileStem(prefix) {
  const who = (profileItem()?.data.fullName || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  return `${prefix}${who ? '-' + who : ''}-${new Date().toISOString().slice(0, 10)}`;
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The CV as a PDF (shown in the viewer) or a Word file (straight to the share sheet). */
async function makeCv(format, excluded = new Set()) {
  const profile = profileItem();
  const input = {
    profile: profile?.data || {},
    certificates: store.itemsOfType('certificate').filter((i) => !excluded.has(i.id)).map((i) => i.data),
    voyages: store.itemsOfType('seatime').filter((i) => !excluded.has(i.id)).map((i) => i.data)
  };
  try {
    const photo = await profilePhotoJpeg(profile).catch((ex) => { toast(ex.message); return null; });
    if (format === 'docx') {
      const name = `${fileStem('CV')}.docx`;
      await shareBlob(new Blob([buildCvDocx({ ...input, photo })], { type: DOCX_TYPE }), name);
      toast('Word CV ready');
    } else {
      await showGeneratedPdf(new Blob([buildCv({ ...input, photo })], { type: 'application/pdf' }), `${fileStem('CV')}.pdf`);
    }
  } catch (ex) {
    toast('Could not make the CV: ' + ex.message);
  }
}

async function makeStatement() {
  const profile = profileItem();
  const voyages = store.itemsOfType('seatime').map((i) => i.data);
  if (!voyages.length) return toast('No sea time entries yet');
  try {
    const bytes = buildSeaServiceStatement({
      profile: profile?.data || {},
      certificates: store.itemsOfType('certificate').map((i) => i.data),
      voyages
    });
    await showGeneratedPdf(new Blob([bytes], { type: 'application/pdf' }), `${fileStem('Sea-service')}.pdf`);
  } catch (ex) {
    toast('Could not make the PDF: ' + ex.message);
  }
}

async function showGeneratedPdf(blob, name) {
  const body = clear($('#viewerBody'));
  $('#viewerTitle').textContent = name;
  $('#viewer').hidden = false;
  $('#viewerShare').onclick = () => shareBlob(blob, name);
  disposeViewer?.();
  disposeViewer = await renderInto(body, blob, name, {
    onStatus: (text) => { $('#viewerTitle').textContent = `${name} · ${text}`; }
  });
}

async function shareBlob(blob, filename, type = blob.type) {
  const file = new File([blob], filename, { type: type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (ex) {
      if (ex.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function addToCalendar(item) {
  const ics = icsForItem(item);
  if (!ics) return toast('This entry has no date to add');
  if (await shareText(ics, calendarFileName(item), 'text/calendar')) {
    toast('Calendar file ready — choose Calendar to add it');
  }
}

async function exportCalendar(items, filename, emptyMessage) {
  const result = icsForItems(items);
  if (!result) return toast(emptyMessage);
  if (await shareText(result.ics, filename, 'text/calendar')) {
    toast(`${result.count} event${result.count === 1 ? '' : 's'} ready for Calendar`);
  }
}

async function doExportEncrypted() {
  const payload = await store.exportEncrypted();
  const stamp = new Date().toISOString().slice(0, 10);
  if (await shareOrDownload(payload, `ava-backup-${stamp}.json`)) {
    view.lastBackupAt = Date.now();
    await db.setMeta('lastBackupAt', view.lastBackupAt);
    toast('Backup ready — save it to Files');
    render();
    if (!$('#settings').hidden) openSettings();
  }
}

async function doExportPlain() {
  if (!confirm('This file is NOT encrypted. Anyone who opens it can read everything. Continue?')) return;
  const payload = await store.exportPlain();
  const stamp = new Date().toISOString().slice(0, 10);
  if (await shareOrDownload(payload, `ava-readable-${stamp}.json`)) toast('Unencrypted copy ready');
}

async function onBackupPicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    return toast('That file is not valid JSON');
  }
  if (payload.format !== 'ava-vault-encrypted') return toast('Not an AVA encrypted backup');

  const passcode = prompt('Passcode for this backup:');
  if (passcode === null) return;
  if (!confirm('Restoring replaces everything currently on this device. Continue?')) return;

  try {
    const n = await store.importEncrypted(payload, passcode);
    $('#settings').hidden = true;
    enterApp();
    toast(`Restored ${n} entr${n === 1 ? 'y' : 'ies'}`);
  } catch (ex) {
    toast(ex.code === 'BAD_PASSCODE' ? 'Wrong passcode for that backup' : 'Restore failed: ' + ex.message);
  }
}

async function doErase() {
  if (!confirm('Erase the entire vault? Every entry is deleted permanently.')) return;
  if (prompt('Type ERASE to confirm:') !== 'ERASE') return toast('Cancelled');
  await store.eraseVault();
  location.reload();
}

boot();
