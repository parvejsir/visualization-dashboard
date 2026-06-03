//public/viz.js
/**
 * Executive charts — Chart.js (CDN). Called from app.js after /api/transcriptions/stats.
 */
(function () {
  const PALETTE = [
    "#5b7cfa",
    "#7c5cfa",
    "#22d3ee",
    "#34d399",
    "#fbbf24",
    "#fb7185",
    "#a78bfa",
    "#38bdf8",
    "#f472b6",
    "#94a3b8",
    "#f97316",
    "#4ade80"
  ];

  const charts = {};

  function destroy(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function destroyAll() {
    Object.keys(charts).forEach(destroy);
  }

  function colorSlice(i) {
    return PALETTE[i % PALETTE.length];
  }

  function pieTooltipPct(total) {
    return {
      callbacks: {
        label(ctx) {
          const v = ctx.raw || 0;
          const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
          return ` ${ctx.label}: ${v} (${pct}%)`;
        }
      }
    };
  }

  function pieTooltipUniqueLeads(uniqueTotal) {
    return {
      callbacks: {
        label(ctx) {
          const v = ctx.raw || 0;
          const pct = uniqueTotal > 0 ? ((v / uniqueTotal) * 100).toFixed(1) : "0";
          return ` ${ctx.label}: ${v} unique leads (${pct}% of unique)`;
        }
      }
    };
  }

  const commonLegend = {
    position: "bottom",
    labels: { color: "#c8d4ff", boxWidth: 12, font: { size: 11 } }
  };

  function showSection(show) {
    const el = document.getElementById("vizSection");
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  function clear() {
    destroyAll();
    showSection(false);
    const kpis = document.getElementById("vizKpis");
    if (kpis) kpis.innerHTML = "";
  }

  function update(stats) {
    if (typeof Chart === "undefined") {
      console.warn("Chart.js not loaded");
      return;
    }

    Chart.defaults.color = "#c8d4ff";
    Chart.defaults.borderColor = "#2a3f72";
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

    const total = stats.totalCalls || 0;
    if (total === 0) {
      clear();
      return;
    }

    showSection(true);

    const ds = stats.durationSummary || {};
    const ul = stats.uniqueLeads || {};
    const uTot = ul.total ?? 0;
    const kpis = document.getElementById("vizKpis");
    if (kpis) {
      kpis.innerHTML = `
        <div class="viz-kpi-row">
          <div class="viz-kpi"><span class="viz-kpi__val">${total.toLocaleString()}</span><span class="viz-kpi__lbl">Total calls (filtered)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ds.gte10 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">≥ 10s (${ds.pctGte10 ?? 0}%)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ds.gte30 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">≥ 30s (${ds.pctGte30 ?? 0}%)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ds.gte60 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">≥ 60s (${ds.pctGte60 ?? 0}%)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ds.gte120 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">≥ 120s (${ds.pctGte120 ?? 0}%)</span></div>
        </div>
        <p class="viz-section-label">Unique leads · deduped by customer phone (same filters)</p>
        <div class="viz-kpi-row">
          <div class="viz-kpi"><span class="viz-kpi__val">${uTot.toLocaleString()}</span><span class="viz-kpi__lbl">Unique leads</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${ul.avgDialsPerUnique ?? 0}</span><span class="viz-kpi__lbl">Avg dials per unique</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ul.redialAtLeast2 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">Unique with ≥2 dials (${ul.pctUniqueWithAtLeast2 ?? 0}%)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ul.redialAtLeast3 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">Unique with ≥3 dials (${ul.pctUniqueWithAtLeast3 ?? 0}%)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ul.redialAtLeast5 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">Unique with ≥5 dials (${ul.pctUniqueWithAtLeast5 ?? 0}%)</span></div>
          <div class="viz-kpi"><span class="viz-kpi__val">${(ul.redialAtLeast10 ?? 0).toLocaleString()}</span><span class="viz-kpi__lbl">Unique with ≥10 dials (${ul.pctUniqueWithAtLeast10 ?? 0}%)</span></div>
        </div>
      `;
    }

    // --- Disposition doughnut ---
    destroy("dispo");
    const dispoRows = stats.byDisposition || [];
    const dispoLabels = dispoRows.map((r) => String(r.key));
    const dispoData = dispoRows.map((r) => r.count);
    const dispoColors = dispoLabels.map((_, i) => colorSlice(i));
    charts.dispo = new Chart(document.getElementById("chartDisposition"), {
      type: "doughnut",
      data: {
        labels: dispoLabels,
        datasets: [{ data: dispoData, backgroundColor: dispoColors, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: commonLegend,
          title: { display: true, text: "Call disposition (share of filtered calls)", color: "#e8ebff", font: { size: 13 } },
          tooltip: pieTooltipPct(total)
        }
      }
    });

    // --- Disconnect doughnut ---
    destroy("disc");
    const discRows = stats.byDisconnectionReason || [];
    charts.disc = new Chart(document.getElementById("chartDisconnect"), {
      type: "doughnut",
      data: {
        labels: discRows.map((r) => String(r.key)),
        datasets: [
          {
            data: discRows.map((r) => r.count),
            backgroundColor: discRows.map((_, i) => colorSlice(i + 3)),
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: commonLegend,
          title: { display: true, text: "Disconnection reason", color: "#e8ebff", font: { size: 13 } },
          tooltip: pieTooltipPct(total)
        }
      }
    });

    // --- Call direction ---
    destroy("dir");
    const dirRows = stats.byDirection || [];
    if (dirRows.length > 0) {
      charts.dir = new Chart(document.getElementById("chartDirection"), {
        type: "pie",
        data: {
          labels: dirRows.map((r) => String(r.key)),
          datasets: [
            {
              data: dirRows.map((r) => r.count),
              backgroundColor: dirRows.map((_, i) => colorSlice(i + 6)),
              borderWidth: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: commonLegend,
            title: { display: true, text: "Call direction", color: "#e8ebff", font: { size: 13 } },
            tooltip: pieTooltipPct(total)
          }
        }
      });
    }

    // --- Duration bar ---
    destroy("dur");
    charts.dur = new Chart(document.getElementById("chartDuration"), {
      type: "bar",
      data: {
        labels: ["≥ 10s", "≥ 30s", "≥ 60s", "≥ 120s"],
        datasets: [
          {
            label: "Calls",
            data: [ds.gte10 ?? 0, ds.gte30 ?? 0, ds.gte60 ?? 0, ds.gte120 ?? 0],
            backgroundColor: ["#5b7cfa", "#7c5cfa", "#22d3ee", "#34d399"]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Call length thresholds (same filtered set)",
            color: "#e8ebff",
            font: { size: 13 }
          }
        }
      }
    });

    // --- Lead type horizontal bar ---
    destroy("lt");
    const ltRows = stats.byLeadType || [];
    charts.lt = new Chart(document.getElementById("chartLeadType"), {
      type: "bar",
      data: {
        labels: ltRows.map((r) => String(r.key)),
        datasets: [{ label: "Calls", data: ltRows.map((r) => r.count), backgroundColor: "#5b7cfa" }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { ticks: { color: "#b8c4ff", font: { size: 10 } }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Calls by lead type (matched lead)", color: "#e8ebff", font: { size: 13 } }
        }
      }
    });

    // --- Vendor horizontal bar ---
    destroy("vendor");
    const vRows = stats.byVendor || [];
    charts.vendor = new Chart(document.getElementById("chartVendor"), {
      type: "bar",
      data: {
        labels: vRows.map((r) => String(r.key)),
        datasets: [{ label: "Calls", data: vRows.map((r) => r.count), backgroundColor: "#22d3ee" }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { ticks: { color: "#b8c4ff", font: { size: 10 } }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          title: { display: true, text: "Calls by vendor (matched lead)", color: "#e8ebff", font: { size: 13 } }
        }
      }
    });

    // --- Lead bought date (ET date) line ---
    destroy("buyDate");
    const bdRows = stats.byLeadBoughtDate || [];
    charts.buyDate = new Chart(document.getElementById("chartLeadBoughtDate"), {
      type: "line",
      data: {
        labels: bdRows.map((r) => String(r.date)),
        datasets: [
          {
            label: "Calls",
            data: bdRows.map((r) => r.count),
            borderColor: "#a78bfa",
            backgroundColor: "rgba(167,139,250,0.15)",
            fill: true,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#b8c4ff", maxRotation: 60, font: { size: 9 } }, grid: { color: "#22305d" } },
          y: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Calls by lead purchase date (ET, date only)",
            color: "#e8ebff",
            font: { size: 13 }
          }
        }
      }
    });

    // --- Lead type × buy date (top combos) ---
    destroy("combo");
    const combo = stats.leadTypeByBuyDate || [];
    const top = combo.slice(0, 24);
    charts.combo = new Chart(document.getElementById("chartLeadTypeBuyDate"), {
      type: "bar",
      data: {
        labels: top.map((r) => r.label || `${r.leadType} · ${r.buyDate}`),
        datasets: [{ label: "Calls", data: top.map((r) => r.count), backgroundColor: "#f472b6" }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { ticks: { color: "#b8c4ff", font: { size: 9 } }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Top lead type × lead bought date (ET) combinations",
            color: "#e8ebff",
            font: { size: 13 }
          }
        }
      }
    });

    // ========== Unique leads & redial (same filter set) ==========
    const uniqV = stats.uniqueByVendor || [];

    destroy("uniqVendor");
    charts.uniqVendor = new Chart(document.getElementById("chartUniqueVendorDoughnut"), {
      type: "doughnut",
      data: {
        labels: uniqV.map((r) => String(r.key)),
        datasets: [
          {
            data: uniqV.map((r) => r.uniqueLeads),
            backgroundColor: uniqV.map((_, i) => colorSlice(i)),
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: commonLegend,
          title: {
            display: true,
            text: "Unique leads by vendor (% of unique, not total calls)",
            color: "#e8ebff",
            font: { size: 13 }
          },
          tooltip: pieTooltipUniqueLeads(uTot)
        }
      }
    });

    destroy("uniqLt");
    const uniqLt = stats.uniqueByLeadType || [];
    charts.uniqLt = new Chart(document.getElementById("chartUniqueLeadTypeBar"), {
      type: "bar",
      data: {
        labels: uniqLt.map((r) => String(r.key)),
        datasets: [
          {
            label: "Unique leads",
            data: uniqLt.map((r) => r.uniqueLeads),
            backgroundColor: "#a78bfa"
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { ticks: { color: "#b8c4ff", font: { size: 10 } }, grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Unique leads by lead type (matched lead)",
            color: "#e8ebff",
            font: { size: 13 }
          },
          tooltip: {
            callbacks: {
              afterLabel(ctx) {
                const row = uniqLt[ctx.dataIndex];
                return row ? ` ${row.pct}% of ${uTot.toLocaleString()} unique` : "";
              }
            }
          }
        }
      }
    });

    destroy("uniqBuy");
    const uniqBd = stats.uniqueByLeadBoughtDate || [];
    charts.uniqBuy = new Chart(document.getElementById("chartUniqueLeadBoughtDate"), {
      type: "line",
      data: {
        labels: uniqBd.map((r) => String(r.date)),
        datasets: [
          {
            label: "Unique leads",
            data: uniqBd.map((r) => r.uniqueLeads),
            borderColor: "#34d399",
            backgroundColor: "rgba(52,211,153,0.12)",
            fill: true,
            tension: 0.25
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#b8c4ff", maxRotation: 60, font: { size: 9 } }, grid: { color: "#22305d" } },
          y: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Unique leads by lead purchase date (ET, date only)",
            color: "#e8ebff",
            font: { size: 13 }
          }
        }
      }
    });

    destroy("redialBar");
    charts.redialBar = new Chart(document.getElementById("chartRedialThresholds"), {
      type: "bar",
      data: {
        labels: ["≥2 dials", "≥3 dials", "≥5 dials", "≥10 dials"],
        datasets: [
          {
            label: "Unique leads",
            data: [
              ul.redialAtLeast2 ?? 0,
              ul.redialAtLeast3 ?? 0,
              ul.redialAtLeast5 ?? 0,
              ul.redialAtLeast10 ?? 0
            ],
            backgroundColor: ["#5b7cfa", "#7c5cfa", "#f472b6", "#fb7185"]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Redial intensity: unique phones with N+ calls in filter",
            color: "#e8ebff",
            font: { size: 13 }
          },
          tooltip: {
            callbacks: {
              afterLabel(ctx) {
                const labels = [
                  ul.pctUniqueWithAtLeast2,
                  ul.pctUniqueWithAtLeast3,
                  ul.pctUniqueWithAtLeast5,
                  ul.pctUniqueWithAtLeast10
                ];
                const p = labels[ctx.dataIndex];
                return p != null ? ` ${p}% of ${uTot.toLocaleString()} unique leads` : "";
              }
            }
          }
        }
      }
    });

    destroy("dialHist");
    const hist = stats.dialCountHistogram || [];
    charts.dialHist = new Chart(document.getElementById("chartDialHistogram"), {
      type: "bar",
      data: {
        labels: hist.map((r) => r.bucket),
        datasets: [
          {
            label: "Unique leads",
            data: hist.map((r) => r.uniqueLeads),
            backgroundColor: hist.map((_, i) => colorSlice(i + 4))
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } },
          y: { beginAtZero: true, ticks: { color: "#b8c4ff" }, grid: { color: "#22305d" } }
        },
        plugins: {
          legend: { display: false },
          title: {
            display: true,
            text: "Distribution: how many dials per unique lead (1, 2, 3, 4–9, 10+)",
            color: "#e8ebff",
            font: { size: 13 }
          },
          tooltip: {
            callbacks: {
              afterLabel(ctx) {
                const n = hist[ctx.dataIndex]?.uniqueLeads ?? 0;
                const pct = uTot > 0 ? ((n / uTot) * 100).toFixed(1) : "0";
                return ` ${pct}% of unique leads`;
              }
            }
          }
        }
      }
    });
  }

  window.DashboardViz = { update, clear };
})();
