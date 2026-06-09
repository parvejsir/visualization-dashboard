// public/analytics/ai-summary.js — AI Summary page controller
(function () {
  "use strict";

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const fromDateInput = document.getElementById("fromDateInput");
  const fromTimeInput = document.getElementById("fromTimeInput");
  const toDateInput   = document.getElementById("toDateInput");
  const toTimeInput   = document.getElementById("toTimeInput");
  const applyBtn      = document.getElementById("applyBtn");
  const resetBtn      = document.getElementById("resetBtn");
  const statusMsg     = document.getElementById("statusMsg");
  const windowNote    = document.getElementById("windowNote");
  const progressBar   = document.getElementById("progressBar");
  const breakdownSec  = document.getElementById("breakdownSection");

  // ── Progress bar helpers ──────────────────────────────────────────────────
  function progressStart() {
    progressBar.classList.remove("is-done");
    progressBar.classList.add("is-active");
  }
  function progressDone() {
    progressBar.classList.add("is-done");
    setTimeout(() => {
      progressBar.classList.remove("is-active", "is-done");
    }, 600);
  }

  // ── Date helpers ──────────────────────────────────────────────────────────
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

  function getEtLabel(dateStr) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", timeZoneName: "short"
    });
    const parts = dtf.formatToParts(new Date(`${dateStr}T12:00:00Z`));
    const tz = parts.find(p => p.type === "timeZoneName");
    return tz ? tz.value : "ET";
  }

  function setDefaults() {
    const today = getTodayEt();
    fromDateInput.value = today;
    fromTimeInput.value = "09:00";
    toDateInput.value   = today;
    toTimeInput.value   = "22:00";
  }
  setDefaults();

  // ── KPI skeleton helpers ──────────────────────────────────────────────────
  function showSkeletons() {
    document.querySelectorAll("[data-kpi]").forEach(card => {
      const val = card.querySelector(".ais-kpi__val");
      if (val) val.remove();
      let sk = card.querySelector(".ais-kpi__sk");
      if (!sk) {
        sk = document.createElement("div");
        sk.className = "ais-kpi__sk";
        const sub = card.querySelector(".ais-kpi__sub");
        card.insertBefore(sk, sub || null);
      }
      sk.classList.add("is-loading");
      sk.style.display = "";
    });
    breakdownSec.style.display = "none";
  }

  // Map of kpi-key → { colorClass, formatter }
  const KPI_META = {
    totalDialed:    { color: "blue",   fmt: "int"    },
    totalTransfer:  { color: "green",  fmt: "int"    },
    "c382-dialed":  { color: "gray",   fmt: "int"    },
    "c382-attempts":{ color: "amber",  fmt: "int"    },
    "c382-paid":    { color: "rose",   fmt: "int"    },
    "c382-cost":    { color: "gray",   fmt: "dollar" },
    "ctbi-dialed":  { color: "gray",   fmt: "int"    },
    "ctbi-attempts":{ color: "teal",   fmt: "int"    },
    "ctbi-paid":    { color: "rose",   fmt: "int"    },
    "ctbi-cost":    { color: "gray",   fmt: "dollar" },
    totalAttempts:    { color: "amber",  fmt: "int"    },
    totalPaid:        { color: "rose",   fmt: "int"    },
    totalCdrCost:     { color: "gray",   fmt: "dollar" },
    retellCost:       { color: "purple", fmt: "dollar" },
    humanAnswerCount: { color: "teal",   fmt: "int"    },
    humanAnswerPct:   { color: "green",  fmt: "pct"    },
    leadsCount:          { color: "teal",   fmt: "int"    },
    leadsCost:           { color: "green",  fmt: "dollar" },
    "c382-acd":          { color: "blue",   fmt: "sec"    },
    "ctbi-acd":          { color: "blue",   fmt: "sec"    },
    grandTotalCost:      { color: "rose",   fmt: "dollar" },
    costPerTransfer:     { color: "amber",  fmt: "dollar" },
    costPerPaidTransfer: { color: "green",  fmt: "dollar" }
  };

  function fmt(val, type) {
    const n = Number(val ?? 0);
    if (type === "int")    return n.toLocaleString();
    if (type === "dollar") return "$" + n.toFixed(2);
    if (type === "pct")    return n.toFixed(2) + "%";
    if (type === "sec") {
      const s = Math.round(n);
      return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    return String(n);
  }

  function renderKpi(key, val) {
    const card = document.querySelector(`[data-kpi="${key}"]`);
    if (!card) return;
    const meta = KPI_META[key] || { color: "", fmt: "int" };
    const sk = card.querySelector(".ais-kpi__sk");
    if (sk) { sk.classList.remove("is-loading"); sk.style.display = "none"; }
    let valEl = card.querySelector(".ais-kpi__val");
    if (!valEl) {
      valEl = document.createElement("span");
      valEl.className = `ais-kpi__val ais-kpi__val--${meta.color}`;
      const sub = card.querySelector(".ais-kpi__sub");
      card.insertBefore(valEl, sub || null);
    }
    valEl.textContent = fmt(val, meta.fmt);
  }

  function renderData(data) {
    const c382 = data.carrier382 || {};
    const ctbi = data.carrierTbi || {};
    const bd   = data.breakdown  || {};
    const l    = bd.leads        || {};
    const s    = bd.sharks       || {};
    const t    = bd.tbi          || {};

    // Transcription KPIs
    renderKpi("totalDialed",      data.totalDialed);
    renderKpi("totalTransfer",    data.totalTransfer);
    renderKpi("retellCost",       data.retellCost);
    renderKpi("humanAnswerCount", data.humanAnswerCount);
    renderKpi("humanAnswerPct",   data.humanAnswerPct);

    // Leads KPIs
    renderKpi("leadsCount", data.leadsCount);
    renderKpi("leadsCost",  data.leadsCost);

    // 382com KPIs
    renderKpi("c382-dialed",   c382.dialed);
    renderKpi("c382-attempts", c382.attempts);
    renderKpi("c382-paid",     c382.paid);
    renderKpi("c382-cost",     c382.cost);
    renderKpi("c382-acd",      c382.acd);

    // TBI KPIs
    renderKpi("ctbi-dialed",   ctbi.dialed);
    renderKpi("ctbi-attempts", ctbi.attempts);
    renderKpi("ctbi-paid",     ctbi.paid);
    renderKpi("ctbi-cost",     ctbi.cost);
    renderKpi("ctbi-acd",      ctbi.acd);

    // Overall CDR
    renderKpi("totalAttempts", data.totalAttempts);
    renderKpi("totalPaid",     data.totalPaid);
    renderKpi("totalCdrCost",  data.totalCdrCost);

    // Grand Total
    renderKpi("grandTotalCost",      data.grandTotalCost);
    renderKpi("costPerTransfer",     data.costPerTransfer);
    renderKpi("costPerPaidTransfer", data.costPerPaidTransfer);

    // Breakdown table
    const set = (id, val, type) => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt(val, type || "int");
    };

    set("br-leads-dialed", l.dialed);
    set("br-leads-att",    l.attempts);
    set("br-leads-paid",   l.paid);
    set("br-leads-cost",   l.cost,  "dollar");

    set("br-sharks-dialed", s.dialed);
    set("br-sharks-att",    s.attempts);
    set("br-sharks-paid",   s.paid);
    set("br-sharks-cost",   s.cost, "dollar");

    set("br-tbi-dialed", t.dialed);
    set("br-tbi-att",    t.attempts);
    set("br-tbi-paid",   t.paid);
    set("br-tbi-cost",   t.cost,   "dollar");

    const totalCdrDialed = (l.dialed || 0) + (s.dialed || 0) + (t.dialed || 0);
    set("br-total-dialed", totalCdrDialed);
    set("br-total-att",    data.totalAttempts);
    set("br-total-paid",   data.totalPaid);
    set("br-total-cost",   data.totalCdrCost, "dollar");

    breakdownSec.style.display = "";
  }

  // ── Fetch + render ────────────────────────────────────────────────────────
  async function fetchAndRender() {
    const fromDate = fromDateInput.value;
    const fromTime = fromTimeInput.value || "09:00";
    const toDate   = toDateInput.value   || fromDate;
    const toTime   = toTimeInput.value   || "22:00";

    if (!fromDate) {
      statusMsg.textContent = "Please select a From date.";
      return;
    }

    const etLabel = getEtLabel(fromDate);
    showSkeletons();
    progressStart();
    statusMsg.textContent = "Fetching…";
    windowNote.textContent = "";
    applyBtn.disabled = true;

    const qs = new URLSearchParams({ fromDate, fromTime, toDate, toTime });

    try {
      const res  = await fetch(`/api/analytics/ai-summary?${qs}`);
      if (!res.ok) throw new Error(`Server error HTTP ${res.status}`);
      const data = await res.json();

      progressDone();
      renderData(data);

      const isSameDay   = fromDate === toDate;
      const cacheTag    = data.cache === "HIT" ? " · from cache" : "";
      statusMsg.textContent = `Loaded${cacheTag}`;
      windowNote.textContent =
        `Window: ${fromDate} ${fromTime} → ${isSameDay ? "" : toDate + " "}${toTime} ${etLabel}` +
        ` · Transcriptions queried in UTC · CDR queried in ${etLabel}`;
    } catch (e) {
      progressBar.classList.remove("is-active", "is-done");
      statusMsg.textContent = `Error: ${e.message}`;
    } finally {
      applyBtn.disabled = false;
    }
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  applyBtn.addEventListener("click", fetchAndRender);

  resetBtn.addEventListener("click", () => {
    setDefaults();
    statusMsg.textContent  = "";
    windowNote.textContent = "";
    showSkeletons();
  });

  // Keep toDate ≥ fromDate automatically
  fromDateInput.addEventListener("change", () => {
    if (toDateInput.value && toDateInput.value < fromDateInput.value) {
      toDateInput.value = fromDateInput.value;
    }
  });

})();
