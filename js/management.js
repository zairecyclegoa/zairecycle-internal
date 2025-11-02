import { supabase } from './supabaseClient.js';

const staffTableBody = document.getElementById('staffTableBody');
const addStaffForm = document.getElementById('addStaffForm');
const changePasswordForm = document.getElementById('changePasswordForm');

// ===== INIT =====
async function initManagement() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return (window.location.href = 'index.html');

  loadProfile(user.id);
  loadStaffList();
}

// ===== LOAD PROFILE =====
async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('staff')
    .select(`name, phone, role, location_id, locations(name)`)
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    console.error('Error fetching profile:', error);
    document.getElementById('displayName').textContent = 'Not found';
    return;
  }

  document.getElementById('displayName').textContent = data.name;
  document.getElementById('displayRole').textContent = data.role || '-';
  document.getElementById('displayPhone').textContent = data.phone || '-';
  document.getElementById('displayLocation').textContent = data.locations?.name || '-';

}

// ===== CHANGE PASSWORD =====
changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const currentPassword = document.getElementById('currentPassword').value.trim();
  const newPassword = document.getElementById('newPassword').value.trim();

  if (!currentPassword || !newPassword)
    return alert('Please fill in both fields.');

  // Step 1: Reauthenticate user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.email) return alert('Authentication error, please log in again.');

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (signInError) {
    alert('Current password is incorrect.');
    return;
  }

  // Step 2: Update password
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) return alert('Error updating password: ' + updateError.message);

  alert('Password updated successfully. You will be logged out now.');

  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

// ===== LOAD STAFF LIST =====
async function loadStaffList() {
  const { data, error } = await supabase.from('staff').select('id, name, role, is_active');
  if (error || !data?.length) {
    staffTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No staff found.</td></tr>';
    return;
  }

  staffTableBody.innerHTML = data.map(staff => `
    <tr>
      <td>${staff.name}</td>
      <td>${staff.role}</td>
      <td>${staff.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>'}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger admin-only" onclick="deleteStaff('${staff.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function loadLocations() {
  const { data, error } = await supabase.from('locations').select('id, name');
  if (error) {
    console.error('Error fetching locations:', error);
    return;
  }

  const locationSelect = document.getElementById('staffLocation');
  locationSelect.innerHTML = '<option value="">Select location...</option>';
  data.forEach(loc => {
    const option = document.createElement('option');
    option.value = loc.id;
    option.textContent = loc.name;
    locationSelect.appendChild(option);
  });
}


// ===== ADD STAFF =====
// client-side: management.js add staff handler (quick workaround)
addStaffForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('staffName').value.trim();
  const role = document.getElementById('staffRole').value.trim();
  const phone = document.getElementById('staffPhone').value.trim();
  const password = document.getElementById('staffPassword').value.trim();
  const location_id = document.getElementById('staffLocation').value;

  if (!name || !phone || !password || !location_id) {
    return alert('Please fill all fields.');
  }

  // 0) Save current admin session tokens
  const { data: curSessionData } = await supabase.auth.getSession();
  const adminSession = curSessionData.session;
  const adminAccess = adminSession?.access_token;
  const adminRefresh = adminSession?.refresh_token;

  try {
    // 1) Create new user (switches session)
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: `${phone}@zairecycle.com`,
      password
    });
    if (signUpError) throw signUpError;
    const newUser = signUpData.user;
    if (!newUser) throw new Error('No new user id returned');

    // 2) Insert into staff table
    const { error: insertErr } = await supabase.from('staff').insert([{
      id: newUser.id,
      name,
      role,
      phone,
      location_id,
      is_active: true
    }]);
    if (insertErr) throw insertErr;

    // 3) Restore admin session
    if (adminAccess && adminRefresh) {
      const { error: setError } = await supabase.auth.setSession({
        access_token: adminAccess,
        refresh_token: adminRefresh
      });
      if (setError) throw setError;
    }

    // 4) Success UI feedback
    alert(`Staff ${name} created successfully!`);

    // 5) Close modal and reset form
    addStaffForm.reset();
    bootstrap.Modal.getInstance(document.getElementById('addStaffModal')).hide();

    // 6) Refresh the page (wait a bit to avoid UI flicker)
    setTimeout(() => {
      location.reload();
    }, 500);

  } catch (err) {
    console.error('Error creating staff:', err);
    alert('Error creating staff: ' + (err.message || JSON.stringify(err)));

    // Try restoring admin session even on error
    if (adminAccess && adminRefresh) {
      await supabase.auth.setSession({ access_token: adminAccess, refresh_token: adminRefresh });
    }
  }
});



// ===== DELETE STAFF =====
window.deleteStaff = async (id) => {
  if (!confirm('Delete this staff member?')) return;
  await supabase.from('staff').delete().eq('id', id);
  loadStaffList();
  location.reload();
};

// ===== LOGOUT =====
document.getElementById('logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
});

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



await initManagement();
await loadLocations();
await adjustUIForRole();