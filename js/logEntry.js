// js/logEntry.js
import { supabase } from './supabaseClient.js';
import * as authModule from './auth.js'; // expects ensureAuthenticated or similar export

/* ============
   DOM refs (safe access)
   ============ */
const loadingOverlay = document.getElementById('loadingOverlay');
const tagInfo = document.getElementById('tagInfo');
const userInfo = document.getElementById('userInfo');
const message = document.getElementById('message');

const availableUI = document.getElementById('availableUI');
const inUseUI = document.getElementById('inUseUI');
const summaryUI = document.getElementById('summaryUI');

const cycleDetails = document.getElementById('cycleDetails');
const accList = document.getElementById('accList');
const startRentalBtn = document.getElementById('startRentalBtn');
const endRentalBtn = document.getElementById('endRentalBtn');

const activeDetails = document.getElementById('activeDetails');
const elapsedTimer = document.getElementById('elapsedTimer');
const estimatedCharge = document.getElementById('estimatedCharge');

const summaryContent = document.getElementById('summaryContent');
const markPaidBtn = document.getElementById('markPaidBtn');

/* ============
   State
   ============ */
let CURRENT_CYCLE = null;
let CURRENT_RENTAL = null;
let ACCESSORIES_AVAILABLE = [];
let timerInterval = null;
let currentSession = null;

/* ============
   Helpers: UI + safe DOM usage
   ============ */
