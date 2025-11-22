// js/maintenance.js
import { supabase } from './supabaseClient.js';

/* ======================
   DOM refs
   ====================== */
const logoutBtn = document.getElementById('logout');

const countPending = document.getElementById('count-pending');
const countMaintenance = document.getElementById('count-maintenance');
const countAccessories = document.getElementById('count-accessories');
const countHistory = document.getElementById('count-history');

const quickCycleSelect = document.getElementById('quickCycleSelect');
const quickCycleStatus = document.getElementById('quickCycleStatus');
const applyCycleStatus = document.getElementById('applyCycleStatus');

const quickAccessorySelect = document.getElementById('quickAccessorySelect');
const quickAccessoryDamage = document.getElementById('quickAccessoryDamage');

const damagesActive = document.getElementById('damages-active');
const damagesHistory = document.getElementById('damages-history');

const damageCycle = document.getElementById('damageCycle');
const damageAccessory = document.getElementById('damageAccessory');
const damageForm = document.getElementById('damageForm');
const saveDamageBtn = document.getElementById('saveDamageBtn');

const linkLastRentalChk = document.getElementById('linkLastRental');
const lastRentalPreview = document.getElementById('lastRentalPreview');

const quickSearch = document.getElementById('quickSearch');
const refreshDamages = document.getElementById('refreshDamages');
const historyFilter = document.getElementById('historyFilter');

const btnAddDamage = document.getElementById('btnAddDamage');

/* ======================
   State
   ====================== */
let ALL_CYCLES = [];
let ALL_ACCESSORIES = [];
let ALL_RENTALS = [];
let CURRENT_USER = null;

/* ======================
   Helpers
   ====================== */
function escapeHtml(s = '') {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function parseDbTimestampToDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(ts)) return new Date(ts);
  const isoLike = ts.replace(' ', 'T');
  return new Date(isoLike + 'Z');
}
function formatToIST(ts) {
  if (!ts) return '—';
  const d = (ts instanceof Date) ? ts : parseDbTimestampToDate(ts);
  if (!d || isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}
function badgeColorForStatus(s) {
  switch (s) {
    case 'pending': return 'warning';
    case 'under_repair': return 'info';
    case 'repaired': return 'success';
    case 'scrapped': return 'dark';
    default: return 'secondary';
  }
}

/* ======================
   Auth + init
   ====================== */
async function ensureAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('Not authenticated');
  }
  CURRENT_USER = (await supabase.auth.getUser()).data.user;
  return session;
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await ensureAuth();
    wireUi();
    await initialLoad();
  } catch (err) {
    console.error('init error', err);
    damagesActive.innerHTML = `<div class="p-3 text-danger">Failed to initialize. Check console.</div>`;
    damagesHistory.innerHTML = `<div class="p-3 text-danger">Failed to initialize. Check console.</div>`;
  }
});

logoutBtn?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

/* ======================
   Wire UI
   ====================== */
function wireUi() {
  damageForm?.addEventListener('submit', onSaveDamage);
  quickSearch?.addEventListener('input', debounce(() => loadActiveDamages(), 350));
  refreshDamages?.addEventListener('click', () => refreshAll());
  applyCycleStatus?.addEventListener('click', onApplyCycleStatus);
  quickAccessoryDamage?.addEventListener('click', onQuickAccessoryDamage);
  linkLastRentalChk?.addEventListener('change', onLinkLastRentalToggle);
  historyFilter?.addEventListener('change', loadHistoryDamages);
  damageCycle?.addEventListener('change', () => {
    if (linkLastRentalChk?.checked) onLinkLastRentalToggle();
  });
  // Reset form when modal closed
  const modalEl = document.getElementById('addDamageModal');
  modalEl?.addEventListener('hidden.bs.modal', () => {
    damageForm.reset();
    delete damageForm.dataset.editingId;
    linkLastRentalChk.checked = false;
    lastRentalPreview.textContent = '';
    // enable save button if disabled
    saveDamageBtn.disabled = false;
  });
}

/* ======================
   Initial load
   ====================== */
async function initialLoad() {
  await loadLookups();
  await refreshAll();
}

/* ======================
   Lookups
   ====================== */
