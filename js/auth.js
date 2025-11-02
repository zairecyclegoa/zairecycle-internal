// js/auth.js
import { supabase } from './supabaseClient.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('error-message');
const REDIRECT_KEY = 'zairecycle_redirect_after_login';

// --- Helper: read redirect param and save to localStorage (survives reloads) ---
function captureRedirectParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const redirectParam = params.get('redirect');
    if (!redirectParam) return null;
    // decode twice safe
    let decoded;
    try {
      decoded = decodeURIComponent(decodeURIComponent(redirectParam));
    } catch {
      decoded = decodeURIComponent(redirectParam);
    }
    // Save final decoded path (absolute or relative)
    localStorage.setItem(REDIRECT_KEY, decoded);
    console.log('auth.js: saved redirect ->', decoded);
    return decoded;
  } catch (e) {
    console.warn('auth.js: captureRedirectParam error', e);
    return null;
  }
}

// call on load to capture redirect if present
captureRedirectParam();

// --- Exported helper: ensure authenticated; if not, redirect to login and remember current URL ---
export async function ensureAuthenticated(allowedRoles = []) {
  // Ask supabase for session
  const { data } = await supabase.auth.getSession();
  const session = data?.session ?? null;

  if (!session) {
    // Save the current URL to localStorage so login can return here
    const current = window.location.pathname + window.location.search;
    localStorage.setItem(REDIRECT_KEY, current);
    // Redirect to login (index.html) with redirect query for visibility
    window.location.href = `index.html?redirect=${encodeURIComponent(current)}`;
    return null;
  }

  // role check
  const role = session.user.user_metadata?.role || 'staff';
  if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    document.body.innerHTML = `
      <div class="d-flex align-items-center justify-content-center vh-100">
        <div class="text-center">
          <h3 class="text-danger">Access Denied</h3>
          <p class="text-muted">You are signed in but you don't have permission to use this page.</p>
        </div>
      </div>
    `;
    return null;
  }

  return session;
}

// --- Login form handling (index.html) ---
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!email || !password) {
      errorBox.textContent = 'Email and password required';
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      errorBox.textContent = error.message;
      return;
    }

    // on successful login, redirect back to saved redirect or dashboard
    const saved = localStorage.getItem(REDIRECT_KEY);
    if (saved) {
      console.log('auth.js: redirecting to saved:', saved);
      localStorage.removeItem(REDIRECT_KEY);
      // Use assign to ensure value is applied
      window.location.href = saved;
    } else {
      window.location.href = 'dashboard.html';
    }
  });

  // If user opens login page but already has a session, auto-redirect
  (async () => {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      const saved = localStorage.getItem(REDIRECT_KEY);
      if (saved) {
        localStorage.removeItem(REDIRECT_KEY);
        window.location.href = saved;
      } else {
        window.location.href = 'dashboard.html';
      }
    }
  })();
}