function showLoading(on = true) {
  if (!loadingOverlay) return;
  loadingOverlay.style.display = on ? 'flex' : 'none';
}
function hideAllSections() {
  if (availableUI) availableUI.style.display = 'none';
  if (inUseUI) inUseUI.style.display = 'none';
  if (summaryUI) summaryUI.style.display = 'none';
}
function escapeHtml(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function formatMsToMinutesSeconds(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

/* ============
   Robust timestamp parsing & formatting
   - parseTimestampToUTCms: converts many DB timestamp formats into UTC ms
   - formatUTCmsToIST: convert UTC ms -> localized IST string for display
   ============ */

// Parse DB timestamp (string or Date) to UTC milliseconds reliably.
// Handles:
//  - "2025-11-02 06:23:21"        -> treated as UTC (appends 'Z')
//  - "2025-11-02T06:23:21Z"       -> parsed as UTC
//  - "2025-11-02T06:23:21.000Z"   -> parsed as UTC
//  - Date object -> uses getTime()
function parseTimestampToUTCms(value) {
  if (value == null) return NaN;
  if (value instanceof Date) return value.getTime();

  const s = String(value).trim();
  // If string ends with Z or timezone offset (e.g. +05:30), Date.parse handles it
  if (/[zZ]|[+\-]\d{2}(:?\d{2})?$/.test(s)) {
    return Date.parse(s);
  }
  // Otherwise normalize "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SSZ"
  const normalized = s.replace(' ', 'T') + 'Z';
  return Date.parse(normalized);
}

// Format UTC ms into IST display string
function formatUTCmsToIST(utcMs) {
  if (!utcMs && utcMs !== 0) return '';
  const d = new Date(Number(utcMs));
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/* ============
   Pricing logic (slab-based)
   - picks the last slab whose duration_minutes <= elapsedMinutes
   ============ */
async function calculatePriceUsingSlabs(rentalStartIso, accessoriesIds = [], cycleTypeId = null, locationId = null) {
  // --- calculate elapsed time ---
  const startMs = parseTimestampToUTCms(rentalStartIso);
  const nowMs = Date.now();
  const minutes = Math.max(0, Math.ceil((nowMs - startMs) / 60000));

  // --- fetch base pricing row ---
  let perBlock = 0;
  let blockMinutes = 15; // default
  if (cycleTypeId && locationId) {
    const { data: pricingRow, error } = await supabase
      .from('pricing')
      .select('duration_minutes, price')
      .eq('cycle_type_id', cycleTypeId)
      .eq('region_id', locationId)
      .limit(1)
      .maybeSingle();

    if (error) console.warn('pricing fetch error', error);

    if (pricingRow) {
      perBlock = Number(pricingRow.price) || 0;
      blockMinutes = Number(pricingRow.duration_minutes) || 15;
    }
  }

  // --- compute cycle rental ---
  const blocks = Math.ceil(minutes / blockMinutes);
  let amount = blocks * perBlock;

  // --- add accessories total ---
  if (Array.isArray(accessoriesIds) && accessoriesIds.length) {
    const { data: accRows } = await supabase
      .from('accessories')
      .select('id, rental_price')
      .in('id', accessoriesIds);

    const accessoriesTotal = (accRows || []).reduce(
      (sum, a) => sum + (Number(a.rental_price) || 0),
      0
    );

    amount += accessoriesTotal;
  }

  return { amount: Number(amount.toFixed(2)), minutes };
}


/* ============
   Main flow: init + render
   ============ */
window.addEventListener('DOMContentLoaded', async () => {
  showLoading(true);

  // ensure authenticated (works whether ensureAuthenticated is exported or available on authModule)
  const session = await (authModule.ensureAuthenticated?.() ?? null);
  if (!session) {
    // ensureAuthenticated likely redirected to login
    showLoading(false);
    return;
  }
  currentSession = session;
  if (userInfo) userInfo.textContent = session.user.email;

  // clear any initialization text
  if (message) message.innerHTML = '';

  const params = new URLSearchParams(window.location.search);
  const tagID = params.get('tagID') ?? '';
  if (tagInfo) tagInfo.textContent = tagID ? `Tag: ${tagID}` : 'No tag provided';
  if (!tagID) {
    if (message) message.innerHTML = `<div class="text-danger">Invalid request: missing tagID parameter.</div>`;
    showLoading(false);
    return;
  }

  // fetch cycle (with cycle_type and location names)
  const { data: cycle, error: cycErr } = await supabase
    .from('cycles')
    .select('id, cycle_code, rfid_tag_id, status, location_id, cycle_type_id, created_at, locations(name), cycle_types(name, base_rate_per_min)')
    .eq('rfid_tag_id', tagID)
    .maybeSingle();

  if (cycErr || !cycle) {
    if (message) message.innerHTML = `<div class="text-danger">No cycle found for Tag ID: <strong>${escapeHtml(tagID)}</strong></div>`;
    showLoading(false);
    return;
  }

  CURRENT_CYCLE = cycle;
  // load accessories
  const { data: accessories } = await supabase
    .from('accessories')
    .select('id, name, rental_price, availability_status')
    .eq('availability_status', 'available')
    .order('name');
  ACCESSORIES_AVAILABLE = accessories || [];

  // render according to status
  if (cycle.status === 'available') renderAvailableUI();
  else if (cycle.status === 'in_use' || cycle.status === 'rented' || cycle.status === 'active') await renderInUseUI();
  else {
    if (message) message.innerHTML = `<div class="text-secondary">Cycle status: ${escapeHtml(cycle.status)}</div>`;
  }

  showLoading(false);
});

/* ============
   Renderers
   ============ */
function renderAvailableUI() {
  hideAllSections();
  if (!availableUI) return;
  availableUI.style.display = 'block';

  if (cycleDetails) {
    const createdMs = parseTimestampToUTCms(CURRENT_CYCLE.created_at);
    cycleDetails.innerHTML = `
      <div><strong>${escapeHtml(CURRENT_CYCLE.cycle_code)}</strong> (${escapeHtml(CURRENT_CYCLE.cycle_types?.name || '-')})</div>
      <div class="small-muted">Location: ${escapeHtml(CURRENT_CYCLE.locations?.name || '-')}</div>
      <div class="small-muted">Added: ${formatUTCmsToIST(createdMs)}</div>
    `;
  }

  if (!accList) return;
  if (!ACCESSORIES_AVAILABLE.length) {
    accList.innerHTML = `<div class="small-muted">No accessories available</div>`;
  } else {
    accList.innerHTML = ACCESSORIES_AVAILABLE.map(a => `
      <div class="form-check">
        <input class="form-check-input" type="checkbox" value="${a.id}" id="acc-${a.id}" data-price="${a.rental_price}">
        <label class="form-check-label" for="acc-${a.id}">${escapeHtml(a.name)} — ₹${a.rental_price}</label>
      </div>
    `).join('');
  }

  if (startRentalBtn) {
    startRentalBtn.onclick = startRentalHandler;
  }
}

async function renderInUseUI() {
  hideAllSections();
  if (!inUseUI) return;
  inUseUI.style.display = 'block';

  // fetch active rental (status = 'active')
  const { data: rental, error: rentErr } = await supabase
    .from('rentals')
    .select('*, rental_accessories(accessory_id, price_per_unit, quantity, accessories(name, rental_price))')
    .eq('cycle_id', CURRENT_CYCLE.id)
    .eq('status', 'active')
    .order('out_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rentErr || !rental) {
    if (activeDetails) activeDetails.innerHTML = `<div class="text-warning">No active rental found for this cycle.</div>`;
    if (endRentalBtn) endRentalBtn.disabled = true;
    return;
  }

  CURRENT_RENTAL = rental;

  if (activeDetails) {
    const startMs = parseTimestampToUTCms(rental.out_time);
    const startDisplay = formatUTCmsToIST(startMs);
    const accessoryList = rental.rental_accessories?.length
      ? rental.rental_accessories.map(a => `${escapeHtml(a.accessories.name)} (₹${a.accessories.rental_price ?? a.price_per_unit})`).join(', ')
      : '—';

    activeDetails.innerHTML = `
      <div><strong>Start:</strong> ${startDisplay}</div>
      <div><strong>Accessories:</strong> ${accessoryList}</div>
    `;
  }

  // immediate estimate + timer
  const res = await calculatePriceUsingSlabs(rental.out_time, rental.rental_accessories?.map(a => a.accessory_id) || [], CURRENT_CYCLE.cycle_type_id, CURRENT_CYCLE.location_id);
  if (estimatedCharge) estimatedCharge.textContent = Number(res.amount).toFixed(2);

  startElapsedTimer(rental.out_time);

  if (endRentalBtn) {
    endRentalBtn.onclick = async () => {
      await endRentalHandler(rental);
    };
  }
}

/* ============
   Timer
   ============ */
function startElapsedTimer(startIso) {
  if (timerInterval) clearInterval(timerInterval);

  // immediate run
  (async () => {
    await updateElapsedAndEstimate(startIso);
  })();

  timerInterval = setInterval(async () => {
    await updateElapsedAndEstimate(startIso);
  }, 15000);
}

async function updateElapsedAndEstimate(startIso) {
  const startMs = parseTimestampToUTCms(startIso);
  const nowMs = Date.now();
  const diffMs = nowMs - startMs;
  if (elapsedTimer) elapsedTimer.textContent = formatMsToMinutesSeconds(diffMs);

  const accessoryIds = CURRENT_RENTAL?.rental_accessories?.map(a => a.accessory_id) || [];
  const res = await calculatePriceUsingSlabs(startIso, accessoryIds, CURRENT_CYCLE.cycle_type_id, CURRENT_CYCLE.location_id);
  if (estimatedCharge) estimatedCharge.textContent = Number(res.amount).toFixed(2);
}

/* ============
   Handlers: Start / End rental
   ============ */
async function startRentalHandler() {
  const nameEl = document.getElementById('custName');
  const phoneEl = document.getElementById('custPhone');
  const name = nameEl?.value?.trim() || '';
  const phone = phoneEl?.value?.trim() || '';

  if (!name) return alert('Customer name required');

  showLoading(true);
  try {
    // 1. Check if customer exists (by phone)
    let customer_id = null;
    if (phone) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (existing) {
        customer_id = existing.id;
      } else {
        const { data: newCust, error: custErr } = await supabase
          .from('customers')
          .insert([{ full_name: name, phone }])
          .select()
          .single();
        if (custErr) throw custErr;
        customer_id = newCust.id;
      }
    }

    // 2. Selected accessories
    const checked = Array.from(accList.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);

    // 3. Insert rental
    const nowIso = new Date().toISOString();
    const { data: rental, error: insErr } = await supabase
      .from('rentals')
      .insert([
        {
          cycle_id: CURRENT_CYCLE.id,
          customer_id,
          out_time: nowIso,
          status: 'active',
          staff_id: currentSession.user.id,
          location_id: CURRENT_CYCLE.location_id
        }
      ])
      .select()
      .single();

    if (insErr) throw insErr;

    // 4. Accessories link + mark in_use
    if (checked.length) {
      const rows = checked.map(id => ({ rental_id: rental.id, accessory_id: id, quantity: 1}));
      await supabase.from('rental_accessories').insert(rows);
      await supabase.from('accessories').update({ availability_status: 'in_use' }).in('id', checked);
    }

    // 5. Update cycle status
    await supabase.from('cycles').update({ status: 'in_use' }).eq('id', CURRENT_CYCLE.id);

    CURRENT_RENTAL = rental;
    CURRENT_CYCLE.status = 'in_use';
    await renderInUseUI();

    alert('✅ Rental started successfully.');
  } catch (e) {
    console.error('startRentalHandler error', e);
    alert('Error starting rental: ' + (e.message || JSON.stringify(e)));
  } finally {
    showLoading(false);
  }
}


async function endRentalHandler(rental) {
  showLoading(true);
  try {
    const nowIso = new Date().toISOString();
    const { amount, minutes } = await calculatePriceUsingSlabs(
      rental.out_time,
      rental.rental_accessories?.map(a => a.accessory_id) || [],
      CURRENT_CYCLE.cycle_type_id,
      CURRENT_CYCLE.location_id
    );

    // Update base rental
    const { error: rentUpdErr } = await supabase
      .from('rentals')
      .update({
        in_time: nowIso,
        duration_minutes: minutes,
        calculated_amount: amount,
        final_amount: amount,
        status: 'completed'
      })
      .eq('id', rental.id);

    if (rentUpdErr) throw rentUpdErr;

    // Update cycle
    await supabase.from('cycles').update({ status: 'available' }).eq('id', CURRENT_CYCLE.id);

    // Restore accessories
    if (rental.rental_accessories?.length) {
      const accIds = rental.rental_accessories.map(a => a.accessory_id);
      await supabase.from('accessories').update({ availability_status: 'available' }).in('id', accIds);
    }

    // Display Summary Screen
    const startMs = parseTimestampToUTCms(rental.out_time);
    const endMs = parseTimestampToUTCms(nowIso);

    hideAllSections();
    summaryUI.style.display = 'block';

    summaryContent.innerHTML = `
      <div class="summary-block">
        <h5 class="mb-2">Rental Summary</h5>
        <div><strong>Cycle:</strong> ${escapeHtml(CURRENT_CYCLE.cycle_code)}</div>
        <div><strong>Start:</strong> ${formatUTCmsToIST(startMs)}</div>
        <div><strong>End:</strong> ${formatUTCmsToIST(endMs)}</div>
        <div><strong>Duration:</strong> ${minutes} min</div>
        <div id="finalAmountDisplay"><strong>Charge:</strong> ₹${Number(amount).toFixed(2)}</div>

        <div class="mt-3">
          <button id="toggleOverrideBtn" class="btn btn-sm btn-outline-warning mb-2">Override Price</button>
          <div id="overrideSection" style="display:none;">
            <input id="overrideInput" type="number" class="form-control mb-2" placeholder="Enter new ₹ amount">
            <button id="applyOverrideBtn" class="btn btn-warning btn-sm mb-3">Apply Override</button>
          </div>
        </div>

        <div class="mt-2">
          <label><strong>Remarks (optional):</strong></label>
          <textarea id="remarksInput" rows="2" class="form-control mb-3" placeholder="Add internal note..."></textarea>
        </div>

        <div class="mt-3">
          <label><strong>Payment Method:</strong></label>
          <select id="paymentModeSelect" class="form-select mb-3">
            <option value="">Select method</option>
            <option value="Cash">Cash</option>
            <option value="UPI">UPI</option>
            <option value="Card">Card</option>
            <option value="Other">Other</option>
          </select>
          <button id="markPaidBtn" class="btn btn-success w-100">Mark as Paid & Close</button>
        </div>
      </div>
    `;

    // --- UI handlers ---
    const overrideBtn = document.getElementById('toggleOverrideBtn');
    const overrideSection = document.getElementById('overrideSection');
    const applyOverrideBtn = document.getElementById('applyOverrideBtn');
    const overrideInput = document.getElementById('overrideInput');
    const amountDisplay = document.getElementById('finalAmountDisplay');
    const paymentBtn = document.getElementById('markPaidBtn');
    const remarksEl = document.getElementById('remarksInput');
    const modeSelect = document.getElementById('paymentModeSelect');

    // Toggle override visibility
    overrideBtn.onclick = () => {
      overrideSection.style.display = overrideSection.style.display === 'none' ? 'block' : 'none';
    };

    // Apply override
    applyOverrideBtn.onclick = async () => {
      const val = parseFloat(overrideInput.value);
      if (isNaN(val) || val <= 0) return alert('Enter valid amount');
      const { error } = await supabase
        .from('rentals')
        .update({ final_amount: val })
        .eq('id', rental.id);

      if (error) return alert('Failed to override: ' + error.message);
      amountDisplay.innerHTML = `<strong>Charge:</strong> ₹${val.toFixed(2)} <small class="text-warning">(Overridden)</small>`;
      alert('✅ Final amount updated.');
    };

    // Final payment & close
    paymentBtn.onclick = async () => {
      const mode = modeSelect.value;
      if (!mode) return alert('Please select payment mode.');
      const remarks = remarksEl.value.trim();

      const { error } = await supabase
        .from('rentals')
        .update({
          payment_mode: mode,
          remarks,
          status: 'completed'
        })
        .eq('id', rental.id);

      if (error) alert('Payment update failed: ' + error.message);
      else {
        alert('✅ Payment recorded & rental closed.');
        window.location.reload();
      }
    };

  } catch (e) {
    console.error('endRentalHandler error', e);
    alert('Error ending rental: ' + (e.message || JSON.stringify(e)));
  } finally {
    showLoading(false);
  }
}


