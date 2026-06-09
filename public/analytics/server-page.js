// public/analytics/server-page.js — Server Wise Analysis page controller
(function () {
  "use strict";

  let serverChart = null;
  let lastParamsKey = null;

  // ── DOM refs ────────────────────────────────────────────────────────────
  const fromDateInput = document.getElementById("fromDateInput");
  const fromTimeInput = document.getElementById("fromTimeInput");
  const toDateInput   = document.getElementById("toDateInput");
  const toTimeInput   = document.getElementById("toTimeInput");
  const serverSelect  = document.getElementById("serverSelect");
  const agentSelect   = document.getElementById("agentSelect");
  const progressBar   = document.getElementById("progressBar");

  // ── Helpers ─────────────────────────────────────────────────────────────
  function setStatus(msg, color) {
    const el = document.getElementById("statusMsg");
    if (el) { el.textContent = msg; el.style.color = color || "#9bb6ff"; }
  }

  function progressStart() {
    progressBar.classList.remove("is-done");
    progressBar.classList.add("is-active");
  }
  function progressDone() {
    progressBar.classList.add("is-done");
    setTimeout(() => progressBar.classList.remove("is-active", "is-done"), 600);
  }

  function esc(v) {
    return String(v == null ? "—" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function show(id) { const el = document.getElementById(id); if (el) el.style.display = ""; }
  function hide(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }

  function getTodayEt() {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit"
    });
    const parts = dtf.formatToParts(new Date());
    const map = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  }

  function setDefaults() {
    const today = getTodayEt();
    fromDateInput.value = today;
    fromTimeInput.value = "09:00";
    toDateInput.value   = today;
    toTimeInput.value   = "22:00";
  }
  setDefaults();

  // ── Read selected server IPs ─────────────────────────────────────────────
  // Returns array of selected IPs, or null (= all) if "All Servers" or nothing selected
  function getSelectedServers() {
    const opts = Array.from(serverSelect.selectedOptions).map(o => o.value);
    // If empty string (All Servers) is selected or nothing is selected → all
    if (opts.length === 0 || opts.includes("")) return null;
    return opts.filter(Boolean);
  }

  // ── Build query params ───────────────────────────────────────────────────
  // Sends ET date/time strings directly (no UTC conversion) because the
  // server converts them for each collection as needed.
  function buildParams() {
    const p = {
      fromDate:  fromDateInput.value || getTodayEt(),
      fromTime:  fromTimeInput.value || "09:00",
      toDate:    toDateInput.value   || fromDateInput.value || getTodayEt(),
      toTime:    toTimeInput.value   || "22:00",
      agentMode: agentSelect.value   || "all"
    };
    const servers = getSelectedServers();
    if (servers) p.servers = servers.join(",");
    return p;
  }

  function buildQS(p) {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v) qs.set(k, v); });
    return qs.toString();
  }

  function paramsKey(p) { return JSON.stringify(p); }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderSummary(rows) {
    const active      = rows.filter(r => r.retellCalls > 0).length;
    const totalRetell = rows.reduce((s, r) => s + r.retellCalls, 0);
    const totalXfer   = rows.reduce((s, r) => s + r.transfers,   0);
    const xferRate    = totalRetell > 0
      ? ((totalXfer / totalRetell) * 100).toFixed(2) : "0.00";

    document.getElementById("sumServers").textContent      = active.toLocaleString();
    document.getElementById("sumRetellCalls").textContent  = totalRetell.toLocaleString();
    document.getElementById("sumTransfers").textContent    = totalXfer.toLocaleString();
    document.getElementById("sumTransferRate").textContent = xferRate + "%";
    show("summaryGrid");
  }

  function renderChart(rows) {
    const canvas = document.getElementById("serverChart");
    if (serverChart) { serverChart.destroy(); serverChart = null; }

    serverChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: rows.map(r => r.server),
        datasets: [
          {
            label:           "Retell Calls",
            data:            rows.map(r => r.retellCalls),
            backgroundColor: "#4d6eff",
            borderRadius:    4,
            borderWidth:     0
          },
          {
            label:           "Transfers",
            data:            rows.map(r => r.transfers),
            backgroundColor: "#22c55e",
            borderRadius:    4,
            borderWidth:     0
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
        <td>${r.retellCalls.toLocaleString()}</td>
        <td>${r.transfers.toLocaleString()}</td>
        <td>${r.transferRate}%</td>
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

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function applyFilters() {
    const params = buildParams();
    const key    = paramsKey(params);

    // Avoid re-fetching same params
    if (key === lastParamsKey) return;

    progressStart();
    setStatus("Fetching server data...", "#9bb6ff");
    hide("summaryGrid"); hide("chartCard"); hide("tableCard"); hide("emptyMsg");

    try {
      const qs  = buildQS(params);
      const t0  = Date.now();
      const res = await fetch(`/api/analytics/server${qs ? "?" + qs : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resp = await res.json();
      const rows = resp.data || [];
      const ms   = Date.now() - t0;

      lastParamsKey = key;
      progressDone();
      render(rows);
      setStatus(
        `Loaded in ${(ms / 1000).toFixed(1)}s  |  ${rows.length} server(s)  |  cache: ${resp.cache || "MISS"}`,
        "#10b981"
      );
    } catch (e) {
      progressDone();
      setStatus("Error: " + e.message, "#f43f5e");
    }
  }

  function reset() {
    setDefaults();
    // Reset server select to "All Servers"
    Array.from(serverSelect.options).forEach(o => { o.selected = o.value === ""; });
    agentSelect.value = "all";
    lastParamsKey = null;
    hide("summaryGrid"); hide("chartCard"); hide("tableCard"); hide("emptyMsg");
    setStatus("", "");
    if (serverChart) { serverChart.destroy(); serverChart = null; }
    document.getElementById("serverTableBody").innerHTML = "";
  }

  document.getElementById("applyBtn").addEventListener("click", applyFilters);
  document.getElementById("resetBtn").addEventListener("click", reset);
})();
