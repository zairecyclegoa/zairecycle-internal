// js/rentalLogs.js
import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
  initRentalLogs();
});

async function initRentalLogs() {
  try {
    await loadRentals();
    // Wire logout (if present)
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = 'index.html'; });
  } catch (err) {
    console.error('initRentalLogs error', err);
  }
}

async function loadRentals() {
  // Clear placeholders
  document.getElementById('active-rentals').innerHTML = '<div class="text-muted">Loading active rentals...</div>';
  ['past-today', 'past-week', 'past-month', 'past-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = 'Loading...';
  });

  // Fetch rentals joining customers and cycles -> cycles -> locations
  // Note: adapt field names if your foreign field names differ
  const { data: rentals, error } = await supabase
    .from('rentals')
    .select(`
      id,
      out_time,
      in_time,
      duration_minutes,
      calculated_amount,
      final_amount,
      status,
      payment_mode,
      remarks,
      created_at,
      customers ( id, full_name, phone ),
      cycles ( id, cycle_code, rfid_tag_id, location_id, locations ( id, name ) )
    `)
    .order('out_time', { ascending: false });

  if (error) {
    console.error('Error fetching rentals:', error);
    document.getElementById('active-rentals').innerHTML = '<div class="text-danger">Failed to load rentals. Check console.</div>';
    ['past-today', 'past-week', 'past-month', 'past-year'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="text-danger">Failed to load rentals.</div>';
    });
    return;
  }

  // Normalize array
  const rows = rentals || [];

  // Active rentals = status === 'active'
  const active = rows.filter(r => ['active', 'ended'].includes(r.status));

  // Past rentals = not active (completed/cancelled etc) AND have in_time
  const past = rows.filter(r => r.status !== 'active' && r.in_time);

  renderActive(active);
  renderPastGrouped(past);
}

/**
 * computeDurationMinutes
 * - startIso/inIso are DB timestamp strings (or Date). Returns integer minutes between them.
 * - If endIso is null, compares with "now".
 */
function computeDurationMinutes(startIso, endIso = null) {
  try {
    const startDate = parseDbTimestampToDate(startIso);
    const endDate = endIso ? parseDbTimestampToDate(endIso) : new Date();
    if (!startDate || isNaN(startDate.getTime())) return 0;
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    return Math.floor(diffMs / 60000);
  } catch (e) {
    console.error('computeDurationMinutes error', e);
    return 0;
  }
}

/**
 * parseDbTimestampToDate
 * - Handles common Supabase/Postgres timestamp formats:
 *   - "2025-11-02T10:02:33Z"  => parsed as UTC (OK)
 *   - "2025-11-02 10:02:33"  => treated as UTC by appending "Z"
 *   - "2025-11-02T10:02:33+05:30" => parsed with offset
 *
 * Returns a JS Date object representing the correct instant.
 */
function parseDbTimestampToDate(ts) {
  if (!ts) return null;
  // Already includes timezone info (Z or + or -)
  if (/[zZ]|[+\-]\d{2}:\d{2}$/.test(ts)) {
    return new Date(ts);
  }
  // If format contains space "YYYY-MM-DD HH:mm:ss" -> convert to ISO and treat as UTC
  // (Common with 'timestamp without time zone' values returned by some servers)
  const isoLike = ts.replace(' ', 'T');
  // Append Z to force treat as UTC instant
  return new Date(isoLike + 'Z');
}

/**
 * formatToIST
 * - Format Date/ISO string into human readable IST locale string.
 */