async function loadLookups() {
  try {
    const [cRes, aRes, rRes] = await Promise.all([
      supabase.from('cycles').select('id, cycle_code, status, cycle_type_id, location_id').order('cycle_code'),
      supabase.from('accessories').select('id, name, description, availability_status, rental_price').order('name'),
      supabase.from('rentals').select('id, cycle_id, customer_id, out_time, in_time, status').order('out_time', { ascending: false }).limit(500)
    ]);

    ALL_CYCLES = (cRes.error) ? [] : (cRes.data || []);
    ALL_ACCESSORIES = (aRes.error) ? [] : (aRes.data || []);
    ALL_RENTALS = (rRes.error) ? [] : (rRes.data || []);

    populateCycleSelect(damageCycle, true);
    populateCycleSelect(quickCycleSelect, true);
    populateAccessorySelect(damageAccessory, true);
    populateAccessorySelect(quickAccessorySelect, false);
  } catch (err) {
    console.error('loadLookups err', err);
  }
}

function populateCycleSelect(selectEl, includeNone) {
  if (!selectEl) return;
  let html = includeNone ? `<option value="">(none)</option>` : `<option value="">Select cycle</option>`;
  html += ALL_CYCLES.map(c => `<option value="${c.id}">${escapeHtml(c.cycle_code)} ${c.status ? '('+escapeHtml(c.status)+')' : ''}</option>`).join('');
  selectEl.innerHTML = html;
}
function populateAccessorySelect(selectEl, includeNone) {
  if (!selectEl) return;
  let html = includeNone ? `<option value="">(none)</option>` : `<option value="">Select accessory</option>`;
  html += ALL_ACCESSORIES.map(a => `<option value="${a.id}">${escapeHtml(a.name)}${a.description ? ' ('+escapeHtml(a.description)+')' : ''}</option>`).join('');
  selectEl.innerHTML = html;
}

/* ======================
   Refresh / counts
   ====================== */
async function refreshAll() {
  await Promise.all([loadActiveDamages(), loadHistoryDamages(), loadSummaryCounts()]);
}

async function loadSummaryCounts() {
  try {
    const pendingRes = await supabase.from('damages').select('id', { head: true, count: 'exact' }).in('status', ['pending', 'under_repair']);
    const pendingCount = pendingRes.count ?? 0;

    // cycles in maintenance
    const inMaint = ALL_CYCLES.filter(c => c.status === 'maintenance').length;
    // accessories in repair/in_use
    const accessoriesInRepair = ALL_ACCESSORIES.filter(a => a.availability_status === 'repair' || a.availability_status === 'in_use').length;

    // history total (repaired+scrapped)
    const historyRes = await supabase.from('damages').select('id', { head: true, count: 'exact' }).in('status', ['repaired', 'scrapped']);
    const historyCount = historyRes.count ?? 0;

    countPending.textContent = pendingCount;
    countMaintenance.textContent = inMaint;
    countAccessories.textContent = accessoriesInRepair;
    countHistory.textContent = historyCount;
  } catch (err) {
    console.error('loadSummaryCounts err', err);
  }
}

/* ======================
   Load active / pending damages
   ====================== */
