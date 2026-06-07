// public/analytics/store.js — lightweight observable store shared by all analytics pages
// Eliminates repeated API calls: data is fetched once per param set and consumed by all cards.
(function (window) {
  "use strict";

  // Create a per-page store factory
  function createStore(initial) {
    let state = Object.assign({ status: "idle", data: null, lastParamsHash: null, error: null }, initial || {});
    const listeners = [];

    const store = {
      getState() { return state; },

      setState(partial) {
        state = Object.assign({}, state, partial);
        listeners.forEach(fn => { try { fn(state); } catch (e) { console.error("store listener error", e); } });
      },

      subscribe(fn) {
        listeners.push(fn);
        return function unsubscribe() {
          const i = listeners.indexOf(fn);
          if (i !== -1) listeners.splice(i, 1);
        };
      },

      // Returns true if the store holds data for a different param set than params
      isStale(params) {
        return state.lastParamsHash !== JSON.stringify(params);
      },

      markFresh(params) {
        this.setState({ lastParamsHash: JSON.stringify(params) });
      }
    };

    return store;
  }

  // ---- Date utility: convert datetime-local (ET wall-clock) to UTC ISO string ----
  // Exact same algorithm as public/app.js — handles EDT/EST DST transitions correctly.
  // datetime-local inputs have NO timezone; the UI labels them "(ET)" so we treat them
  // as America/New_York wall-clock time and convert to UTC before sending to the server.
  const USER_TZ = "America/New_York";

  function getOffsetMinutes(timeZone, dateUtcInstant) {
    // Use Intl to get what ET wall-clock looks like for this UTC instant,
    // then compute offset = (etWallAsIfUtc - utcInstant)
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
    const parts = dtf.formatToParts(dateUtcInstant);
    const map = {};
    for (const p of parts) { if (p.type !== "literal") map[p.type] = p.value; }
    const asUTC = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour), Number(map.minute), Number(map.second)
    );
    return (asUTC - dateUtcInstant.getTime()) / 60000;
  }

  function datetimeLocalToUtcIso(localStr) {
    // localStr = "YYYY-MM-DDTHH:mm" with no TZ — user intends America/New_York
    if (!localStr) return null;
    const [datePart, timePart] = String(localStr).split("T");
    if (!datePart || !timePart) return null;
    const [y, mo, d] = datePart.split("-").map(Number);
    const [hh, mm]   = timePart.split(":").map(Number);
    // Treat wall-clock digits as UTC first, then subtract the ET offset (DST-aware)
    const wallAsUtc = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
    // Two iterations handles the DST boundary edge case (same approach as app.js)
    let utc = wallAsUtc;
    for (let i = 0; i < 2; i++) {
      const offsetMin = getOffsetMinutes(USER_TZ, utc);
      utc = new Date(wallAsUtc.getTime() - offsetMin * 60000);
    }
    return utc.toISOString();
  }

  // ---- Param helpers ----
  function getFilterParams() {
    const from = document.getElementById("fromInput")?.value;
    const to   = document.getElementById("toInput")?.value;
    const params = {};
    if (from) params.from = datetimeLocalToUtcIso(from);
    if (to)   params.to   = datetimeLocalToUtcIso(to);
    return params;
  }

  function buildQS(params) {
    const p = new URLSearchParams();
    if (params.from) p.set("from", params.from);
    if (params.to)   p.set("to",   params.to);
    return p.toString();
  }

  // Expose
  window.AnalyticsStore   = createStore();
  window.StoreUtils       = { datetimeLocalToUtcIso, getFilterParams, buildQS };
})(window);
