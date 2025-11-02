// js/inventory.js
import { supabase } from './supabaseClient.js';

// DOM targets
const cyclesTableBody = document.getElementById('cyclesTableBody');
const cycleTypesTableBody = document.getElementById('cycleTypesTableBody');
const pricingTableBody = document.getElementById('pricingTableBody');
const accessoriesTableBody = document.getElementById('accessoriesTableBody');
const modalsContainer = document.getElementById('modals-container');

let currentUser = null;
let currentStaff = null; // staff row for role lookup
let locationsCache = [];
let cycleTypesCache = [];

// ---------- Initialization ----------
document.addEventListener('DOMContentLoaded', initInventory);

async function initInventory() {
  // get session + user
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return (window.location.href = 'index.html'); // not logged in

  currentUser = session.user;

  // load staff record for role & location
  await loadCurrentStaff();

  // load lookups first
  await loadLocations();
  await loadCycleTypes();

  // reveal admin UI if admin
  //adjustAdminUI();

  // initial data loads
  await Promise.all([
    loadCycles(),
    loadCycleTypesTable(),
    loadPricing(),
    loadAccessories()
  ]);

 await adjustUIForRole();


  // attach logout (if present)
  const logoutBtn = document.getElementById('logout');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // delegate action buttons
  document.addEventListener('click', handleDelegatedClicks);
}

// ---------- Load current staff (role) ----------
async function loadCurrentStaff() {
  // assuming staff.id === auth user id
  const { data, error } = await supabase
    .from('staff')
    .select('id, name, role, location_id, locations(name)')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('Error loading current staff:', error);
    return;
  }
  currentStaff = data;
}

// ---------- Admin UI ----------
function adjustAdminUI() {
  // hide admin-only by default via CSS; reveal if admin
  if (currentStaff?.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => {
      el.classList.remove('admin-only');
      // make sure visible inline-block for buttons
      el.style.display = 'inline-block';
    });
  }
}

// ---------- Lookup loaders ----------
async function loadLocations() {
  const { data, error } = await supabase.from('locations').select('id, name').order('name');
  if (error) {
    console.error('Error loading locations:', error);
    locationsCache = [];
    return;
  }
  locationsCache = data || [];
}

async function loadCycleTypes() {
  const { data, error } = await supabase.from('cycle_types').select('id, name, base_rate_per_min').order('name');
  if (error) {
    console.error('Error loading cycle types:', error);
    cycleTypesCache = [];
    return;
  }
  cycleTypesCache = data || [];
}

// ---------- Render helpers ----------
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

function showAlert(msg, type = 'success') {
  // simple alert using browser alert for now. Replace with toast if desired.
  // type can be 'success' or 'danger'
  if (type === 'danger') console.error(msg);
  else console.log(msg);
  alert(msg);
}