async function loadActiveDamages() {
  try {
    const searchTerm = (quickSearch?.value || '').trim().toLowerCase();
    const { data, error } = await supabase
      .from('damages')
      .select(`id, cycle_id, rental_id, reported_by, reported_on, damage_type, description, photo_url, estimated_cost, status, resolved_on, remarks, cycles(id, cycle_code), staff(id, name)`)
      .in('status', ['pending', 'under_repair'])
      .order('reported_on', { ascending: false });

    if (error) throw error;
    let rows = data || [];

    if (searchTerm) {
      rows = rows.filter(r => {
        const cc = r.cycles?.cycle_code?.toLowerCase() || '';
        const dt = r.damage_type?.toLowerCase() || '';
        const desc = r.description?.toLowerCase() || '';
        return cc.includes(searchTerm) || dt.includes(searchTerm) || desc.includes(searchTerm);
      });
    }

    if (!rows.length) {
      damagesActive.innerHTML = `<div class="p-3 text-muted">No active damages.</div>`;
    } else {
      damagesActive.innerHTML = rows.map(activeDamageCardHtml).join('');
      attachActiveHandlers();
    }

    await loadSummaryCounts();
  } catch (err) {
    console.error('loadActiveDamages err', err);
    damagesActive.innerHTML = `<div class="p-3 text-danger">Failed to load damages.</div>`;
  }
}
/*
function activeDamageCardHtml(d) {
  const cycle = d.cycles?.cycle_code || '—';
  const reporter = d.staff?.name || '—';
  const reportedOn = formatToIST(d.reported_on);
  const est = d.estimated_cost != null ? `• ₹${Number(d.estimated_cost).toFixed(2)}` : '';
  const photoBtn = d.photo_url ? `<button class="btn btn-sm btn-outline-secondary btn-view-photo" data-url="${escapeHtml(d.photo_url)}">View</button>` : '';
  const statusBadge = `<span class="badge bg-${badgeColorForStatus(d.status)}">${escapeHtml(d.status)}</span>`;

  // if accessory-only (no cycle) show accessory chip; we may have link via damage_accessories, but if no direct column, user likely used damage_accessories table. We'll indicate accessory presence by checking description text marker later - for safety keep generic.
  const accessoryTag = (d.description && d.description.toLowerCase().includes('accessory')) ? `<span class="chip-accessory ms-2">Accessory</span>` : '';

  // trim long description
  const shortDesc = d.description ? (d.description.length > 220 ? d.description.slice(0, 217) + '...' : d.description) : '';

  const classes = `list-group-item damage-card ${d.photo_url ? 'has-photo' : ''}`;

  return `
    <div class="${classes}" data-id="${d.id}">
      <div class="d-flex align-items-start">
        <div class="damage-row d-flex justify-content-between w-100 pe-3">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <strong>${escapeHtml(cycle)} ${accessoryTag}</strong> ${statusBadge}
              <div class="damage-meta mt-1">${escapeHtml(d.damage_type)} ${est}</div>
            </div>
            <div class="damage-right-meta">${reportedOn}<br/>By: ${escapeHtml(reporter)}</div>
          </div>

          <div class="mt-2">${escapeHtml(shortDesc)}</div>

          <div class="mt-2 small damage-actions">
            ${photoBtn}
            <button class="btn btn-sm btn-outline-info btn-mark-status" data-id="${d.id}" data-next="under_repair">Under Repair</button>
            <button class="btn btn-sm btn-outline-success btn-mark-status" data-id="${d.id}" data-next="repaired">Repaired</button>
            <button class="btn btn-sm btn-outline-danger btn-mark-status" data-id="${d.id}" data-next="scrapped">Scrapped</button>
            <button class="btn btn-sm btn-outline-secondary btn-toggle-cycle-status" data-cycle="${d.cycle_id || ''}">Toggle Cycle</button>
            <button class="btn btn-sm btn-outline-warning btn-edit-damage" data-id="${d.id}">Edit</button>
            <button class="btn btn-sm btn-outline-danger btn-delete-damage" data-id="${d.id}">Delete</button>
          </div>
        </div>
      </div>
    </div>
  `;
}*/


function activeDamageCardHtml(d) {
  const cycle = d.cycles?.cycle_code || '—';
  const reporter = d.staff?.name || '—';
  const reportedOn = formatToIST(d.reported_on);
  const est = d.estimated_cost != null ? `• ₹${Number(d.estimated_cost).toFixed(2)}` : '';
  const photoBtn = d.photo_url ? `<button class="btn btn-sm btn-outline-secondary btn-view-photo" data-url="${escapeHtml(d.photo_url)}">View</button>` : '';
  const statusBadge = `<span class="badge bg-${badgeColorForStatus(d.status)}">${escapeHtml(d.status)}</span>`;

  // if accessory-only (no cycle) show accessory chip; we may have link via damage_accessories, but if no direct column, user likely used damage_accessories table. We'll indicate accessory presence by checking description text marker later - for safety keep generic.
  const accessoryTag = (d.description && d.description.toLowerCase().includes('accessory')) ? `<span class="chip-accessory ms-2">Accessory</span>` : '';

  return `
    <div class="list-group-item damage-card">
      <div class="damage-row d-flex justify-content-between">

        <div class="damage-left">
         <div>
              <strong>${escapeHtml(cycle)} ${accessoryTag}</strong> ${statusBadge}
              <div class="damage-meta mt-1">${escapeHtml(d.damage_type)} ${est}</div>
            </div>
          <div class="desc small">${escapeHtml(d.description || '')}</div>
        </div>

        <div class="damage-right small text-muted">
          ${reportedOn}<br/>By: ${escapeHtml(reporter)}
        </div>

      </div>

      <div class="actions mt-1 small d-flex gap-2 flex-wrap">
        ${photoBtn}
        <button class="btn btn-sm btn-outline-info btn-mark-status" data-id="${d.id}" data-next="under_repair">Under Repair</button>
        <button class="btn btn-sm btn-outline-success btn-mark-status" data-id="${d.id}" data-next="repaired">Repaired</button>
        <button class="btn btn-sm btn-outline-danger btn-mark-status" data-id="${d.id}" data-next="scrapped">Scrapped</button>
        <button class="btn btn-sm btn-outline-secondary btn-toggle-cycle-status" data-cycle="${d.cycle_id}">Toggle Cycle</button>
        <button class="btn btn-sm btn-outline-warning btn-edit-damage" data-id="${d.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger btn-delete-damage" data-id="${d.id}">Delete</button>
      </div>
    </div>
  `;
}


