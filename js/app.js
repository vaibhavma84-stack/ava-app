import * as store from './store.js';
import * as db from './db.js';
import * as sec from './crypto.js';
import { TYPES, TAB_ORDER, CONTRACT_FIELDS } from './schema.js';
import { entryDays, isOnboard, formatDuration, seaTimeSummary, expiryStatus, expiryLabel, displayDate, displayDateShort } from './derive.js';
import { el, $, clear, toast, formatBytes } from './ui.js';
import { icon } from './icons.js';

const AUTOLOCK_DEFAULT_MS = 5 * 60 * 1000;

const view = {
  tab: 'manual',
  query: '',
  draft: null,
  detailId: null,
  autolockMs: AUTOLOCK_DEFAULT_MS
};

let lockTimer = null;

// ── boot ────────────────────────────────────────────────────────────────────

async function boot() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
    });
  }
  view.autolockMs = (await db.getMeta('autolockMs')) ?? AUTOLOCK_DEFAULT_MS;

  const ready = await store.isInitialized();
  $('#lock').hidden = false;
  $('#unlockForm').hidden = !ready;
  $('#setupForm').hidden = ready;
  $('#lockSub').textContent = ready ? 'Enter your passcode' : 'Everything stays on this iPhone';
  if (ready) setTimeout(() => $('#unlockCode').focus(), 150);

  store.onChange(render);
  wireLock();
  wireApp();
  wireAutoLock();
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
    if (a.length < 6) { err.textContent = 'Use at least 6 characters.'; err.hidden = false; return; }
    if (a !== b) { err.textContent = 'The two passcodes do not match.'; err.hidden = false; return; }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await store.initialize(a);
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

function enterApp() {
  $('#lock').hidden = true;
  $('#app').hidden = false;
  renderNav();
  render();
  resetLockTimer();
}

function lockNow() {
  store.lock();
  for (const s of ['#detail', '#editor', '#settings']) $(s).hidden = true;
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
  if (view.query) renderSearch(list);
  else renderTab(list, view.tab);
}

