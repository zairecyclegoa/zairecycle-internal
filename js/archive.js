// js/archive.js
import { supabase } from "./supabaseClient.js";

/*
  Notes:
  - Robust timestamp parsing: parseDbTimestampToDate() handles "YYYY-MM-DD HH:MM:SS",
    ISO with timezone, and plain ISO. Then formatToIST() shows localised IST string.
  - rental_accessories are fetched and displayed (requires that rental_accessories
    relationship exists and is selectable).
  - Doughnut chart is constrained with aspectRatio and container CSS to appear smaller.
*/

// ------------------ DOM Ready ------------------
document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("rental-history");
  const totalRevenueEl = document.getElementById("total-revenue");
  const totalRentalsEl = document.getElementById("total-rentals");
  const uniqueCustomersEl = document.getElementById("unique-customers");
  const avgDurationEl = document.getElementById("avg-duration");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const exportXlsxBtn = document.getElementById("exportXlsxBtn");
  const refreshBtn = document.getElementById("refresh-archive");

  try {
    await loadAndRenderAll();

    // refresh handler
    refreshBtn?.addEventListener("click", async () => {
      await loadAndRenderAll();
    });

    // export handlers are set inside loadAndRenderAll to use the latest dataset
  } catch (err) {
    console.error("Archive bootstrap error:", err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center">Failed to load data</td></tr>`;
  }

  async function loadAndRenderAll() {
    // set temporary loading state
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-muted text-center">Loading...</td></tr>`;

    // --- Fetch rentals with relational data incl accessories ---
    const { data: rentals, error } = await supabase
      .from("rentals")
      .select(`
        id,
        out_time,
        in_time,
        final_amount,
        calculated_amount,
        payment_mode,
        remarks,
        status,
        customers ( id, full_name, phone ),
        cycles ( cycle_code, rfid_tag_id, locations ( name ) ),
        rental_accessories (
          id,
          accessory_id,
          quantity,
          total_price,
          accessories ( id, name, rental_price )
        )
      `)
      .order("out_time", { ascending: false });

    if (error) throw error;
    if (!rentals || rentals.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-muted text-center">No rentals found.</td></tr>`;
      // clear metrics
      totalRevenueEl && (totalRevenueEl.textContent = "₹0");
      totalRentalsEl && (totalRentalsEl.textContent = "0");
      uniqueCustomersEl && (uniqueCustomersEl.textContent = "0");
      avgDurationEl && (avgDurationEl.textContent = "0m");
      return;
    }

    // Only consider completed rentals for archive stats (has in_time)
    const completed = rentals.filter(r => r.in_time);

    // ---- SUMMARY STATS ----
    const totalRevenue = completed.reduce((s, r) => s + parseFloat(r.final_amount ?? r.calculated_amount ?? 0), 0);
    const totalRentals = completed.length;
    const uniqueCustomers = new Set(completed.map(r => r.customers?.id ?? (r.customers?.phone || r.customers?.full_name))).size;
    const avgDurationMins = completed.reduce((s, r) => s + computeDurationMinutes(r.out_time, r.in_time), 0) / (completed.length || 1);

    totalRevenueEl && (totalRevenueEl.textContent = `₹${totalRevenue.toFixed(2)}`);
    totalRentalsEl && (totalRentalsEl.textContent = totalRentals);
    uniqueCustomersEl && (uniqueCustomersEl.textContent = uniqueCustomers);
    avgDurationEl && (avgDurationEl.textContent = humanDurationFromMinutes(avgDurationMins));

    // ---- RENDER TABLE ----
    if (tbody) {
      tbody.innerHTML = completed
        .map(r => {
          const cycle = r.cycles?.cycle_code || r.cycles?.rfid_tag_id || "Unknown";
          const cust = r.customers?.full_name || "N/A";
          const kiosk = r.cycles?.locations?.name || "Unknown";
          const dur = humanDurationFromMinutes(computeDurationMinutes(r.out_time, r.in_time));
          const amt = (r.final_amount || r.calculated_amount || 0).toFixed(2);

          // accessories: show as small inline list
          const accessoriesList = (r.rental_accessories || []).map(a => {
            const name = a?.accessories?.name || "Accessory";
            const qty = a?.quantity ?? 1;
            const price = a?.total_price ?? a?.accessories?.rental_price ?? "";
            return `${escapeHtml(name)}${qty > 1 ? ` x${qty}` : ""}${price ? ` (₹${price})` : ""}`;
          }).join(" • ");

          const accessoriesHtml = accessoriesList ? `<div class="small text-muted">Accessories: ${accessoriesList}</div>` : "";

          return `
            <tr>
              <td>${escapeHtml(formatToIST(r.out_time))}</td>
              <td>${escapeHtml(cycle)}</td>
              <td>${escapeHtml(cust)}${r.customers?.phone ? ` <div class="small"><a href="tel:${encodeURIComponent(r.customers.phone)}">${escapeHtml(r.customers.phone)}</a></div>` : ""}${accessoriesHtml}</td>
              <td>${escapeHtml(kiosk)}</td>
              <td>${dur}</td>
              <td>₹${amt}</td>
              <td>${escapeHtml(r.payment_mode || "N/A")}</td>
            </tr>
          `;
        })
        .join("");
    }

    // ---- CHARTS & TOP CUSTOMERS ----
    renderCharts(completed);
    renderTopCustomers(completed);

    // ---- EXPORTS ----
    document.getElementById("exportCsvBtn")?.removeEventListener?.("click", dummy);
    document.getElementById("exportXlsxBtn")?.removeEventListener?.("click", dummy);
    document.getElementById("exportCsvBtn")?.addEventListener("click", () => exportToCSV(completed));
    document.getElementById("exportXlsxBtn")?.addEventListener("click", () => exportToXLSX(completed));
  }
});