function formatToIST(ts) {
  if (!ts) return '—';
  const d = (ts instanceof Date) ? ts : parseDbTimestampToDate(ts);
  if (!d || isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * humanDurationFromMinutes -> "1h 23m" or "23m"
 */
function humanDurationFromMinutes(m) {
  const mins = Math.max(0, Math.floor(m || 0));
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function formatLocal(dateIso) {
  if (!dateIso) return '—';
  try {
    return new Date(dateIso).toLocaleString('en-IN');
  } catch {
    return dateIso;
  }
}

function renderActive(active) {
  const container = document.getElementById('active-rentals');
  container.innerHTML = '';

  if (!active.length) {
    container.innerHTML = '<div class="text-muted">No active rentals.</div>';
    return;
  }

  active.forEach(r => {
    const cycleCode = r.cycles?.cycle_code || r.cycles?.rfid_tag_id || 'Unknown';
    const rfidTag = r.cycles?.rfid_tag_id || cycleCode;
    const customerName = r.customers?.full_name || 'N/A';
    const customerPhone = r.customers?.phone || '';
    const kiosk = r.cycles?.locations?.name || 'Unknown';

    const minutes = computeDurationMinutes(r.out_time, null);
    const duration = humanDurationFromMinutes(minutes);

    const wrapper = document.createElement('div');
    wrapper.className = 'border-bottom py-2';

    wrapper.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div><strong>${escapeHtml(cycleCode)}</strong> — ${escapeHtml(customerName)}</div>
          <div class="small text-secondary">Kiosk: ${escapeHtml(kiosk)}</div>
          <div class="small text-muted">Started: ${escapeHtml(formatToIST(r.out_time))} • Duration: ${duration}</div>
          ${customerPhone ? `<div class="small"><a href="tel:${encodeURIComponent(customerPhone)}">${escapeHtml(customerPhone)}</a></div>` : ''}
        </div>
        <div class="ms-3">
          <button class="btn btn-sm btn-outline-success view-rental-btn" data-tag="${escapeHtml(rfidTag)}">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </div>
      </div>
    `;
    container.appendChild(wrapper);
  });

  // Attach handlers robustly using currentTarget (works when clicking icon inside button)
  container.querySelectorAll('.view-rental-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tag = e.currentTarget.dataset.tag; // use currentTarget to avoid icon->target issues
      if (!tag) return alert('Missing RFID tag for this rental.');
      window.location.href = `logEntry?tagID=${encodeURIComponent(tag)}`;
    });
  });
}


function renderPastGrouped(past) {
  const now = new Date();

  // Create Date objects at midnight *in IST*
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayStartIST = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());
  const weekStartIST = new Date(todayStartIST);
  // Set to Monday start (or Sunday if you prefer)
  weekStartIST.setDate(todayStartIST.getDate() - todayStartIST.getDay());
  const monthStartIST = new Date(nowIST.getFullYear(), nowIST.getMonth(), 1);
  const yearStartIST = new Date(nowIST.getFullYear(), 0, 1);

  const groups = { today: [], week: [], month: [], year: [] };

  past.forEach(r => {
    const start = parseDbTimestampToDate(r.out_time);
    if (!start) return;

    // Convert rental start to IST clock time for comparison
    const startIST = new Date(start.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    if (startIST >= todayStartIST) groups.today.push(r);
    if (startIST >= weekStartIST) groups.week.push(r);
    if (startIST >= monthStartIST) groups.month.push(r);
    if (startIST >= yearStartIST) groups.year.push(r);
  });

  renderPastList(groups.today, 'past-today');
  renderPastList(groups.week, 'past-week');
  renderPastList(groups.month, 'past-month');
  renderPastList(groups.year, 'past-year');
}



function renderPastList(list, elementId) {
  const container = document.getElementById(elementId);
  if (!container) return;

  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div class="text-muted">No rentals found.</div>';
    return;
  }

  list.forEach(r => {
    const cycleCode = r.cycles?.cycle_code || r.cycles?.rfid_tag_id || 'Unknown';
    const customerName = r.customers?.full_name || 'N/A';
    const customerPhone = r.customers?.phone || '';
    const kiosk = r.cycles?.locations?.name || 'Unknown';
    const durationMins = computeDurationMinutes(r.out_time, r.in_time);
    const duration = humanDurationFromMinutes(durationMins);
    const amount = (r.final_amount ?? r.calculated_amount ?? 0);

    const div = document.createElement('div');
    div.className = 'border-bottom py-2';

    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div><strong>${escapeHtml(cycleCode)}</strong> — ${escapeHtml(customerName)}</div>
          <div class="small text-secondary">Kiosk: ${escapeHtml(kiosk)}</div>
          <div class="small text-muted">${escapeHtml(formatToIST(r.out_time))} → ${escapeHtml(formatToIST(r.in_time))}</div>
          <div class="small">Duration: ${duration} • ₹${Number(amount).toFixed(2)} • ${escapeHtml(r.payment_mode || 'N/A')}</div>
          ${r.remarks ? `<div class="small text-muted">Note: ${escapeHtml(r.remarks)}</div>` : ''}
          ${customerPhone ? `<div class="small"><a href="tel:${encodeURIComponent(customerPhone)}">${escapeHtml(customerPhone)}</a></div>` : ''}
        </div>
        <div class="ms-3">
          <span class="badge bg-${r.payment_mode ? 'success' : 'secondary'}">${escapeHtml(r.status || '')}</span>
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

// simple html escape to avoid injection when rendering from DB
function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function adjustUIForRole() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "login.html";
      return;
    }

    const userId = session.user.id;

    // Fetch the role of logged-in user
    const { data: userProfile, error } = await supabase
      .from('staff')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !userProfile) {
      console.error("Error fetching role:", error);
      return;
    }

    const role = userProfile.role;

    // If admin, show admin-only buttons
    if (role === "admin") {
      document.querySelectorAll(".admin-only").forEach(btn => {
        btn.classList.remove("admin-only"); // remove class to restore display
        btn.style.display = "inline-block"; // ensure visible
      });
    }
  } catch (err) {
    console.error("Error adjusting UI for role:", err.message);
  }
}

adjustUIForRole();