function renderTab(list, type) {
  const items = store.itemsOfType(type);

  if (type === 'seatime') list.append(seaTimeSummaryPanel(items));

  if (!items.length) {
    list.append(emptyState(`No ${TYPES[type].label.toLowerCase()} yet`, 'Tap + to add the first entry.'));
    return;
  }
  for (const item of items) list.append(rowFor(item));
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
    el('h2', { class: 'card-title', text: item.type === 'salary' ? displayDate(item.data.month) : title }),
    item.pinned ? el('span', { class: 'pill pill-brass', text: 'Pinned' }) : null,
    attachCount(item)
  ]);

  const card = cardShell(item, item.pinned ? 'pinned' : '', [head]);

  if (item.type === 'salary') {
    const amount = item.data.amount;
    card.append(el('div', { class: 'dgrid two' }, [
      dcell('Amount', amount ? `${item.data.currency || ''} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : '—'),
      dcell('Vessel', item.data.vessel || '—')
    ]));
  } else if (subParts.length) {
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
      dcell('Sign off', onboard ? 'Onboard' : displayDateShort(d.signOffDate))
    ]),
    el('div', { class: 'dgrid' }, [
      dcell('GRT', d.grt || '—'),
      dcell('NRT', d.nrt || '—'),
      dcell('KW', d.kw || '—')
    ])
  ]);
  return card;
}

function dcell(key, value, dim) {
  return el('div', { class: 'dcell' }, [
    el('span', { class: 'dkey', text: key }),
    el('span', { class: 'dval' + (dim ? ' dim' : ''), text: String(value ?? '—') })
  ]);
}

function seaTimeSummaryPanel(items) {
  const data = items.map((i) => i.data);
  const { totalDays, byRank, voyages } = seaTimeSummary(data);
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
    el('div', { class: 'summary-days', text: `${totalDays} days total · 30-day months` })
  ]);

  const max = byRank.length ? byRank[0].days : 0;
  for (const r of byRank) {
    panel.append(el('div', { class: 'rank-row' }, [
      el('span', { class: 'rank-name', text: r.rank }),
      el('span', { class: 'rank-bar', style: `width:${max ? Math.max(6, (r.days / max) * 64) : 0}px` }),
      el('span', { class: 'rank-days', text: formatDuration(r.days) })
    ]));
  }
  return panel;
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

  const heading = item.type === 'salary' ? displayDate(item.data.month) : (item.data[def.titleKey] || 'Untitled');
  body.append(el('h2', { class: 'card-title', style: 'font-size:21px;margin:0', text: heading }));

  if (item.type === 'certificate') {
    const st = expiryStatus(item.data.expiryDate);
    const cls = st.state === 'expired' ? 'pill-danger' : st.state === 'soon' ? 'pill-amber' : st.state === 'ok' ? 'pill-teal' : 'pill-dim';
    body.append(el('div', {}, [el('span', { class: 'pill ' + cls, text: expiryLabel(st) })]));
  }
  if (item.type === 'seatime') {
    const days = entryDays(item.data);
    body.append(el('div', { class: 'summary' }, [
      el('div', { class: 'summary-label', text: isOnboard(item.data) ? 'Sea time so far' : 'Sea time this voyage' }),
      el('div', { class: 'summary-total', text: formatDuration(days) }),
      el('div', { class: 'summary-days', text: `${days} days` })
    ]));
  }

  // Plain field readout, skipping the specials handled below.
  const section = el('div', { class: 'detail-sec' });
  let shown = 0;
  for (const f of def.fields) {
    if (['attachments', 'contracts', 'fileLink'].includes(f.key)) continue;
    if (f.key === def.titleKey || (item.type === 'salary' && f.key === 'month')) continue;
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

  const actions = el('div', { class: 'detail-sec' }, [
    el('button', { class: 'btn btn-primary btn-block', onclick: () => { $('#detail').hidden = true; openEditor(item.type, item); } }, ['Edit entry'])
  ]);
  if (def.pinnable) {
    actions.append(el('button', {
      class: 'btn btn-block', style: 'margin-top:8px',
      onclick: async () => { await store.togglePin(item.id); openDetail(item.id); }
    }, [item.pinned ? 'Unpin' : 'Pin to top']));
  }
  body.append(actions);

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

async function openAttachment(att) {
  try {
    const blob = await store.readFile(att);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (ex) {
    toast('Could not open: ' + ex.message);
  }
}

/**
 * Hand the decrypted file to iOS. The share sheet is the reliable route out of a
 * standalone PWA -- it offers "Save to Files", Mail, AirDrop and the rest.
 * Falls back to a download link where the Web Share API is unavailable.
 */
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
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (ex) {
    if (ex.name !== 'AbortError') toast('Could not share: ' + ex.message);
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
  $('#editorTitle').textContent = (item ? 'Edit ' : 'New ') + def.singular.toLowerCase();
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

  if (draft.id) {
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

function fieldFor(f, draft) {
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
      oninput: (e) => { draft.data[f.key] = e.target.value; }
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
      oninput: (e) => { contract[cf.key] = e.target.value; }
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
  $('#settings').hidden = false;
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

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Passcode' }),
    el('p', { text: 'Changing it re-wraps the encryption key, so it is instant — your data is not re-encrypted.' }),
    el('button', { class: 'btn btn-block', onclick: changePasscodeFlow }, ['Change passcode'])
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Backup' }),
    el('p', { text: 'This device holds the only copy. Export regularly and keep the file in iCloud Drive — the backup is encrypted, so cloud storage is safe.' }),
    el('button', { class: 'btn btn-primary btn-block', style: 'margin-bottom:8px', onclick: doExportEncrypted }, ['Export encrypted backup']),
    el('button', { class: 'btn btn-block', style: 'margin-bottom:8px', onclick: () => $('#backupPicker').click() }, ['Restore from backup']),
    el('button', { class: 'btn btn-block', onclick: doExportPlain }, ['Export readable copy'])
  ]));

  body.append(el('div', { class: 'panel' }, [
    el('h3', { text: 'Erase' }),
    el('p', { text: 'Deletes the vault and every entry permanently. There is no recovery.' }),
    el('button', { class: 'btn btn-danger btn-block', onclick: doErase }, ['Erase everything'])
  ]));

  body.append(el('p', { class: 'hint', style: 'text-align:center' },
    ['AVA keeps data only on this device and makes no network requests once loaded.']));
}

async function changePasscodeFlow() {
  const current = prompt('Current passcode:');
  if (current === null) return;
  const next = prompt('New passcode (at least 6 characters):');
  if (next === null) return;
  if (next.length < 6) return toast('Passcode too short');
  if (prompt('Confirm the new passcode:') !== next) return toast('Passcodes did not match');
  try {
    await store.changePasscode(current, next);
    toast('Passcode changed');
  } catch (ex) {
    toast(ex.code === 'BAD_PASSCODE' ? 'Current passcode is wrong' : ex.message);
  }
}

async function shareOrDownload(payload, filename) {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
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

async function doExportEncrypted() {
  const payload = await store.exportEncrypted();
  const stamp = new Date().toISOString().slice(0, 10);
  if (await shareOrDownload(payload, `ava-backup-${stamp}.json`)) toast('Backup ready — save it to Files');
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