// dummy for safe removeEventListener
function dummy() { }

// ------------------ Utilities ------------------

/** 
 * parseDbTimestampToDate:
 *  - If timestamp has timezone (Z or +HH:mm) rely on Date.
 *  - If not (eg "2025-11-02 10:02:33") treat as UTC by appending 'Z' (server stored as UTC)
 *  - Returns a Date object (UTC instant)
 */
function parseDbTimestampToDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  // string check
  if (/[zZ]$/.test(ts) || /[+\-]\d{2}:\d{2}$/.test(ts)) {
    return new Date(ts);
  }
  // if contains space between date/time, convert to ISO-like and append Z to treat as UTC
  const iso = ts.replace(" ", "T");
  return new Date(iso + "Z");
}

function formatToIST(ts) {
  if (!ts) return "";
  const d = parseDbTimestampToDate(ts);
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function computeDurationMinutes(out, inn) {
  const s = parseDbTimestampToDate(out);
  const e = parseDbTimestampToDate(inn);
  if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
  return Math.max(0, Math.round((e - s) / 60000));
}

function humanDurationFromMinutes(mins) {
  const m = Math.max(0, Math.floor(mins || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ------------------ Charts ------------------
let revenueChartInstance = null;
let rentalChartInstance = null;
let repeatChartInstance = null;

function renderCharts(rentals) {
  // Monthly revenue (group by Month-Year)
  const months = {};
  rentals.forEach(r => {
    const d = parseDbTimestampToDate(r.in_time);
    const key = d.toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    months[key] = (months[key] || 0) + parseFloat(r.final_amount ?? r.calculated_amount ?? 0);
  });

  const monthLabels = Object.keys(months).reverse();
  const monthValues = monthLabels.map(l => months[l]);

  // Revenue chart
  const ctx1 = document.getElementById("revenueChart").getContext("2d");
  if (revenueChartInstance) revenueChartInstance.destroy();
  revenueChartInstance = new Chart(ctx1, {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{ label: "Revenue (₹)", data: monthValues, backgroundColor: "rgba(25,135,84,0.8)" }]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
  });

  // Daily rental count
  const daily = {};
  rentals.forEach(r => {
    const d = parseDbTimestampToDate(r.in_time);
    const key = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
    daily[key] = (daily[key] || 0) + 1;
  });

  const dayLabels = Object.keys(daily).reverse().slice(0, 30).reverse(); // last 30 days window
  const dayValues = dayLabels.map(l => daily[l]);

  const ctx2 = document.getElementById("rentalChart").getContext("2d");
  if (rentalChartInstance) rentalChartInstance.destroy();
  rentalChartInstance = new Chart(ctx2, {
    type: "line",
    data: {
      labels: dayLabels,
      datasets: [{ label: "Rentals", data: dayValues, borderColor: "rgba(2,117,216,0.9)", tension: 0.25 }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // Repeat vs New (doughnut) — make smaller via aspectRatio + CSS
  const byCustomer = {};
  rentals.forEach(r => {
    const key = r.customers?.phone || r.customers?.full_name || r.customer_id || "unknown";
    byCustomer[key] = (byCustomer[key] || 0) + 1;
  });
  const repeat = Object.values(byCustomer).filter(c => c > 1).length;
  const single = Object.values(byCustomer).filter(c => c === 1).length;

  const ctx3 = document.getElementById("repeatChart").getContext("2d");
  if (repeatChartInstance) repeatChartInstance.destroy();
  repeatChartInstance = new Chart(ctx3, {
    type: "doughnut",
    data: { labels: ["Repeat", "Single"], datasets: [{ data: [repeat, single], backgroundColor: ["#198754", "#6c757d"] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } } },
      cutout: "60%"
    }
  });

  // Ensure canvas containers have constrained heights (so donut stays small)
  constrainCanvasHeight("revenueChart", 220);
  constrainCanvasHeight("rentalChart", 220);
  constrainCanvasHeight("repeatChart", 180);
}

function constrainCanvasHeight(canvasId, px) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentElement;
  parent.style.height = `${px}px`;
  // ensure canvas redraw respects new size
  canvas.height = px;
}

// ------------------ Top Customers ------------------
function renderTopCustomers(rentals) {
  const container = document.getElementById("top-customers");
  if (!container) return;
  const spend = {};
  rentals.forEach(r => {
    const name = r.customers?.full_name || r.customers?.phone || "Unknown";
    spend[name] = (spend[name] || 0) + parseFloat(r.final_amount ?? r.calculated_amount ?? 0);
  });
  const top = Object.entries(spend).sort((a, b) => b[1] - a[1]).slice(0, 5);
  container.innerHTML = top.length
    ? top.map((t, i) => `<div class="mb-2"><strong>${i + 1}. ${escapeHtml(t[0])}</strong> — ₹${t[1].toFixed(2)}</div>`).join("")
    : `<div class="text-muted">No data</div>`;
}

// ------------------ Export helpers ------------------

function exportToCSV(data) {
  const headers = [
    "Cycle Code",
    "Customer",
    "Phone",
    "Kiosk",
    "Start Time (IST)",
    "End Time (IST)",
    "Duration (mins)",
    "Amount",
    "Payment Mode",
    "Accessories",
    "Remarks"
  ];

  const rows = data.map(r => {
    const accessories = (r.rental_accessories || []).map(a => {
      const n = a?.accessories?.name || "Accessory";
      const q = a?.quantity ?? 1;
      const p = a?.total_price ?? a?.accessories?.rental_price ?? "";
      return `${n}${q > 1 ? ` x${q}` : ""}${p ? ` (₹${p})` : ""}`;
    }).join("; ");

    return [
      r.cycles?.cycle_code || r.cycles?.rfid_tag_id || "Unknown",
      r.customers?.full_name || "N/A",
      r.customers?.phone || "",
      r.cycles?.locations?.name || "Unknown",
      formatToIST(r.out_time),
      formatToIST(r.in_time),
      computeDurationMinutes(r.out_time, r.in_time),
      (r.final_amount || r.calculated_amount || 0).toFixed(2),
      r.payment_mode || "",
      accessories,
      r.remarks || ""
    ].map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ZaiReCycle_Archive_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function exportToXLSX(data) {
  // Use SheetJS via CDN (module import)
  import("https://cdn.sheetjs.com/xlsx-0.19.3/package/xlsx.mjs").then(XLSX => {
    const rows = data.map(r => {
      const accessories = (r.rental_accessories || []).map(a => {
        const n = a?.accessories?.name || "Accessory";
        const q = a?.quantity ?? 1;
        const p = a?.total_price ?? a?.accessories?.rental_price ?? "";
        return `${n}${q > 1 ? ` x${q}` : ""}${p ? ` (₹${p})` : ""}`;
      }).join("; ");

      return {
        "Cycle Code": r.cycles?.cycle_code || r.cycles?.rfid_tag_id || "Unknown",
        "Customer": r.customers?.full_name || "N/A",
        "Phone": r.customers?.phone || "",
        "Kiosk": r.cycles?.locations?.name || "Unknown",
        "Start Time (IST)": formatToIST(r.out_time),
        "End Time (IST)": formatToIST(r.in_time),
        "Duration (mins)": computeDurationMinutes(r.out_time, r.in_time),
        "Amount": (r.final_amount || r.calculated_amount || 0).toFixed(2),
        "Payment Mode": r.payment_mode || "",
        "Accessories": accessories,
        "Remarks": r.remarks || ""
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Archive");
    XLSX.writeFile(wb, `ZaiReCycle_Archive_${new Date().toISOString().split("T")[0]}.xlsx`);
  }).catch(err => {
    console.error("XLSX export failed:", err);
    alert("Export to XLSX failed. CSV export is still available.");
  });
}
