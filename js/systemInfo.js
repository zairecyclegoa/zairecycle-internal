import { supabase } from "./supabaseClient.js";

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  const token = session.access_token;

  const dbSize = document.getElementById("db-size");
  const storageUsed = document.getElementById("storage-used");
  const apiCalls = document.getElementById("api-calls");
  const usageLog = document.getElementById("usage-log");

  try {
    const res = await fetch(
      "https://kzoeygxxyqwxlmhncggv.supabase.co/functions/v1/get-usage",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    // Extract values
    const dbVal = data.dbSize || 0;
    const storageVal = data.storageUsed || 0;
    const apiVal = data.apiCalls || 0;

    // Update Cards
    dbSize.textContent = dbVal.toFixed(2);
    storageUsed.textContent = storageVal.toFixed(2);
    apiCalls.textContent = apiVal;
    usageLog.textContent = JSON.stringify(data.details || {}, null, 2);

    // Chart 1: Database usage (Free tier 500MB)
    const dbCtx = document.getElementById("dbChart");
    new Chart(dbCtx, {
      type: "doughnut",
      data: {
        labels: ["Used", "Free"],
        datasets: [
          {
            data: [dbVal, Math.max(500 - dbVal, 0)],
            backgroundColor: ["#28a745", "#e0e0e0"],
          },
        ],
      },
      options: {
        responsive: true,
        cutout: "70%",
        plugins: { legend: { position: "bottom" } },
      },
    });

    // Chart 2: File storage usage (Free tier 1GB ≈ 1024MB)
    const storageCtx = document.getElementById("storageChart");
    new Chart(storageCtx, {
      type: "doughnut",
      data: {
        labels: ["Used", "Free"],
        datasets: [
          {
            data: [storageVal, Math.max(1024 - storageVal, 0)],
            backgroundColor: ["#0d6efd", "#e0e0e0"],
          },
        ],
      },
      options: {
        responsive: true,
        cutout: "70%",
        plugins: { legend: { position: "bottom" } },
      },
    });
  } catch (err) {
    console.error("Error loading usage:", err);
    usageLog.textContent = "Error loading system info.";
  }
});
