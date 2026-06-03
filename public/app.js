//public/app.js
let state = {
  page: 1,
  pageSize: 1000,
  totalPages: 1,
  lastQueryString: ""
};

const $ = (id) => document.getElementById(id);

function getSelectedValues(selectEl) {
  return Array.from(selectEl.selectedOptions).map((o) => o.value).filter(Boolean);
}

// The dashboard UX expects "From/To" to be interpreted as America/New_York wall-clock time,
// then converted to UTC ISO strings before sending to the server.
const USER_TZ = "America/New_York";

function getOffsetMinutes(timeZone, dateUtcInstant) {
  // dateUtcInstant is a JS Date representing an actual UTC instant.
  // Intl will format that instant into the given timeZone, and we compute offset.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(dateUtcInstant);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return (asUTC - dateUtcInstant.getTime()) / 60000;
}

function datetimeLocalToUtcIso(dateTimeLocalStr) {
  // datetime-local is like: "YYYY-MM-DDTHH:mm" (no timezone)
  if (!dateTimeLocalStr) return null;

  const [datePart, timePart] = String(dateTimeLocalStr).split("T");
  if (!datePart || !timePart) return null;

  const [y, mo, d] = datePart.split("-").map((x) => Number(x));
  const [hh, mm] = timePart.split(":").map((x) => Number(x));
  const wallAsUtc = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));

  // Iterate offset computation once to handle DST correctly.
  let utc = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    const offsetMin = getOffsetMinutes(USER_TZ, utc);
    utc = new Date(wallAsUtc.getTime() - offsetMin * 60000);
  }

  return utc.toISOString();
}

