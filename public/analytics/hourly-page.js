// public/analytics/hourly-page.js — Hourly Business Analysis page controller
(function () {
  "use strict";

  const store = window.AnalyticsStore;
  let hourlyChart = null;
  let costChart   = null;

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

  function renderSummary(slots) {
    const peak  = slots.reduce((a, b) => b.totalCalls > a.totalCalls ? b : a, slots[0] || {});
    const total = slots.reduce((s, r) => s + r.totalCalls, 0);
    const cost  = slots.reduce((s, r) => s + r.totalCost, 0);

    document.getElementById("peakHour").textContent     = peak?.label || "—";
    document.getElementById("peakCalls").textContent    = (peak?.totalCalls || 0).toLocaleString();
    document.getElementById("totalCallsAll").textContent = total.toLocaleString();
    document.getElementById("totalCostAll").textContent  = "$" + cost.toFixed(2);
    show("summaryGrid");
  }

  function renderCharts(slots) {
    const labels = slots.map(s => s.label);

    // Stacked bar: AI, 382, TBI calls by hour
    const hCanvas = document.getElementById("hourlyChart");
    if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }
    hourlyChart = new Chart(hCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "AI (Retell)", data: slots.map(s => s.retellCalls), backgroundColor: "#4d6eff", borderWidth: 0, stack: "calls" },
          { label: "382 (CDR)",   data: slots.map(s => s.sureCalls),   backgroundColor: "#00c2cb", borderWidth: 0, stack: "calls" },
          { label: "TBI",         data: slots.map(s => s.tbiCalls),    backgroundColor: "#f59e0b", borderWidth: 0, stack: "calls" }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: "#e8ebff", font: { size: 11 } } }
        },
        scales: {
          x: { stacked: true, ticks: { color: "#9bb6ff", font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, ticks: { color: "#9bb6ff" }, grid: { color: "#2a3f72" } }
        }
      }
    });
    show("chartCard");

    // Cost bar by hour
    const cCanvas = document.getElementById("costChart");
    if (costChart) { costChart.destroy(); costChart = null; }
    costChart = new Chart(cCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "Total Cost ($)", data: slots.map(s => s.totalCost), backgroundColor: "#f43f5e", borderWidth: 0, borderRadius: 2 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#9bb6ff", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#9bb6ff", callback: v => "$" + v.toFixed(2) }, grid: { color: "#2a3f72" } }
        }
      }
    });
    show("costChartCard");
  }

  // Color cells by intensity — heat map effect on the hour column
  function heatColor(val, max) {
    if (!max) return "";
    const pct = val / max;
    // Blue (low) → cyan (mid) → amber (peak)
    if (pct < 0.33) return `rgba(77, 110, 255, ${0.2 + pct * 0.5})`;
    if (pct < 0.66) return `rgba(0, 194, 203, ${0.3 + pct * 0.4})`;
    return `rgba(245, 158, 11, ${0.4 + pct * 0.5})`;
  }

  function renderTable(slots) {
    const maxCalls = Math.max(...slots.map(s => s.totalCalls), 1);
    const tbody = document.getElementById("hourlyTableBody");
    tbody.innerHTML = slots.map(s => {
      const bg = heatColor(s.totalCalls, maxCalls);
      return `
        <tr>
          <td style="background:${bg};border-radius:4px">${esc(s.label)}</td>
          <td>${s.retellCalls.toLocaleString()}</td>
          <td>${s.sureCalls.toLocaleString()}</td>
          <td>${s.tbiCalls.toLocaleString()}</td>
          <td><strong>${s.totalCalls.toLocaleString()}</strong></td>
          <td>$${s.totalCost.toFixed(2)}</td>
        </tr>
      `;
    }).join("");
    show("tableCard");
  }

  function render(slots) {
    const hasData = slots && slots.some(s => s.totalCalls > 0);
    if (!hasData) {
      show("emptyMsg");
      hide("summaryGrid"); hide("chartCard"); hide("costChartCard"); hide("tableCard");
      return;
    }
    hide("emptyMsg");
    renderSummary(slots);
    renderCharts(slots);
    renderTable(slots);
  }

  async function applyFilters() {
    const params = window.StoreUtils.getFilterParams();

    if (!store.isStale(params)) {
      const data = store.getState().data;
      if (data) { render(data); return; }
    }

    store.setState({ status: "loading" });
    setStatus("Fetching hourly data...", "#9bb6ff");

    try {
      const qs  = window.StoreUtils.buildQS(params);
      const t0  = Date.now();
      const res = await fetch(`/api/analytics/hourly${qs ? "?" + qs : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resp  = await res.json();
      const slots = resp.data || [];
      const ms    = Date.now() - t0;

      store.setState({ status: "loaded", data: slots });
      store.markFresh(params);

      render(slots);
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
    hide("summaryGrid"); hide("chartCard"); hide("costChartCard"); hide("tableCard"); hide("emptyMsg");
    setStatus("", "");
    if (hourlyChart) { hourlyChart.destroy(); hourlyChart = null; }
    if (costChart)   { costChart.destroy();   costChart   = null; }
    document.getElementById("hourlyTableBody").innerHTML = "";
  }

  document.getElementById("applyBtn").addEventListener("click", applyFilters);
  document.getElementById("resetBtn").addEventListener("click", reset);
})();