function attachActiveHandlers() {
  document.querySelectorAll('.btn-mark-status').forEach(btn => btn.removeEventListener('click', onChangeDamageStatus) || btn.addEventListener('click', onChangeDamageStatus));
  document.querySelectorAll('.btn-toggle-cycle-status').forEach(btn => btn.removeEventListener('click', onToggleCycleMaintenance) || btn.addEventListener('click', onToggleCycleMaintenance));
  document.querySelectorAll('.btn-view-photo').forEach(btn => btn.removeEventListener('click', onViewPhoto) || btn.addEventListener('click', onViewPhoto));
  document.querySelectorAll('.btn-edit-damage').forEach(btn => btn.removeEventListener('click', onEditDamage) || btn.addEventListener('click', onEditDamage));
  document.querySelectorAll('.btn-delete-damage').forEach(btn => btn.removeEventListener('click', onDeleteDamage) || btn.addEventListener('click', onDeleteDamage));
}

/* ======================
   History damages
   ====================== */
async function loadHistoryDamages() {
  try {
    const filter = historyFilter?.value || 'all';
    const { data, error } = await supabase
      .from('damages')
      .select(`id, cycle_id, rental_id, reported_by, reported_on, damage_type, description, photo_url, estimated_cost, status, resolved_on, remarks, cycles(id, cycle_code), staff(id, name)`)
      .in('status', ['repaired','scrapped'])
      .order('resolved_on', { ascending: false });

    if (error) throw error;
    let rows = data || [];
    if (filter !== 'all') rows = rows.filter(r => r.status === filter);

    if (!rows.length) {
      damagesHistory.innerHTML = `<div class="p-3 text-muted">No history items.</div>`;
    } else {
      damagesHistory.innerHTML = rows.map(historyCardHtml).join('');
      document.querySelectorAll('.btn-view-photo').forEach(btn => btn.removeEventListener('click', onViewPhoto) || btn.addEventListener('click', onViewPhoto));
    }

    countHistory.textContent = rows.length;
  } catch (err) {
    console.error('loadHistoryDamages err', err);
    damagesHistory.innerHTML = `<div class="p-3 text-danger">Failed to load history.</div>`;
  }
}

/*function historyCardHtml(d) {
  const cycle = d.cycles?.cycle_code || '—';
  const reporter = d.staff?.name || '—';
  const resolvedOn = d.resolved_on ? formatToIST(d.resolved_on) : formatToIST(d.reported_on);
  const est = d.estimated_cost != null ? `• ₹${Number(d.estimated_cost).toFixed(2)}` : '';
  const photoBtn = d.photo_url ? `<button class="btn btn-sm btn-outline-secondary btn-view-photo" data-url="${escapeHtml(d.photo_url)}">View</button>` : '';
  const statusBadge = `<span class="badge bg-${badgeColorForStatus(d.status)}">${escapeHtml(d.status)}</span>`;

  return `
    <div class="list-group-item d-flex gap-3 align-items-start">
      <div class="flex-grow-1">
        <div class="d-flex justify-content-between">
          <div>
            <strong>${escapeHtml(cycle)}</strong> ${statusBadge}
            <div class="small text-muted mt-1">${escapeHtml(d.damage_type)} ${est}</div>
            <div class="small text-muted mt-1">${escapeHtml(d.description || '')}</div>
          </div>
          <div class="text-end small text-muted">${resolvedOn}</div>
        </div>
        <div class="mt-2 small">
          ${photoBtn}
        </div>
      </div>
    </div>
  `;
}*/