function buildQueryString() {
  const from = $("from").value;
  const to = $("to").value;
  const durationBucket = $("durationBucket").value;
  const callDirection = $("callDirection").value || "outbound";
  const disconnectionReasons = getSelectedValues($("disconnectionReasons"));
  const callDispositions = getSelectedValues($("callDispositions"));
  const pageSize = $("pageSize").value;

  const params = new URLSearchParams();
  const fromUtcIso = datetimeLocalToUtcIso(from);
  const toUtcIso = datetimeLocalToUtcIso(to);
  if (fromUtcIso) params.set("from", fromUtcIso);
  if (toUtcIso) params.set("to", toUtcIso);
  if (durationBucket) params.set("durationBucket", durationBucket);
  params.set("callDirection", callDirection);

  // Multi values: send comma-separated
  if (disconnectionReasons.length) params.set("disconnectionReasons", disconnectionReasons.join(","));
  if (callDispositions.length) params.set("callDispositions", callDispositions.join(","));

  params.set("page", String(state.page));
  params.set("pageSize", String(pageSize));

  state.pageSize = parseInt(pageSize, 10);
  const qs = params.toString();
  // console.log("[UI] Built query string:", qs);
  console.log("[UI] Filters:", {
    from,
    to,
    fromUtcIso,
    toUtcIso,
    durationBucket,
    callDirection,
    disconnectionReasons,
    callDispositions,
    page: state.page,
    pageSize: state.pageSize
  });
  return qs;
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function showLoader(message) {
  const root = $("globalLoader");
  const msg = $("loaderMessage");
  if (!root) return;
  if (msg) msg.textContent = message || "Loading…";
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  root.setAttribute("aria-busy", "true");
}

function hideLoader() {
  const root = $("globalLoader");
  if (!root) return;
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("aria-busy", "false");
}

function linkOrDash(url, label) {
  if (!url) return "-";
  const safe = String(url);
  const text = label || "link";
  return `<a href="${safe}" target="_blank" rel="noreferrer">${text}</a>`;
}

function escapeHtml(s) {
  if (s == null || s === "") return "-";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Display any scalar / date-ish value from API (JSON has no Date type). */
function cell(val) {
  if (val == null || val === "") return "-";
  if (typeof val === "object" && val !== null) {
    if (val.$date) return escapeHtml(String(val.$date));
    try {
      return escapeHtml(JSON.stringify(val));
    } catch {
      return "-";
    }
  }
  return escapeHtml(val);
}

function renderTable(rows) {
  const tbody = $("resultsBody");
  tbody.innerHTML = rows.map((r) => {
    return `
      <tr>
        <td>${cell(r.call_id)}</td>
        <td>${cell(r.phone_number)}</td>
        <td>${cell(r.phone_entry_count)}</td>
        <td>${cell(r.CombinedRetellCost)}</td>
        <td>${cell(r.disconnection_reason)}</td>
        <td>${cell(r.call_duration_seconds)}</td>
        <td>${cell(r.ToNumber)}</td>
        <td>${cell(r.FromNumber)}</td>
        <td>${cell(r.call_disposition)}</td>
        <td>${cell(r.call_direction)}</td>
        <td>${cell(r.agent_id)}</td>
        <td>${cell(r.call_start_time)}</td>
        <td>${cell(r.call_start_time_est)}</td>
        <td>${linkOrDash(r.recording_url, "recording")}</td>
        <td>${linkOrDash(r.public_log_url, "log")}</td>
        <td>${cell(r.campaign_id)}</td>
        <td>${cell(r.list_id)}</td>
        <td>${cell(r.first_name)}</td>
        <td>${cell(r.last_name)}</td>
        <td>${cell(r.dob)}</td>
        <td>${cell(r.address)}</td>
        <td>${cell(r.city)}</td>
        <td>${cell(r.state)}</td>
        <td>${cell(r.zip)}</td>
        <td>${cell(r.gender)}</td>
        <td>${cell(r.Lead_type)}</td>
        <td>${cell(r.LeadBoughtDate)}</td>
        <td>${cell(r.LeadBoughtDate_est)}</td>
        <td>${cell(r.LeadBoughtDate_est_dateonly)}</td>
        <td>${cell(r.Vendor)}</td>
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
  // No full-page loader on first tab open — only populate dropdowns quietly.
  try {
    const res = await fetch("/api/meta");
    const meta = await res.json();

    const dr = $("disconnectionReasons");
    const cd = $("callDispositions");

    dr.innerHTML = (meta.disconnectionReasons || []).map((v) => `<option value="${v}">${v}</option>`).join("");
    cd.innerHTML = (meta.callDispositions || []).map((v) => `<option value="${v}">${v}</option>`).join("");
  } catch (e) {
    console.error(e);
    setStatus("Could not load filter options");
  }
}

/**
 * @param {{ showLoader?: boolean, refreshStats?: boolean }} opts
 * showLoader: true only when user explicitly applies filters (Apply button).
 * refreshStats: false on Prev/Next (charts stay for current filter set); true otherwise.
 */
async function loadData(opts = {}) {

  const useOverlay =
  opts.showLoader === true;

  const refreshStats =
  opts.refreshStats !== false;

  if(useOverlay){

    showLoader(
      "Loading results… This may take a while for large date ranges or page sizes."
    );

    setStatus(
      "Loading..."
    );

  }

  const FRONTEND_STARTED =
  performance.now();

  try{

    const qs =
    buildQueryString();

    state.lastQueryString =
    qs;

    console.log(
      "[FRONTEND] Fetch Started"
    );

    const response =
    await fetch(
      `/api/transcriptions?${qs}`
    );

    const json =
    await response.json();

    console.log(

      "[FRONTEND] API Response:",

      (
        performance.now()
        -
        FRONTEND_STARTED
      ).toFixed(0),

      "ms"

    );

    console.log(

      "[FRONTEND SAMPLE]",

      {

        cache:
        json.cache_status,

        rows:
        json.data?.length,

        sample:

        json.data?.[0]

      }

    );

    if(!response.ok){

      setStatus(
        json.error ||
        "Failed"
      );

      renderTable([]);

      renderPager(
        0,
        1
      );

      return;

    }

    const RENDER_STARTED =
    performance.now();

    state.totalPages =
    json.totalPages || 1;

    renderTable(
      json.data || []
    );

    renderPager(

      json.total || 0,

      state.totalPages

    );

    console.log(

      "[FRONTEND] Rendering:",

      (
        performance.now()
        -
        RENDER_STARTED
      ).toFixed(0),

      "ms"

    );

    if(useOverlay){

      hideLoader();

      setStatus("");

    }

    /*
      FETCH STATS AFTER UI RENDERS
    */

    if(
      refreshStats &&
      window.DashboardViz
    ){

      setTimeout(
        async()=>{

          try{

            const statsParams =
            new URLSearchParams(
              qs
            );

            statsParams.delete(
              "page"
            );

            statsParams.delete(
              "pageSize"
            );

            const statsStarted =
            performance.now();

            const statsResponse =
            await fetch(

              `/api/transcriptions/stats?${
                statsParams.toString()
              }`

            );

            const statsJson =
            await statsResponse.json();

            console.log(

              "[STATS] Loaded:",

              (
                performance.now()
                -
                statsStarted
              ).toFixed(0),

              "ms"

            );

            window.DashboardViz.update(
              statsJson
            );

          }

          catch(err){

            console.error(
              "[STATS ERROR]",
              err
            );

          }

        },

        0

      );

    }

  }

  catch(e){

    console.error(
      e
    );

    setStatus(
      "Request Failed"
    );

    renderTable([]);

    renderPager(
      0,
      1
    );

  }

  finally{

    if(useOverlay){

      hideLoader();

    }

  }

}

function resetFilters() {
  $("from").value = "";
  $("to").value = "";
  $("durationBucket").value = "";
  $("callDirection").value = "outbound";
  $("pageSize").value = "1000";

  Array.from($("disconnectionReasons").options).forEach((o) => (o.selected = false));
  Array.from($("callDispositions").options).forEach((o) => (o.selected = false));

  state.page = 1;
}

$("applyBtn").addEventListener("click", async () => {
  state.page = 1;
  await loadData({ showLoader: true });
});

$("resetBtn").addEventListener("click", async () => {
  resetFilters();
  await loadData();
});

$("prevBtn").addEventListener("click", async () => {
  state.page = Math.max(state.page - 1, 1);
  await loadData({ refreshStats: false });
});

$("nextBtn").addEventListener("click", async () => {
  state.page = Math.min(state.page + 1, state.totalPages);
  await loadData({ refreshStats: false });
});

$("downloadBtn").addEventListener("click", async () => {
  const params = new URLSearchParams(state.lastQueryString || buildQueryString());
  params.delete("page");
  params.delete("pageSize");
  const url = `/api/transcriptions/export.csv?${params.toString()}`;

  showLoader("Preparing CSV download… Large exports can take several minutes.");
  setStatus("Preparing CSV…");
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") || "";
    let filename = `transcriptions_export_${Date.now()}.csv`;
    const m = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(dispo);
    if (m) {
      try {
        filename = decodeURIComponent(m[1].replace(/"/g, "").trim());
      } catch {
        filename = m[1].replace(/"/g, "").trim();
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    setStatus("Download started.");
    setTimeout(() => setStatus(""), 4000);
  } catch (e) {
    console.error(e);
    setStatus("CSV download failed");
    alert("CSV download failed: " + (e.message || String(e)));
  } finally {
    hideLoader();
  }
});

// Boot
(async function init() {
  await loadMeta();
  await loadData();
})();
