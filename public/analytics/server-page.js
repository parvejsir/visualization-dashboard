// public/analytics/server-page.js — Server Wise Analysis page controller
(function () {
  "use strict";

  const store = window.AnalyticsStore;
  let serverChart = null;

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
    const totalCalls = rows.reduce((s, r) => s + r.totalCalls, 0);
    const totalCost  = rows.reduce((s, r) => s + r.totalCost, 0);
    const avgAsr     = rows.length > 0
      ? (rows.reduce((s, r) => s + r.asr, 0) / rows.length).toFixed(2)
      : 0;

    document.getElementById("sumServers").textContent    = rows.length.toLocaleString();
    document.getElementById("sumTotalCalls").textContent = totalCalls.toLocaleString();
    document.getElementById("sumTotalCost").textContent  = "$" + totalCost.toFixed(2);
    document.getElementById("sumAvgAsr").textContent     = avgAsr + "%";
    show("summaryGrid");
  }

  function renderChart(rows) {
    const top20 = rows.slice(0, 20);
    const canvas = document.getElementById("serverChart");
    if (serverChart) { serverChart.destroy(); serverChart = null; }

    serverChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: top20.map(r => r.server),
        datasets: [
          {
            label: "Total Calls",
            data: top20.map(r => r.totalCalls),
            backgroundColor: "#4d6eff",
            borderRadius: 4,
            borderWidth: 0
          },
          {
            label: "Completed",
            data: top20.map(r => r.completedCalls),
            backgroundColor: "#00c2cb",
            borderRadius: 4,
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: "#e8ebff", font: { size: 11 } } }
        },
        scales: {
          x: { ticks: { color: "#9bb6ff", font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: "#9bb6ff" }, grid: { color: "#2a3f72" } }
        }
      }
    });
    show("chartCard");
  }

  function renderTable(rows) {
    const tbody = document.getElementById("serverTableBody");
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${esc(r.server)}</td>
        <td>${r.totalCalls.toLocaleString()}</td>
        <td>${r.completedCalls.toLocaleString()}</td>
        <td>${r.asr}%</td>
        <td>${r.acd}</td>
        <td>$${r.totalCost}</td>
      </tr>
    `).join("");
    show("tableCard");
  }

  function render(rows) {
    if (!rows || rows.length === 0) {
      show("emptyMsg");
      hide("summaryGrid"); hide("chartCard"); hide("tableCard");
      return;
    }
    hide("emptyMsg");
    renderSummary(rows);
    renderChart(rows);
    renderTable(rows);
  }

  async function applyFilters() {
    const params = window.StoreUtils.getFilterParams();

    if (!store.isStale(params)) {
      const data = store.getState().data;
      if (data) { render(data); return; }
    }

    store.setState({ status: "loading" });
    setStatus("Fetching server data...", "#9bb6ff");

    try {
      const qs  = window.StoreUtils.buildQS(params);
      const t0  = Date.now();
      const res = await fetch(`/api/analytics/server${qs ? "?" + qs : ""}`);
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
    hide("summaryGrid"); hide("chartCard"); hide("tableCard"); hide("emptyMsg");
    setStatus("", "");
    if (serverChart) { serverChart.destroy(); serverChart = null; }
    document.getElementById("serverTableBody").innerHTML = "";
  }

  document.getElementById("applyBtn").addEventListener("click", applyFilters);
  document.getElementById("resetBtn").addEventListener("click", reset);
})();