function historyCardHtml(d) {
  const cycle = d.cycles?.cycle_code || '—';
  const reporter = d.staff?.name || '—';
  const resolvedOn = d.resolved_on ? formatToIST(d.resolved_on) : formatToIST(d.reported_on);
  const est = d.estimated_cost != null ? `• ₹${Number(d.estimated_cost).toFixed(2)}` : '';
  const photoBtn = d.photo_url ? `<button class="btn btn-sm btn-outline-secondary btn-view-photo" data-url="${escapeHtml(d.photo_url)}">View</button>` : '';
  const statusBadge = `<span class="badge bg-${badgeColorForStatus(d.status)}">${escapeHtml(d.status)}</span>`;

  return `
    <div class="list-group-item damage-card">
      <div class="damage-row d-flex justify-content-between">

        <div class="damage-left">
          <strong>${escapeHtml(cycle)}</strong>  ${statusBadge}
          <div class="meta small">${escapeHtml(d.damage_type)} ${est}</div>
          <div class="desc small">${escapeHtml(d.description || '')}</div>
        </div>

        <div class="damage-right small text-muted">
          ${resolvedOn}<br/>By: ${escapeHtml(reporter)}
        </div>

      </div>

      <div class="actions mt-1 small d-flex gap-2 flex-wrap">
        ${photoBtn}
      </div>
    </div>
  `;
}


/* ======================
   Actions: change status / toggle cycle
   ====================== */
async function onChangeDamageStatus(e) {
  const id = e.currentTarget.dataset.id;
  const next = e.currentTarget.dataset.next;
  if (!id || !next) return;
  try {
    const updates = { status: next };
    if (next === 'repaired') updates.resolved_on = new Date().toISOString();
    const { error } = await supabase.from('damages').update(updates).eq('id', id);
    if (error) throw error;
    await refreshAll();
  } catch (err) {
    console.error('onChangeDamageStatus', err);
    alert('Failed to update damage status');
  }
}

async function onToggleCycleMaintenance(e) {
  const cycleId = e.currentTarget.dataset.cycle;
  if (!cycleId) return;
  try {
    const cycle = ALL_CYCLES.find(c => c.id === cycleId);
    if (!cycle) return;
    const newStatus = cycle.status === 'maintenance' ? 'available' : 'maintenance';
    const { error } = await supabase.from('cycles').update({ status: newStatus }).eq('id', cycleId);
    if (error) throw error;
    await loadLookups();
    await refreshAll();
  } catch (err) {
    console.error('onToggleCycleMaintenance', err);
    alert('Failed to toggle cycle status');
  }
}

function onViewPhoto(e) {
  const url = e.currentTarget.dataset.url;
  if (!url) return;
  window.open(url, '_blank');
}

/* ======================
   Edit / Delete damage
   ====================== */