// ---------- Cycles ----------
async function loadCycles() {
  cyclesTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Loading...</td></tr>`;
  const { data, error } = await supabase
    .from('cycles')
    .select(`
      id,
      cycle_code,
      rfid_tag_id,
      status,
      gps_tracker_id,
      locations(name),
      cycle_types(name)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    cyclesTableBody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">Error loading cycles</td></tr>`;
    console.error(error);
    return;
  }

  if (!data?.length) {
    cyclesTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No cycles found.</td></tr>`;
    return;
  }

  cyclesTableBody.innerHTML = data.map(c => `
    <tr>
      <td>${escapeHtml(c.cycle_code)}</td>
      <td>${escapeHtml(c.rfid_tag_id)}</td>
      <td>${c.cycle_types?.name || '-'}</td>
      <td>${escapeHtml(c.status || '-')}</td>
      <td>${c.locations?.name || '-'}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 edit-cycle-btn admin-only" data-id="${c.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger del-cycle-btn admin-only" data-id="${c.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');

}

// ---------- Cycle Types ----------
async function loadCycleTypesTable() {
  cycleTypesTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Loading...</td></tr>`;
  const { data, error } = await supabase.from('cycle_types').select('id, name, base_rate_per_min, description').order('name');

  if (error) {
    cycleTypesTableBody.innerHTML = `<tr><td colspan="4" class="text-danger text-center">Error loading cycle types</td></tr>`;
    console.error(error);
    return;
  }

  if (!data?.length) {
    cycleTypesTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No cycle types found.</td></tr>`;
    return;
  }

  cycleTypesTableBody.innerHTML = data.map(t => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td>${t.base_rate_per_min ?? '-'}</td>
      <td>${escapeHtml(t.description ?? '-')}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 edit-type-btn admin-only" data-id="${t.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger del-type-btn admin-only" data-id="${t.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');

  //if (currentStaff?.role !== 'admin') document.querySelectorAll('.admin-only').forEach(b => b.style.display = 'none');
}

// ---------- Pricing ----------
async function loadPricing() {
  pricingTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Loading...</td></tr>`;
  const { data, error } = await supabase
    .from('pricing')
    .select('id, duration_minutes, price, effective_from, effective_to, locations(name), cycle_types(name)')
    .order('created_at', { ascending: false });

  if (error) {
    pricingTableBody.innerHTML = `<tr><td colspan="7" class="text-danger text-center">Error loading pricing</td></tr>`;
    console.error(error);
    return;
  }

  if (!data?.length) {
    pricingTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No pricing found.</td></tr>`;
    return;
  }

  pricingTableBody.innerHTML = data.map(p => `
    <tr>
      <td>${p.cycle_types?.name || '-'}</td>
      <td>${p.locations?.name || '-'}</td>
      <td>${p.duration_minutes}</td>
      <td>${p.price}</td>
      <td>${formatDate(p.effective_from)}</td>
      <td>${p.effective_to ? formatDate(p.effective_to) : '-'}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 edit-pricing-btn admin-only" data-id="${p.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger del-pricing-btn admin-only" data-id="${p.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');

  //if (currentStaff?.role !== 'admin') document.querySelectorAll('.admin-only').forEach(b => b.style.display = 'none');
}

// ---------- Accessories ----------
async function loadAccessories() {
  accessoriesTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Loading...</td></tr>`;
  const { data, error } = await supabase.from('accessories').select('id, name, description, rental_price, availability_status').order('name');

  if (error) {
    accessoriesTableBody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">Error loading accessories</td></tr>`;
    console.error(error);
    return;
  }

  if (!data?.length) {
    accessoriesTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No accessories found.</td></tr>`;
    return;
  }

  accessoriesTableBody.innerHTML = data.map(a => `
    <tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.description ?? '-')}</td>
      <td>${a.rental_price}</td>
      <td>${escapeHtml(a.availability_status)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 edit-accessory-btn admin-only" data-id="${a.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger del-accessory-btn admin-only" data-id="${a.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');

  //if (currentStaff?.role !== 'admin') document.querySelectorAll('.admin-only').forEach(b => b.style.display = 'none');
}

// ---------- Delegated Click Handling ----------
function handleDelegatedClicks(e) {
  const editCycleBtn = e.target.closest('.edit-cycle-btn');
  const delCycleBtn = e.target.closest('.del-cycle-btn');
  const addCycleBtn = e.target.closest('[data-bs-target="#addCycleModal"]');

  const editTypeBtn = e.target.closest('.edit-type-btn');
  const delTypeBtn = e.target.closest('.del-type-btn');

  const editPricingBtn = e.target.closest('.edit-pricing-btn');
  const delPricingBtn = e.target.closest('.del-pricing-btn');

  const editAccessoryBtn = e.target.closest('.edit-accessory-btn');
  const delAccessoryBtn = e.target.closest('.del-accessory-btn');

  if (editCycleBtn) return openEditCycleModal(editCycleBtn.dataset.id);
  if (delCycleBtn) return deleteCycle(delCycleBtn.dataset.id);

  if (editTypeBtn) return openEditTypeModal(editTypeBtn.dataset.id);
  if (delTypeBtn) return deleteType(delTypeBtn.dataset.id);

  if (editPricingBtn) return openEditPricingModal(editPricingBtn.dataset.id);
  if (delPricingBtn) return deletePricing(delPricingBtn.dataset.id);

  if (editAccessoryBtn) return openEditAccessoryModal(editAccessoryBtn.dataset.id);
  if (delAccessoryBtn) return deleteAccessory(delAccessoryBtn.dataset.id);

  // Add cycle button usage handled by Bootstrap modal attribute; we must ensure the modal markup exists
}

// ---------- Modal helpers ----------
function clearModals() {
  modalsContainer.innerHTML = '';
}

function createModal(html) {
  // append html and return the bootstrap modal instance
  modalsContainer.insertAdjacentHTML('beforeend', html);
  // last child is our modal
  const lastModal = modalsContainer.lastElementChild.querySelector('.modal');
  return new bootstrap.Modal(lastModal);
}

// ---------- Add Cycle Modal ----------
function openAddCycleModal() {
  const modalHtml = `
  <div>
    <div class="modal fade" id="tempAddCycleModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white">
            <h5 class="modal-title">Add Cycle</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="formAddCycle">
              <div class="mb-3"><label class="form-label">Cycle Code</label><input id="cycle_code" class="form-control" required></div>
              <div class="mb-3"><label class="form-label">RFID Tag ID</label><input id="rfid_tag_id" class="form-control" required></div>
              <div class="mb-3">
                <label class="form-label">Cycle Type</label>
                <select id="cycle_type_id" class="form-select" required>
                  <option value="">Select type...</option>
                  ${cycleTypesCache.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Location</label>
                <select id="cycle_location_id" class="form-select" required>
                  <option value="">Select location...</option>
                  ${locationsCache.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3"><label class="form-label">GPS Tracker ID (optional)</label><input id="gps_tracker_id" class="form-control"></div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Add Cycle</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempAddCycleModal');
  modal.show();

  modalEl.querySelector('#formAddCycle').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      cycle_code: modalEl.querySelector('#cycle_code').value.trim(),
      rfid_tag_id: modalEl.querySelector('#rfid_tag_id').value.trim(),
      cycle_type_id: modalEl.querySelector('#cycle_type_id').value || null,
      location_id: modalEl.querySelector('#cycle_location_id').value || null,
      gps_tracker_id: modalEl.querySelector('#gps_tracker_id').value.trim() || null
    };
    // validation
    if (!payload.cycle_code || !payload.rfid_tag_id) return showAlert('Cycle code & RFID required', 'danger');

    const { error } = await supabase.from('cycles').insert([payload]);
    if (error) {
      showAlert('Error adding cycle: ' + error.message, 'danger');
      return;
    }
    modal.hide();
    clearModals();
    await loadCycles();
    showAlert('Cycle added successfully');
    await adjustUIForRole();
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

// ---------- Edit Cycle ----------
async function openEditCycleModal(id) {
  // fetch cycle
  const { data: c, error } = await supabase.from('cycles').select('*').eq('id', id).maybeSingle();
  if (error || !c) return showAlert('Cycle not found', 'danger');

  const modalHtml = `
  <div>
    <div class="modal fade" id="tempEditCycleModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white">
            <h5 class="modal-title">Edit Cycle</h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <form id="formEditCycle">
              <div class="mb-3"><label class="form-label">Cycle Code</label><input id="cycle_code" class="form-control" required value="${escapeHtml(c.cycle_code)}"></div>
              <div class="mb-3"><label class="form-label">RFID Tag ID</label><input id="rfid_tag_id" class="form-control" required value="${escapeHtml(c.rfid_tag_id)}"></div>
              <div class="mb-3">
                <label class="form-label">Cycle Type</label>
                <select id="cycle_type_id" class="form-select">
                  <option value="">Select type...</option>
                  ${cycleTypesCache.map(t => `<option value="${t.id}" ${t.id === c.cycle_type_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Location</label>
                <select id="cycle_location_id" class="form-select">
                  <option value="">Select location...</option>
                  ${locationsCache.map(l => `<option value="${l.id}" ${l.id === c.location_id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3"><label class="form-label">GPS Tracker ID</label><input id="gps_tracker_id" class="form-control" value="${escapeHtml(c.gps_tracker_id || '')}"></div>
              <div class="mb-3">
                <label class="form-label">Status</label>
                <select id="status" class="form-select">
                  <option ${c.status === 'available' ? 'selected' : ''}>available</option>
                  <option ${c.status === 'in_use' ? 'selected' : ''}>in_use</option>
                  <option ${c.status === 'maintenance' ? 'selected' : ''}>maintenance</option>
                  <option ${c.status === 'inactive' ? 'selected' : ''}>inactive</option>
                </select>
              </div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempEditCycleModal');
  modal.show();

  modalEl.querySelector('#formEditCycle').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      cycle_code: modalEl.querySelector('#cycle_code').value.trim(),
      rfid_tag_id: modalEl.querySelector('#rfid_tag_id').value.trim(),
      cycle_type_id: modalEl.querySelector('#cycle_type_id').value || null,
      location_id: modalEl.querySelector('#cycle_location_id').value || null,
      gps_tracker_id: modalEl.querySelector('#gps_tracker_id').value.trim() || null,
      status: modalEl.querySelector('#status').value
    };

    const { error } = await supabase.from('cycles').update(payload).eq('id', id);
    if (error) {
      showAlert('Error updating cycle: ' + error.message, 'danger');
      return;
    }
    modal.hide();
    clearModals();
    await loadCycles();
    showAlert('Cycle updated');
    await adjustUIForRole();
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

// ---------- Delete Cycle ----------
async function deleteCycle(id) {
  if (!confirm('Delete this cycle?')) return;
  const { error } = await supabase.from('cycles').delete().eq('id', id);
  if (error) return showAlert('Error deleting cycle: ' + error.message, 'danger');
  await loadCycles();
  showAlert('Cycle deleted');
  await adjustUIForRole();
}

// ---------- Cycle Types Add/Edit/Delete ----------
function openAddTypeModal() {
  const modalHtml = `
  <div>
    <div class="modal fade" id="tempAddTypeModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white"><h5 class="modal-title">Add Cycle Type</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="formAddType">
              <div class="mb-3"><label class="form-label">Name</label><input id="type_name" class="form-control" required></div>
              <div class="mb-3"><label class="form-label">Base rate per minute</label><input id="type_rate" type="number" step="0.01" class="form-control"></div>
              <div class="mb-3"><label class="form-label">Description</label><textarea id="type_desc" class="form-control"></textarea></div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Add Type</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempAddTypeModal');
  modal.show();

  modalEl.querySelector('#formAddType').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      name: modalEl.querySelector('#type_name').value.trim(),
      base_rate_per_min: modalEl.querySelector('#type_rate').value || null,
      description: modalEl.querySelector('#type_desc').value.trim() || null
    };
    const { error } = await supabase.from('cycle_types').insert([payload]);
    if (error) return showAlert('Error adding type: ' + error.message, 'danger');
    modal.hide();
    clearModals();
    await loadCycleTypes(); // refresh cache
    await loadCycleTypesTable();
    await loadCycles();
    showAlert('Cycle type added');
    await adjustUIForRole();
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

async function openEditTypeModal(id) {
  const { data: t, error } = await supabase.from('cycle_types').select('*').eq('id', id).maybeSingle();
  if (error || !t) return showAlert('Cycle type not found', 'danger');

  const modalHtml = `
  <div>
    <div class="modal fade" id="tempEditTypeModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white"><h5 class="modal-title">Edit Cycle Type</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="formEditType">
              <div class="mb-3"><label class="form-label">Name</label><input id="type_name" class="form-control" required value="${escapeHtml(t.name)}"></div>
              <div class="mb-3"><label class="form-label">Base rate per minute</label><input id="type_rate" type="number" step="0.01" class="form-control" value="${t.base_rate_per_min ?? ''}"></div>
              <div class="mb-3"><label class="form-label">Description</label><textarea id="type_desc" class="form-control">${escapeHtml(t.description ?? '')}</textarea></div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempEditTypeModal');
  modal.show();

  modalEl.querySelector('#formEditType').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      name: modalEl.querySelector('#type_name').value.trim(),
      base_rate_per_min: modalEl.querySelector('#type_rate').value || null,
      description: modalEl.querySelector('#type_desc').value.trim() || null
    };
    const { error } = await supabase.from('cycle_types').update(payload).eq('id', id);
    if (error) return showAlert('Error updating type: ' + error.message, 'danger');
    modal.hide();
    clearModals();
    await loadCycleTypes();
    await loadCycleTypesTable();
    await loadCycles();
    showAlert('Cycle type updated');
    await adjustUIForRole();
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

async function deleteType(id) {
  if (!confirm('Delete this cycle type? This will fail if any cycles/pricing reference it.')) return;
  const { error } = await supabase.from('cycle_types').delete().eq('id', id);
  if (error) return showAlert('Error deleting type: ' + error.message, 'danger');
  await loadCycleTypes();
  await loadCycleTypesTable();
  await loadCycles();
  showAlert('Cycle type deleted');
  await adjustUIForRole();
}

// ---------- Pricing Add/Edit/Delete ----------
function openAddPricingModal() {
  const modalHtml = `
  <div>
    <div class="modal fade" id="tempAddPricingModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white"><h5 class="modal-title">Add Pricing</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="formAddPricing">
              <div class="mb-3">
                <label class="form-label">Cycle Type</label>
                <select id="pricing_cycle_type_id" class="form-select" required>
                  <option value="">Select type...</option>
                  ${cycleTypesCache.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Region</label>
                <select id="pricing_region_id" class="form-select" required>
                  <option value="">Select region...</option>
                  ${locationsCache.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3"><label class="form-label">Duration (minutes)</label><input id="pricing_duration" type="number" class="form-control" required></div>
              <div class="mb-3"><label class="form-label">Price</label><input id="pricing_price" type="number" step="0.01" class="form-control" required></div>
              <div class="mb-3"><label class="form-label">Effective From</label><input id="pricing_from" type="date" class="form-control" required></div>
              <div class="mb-3"><label class="form-label">Effective To (optional)</label><input id="pricing_to" type="date" class="form-control"></div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Add Pricing</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempAddPricingModal');
  modal.show();

  modalEl.querySelector('#formAddPricing').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      cycle_type_id: modalEl.querySelector('#pricing_cycle_type_id').value,
      region_id: modalEl.querySelector('#pricing_region_id').value,
      duration_minutes: parseInt(modalEl.querySelector('#pricing_duration').value, 10),
      price: parseFloat(modalEl.querySelector('#pricing_price').value),
      effective_from: modalEl.querySelector('#pricing_from').value,
      effective_to: modalEl.querySelector('#pricing_to').value || null
    };
    const { error } = await supabase.from('pricing').insert([payload]);
    if (error) return showAlert('Error adding pricing: ' + error.message, 'danger');
    modal.hide();
    clearModals();
    await loadPricing();
    showAlert('Pricing added');
    await adjustUIForRole();
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

async function openEditPricingModal(id) {
  const { data: p, error } = await supabase.from('pricing').select('*').eq('id', id).maybeSingle();
  if (error || !p) return showAlert('Pricing not found', 'danger');

  const modalHtml = `
  <div>
    <div class="modal fade" id="tempEditPricingModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white"><h5 class="modal-title">Edit Pricing</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="formEditPricing">
              <div class="mb-3">
                <label class="form-label">Cycle Type</label>
                <select id="pricing_cycle_type_id" class="form-select" required>
                  <option value="">Select type...</option>
                  ${cycleTypesCache.map(t => `<option value="${t.id}" ${t.id === p.cycle_type_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Region</label>
                <select id="pricing_region_id" class="form-select" required>
                  <option value="">Select region...</option>
                  ${locationsCache.map(l => `<option value="${l.id}" ${l.id === p.region_id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
                </select>
              </div>
              <div class="mb-3"><label class="form-label">Duration (minutes)</label><input id="pricing_duration" type="number" class="form-control" value="${p.duration_minutes}" required></div>
              <div class="mb-3"><label class="form-label">Price</label><input id="pricing_price" type="number" step="0.01" class="form-control" value="${p.price}" required></div>
              <div class="mb-3"><label class="form-label">Effective From</label><input id="pricing_from" type="date" class="form-control" value="${p.effective_from ? p.effective_from : ''}" required></div>
              <div class="mb-3"><label class="form-label">Effective To (optional)</label><input id="pricing_to" type="date" class="form-control" value="${p.effective_to ? p.effective_to : ''}"></div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempEditPricingModal');
  modal.show();

  modalEl.querySelector('#formEditPricing').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      cycle_type_id: modalEl.querySelector('#pricing_cycle_type_id').value,
      region_id: modalEl.querySelector('#pricing_region_id').value,
      duration_minutes: parseInt(modalEl.querySelector('#pricing_duration').value, 10),
      price: parseFloat(modalEl.querySelector('#pricing_price').value),
      effective_from: modalEl.querySelector('#pricing_from').value,
      effective_to: modalEl.querySelector('#pricing_to').value || null
    };
    const { error } = await supabase.from('pricing').update(payload).eq('id', id);
    if (error) return showAlert('Error updating pricing: ' + error.message, 'danger');
    modal.hide();
    clearModals();
    await loadPricing();
    showAlert('Pricing updated');
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

async function deletePricing(id) {
  if (!confirm('Delete this pricing rule?')) return;
  const { error } = await supabase.from('pricing').delete().eq('id', id);
  if (error) return showAlert('Error deleting pricing: ' + error.message, 'danger');
  await loadPricing();
  showAlert('Pricing deleted');
  await adjustUIForRole();
}

// ---------- Accessories Add/Edit/Delete ----------
function openAddAccessoryModal() {
  const modalHtml = `
  <div>
    <div class="modal fade" id="tempAddAccessoryModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white"><h5 class="modal-title">Add Accessory</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="formAddAccessory">
              <div class="mb-3"><label class="form-label">Name</label><input id="acc_name" class="form-control" required></div>
              <div class="mb-3"><label class="form-label">Description</label><textarea id="acc_desc" class="form-control"></textarea></div>
              <div class="mb-3"><label class="form-label">Rental Price</label><input id="acc_price" type="number" step="0.01" class="form-control" required></div>
              <div class="mb-3">
                <label class="form-label">Availability</label>
                <select id="acc_status" class="form-select">
                  <option value="available">available</option>
                  <option value="in_use">in_use</option>
                  <option value="damaged">damaged</option>
                  <option value="lost">lost</option>
                </select>
              </div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Add Accessory</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempAddAccessoryModal');
  modal.show();

  modalEl.querySelector('#formAddAccessory').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      name: modalEl.querySelector('#acc_name').value.trim(),
      description: modalEl.querySelector('#acc_desc').value.trim(),
      rental_price: parseFloat(modalEl.querySelector('#acc_price').value),
      availability_status: modalEl.querySelector('#acc_status').value
    };
    const { error } = await supabase.from('accessories').insert([payload]);
    if (error) return showAlert('Error adding accessory: ' + error.message, 'danger');
    modal.hide();
    clearModals();
    await loadAccessories();
    showAlert('Accessory added');
    await adjustUIForRole();
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

async function openEditAccessoryModal(id) {
  const { data: a, error } = await supabase.from('accessories').select('*').eq('id', id).maybeSingle();
  if (error || !a) return showAlert('Accessory not found', 'danger');

  const modalHtml = `
  <div>
    <div class="modal fade" id="tempEditAccessoryModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header bg-dark text-white"><h5 class="modal-title">Edit Accessory</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <form id="formEditAccessory">
              <div class="mb-3"><label class="form-label">Name</label><input id="acc_name" class="form-control" required value="${escapeHtml(a.name)}"></div>
              <div class="mb-3"><label class="form-label">Description</label><textarea id="acc_desc" class="form-control">${escapeHtml(a.description ?? '')}</textarea></div>
              <div class="mb-3"><label class="form-label">Rental Price</label><input id="acc_price" type="number" step="0.01" class="form-control" value="${a.rental_price}"></div>
              <div class="mb-3">
                <label class="form-label">Availability</label>
                <select id="acc_status" class="form-select">
                  <option value="available" ${a.availability_status === 'available' ? 'selected' : ''}>available</option>
                  <option value="in_use" ${a.availability_status === 'in_use' ? 'selected' : ''}>in_use</option>
                  <option value="damaged" ${a.availability_status === 'damaged' ? 'selected' : ''}>damaged</option>
                  <option value="lost" ${a.availability_status === 'lost' ? 'selected' : ''}>lost</option>
                </select>
              </div>
              <div class="d-flex justify-content-end">
                <button type="button" class="btn btn-secondary me-2" data-bs-dismiss="modal">Cancel</button>
                <button type="submit" class="btn btn-success">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
  const modal = createModal(modalHtml);
  const modalEl = document.getElementById('tempEditAccessoryModal');
  modal.show();

  modalEl.querySelector('#formEditAccessory').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      name: modalEl.querySelector('#acc_name').value.trim(),
      description: modalEl.querySelector('#acc_desc').value.trim(),
      rental_price: parseFloat(modalEl.querySelector('#acc_price').value),
      availability_status: modalEl.querySelector('#acc_status').value
    };
    const { error } = await supabase.from('accessories').update(payload).eq('id', id);
    if (error) return showAlert('Error updating accessory: ' + error.message, 'danger');
    modal.hide();
    clearModals();
    await loadAccessories();
    showAlert('Accessory updated');
  });

  modalEl.addEventListener('hidden.bs.modal', () => clearModals());
}

async function deleteAccessory(id) {
  if (!confirm('Delete this accessory?')) return;
  const { error } = await supabase.from('accessories').delete().eq('id', id);
  if (error) return showAlert('Error deleting accessory: ' + error.message, 'danger');
  await loadAccessories();
  showAlert('Accessory deleted');
  await adjustUIForRole();
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



// ---------- Util ----------
function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ---------- Wire up static "Add" modal triggers (because HTML uses data-bs-target) ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-bs-target="#addCycleModal"]') || e.target.closest('[data-bs-target="#addCycleModal"] *')) {
    // open our dynamic add cycle modal
    e.preventDefault();
    openAddCycleModal();
  }
  if (e.target.closest('[data-bs-target="#addTypeModal"]') || e.target.closest('[data-bs-target="#addTypeModal"] *')) {
    e.preventDefault();
    openAddTypeModal();
  }
  if (e.target.closest('[data-bs-target="#addPricingModal"]') || e.target.closest('[data-bs-target="#addPricingModal"] *')) {
    e.preventDefault();
    openAddPricingModal();
  }
  if (e.target.closest('[data-bs-target="#addAccessoryModal"]') || e.target.closest('[data-bs-target="#addAccessoryModal"] *')) {
    e.preventDefault();
    openAddAccessoryModal();
  }
});

// Exported helper if needed elsewhere
export {
  loadCycles,
  loadCycleTypes,
  loadAccessories,
  loadPricing,
  loadLocations
};

a//djustUIForRole();