import { supabase } from './supabaseClient.js';


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