async function onEditDamage(e) {
  const id = e.currentTarget.dataset.id;
  if (!id) return;
  try {
    const { data, error } = await supabase.from('damages').select('*').eq('id', id).single();
    if (error) throw error;

    // If accessory-only (no cycle_id and there is damage_accessories record), disallow full edit: open modal in view-only
    const accessoryLink = await tryFetchDamageAccessory(id);

    // prefill modal fields
    document.getElementById('damageType').value = data.damage_type || '';
    document.getElementById('damageDesc').value = data.description || '';
    document.getElementById('damageCost').value = data.estimated_cost ?? '';
    document.getElementById('damageStatus').value = data.status || 'pending';
    damageCycle.value = data.cycle_id || '';
    damageAccessory.value = accessoryLink?.accessory_id || '';

    // If accessory-only (no cycle_id but accessory exists) then disable cycle input and prevent editing cycle fields
    if (!data.cycle_id && accessoryLink?.accessory_id) {
      damageCycle.disabled = true;
      // mark modal header
      const modalTitle = document.querySelector('#addDamageModal .modal-title');
      modalTitle.textContent = 'Accessory Damage (Edit view)';
      // we still allow change of description/status/cost
    } else {
      damageCycle.disabled = false;
      const modalTitle = document.querySelector('#addDamageModal .modal-title');
      modalTitle.textContent = 'Report Damage';
    }

    // set editing id
    damageForm.dataset.editingId = id;

    // show modal
    const modalEl = document.getElementById('addDamageModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  } catch (err) {
    console.error('onEditDamage', err);
    alert('Failed to load damage for edit');
  }
}
async function tryFetchDamageAccessory(damageId) {
  try {
    const { data, error } = await supabase.from('damage_accessories').select('*').eq('damage_id', damageId).limit(1).maybeSingle();
    if (error) return null;
    return data || null;
  } catch (e) {
    return null;
  }
}

async function onDeleteDamage(e) {
  const id = e.currentTarget.dataset.id;
  if (!id) return;
  if (!confirm('Delete damage record?')) return;
  try {
    const { error } = await supabase.from('damages').delete().eq('id', id);
    if (error) throw error;
    await refreshAll();
  } catch (err) {
    console.error('onDeleteDamage', err);
    alert('Failed to delete damage');
  }
}

/* ======================
   Save damage (create / update)
   ====================== */
async function onSaveDamage(evt) {
  evt.preventDefault();
  saveDamageBtn.disabled = true;
  const editingId = damageForm.dataset.editingId || null;

  const cycleId = damageCycle.value || null;
  const accessoryId = damageAccessory.value || null;
  const damageType = document.getElementById('damageType').value.trim();
  const description = document.getElementById('damageDesc').value.trim();
  const estCostVal = document.getElementById('damageCost').value;
  const estCost = estCostVal ? Number(estCostVal) : null;
  const status = document.getElementById('damageStatus').value || 'pending';
  const fileEl = document.getElementById('damagePhoto');

  if (!damageType) {
    alert('Damage type required');
    saveDamageBtn.disabled = false;
    return;
  }

  try {
    // upload photo (if any)
    let photoPublicUrl = null;
    if (fileEl && fileEl.files && fileEl.files.length) {
      const file = fileEl.files[0];
      const ext = file.name.split('.').pop();
      const fileName = `damage_${Date.now()}.${ext}`;
      const { data: upData, error: upErr } = await supabase.storage.from('images').upload(fileName, file);
      if (upErr && upErr.status !== 409) { // 409 file exists
        console.error('image upload error', upErr);
        throw upErr;
      }
      const { data: pub } = supabase.storage.from('images').getPublicUrl(fileName);
      photoPublicUrl = pub?.publicUrl || null;
    }

    const payload = {
      cycle_id: cycleId,
      rental_id: null,
      reported_by: CURRENT_USER?.id || null,
      damage_type: damageType,
      description: description || null,
      photo_url: photoPublicUrl,
      estimated_cost: estCost,
      status,
      reported_on: new Date().toISOString(),
      remarks: null
    };

    // If link-last-rental was checked and a cycle selected, find last rental
    if (linkLastRentalChk?.checked && cycleId) {
      const lastRental = ALL_RENTALS.find(r => r.cycle_id === cycleId && r.out_time);
      if (lastRental) {
        payload.rental_id = lastRental.id;
      } else {
        // fallback DB fetch
        const { data: last, error: lrErr } = await supabase.from('rentals')
          .select('id, out_time, in_time, status').eq('cycle_id', cycleId).order('out_time', { ascending: false }).limit(1).maybeSingle();
        if (!lrErr && last) payload.rental_id = last.id;
      }
    }

    let resData = null;
    if (editingId) {
      // Update existing
      const { error } = await supabase.from('damages').update(payload).eq('id', editingId);
      if (error) throw error;
      resData = { id: editingId };
      delete damageForm.dataset.editingId;
    } else {
      const { data, error } = await supabase.from('damages').insert([payload]).select().single();
      if (error) throw error;
      resData = data;
    }

    // If accessory chosen, attempt to insert into damage_accessories (if table exists)
    if (accessoryId) {
      try {
        // If editing: upsert by deleting any existing then inserting (simple strategy)
        if (resData && resData.id) {
          // remove existing accessory links (if table exists) then insert new
          try {
            await supabase.from('damage_accessories').delete().eq('damage_id', resData.id);
          } catch (e) { /* ignore */ }
          await supabase.from('damage_accessories').insert([{ damage_id: resData.id, accessory_id: accessoryId }]);
        }
      } catch (e) {
        // ignore if table missing or RLS
        console.warn('damage_accessories insert skipped', e);
      }
    }

    // close modal and refresh
    const modalEl = document.getElementById('addDamageModal');
    const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modal.hide();
    damageForm.reset();
    linkLastRentalChk.checked = false;
    lastRentalPreview.textContent = '';

    // re-enable cycle select (in case edit disabled it)
    damageCycle.disabled = false;
    const modalTitle = document.querySelector('#addDamageModal .modal-title');
    modalTitle.textContent = 'Report Damage';

    await loadLookups();
    await refreshAll();
  } catch (err) {
    console.error('onSaveDamage', err);
    alert('Failed to save damage (see console).');
  } finally {
    saveDamageBtn.disabled = false;
  }
}

/* ======================
   Link last rental preview logic
   ====================== */
async function onLinkLastRentalToggle() {
  if (!linkLastRentalChk.checked) {
    lastRentalPreview.textContent = '';
    return;
  }
  const cycleId = damageCycle.value;
  if (!cycleId) {
    lastRentalPreview.textContent = 'Select a cycle to attach last rental.';
    return;
  }
  // find last rental in memory
  const last = ALL_RENTALS.find(r => r.cycle_id === cycleId && r.out_time);
  if (last) {
    lastRentalPreview.textContent = `${formatToIST(last.out_time)} ${last.in_time ? '→ ' + formatToIST(last.in_time) : '(ongoing)'}`;
    return;
  }
  // fallback to db
  const { data, error } = await supabase.from('rentals').select('id, out_time, in_time, status').eq('cycle_id', cycleId).order('out_time', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    lastRentalPreview.textContent = 'Error fetching last rental';
  } else if (data) {
    lastRentalPreview.textContent = `${formatToIST(data.out_time)} ${data.in_time ? '→ ' + formatToIST(data.in_time) : '(ongoing)'}`;
  } else {
    lastRentalPreview.textContent = 'No previous rentals found for this cycle';
  }
}

/* ======================
   Quick accessory damage
   ====================== */
async function onQuickAccessoryDamage() {
  const accId = quickAccessorySelect.value;
  if (!accId) return alert('Select accessory');
  const acc = ALL_ACCESSORIES.find(a => a.id === accId) || {};
  const confirmMsg = `Report accessory damage for "${acc.name || 'accessory'}"?`;
  if (!confirm(confirmMsg)) return;
  try {
    const payload = {
      cycle_id: null,
      rental_id: null,
      reported_by: CURRENT_USER?.id || null,
      damage_type: 'Accessory damage',
      description: 'Reported via quick action',
      photo_url: null,
      estimated_cost: null,
      status: 'pending',
      reported_on: new Date().toISOString(),
      remarks: null
    };
    const { data, error } = await supabase.from('damages').insert([payload]).select().single();
    if (error) throw error;
    // attach accessory via damage_accessories if possible
    try {
      await supabase.from('damage_accessories').insert([{ damage_id: data.id, accessory_id: accId }]);
    } catch (e) { /* ignore */ }
    await loadLookups();
    await refreshAll();
    alert('Accessory damage reported');
  } catch (err) {
    console.error('onQuickAccessoryDamage', err);
    alert('Failed to report accessory damage');
  }
}

/* ======================
   Apply cycle status quick
   ====================== */
async function onApplyCycleStatus() {
  const cycleId = quickCycleSelect.value;
  const newStatus = quickCycleStatus.value;
  if (!cycleId) return alert('Select a cycle');
  try {
    const { error } = await supabase.from('cycles').update({ status: newStatus }).eq('id', cycleId);
    if (error) throw error;
    await loadLookups();
    await refreshAll();
    alert('Cycle status updated');
  } catch (err) {
    console.error('onApplyCycleStatus', err);
    alert('Failed to update cycle');
  }
}

/* ======================
   Utilities
   ====================== */
function debounce(fn, wait=250){
  let t;
  return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn.apply(this,a), wait); };
}

/* Expose quick functions for console debugging */
window.loadActiveDamages = loadActiveDamages;
window.loadHistoryDamages = loadHistoryDamages;

/* ======================
   Initial load triggers
   ====================== */
(async ()=> {
  try {
    await loadLookups();
    await refreshAll();
  } catch (e) {
    console.error('initial auto-load failed', e);
  }
})();
