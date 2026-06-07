// public/analytics/overview.js — Overview Call Analysis page controller
(function () {
  "use strict";

  const store = window.AnalyticsStore;

  const KPI_META = [
    { key: "totalAIDialed",    fmt: "int",    label: "Total AI Dialed" },
    { key: "goTo382",          fmt: "int",    label: "Go To 382Com" },
    { key: "complete382",      fmt: "int",    label: "Complete By 382Com" },
    { key: "goToTBI",          fmt: "int",    label: "Go To TBI" },
    { key: "completeTBI",      fmt: "int",    label: "Complete By TBI" },
    { key: "asr382",           fmt: "pct",    label: "ASR 382 (%)" },
    { key: "acd382",           fmt: "float",  label: "ACD 382 (sec)" },
    { key: "asrTBI",           fmt: "pct",    label: "ASR TBI (%)" },
    { key: "acdTBI",           fmt: "float",  label: "ACD TBI (sec)" },
    { key: "cost382",          fmt: "dollar", label: "382 Cost ($)" },
    { key: "costTBI",          fmt: "dollar", label: "TBI Cost ($)" },
    { key: "leadsCost",        fmt: "dollar", label: "Leads Cost ($)" },
    { key: "retellCost",       fmt: "dollar", label: "Retell Cost ($)" },
    { key: "totalCost",        fmt: "dollar", label: "Total Cost ($)" },
    { key: "humanAnswerPct",   fmt: "pct",    label: "Human Answer (%)" },
    { key: "transferCount",    fmt: "int",    label: "Transfer Count" },
    { key: "paidCount",        fmt: "int",    label: "Paid Count" },
    { key: "costPerTransfer",  fmt: "dollar", label: "Cost / Transfer ($)" },
    { key: "costPerPaid",      fmt: "dollar", label: "Cost / Paid ($)" }
  ];

  function fmtVal(val, fmt) {
    if (val == null || val === undefined) return "—";
    const n = Number(val);
    if (Number.isNaN(n)) return "—";
    if (fmt === "int")    return n.toLocaleString();
    if (fmt === "float")  return n.toFixed(2);
    if (fmt === "pct")    return n.toFixed(2) + "%";
    if (fmt === "dollar") return "$" + n.toFixed(2);
    return String(val);
  }

  function showSkeletons() {
    document.querySelectorAll("[data-kpi]").forEach(card => {
      let sk = card.querySelector(".kpi-card__sk");
      if (!sk) {
        sk = document.createElement("div");
        sk.className = "kpi-card__sk";
        card.insertBefore(sk, card.firstChild);
      }
      sk.classList.add("is-loading");
      const val = card.querySelector(".kpi-card__val");
      if (val) val.remove();
    });
  }

  function renderKpis(data) {
    KPI_META.forEach(meta => {
      const card = document.querySelector(`[data-kpi="${meta.key}"]`);
      if (!card) return;

      const sk = card.querySelector(".kpi-card__sk");
      if (sk) { sk.classList.remove("is-loading"); sk.style.display = "none"; }

      let valEl = card.querySelector(".kpi-card__val");
      if (!valEl) {
        valEl = document.createElement("span");
        valEl.className = "kpi-card__val";
        const lbl = card.querySelector(".kpi-card__lbl");
        card.insertBefore(valEl, lbl);
      }
      valEl.textContent = fmtVal(data[meta.key], meta.fmt);
    });
  }

  // ---- Chart panel (lazy — only rendered on card click) ----
  let activeChart = null;

  function openCostChart(data) {
    const panel = document.getElementById("chartPanel");
    const title = document.getElementById("chartPanelTitle");
    const canvas = document.getElementById("detailChart");

    title.textContent = "Cost Breakdown";
    panel.classList.remove("hidden");

    if (activeChart) { activeChart.destroy(); activeChart = null; }

    activeChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["382 Cost", "TBI Cost", "Leads Cost", "Retell Cost"],
        datasets: [{
          data: [data.cost382, data.costTBI, data.leadsCost, data.retellCost],
          backgroundColor: ["#4d6eff", "#00c2cb", "#f59e0b", "#f43f5e"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: "#e8ebff", font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` $${Number(ctx.raw).toFixed(2)}`
            }
          }
        }
      }
    });
  }

  function openFunnelChart(data, type) {
    const panel = document.getElementById("chartPanel");
    const title = document.getElementById("chartPanelTitle");
    const canvas = document.getElementById("detailChart");

    const is382 = type === "382";
    title.textContent = is382 ? "382Com Funnel" : "TBI Funnel";
    panel.classList.remove("hidden");

    if (activeChart) { activeChart.destroy(); activeChart = null; }

    const goTo     = is382 ? data.goTo382 : data.goToTBI;
    const complete  = is382 ? data.complete382 : data.completeTBI;
    const labels    = is382 ? ["Go To 382", "Complete By 382"] : ["Go To TBI", "Complete By TBI"];
    const colors    = is382 ? ["#4d6eff", "#00c2cb"] : ["#f59e0b", "#10b981"];

    activeChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: [goTo, complete],
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${Number(ctx.raw).toLocaleString()}` } }
        },
        scales: {
          x: { ticks: { color: "#9bb6ff" }, grid: { color: "#2a3f72" } },
          y: { ticks: { color: "#e8ebff" }, grid: { display: false } }
        }
      }
    });
  }

  function openAnswerChart(data) {
    const panel = document.getElementById("chartPanel");
    const title = document.getElementById("chartPanelTitle");
    const canvas = document.getElementById("detailChart");

    title.textContent = "Human Answer vs Machine";
    panel.classList.remove("hidden");

    if (activeChart) { activeChart.destroy(); activeChart = null; }

    const humanCount   = Math.round((data.humanAnswerPct / 100) * data.totalAIDialed);
    const machineCount = data.totalAIDialed - humanCount;

    activeChart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Human Answer", "Machine / No Answer"],
        datasets: [{
          data: [humanCount, machineCount],
          backgroundColor: ["#10b981", "#f43f5e"],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "bottom", labels: { color: "#e8ebff", font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${Number(ctx.raw).toLocaleString()} (${((ctx.raw / data.totalAIDialed) * 100).toFixed(1)}%)`
            }
          }
        }
      }
    });
  }

  function openTransferChart(data) {
    const panel = document.getElementById("chartPanel");
    const title = document.getElementById("chartPanelTitle");
    const canvas = document.getElementById("detailChart");

    title.textContent = "Transfer vs Paid";
    panel.classList.remove("hidden");

    if (activeChart) { activeChart.destroy(); activeChart = null; }

    activeChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: ["Transfer Count", "Paid Count"],
        datasets: [{
          data: [data.transferCount, data.paidCount],
          backgroundColor: ["#4d6eff", "#10b981"],
          borderWidth: 0,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#e8ebff" }, grid: { display: false } },
          y: { ticks: { color: "#9bb6ff" }, grid: { color: "#2a3f72" } }
        }
      }
    });
  }

  // Map KPI key to which chart to show
  const CHART_MAP = {
    cost382: "cost", costTBI: "cost", leadsCost: "cost", retellCost: "cost", totalCost: "cost",
    goTo382: "382",  complete382: "382", asr382: "382", acd382: "382",
    goToTBI: "tbi",  completeTBI: "tbi", asrTBI: "tbi", acdTBI: "tbi",
    humanAnswerPct: "answer",
    transferCount: "transfer", paidCount: "transfer",
    costPerTransfer: "transfer", costPerPaid: "transfer"
  };

  function attachCardClickHandlers() {
    document.querySelectorAll("[data-kpi]").forEach(card => {
      card.addEventListener("click", () => {
        const data = store.getState().data;
        if (!data) return;
        const chartType = CHART_MAP[card.dataset.kpi];
        if (!chartType) return;
        if (chartType === "cost")     openCostChart(data);
        else if (chartType === "382") openFunnelChart(data, "382");
        else if (chartType === "tbi") openFunnelChart(data, "tbi");
        else if (chartType === "answer")   openAnswerChart(data);
        else if (chartType === "transfer") openTransferChart(data);
      });
    });
  }

  // ---- Main fetch ----
  function setStatus(msg, color) {
    const el = document.getElementById("statusMsg");
    if (el) { el.textContent = msg; el.style.color = color || "#9bb6ff"; }
  }

  async function applyFilters() {
    const params = window.StoreUtils.getFilterParams();

    // Data already loaded for the same params — skip the fetch, just re-render
    if (!store.isStale(params)) {
      const data = store.getState().data;
      if (data) { renderKpis(data); return; }
    }

    showSkeletons();
    store.setState({ status: "loading" });
    setStatus("Fetching analytics...", "#9bb6ff");

    try {
      const qs  = window.StoreUtils.buildQS(params);
      const t0  = Date.now();
      const res = await fetch(`/api/analytics/overview${qs ? "?" + qs : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ms  = Date.now() - t0;

      store.setState({ status: "loaded", data });
      store.markFresh(params);

      renderKpis(data);
      setStatus(`Loaded in ${(ms / 1000).toFixed(1)}s  |  cache: ${data.cache || "MISS"}`, "#10b981");
    } catch (e) {
      store.setState({ status: "error", error: e.message });
      setStatus("Error: " + e.message, "#f43f5e");
    }
  }

  function reset() {
    document.getElementById("fromInput").value = "";
    document.getElementById("toInput").value   = "";
    store.setState({ status: "idle", data: null, lastParamsHash: null });
    showSkeletons();
    setStatus("", "");
    const panel = document.getElementById("chartPanel");
    if (panel) panel.classList.add("hidden");
    if (activeChart) { activeChart.destroy(); activeChart = null; }
  }

  // ---- Init ----
  document.getElementById("applyBtn").addEventListener("click", applyFilters);
  document.getElementById("resetBtn").addEventListener("click", reset);

  document.getElementById("chartCloseBtn").addEventListener("click", () => {
    document.getElementById("chartPanel").classList.add("hidden");
    if (activeChart) { activeChart.destroy(); activeChart = null; }
  });

  attachCardClickHandlers();
})();
