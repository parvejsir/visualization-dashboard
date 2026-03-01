let state = {
  page: 1,
  pageSize: 25,
  totalPages: 1,
  lastQueryString: ""
};

const $ = (id) => document.getElementById(id);

function getSelectedValues(selectEl) {
  return Array.from(selectEl.selectedOptions).map((o) => o.value).filter(Boolean);
}

// datetime-local returns local time without timezone.
// Server uses Date(val) which interprets as local time in browser, then sends ISO-ish string.
// Good enough for dashboards; if you want strict TZ handling, send epoch millis instead.
function buildQueryString() {
  const from = $("from").value;
  const to = $("to").value;
  const durationBucket = $("durationBucket").value;
  const disconnectionReasons = getSelectedValues($("disconnectionReasons"));
  const callDispositions = getSelectedValues($("callDispositions"));
  const pageSize = $("pageSize").value;

  const params = new URLSearchParams();
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  if (durationBucket) params.set("durationBucket", durationBucket);

  // Multi values: send comma-separated
  if (disconnectionReasons.length) params.set("disconnectionReasons", disconnectionReasons.join(","));
  if (callDispositions.length) params.set("callDispositions", callDispositions.join(","));

  params.set("page", String(state.page));
  params.set("pageSize", String(pageSize));

  state.pageSize = parseInt(pageSize, 10);
  return params.toString();
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function linkOrDash(url, label) {
  if (!url) return "-";
  const safe = String(url);
  const text = label || "link";
  return `<a href="${safe}" target="_blank" rel="noreferrer">${text}</a>`;
}

function renderTable(rows) {
  const tbody = $("resultsBody");
  tbody.innerHTML = rows.map((r) => {
    const leadName = [r.first_name, r.last_name].filter(Boolean).join(" ") || "-";
    return `
      <tr>
        <td>${r.call_start_time_est || "-"}</td>
        <td>${r.phone_number ?? "-"}</td>
        <td>${r.phone_entry_count ?? "-"}</td>
        <td>${r.call_disposition || "-"}</td>
        <td>${r.disconnection_reason || "-"}</td>
        <td>${r.call_duration_seconds ?? "-"}</td>
        <td>${r.agent_id || "-"}</td>
        <td>${r.campaign_id || "-"}</td>
        <td>${r.list_id || "-"}</td>
        <td>${leadName}</td>
        <td>${r.Vendor || "-"}</td>
        <td>${linkOrDash(r.recording_url, "recording")}</td>
        <td>${linkOrDash(r.public_log_url, "log")}</td>
      </tr>
    `;
  }).join("");
}

function renderPager(total, totalPages) {
  $("pageInfo").textContent = `Page ${state.page} / ${totalPages} • Total rows: ${total}`;
  $("prevBtn").disabled = state.page <= 1;
  $("nextBtn").disabled = state.page >= totalPages;
}

async function loadMeta() {
  setStatus("Loading filter options...");
  const res = await fetch("/api/meta");
  const meta = await res.json();

  const dr = $("disconnectionReasons");
  const cd = $("callDispositions");

  dr.innerHTML = (meta.disconnectionReasons || []).map((v) => `<option value="${v}">${v}</option>`).join("");
  cd.innerHTML = (meta.callDispositions || []).map((v) => `<option value="${v}">${v}</option>`).join("");

  setStatus("");
}

async function loadData() {
  setStatus("Loading...");
  const qs = buildQueryString();
  state.lastQueryString = qs;

  const res = await fetch(`/api/transcriptions?${qs}`);
  const json = await res.json();

  if (!res.ok) {
    setStatus(json.error || "Failed");
    renderTable([]);
    renderPager(0, 1);
    return;
  }

  state.totalPages = json.totalPages || 1;
  renderTable(json.data || []);
  renderPager(json.total || 0, state.totalPages);
  setStatus("");
}

function resetFilters() {
  $("from").value = "";
  $("to").value = "";
  $("durationBucket").value = "";
  $("pageSize").value = "25";

  Array.from($("disconnectionReasons").options).forEach((o) => (o.selected = false));
  Array.from($("callDispositions").options).forEach((o) => (o.selected = false));

  state.page = 1;
}

$("applyBtn").addEventListener("click", async () => {
  state.page = 1;
  await loadData();
});

$("resetBtn").addEventListener("click", async () => {
  resetFilters();
  await loadData();
});

$("prevBtn").addEventListener("click", async () => {
  state.page = Math.max(state.page - 1, 1);
  await loadData();
});

$("nextBtn").addEventListener("click", async () => {
  state.page = Math.min(state.page + 1, state.totalPages);
  await loadData();
});

$("downloadBtn").addEventListener("click", () => {
  // Export ignores page/pageSize, exports full filtered dataset.
  // Rebuild query string without pagination params:
  const params = new URLSearchParams(state.lastQueryString || buildQueryString());
  params.delete("page");
  params.delete("pageSize");

  window.location.href = `/api/transcriptions/export.csv?${params.toString()}`;
});

// Boot
(async function init() {
  await loadMeta();
  await loadData();
})();