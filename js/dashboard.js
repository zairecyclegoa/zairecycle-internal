import { supabase } from './supabaseClient.js';

async function initDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return (window.location.href = 'index.html');

  const role = user.user_metadata?.role || 'staff';
  if (role === 'admin') document.getElementById('add-staff-btn')?.classList.remove('d-none');

  loadDashboardStats();
  loadActiveRentals();
  loadAvailableCycles();
  loadStaffList();
}

// ===== DASHBOARD SUMMARY =====
async function loadDashboardStats() {
  const [cycles, rentals, staff, maintenance] = await Promise.all([
    supabase.from('cycles').select('*', { count: 'exact', head: true }),
    supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('staff').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('maintenance').select('*', { count: 'exact', head: true })
  ]);

  document.getElementById('total-cycles').textContent = cycles.count ?? 0;
  document.getElementById('total-rentals').textContent = rentals.count ?? 0;
  document.getElementById('total-staff').textContent = staff.count ?? 0;
  document.getElementById('total-maintenance').textContent = maintenance.count ?? 0;
}

// ===== HELPER: Duration =====
function getDurationMins(startTime) {
  const diffMs = Date.now() - new Date(startTime).getTime();
  return Math.floor(diffMs / 60000);
}

// ===== ACTIVE RENTALS SECTION =====
async function loadActiveRentals() {
  const { data, error } = await supabase.from('rentals').select(`
    id, out_time, status,
    customers(full_name),
    cycles(cycle_code, location_id, locations(name))
  `).eq('status', 'active');

  const container = document.getElementById('rentals-list');
  if (error || !data?.length) {
    container.innerHTML = '<p class="text-muted">No active rentals.</p>';
    return;
  }

  const cardsHTML = data.map(r => {
    const duration = getDurationMins(r.out_time) - 330;
    const loc = r.cycles?.locations?.name || 'Unknown';
    const customer = r.customers?.full_name || 'N/A';
    return `
      <div class="rental-card border-bottom py-2">
        <div><b>${r.cycles?.cycle_code || 'N/A'}</b> — ${customer}</div>
        <div class="small text-secondary">Kiosk: ${loc}</div>
        <div class="small text-muted">Duration: ${duration} min</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="card-grid">${cardsHTML}</div>
  `;

  // Live refresh timer every 1 minute
  setInterval(loadActiveRentals, 60000);

  // View all navigation
  document.getElementById('viewAllActiveBtn').onclick = () => {
    window.location.href = 'rentalLogs.html';
  };
}

// ===== AVAILABLE CYCLES SECTION =====
async function loadAvailableCycles() {
  const { data, error } = await supabase.from('cycles')
    .select('cycle_code, status, locations(name)')
    .eq('status', 'available');

  const container = document.getElementById('cycles-list');
  if (error || !data?.length) {
    container.innerHTML = '<p class="text-muted">No available cycles.</p>';
    return;
  }

  const cardsHTML = data.map(c => `
    <div class="cycle-card border-bottom py-2">
      <div><b>${c.cycle_code}</b></div>
      <div class="small text-secondary">Kiosk: ${c.locations?.name || 'Unknown'}</div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="card-grid">${cardsHTML}</div>
  `;

  document.getElementById('viewAllAvailableBtn').onclick = () => {
    window.location.href = 'inventory.html';
  };
}

// ===== STAFF SECTION =====
async function loadStaffList() {
  const { data, error } = await supabase.from('staff').select('name, role, phone, is_active');
  const container = document.getElementById('staff-list');
  if (error || !data?.length) {
    container.innerHTML = '<p class="text-muted">No staff found.</p>';
    return;
  }

  container.innerHTML = data.map(s =>
    `<div class="border-bottom py-2 d-flex justify-content-between">
      <span>${s.name} (${s.role})</span>
      <small class="${s.is_active ? 'text-success' : 'text-danger'}">
        ${s.is_active ? 'Active' : 'Inactive'}
      </small>
    </div>`
  ).join('');
}

// ===== LOGOUT =====
document.getElementById('logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

initDashboard();
