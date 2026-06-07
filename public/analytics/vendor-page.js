// public/analytics/vendor-page.js — Lead / Vendor Wise Analysis page controller
(function () {
  "use strict";

  const store = window.AnalyticsStore;
  let volChart = null;
  let xferChart = null;

  function setStatus(msg, color) {
    const el = document.getElementById("statusMsg");
    if (el) { el.textContent = msg; el.style.color = color || "#9bb6ff"; }
  }

  function esc(v) {
    return String(v == null ? "—" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function show(id) { const el = document.getElementById(id); if (el) el.style.display = ""; }
  function hide(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }

  function renderSummary(rows) {
    const totalLeads    = rows.reduce((s, r) => s + r.leadCount, 0);
    const totalLeadCost = rows.reduce((s, r) => s + r.leadCost, 0);
    const totalXfer     = rows.reduce((s, r) => s + r.transferCount, 0);

    document.getElementById("sumVendors").textContent  = rows.length.toLocaleString();
    document.getElementById("sumLeads").textContent    = totalLeads.toLocaleString();
    document.getElementById("sumLeadCost").textContent = "$" + totalLeadCost.toFixed(2);
    document.getElementById("sumTransfers").textContent = totalXfer.toLocaleString();
    show("summaryGrid");
  }

  const PALETTE = [
    "#4d6eff","#00c2cb","#f59e0b","#f43f5e","#10b981","#8b5cf6",
    "#ec4899","#14b8a6","#f97316","#6366f1","#84cc16","#06b6d4",
    "#a855f7","#eab308","#ef4444"
  ];

  function renderCharts(rows) {
    const top15 = rows.slice(0, 15);
    const labels = top15.map(r => r.vendor);
    const colors = top15.map((_, i) => PALETTE[i % PALETTE.length]);

    // Lead volume chart
    const volCanvas = document.getElementById("leadVolChart");
    if (volChart) { volChart.destroy(); volChart = null; }
    volChart = new Chart(volCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Leads", data: top15.map(r => r.leadCount), backgroundColor: colors, borderWidth: 0, borderRadius: 4 }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#9bb6ff" }, grid: { color: "#2a3f72" } },
          y: { ticks: { color: "#e8ebff", font: { size: 10 } }, grid: { display: false } }
        }
      }
    });

    // Transfer rate chart
    const xferCanvas = document.getElementById("xferRateChart");
    if (xferChart) { xferChart.destroy(); xferChart = null; }
    xferChart = new Chart(xferCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Xfer Rate %", data: top15.map(r => r.xferRate), backgroundColor: "#10b981", borderWidth: 0, borderRadius: 4 }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#9bb6ff" }, grid: { color: "#2a3f72" }, max: 100 },
          y: { ticks: { color: "#e8ebff", font: { size: 10 } }, grid: { display: false } }
        }
      }
    });

    show("chartsRow");
  }

  function renderTable(rows) {
    const tbody = document.getElementById("vendorTableBody");
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${esc(r.vendor)}</td>
        <td>${r.leadCount.toLocaleString()}</td>
        <td>$${r.leadCost.toFixed(2)}</td>
        <td>${r.callCount.toLocaleString()}</td>
        <td>${r.transferCount.toLocaleString()}</td>
        <td>${r.paidCount.toLocaleString()}</td>
        <td>${r.xferRate}%</td>
      </tr>
    `).join("");
    show("tableCard");
  }

  function render(rows) {
    if (!rows || rows.length === 0) {
      show("emptyMsg");
      hide("summaryGrid"); hide("chartsRow"); hide("tableCard");
      return;
    }
    hide("emptyMsg");
    renderSummary(rows);
    renderCharts(rows);
    renderTable(rows);
  }

  async function applyFilters() {
    const params = window.StoreUtils.getFilterParams();

    if (!store.isStale(params)) {
      const data = store.getState().data;
      if (data) { render(data); return; }
    }

    store.setState({ status: "loading" });
    setStatus("Fetching vendor data...", "#9bb6ff");

    try {
      const qs  = window.StoreUtils.buildQS(params);
      const t0  = Date.now();
      const res = await fetch(`/api/analytics/vendor${qs ? "?" + qs : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resp = await res.json();
      const rows = resp.data || [];
      const ms   = Date.now() - t0;

      store.setState({ status: "loaded", data: rows });
      store.markFresh(params);

      render(rows);
      setStatus(`Loaded in ${(ms / 1000).toFixed(1)}s  |  cache: ${resp.cache || "MISS"}`, "#10b981");
    } catch (e) {
      store.setState({ status: "error", error: e.message });
      setStatus("Error: " + e.message, "#f43f5e");
    }
  }

  function reset() {
    document.getElementById("fromInput").value = "";
    document.getElementById("toInput").value   = "";
    store.setState({ status: "idle", data: null, lastParamsHash: null });
    hide("summaryGrid"); hide("chartsRow"); hide("tableCard"); hide("emptyMsg");
    setStatus("", "");
    if (volChart)  { volChart.destroy();  volChart  = null; }
    if (xferChart) { xferChart.destroy(); xferChart = null; }
    document.getElementById("vendorTableBody").innerHTML = "";
  }

  document.getElementById("applyBtn").addEventListener("click", applyFilters);
  document.getElementById("resetBtn").addEventListener("click", reset);
})();
