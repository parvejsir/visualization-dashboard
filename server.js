const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const { MongoClient } = require("mongodb");
const { stringify } = require("csv-stringify");

dotenv.config();

const app = express();
console.log("BOOTED FROM:", __dirname);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//app.use("/public", express.static(path.join(__dirname, "public")));

const publicDir = path.join(__dirname, "public");
console.log("Serving static from:", publicDir);
app.use("/public", express.static(publicDir));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;

if (!MONGO_URI) throw new Error("Missing MONGO_URI in .env");
if (!DB_NAME) throw new Error("Missing DB_NAME in .env");

// ---- Mongo client (single shared connection) ----
let client;
let db;

async function getDb() {
  if (db) return db;
  client = new MongoClient(MONGO_URI, {
    maxPoolSize: 20,
    // Increase server selection timeout so slow / distant clusters don't immediately fail
    serverSelectionTimeoutMS: 10000000
  });
  await client.connect();
  db = client.db(DB_NAME);
  console.log("✅ Connected to MongoDB");
  return db;
}

// ---- Helpers: parsing query params safely ----
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean);
  return String(val).split(",").map((x) => x.trim()).filter(Boolean);
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Debug helper: show Dates in a Mongo-shell-like way.
// IMPORTANT: This is for logging only; the real pipeline uses actual Date objects.
function toIsoDateStringForLog(value) {
  if (value instanceof Date) return `ISODate("${value.toISOString()}")`;
  if (Array.isArray(value)) return value.map(toIsoDateStringForLog);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toIsoDateStringForLog(v);
    return out;
  }
  return value;
}

/** outbound | inbound | both — drives $match on direction + which number field maps to customer phone */
function getCallDirectionMode(q) {
  const v = String(q.callDirection || "outbound").toLowerCase().trim();
  if (v === "inbound") return "inbound";
  if (v === "both" || v === "all") return "both";
  return "outbound";
}

function buildPhoneStrAddFieldsStage(directionMode) {
  // Outbound: customer on to_number. Inbound: customer on from_number (swap).
  const customerE164 =
    directionMode === "inbound"
      ? "$body.call.from_number"
      : directionMode === "outbound"
        ? "$body.call.to_number"
        : {
            $cond: [
              { $eq: ["$body.call.direction", "inbound"] },
              "$body.call.from_number",
              "$body.call.to_number"
            ]
          };

  return {
    $addFields: {
      phone_str: {
        $substrBytes: [{ $ifNull: [customerE164, ""] }, 2, 10]
      }
    }
  };
}

function buildMatchFromFilters(q) {
  const directionMode = getCallDirectionMode(q);

  const match = {
    "body.event": "call_analyzed"
  };

  if (directionMode === "both") {
    match["body.call.direction"] = { $in: ["inbound", "outbound"] };
  } else {
    match["body.call.direction"] = directionMode;
  }

  // Date range (createdAt)
  const from = parseDate(q.from);
  const to = parseDate(q.to);
  if (from || to) {
    match.createdAt = {};
    if (from) match.createdAt.$gte = from;
    if (to) match.createdAt.$lte = to;
  }

  // Multi-select: disconnection_reason
  const disconnectionReasons = toArray(q.disconnectionReasons);
  if (disconnectionReasons.length) {
    match["body.call.disconnection_reason"] = { $in: disconnectionReasons };
  }

  // Multi-select: call_disposition
  const callDispositions = toArray(q.callDispositions);
  if (callDispositions.length) {
    match["body.call.call_analysis.custom_analysis_data.call_disposition"] = { $in: callDispositions };
  }

  // Duration buckets (seconds) - apply only if selected
  // durationBucket = "gte3" | "gte10" | "gte30" | "gte60" | "gte120" | ""
  const durationBucket = String(q.durationBucket || "");
  const field = "body.call.call_cost.total_duration_seconds";
  if (durationBucket === "gte3") match[field] = { $gte: 3 };
  if (durationBucket === "gte10") match[field] = { $gte: 10 };
  if (durationBucket === "gte30") match[field] = { $gte: 30 };
  if (durationBucket === "gte60") match[field] = { $gte: 60 };
  if (durationBucket === "gte120") match[field] = { $gte: 120 };

  return { match, directionMode };
}

function buildBasePipeline(match, directionMode) {
  return [
    // IMPORTANT: match MUST include all user-selected constraints (date, duration, reasons, dispositions)
    { $match: match },

    // ---- Safe phone extraction (+1XXXXXXXXXX -> XXXXXXXXXX) ----
    // outbound: to_number | inbound: from_number | both: pick by body.call.direction
    buildPhoneStrAddFieldsStage(directionMode),
    {
      $addFields: {
        phone: {
          $cond: [
            {
              $regexMatch: {
                input: "$phone_str",
                regex: /^[0-9]{10}$/
              }
            },
            {
              $convert: {
                input: "$phone_str",
                to: "long",
                onError: null,
                onNull: null
              }
            },
            null
          ]
        }
      }
    },
    // Ignore docs where we couldn't extract a valid 10-digit number
    { $match: { phone: { $ne: null } } },

    // Per-phone count across the matched dataset
    {
      $setWindowFields: {
        partitionBy: "$phone",
        output: {
          phone_entry_count: {
            $count: {}
          }
        }
      }
    },

    {
      $lookup: {
        from: "realtimeleads",
        localField: "phone",
        foreignField: "phone",
        as: "matched_data"
      }
    },

    {
      $project: {
        _id: 0,
        phone_number: "$phone",
        phone_entry_count: 1,
        call_id: "$body.call.call_id",
        CombinedRetellCost: "$body.call.call_cost.combined_cost",
        disconnection_reason: "$body.call.disconnection_reason",
        call_duration_seconds: "$body.call.call_cost.total_duration_seconds",
        ToNumber: "$body.call.to_number",
        FromNumber: "$body.call.from_number",
        call_disposition: "$body.call.call_analysis.custom_analysis_data.call_disposition",
        call_direction: "$body.call.direction",
        agent_id: "$body.call.agent_id",
        call_start_time: "$body.call.start_timestamp",

        // epoch millis -> ET formatted string
        call_start_time_est: {
          $dateToString: {
            date: { $toDate: "$body.call.start_timestamp" },
            timezone: "America/New_York",
            format: "%Y-%m-%d %H:%M:%S"
          }
        },

        public_log_url: "$body.call.public_log_url",
        recording_url: "$body.call.recording_url",
        campaign_id: "$body.call.vicidialRequestBody.campaign_id",
        list_id: "$body.call.vicidialRequestBody.list_id",
        first_name: { $arrayElemAt: ["$matched_data.fname", 0] },
        last_name: { $arrayElemAt: ["$matched_data.lname", 0] },
        dob: { $arrayElemAt: ["$matched_data.dob", 0] },
        address: { $arrayElemAt: ["$matched_data.address", 0] },
        city: { $arrayElemAt: ["$matched_data.city", 0] },
        state: { $arrayElemAt: ["$matched_data.state", 0] },
        zip: { $arrayElemAt: ["$matched_data.zip", 0] },
        gender: { $arrayElemAt: ["$matched_data.gender", 0] },
        Lead_type: { $arrayElemAt: ["$matched_data.type", 0] },
        LeadBoughtDate: { $arrayElemAt: ["$matched_data.createdAt", 0] },

        // LeadBoughtDate -> ET formatted string + date-only
        LeadBoughtDate_est: {
          $cond: [
            { $ne: [{ $arrayElemAt: ["$matched_data.createdAt", 0] }, null] },
            {
              $dateToString: {
                date: { $arrayElemAt: ["$matched_data.createdAt", 0] },
                timezone: "America/New_York",
                format: "%Y-%m-%d %H:%M:%S"
              }
            },
            null
          ]
        },
        LeadBoughtDate_est_dateonly: {
          $cond: [
            { $ne: [{ $arrayElemAt: ["$matched_data.createdAt", 0] }, null] },
            {
              $dateToString: {
                date: { $arrayElemAt: ["$matched_data.createdAt", 0] },
                timezone: "America/New_York",
                format: "%Y-%m-%d"
              }
            },
            null
          ]
        },

        Vendor: { $arrayElemAt: ["$matched_data.vendor", 0] }
      }
    }
  ];
}

/**
 * Same filtered population as the table (match → phone → lookup leads), without $setWindowFields / $project.
 * Used only for executive summary charts across the full filtered set (not the current page).
 */
function buildStatsPipeline(match, directionMode) {
  const phoneConvert = {
    $addFields: {
      phone: {
        $cond: [
          {
            $regexMatch: {
              input: "$phone_str",
              regex: /^[0-9]{10}$/
            }
          },
          {
            $convert: {
              input: "$phone_str",
              to: "long",
              onError: null,
              onNull: null
            }
          },
          null
        ]
      }
    }
  };

  return [
    { $match: match },
    buildPhoneStrAddFieldsStage(directionMode),
    phoneConvert,
    { $match: { phone: { $ne: null } } },
    {
      $lookup: {
        from: "realtimeleads",
        localField: "phone",
        foreignField: "phone",
        as: "matched_data"
      }
    },
    {
      $addFields: {
        _dispo: { $ifNull: ["$body.call.call_analysis.custom_analysis_data.call_disposition", ""] },
        _disc: { $ifNull: ["$body.call.disconnection_reason", ""] },
        _dur: { $ifNull: ["$body.call.call_cost.total_duration_seconds", 0] },
        _dir: { $ifNull: ["$body.call.direction", ""] },
        _leadType: { $ifNull: [{ $arrayElemAt: ["$matched_data.type", 0] }, ""] },
        _vendor: { $ifNull: [{ $arrayElemAt: ["$matched_data.vendor", 0] }, ""] },
        _leadBoughtDateOnly: {
          $cond: [
            { $ne: [{ $arrayElemAt: ["$matched_data.createdAt", 0] }, null] },
            {
              $dateToString: {
                date: { $arrayElemAt: ["$matched_data.createdAt", 0] },
                timezone: "America/New_York",
                format: "%Y-%m-%d"
              }
            },
            ""
          ]
        }
      }
    },
    {
      $facet: {
        meta: [{ $count: "total" }],
        byDisposition: [
          {
            $group: {
              _id: { $cond: [{ $eq: ["$_dispo", ""] }, "(none)", "$_dispo"] },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } }
        ],
        byDisconnect: [
          {
            $group: {
              _id: { $cond: [{ $eq: ["$_disc", ""] }, "(none)", "$_disc"] },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } }
        ],
        byDirection: [{ $group: { _id: { $cond: [{ $eq: ["$_dir", ""] }, "(unknown)", "$_dir"] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }],
        durationThresholds: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              gte10: { $sum: { $cond: [{ $gte: ["$_dur", 10] }, 1, 0] } },
              gte30: { $sum: { $cond: [{ $gte: ["$_dur", 30] }, 1, 0] } },
              gte60: { $sum: { $cond: [{ $gte: ["$_dur", 60] }, 1, 0] } },
              gte120: { $sum: { $cond: [{ $gte: ["$_dur", 120] }, 1, 0] } }
            }
          }
        ],
        byLeadType: [
          {
            $group: {
              _id: { $cond: [{ $eq: ["$_leadType", ""] }, "(no type)", "$_leadType"] },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 25 }
        ],
        byVendor: [
          {
            $group: {
              _id: { $cond: [{ $eq: ["$_vendor", ""] }, "(no vendor)", "$_vendor"] },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 25 }
        ],
        byLeadBoughtDate: [
          {
            $group: {
              _id: { $cond: [{ $eq: ["$_leadBoughtDateOnly", ""] }, "(unknown)", "$_leadBoughtDateOnly"] },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 90 }
        ],
        leadTypeByBuyDate: [
          {
            $group: {
              _id: {
                lt: { $cond: [{ $eq: ["$_leadType", ""] }, "(no type)", "$_leadType"] },
                bd: { $cond: [{ $eq: ["$_leadBoughtDateOnly", ""] }, "(unknown)", "$_leadBoughtDateOnly"] }
              },
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 100 }
        ],

        // ---- Unique leads (dedupe by $phone within filtered set) ----
        uniqueLeadDialMetrics: [
          { $group: { _id: "$phone", dialCount: { $sum: 1 } } },
          {
            $group: {
              _id: null,
              totalUniqueLeads: { $sum: 1 },
              atLeast2: { $sum: { $cond: [{ $gte: ["$dialCount", 2] }, 1, 0] } },
              atLeast3: { $sum: { $cond: [{ $gte: ["$dialCount", 3] }, 1, 0] } },
              atLeast5: { $sum: { $cond: [{ $gte: ["$dialCount", 5] }, 1, 0] } },
              atLeast10: { $sum: { $cond: [{ $gte: ["$dialCount", 10] }, 1, 0] } }
            }
          }
        ],
        uniqueLeadByVendor: [
          { $group: { _id: "$phone", vendor: { $first: "$_vendor" } } },
          {
            $group: {
              _id: {
                $cond: [
                  { $or: [{ $eq: ["$vendor", ""] }, { $eq: ["$vendor", null] }] },
                  "(no vendor)",
                  "$vendor"
                ]
              },
              uniqueLeads: { $sum: 1 }
            }
          },
          { $sort: { uniqueLeads: -1 } },
          { $limit: 30 }
        ],
        uniqueLeadByLeadType: [
          { $group: { _id: "$phone", leadType: { $first: "$_leadType" } } },
          {
            $group: {
              _id: { $cond: [{ $eq: ["$leadType", ""] }, "(no type)", "$leadType"] },
              uniqueLeads: { $sum: 1 }
            }
          },
          { $sort: { uniqueLeads: -1 } },
          { $limit: 25 }
        ],
        uniqueLeadByBuyDate: [
          { $group: { _id: "$phone", buyDate: { $first: "$_leadBoughtDateOnly" } } },
          {
            $group: {
              _id: { $cond: [{ $eq: ["$buyDate", ""] }, "(unknown)", "$buyDate"] },
              uniqueLeads: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } },
          { $limit: 90 }
        ],
        dialCountHistogram: [
          { $group: { _id: "$phone", dialCount: { $sum: 1 } } },
          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    { case: { $eq: ["$dialCount", 1] }, then: "1 call" },
                    { case: { $eq: ["$dialCount", 2] }, then: "2 calls" },
                    { case: { $eq: ["$dialCount", 3] }, then: "3 calls" },
                    {
                      case: { $and: [{ $gte: ["$dialCount", 4] }, { $lte: ["$dialCount", 9] }] },
                      then: "4–9 calls"
                    }
                  ],
                  default: "10+ calls"
                }
              },
              uniqueLeads: { $sum: 1 }
            }
          }
        ]
      }
    }
  ];
}

function withPct(rows, total) {
  const t = Math.max(1, total);
  return (rows || []).map((r) => ({
    key: r._id,
    count: r.count,
    pct: Math.round((r.count / t) * 1000) / 10
  }));
}

/** For unique-lead breakdowns: pct is share of unique leads (not total calls). */
function withUniqueLeadPct(rows, uniqueTotal) {
  const t = Math.max(1, uniqueTotal);
  return (rows || []).map((r) => ({
    key: r._id,
    uniqueLeads: r.uniqueLeads,
    pct: Math.round((r.uniqueLeads / t) * 1000) / 10
  }));
}

const DIAL_HIST_ORDER = ["1 call", "2 calls", "3 calls", "4–9 calls", "10+ calls"];

function sortDialHistogram(rows) {
  const list = rows || [];
  return [...list].sort(
    (a, b) => DIAL_HIST_ORDER.indexOf(a.bucket) - DIAL_HIST_ORDER.indexOf(b.bucket)
  );
}

function formatStatsResult(facetOut) {
  const f = facetOut || {};
  const total = f.meta?.[0]?.total ?? 0;
  const dur = f.durationThresholds?.[0] || { total: 0, gte10: 0, gte30: 0, gte60: 0, gte120: 0 };
  const t = Math.max(1, total);

  const um = f.uniqueLeadDialMetrics?.[0] || {};
  const uniqueTotal = um.totalUniqueLeads ?? 0;
  const uq = Math.max(1, uniqueTotal);

  return {
    totalCalls: total,
    uniqueLeads: {
      total: uniqueTotal,
      avgDialsPerUnique:
        uniqueTotal > 0 && total > 0 ? Math.round((total / uniqueTotal) * 100) / 100 : 0,
      redialAtLeast2: um.atLeast2 ?? 0,
      redialAtLeast3: um.atLeast3 ?? 0,
      redialAtLeast5: um.atLeast5 ?? 0,
      redialAtLeast10: um.atLeast10 ?? 0,
      pctUniqueWithAtLeast2: Math.round(((um.atLeast2 ?? 0) / uq) * 1000) / 10,
      pctUniqueWithAtLeast3: Math.round(((um.atLeast3 ?? 0) / uq) * 1000) / 10,
      pctUniqueWithAtLeast5: Math.round(((um.atLeast5 ?? 0) / uq) * 1000) / 10,
      pctUniqueWithAtLeast10: Math.round(((um.atLeast10 ?? 0) / uq) * 1000) / 10
    },
    uniqueByVendor: withUniqueLeadPct(f.uniqueLeadByVendor, uniqueTotal),
    uniqueByLeadType: withUniqueLeadPct(f.uniqueLeadByLeadType, uniqueTotal),
    uniqueByLeadBoughtDate: (f.uniqueLeadByBuyDate || []).map((r) => ({
      date: r._id,
      uniqueLeads: r.uniqueLeads
    })),
    dialCountHistogram: sortDialHistogram(
      (f.dialCountHistogram || []).map((r) => ({
        bucket: r._id,
        uniqueLeads: r.uniqueLeads
      }))
    ),
    durationSummary: {
      total: dur.total || total,
      gte10: dur.gte10 ?? 0,
      gte30: dur.gte30 ?? 0,
      gte60: dur.gte60 ?? 0,
      gte120: dur.gte120 ?? 0,
      pctGte10: Math.round(((dur.gte10 ?? 0) / t) * 1000) / 10,
      pctGte30: Math.round(((dur.gte30 ?? 0) / t) * 1000) / 10,
      pctGte60: Math.round(((dur.gte60 ?? 0) / t) * 1000) / 10,
      pctGte120: Math.round(((dur.gte120 ?? 0) / t) * 1000) / 10
    },
    byDisposition: withPct(f.byDisposition, total),
    byDisconnectionReason: withPct(f.byDisconnect, total),
    byDirection: withPct(f.byDirection, total),
    byLeadType: withPct(f.byLeadType, total),
    byVendor: withPct(f.byVendor, total),
    byLeadBoughtDate: (f.byLeadBoughtDate || []).map((r) => ({
      date: r._id,
      count: r.count
    })),
    leadTypeByBuyDate: (f.leadTypeByBuyDate || []).map((r) => ({
      leadType: r._id?.lt ?? "(no type)",
      buyDate: r._id?.bd ?? "(unknown)",
      count: r.count,
      label: `${r._id?.lt ?? "?"} · ${r._id?.bd ?? "?"}`
    }))
  };
}

// ---- Views ----
app.get("/", (req, res) => {
  res.render("dashboard");
});

// ---- Filters metadata (distinct lists for dropdowns) ----
app.get("/api/meta", async (req, res) => {
  try {
    // Hard-coded lists provided by you so that
    // the dashboard always shows all options on load.
    const disconnectionReasons = [
      "no_answer",
      "adc",
      "voicemail_reached",
      "user_hangup",
      "agent_hangup",
      "pdrop",
      "inactivity",
      "busy",
      "call_transfer",
      "error_unknown",
      "max_duration_reached"
    ];

    const callDispositions = [
      "NA",
      "ADC",
      "VM",
      "HU",
      "NHO",
      "PDROP",
      "NI",
      "DNC",
      "CALLBK",
      "INA",
      "BUSY",
      "WN",
      "LB",
      "AA",
      "XFER"
    ];

    res.json({
      disconnectionReasons,
      callDispositions
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load meta" });
  }
});

// ---- Main data endpoint (pagination) ----
app.get("/api/transcriptions", async (req, res) => {
  try {
    const started = Date.now();
    // console.log("========================================");
    // console.log("[API] /api/transcriptions called");
    // console.log("[API] Raw query params:", req.query);

    const db = await getDb();
    const col = db.collection("transcriptions");

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "1000", 10), 1), 1000);

    const { match, directionMode } = buildMatchFromFilters(req.query);
    //console.log("[API] Match stage:", JSON.stringify(match, null, 2));
    if (match.createdAt) {
      console.log(
        "[API] createdAt types:",
        "gte ->",
        match.createdAt.$gte,
        "type:",
        typeof match.createdAt.$gte,
        "isDate:",
        match.createdAt.$gte instanceof Date,
        "| lte ->",
        match.createdAt.$lte,
        "type:",
        typeof match.createdAt.$lte,
        "isDate:",
        match.createdAt.$lte instanceof Date
      );
    }

    const base = buildBasePipeline(match, directionMode);
    console.log("[API] Base pipeline stages:", base.length, "directionMode:", directionMode);

    // Sort newest first (you can change)
    const sortStage = { $sort: { call_start_time: -1 } };

    const pipeline = [
      ...base,
      sortStage,
      {
        $facet: {
          data: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
          total: [{ $count: "count" }]
        }
      }
    ];

    // console.log("[API] Final pipeline length (stages):", pipeline.length);
    console.log(
      "[API] Final aggregation pipeline (debug):",
      JSON.stringify(toIsoDateStringForLog(pipeline), null, 2)
    );

    const agg = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const durationMs = Date.now() - started;

    const out = agg[0] || { data: [], total: [] };
    const total = out.total?.[0]?.count || 0;

    // console.log("[API] Aggregation finished in ms:", durationMs);
    // console.log("[API] Total rows:", total);
    if (out.data && out.data.length) {
      console.log("[API] Sample row:", out.data[0]);
    } else {
      console.log("[API] No rows returned");
    }

    res.json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: out.data
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Query failed" });
  }
});

// ---- Stats for charts (full filtered set; same filters as table, ignores pagination) ----
app.get("/api/transcriptions/stats", async (req, res) => {
  try {
    const db = await getDb();
    const col = db.collection("transcriptions");

    const { match, directionMode } = buildMatchFromFilters(req.query);
    const pipeline = buildStatsPipeline(match, directionMode);

    const agg = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const facet = agg[0] || {};
    const stats = formatStatsResult(facet);

    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Stats query failed" });
  }
});

// ---- CSV Export (all rows for current filters) ----
app.get("/api/transcriptions/export.csv", async (req, res) => {
  try {
    const db = await getDb();
    const col = db.collection("transcriptions");

    const { match, directionMode } = buildMatchFromFilters(req.query);
    const base = buildBasePipeline(match, directionMode);

    const sortStage = { $sort: { call_start_time: -1 } };

    // For very large exports, consider adding a hard cap or background job.
    const cursor = col.aggregate([...base, sortStage], { allowDiskUse: true });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="transcriptions_export_${Date.now()}.csv"`
    );

    const stringifier = stringify({
      header: true,
      columns: [
        "call_id",
        "phone_number",
        "phone_entry_count",
        "CombinedRetellCost",
        "disconnection_reason",
        "call_duration_seconds",
        "ToNumber",
        "FromNumber",
        "call_disposition",
        "call_direction",
        "agent_id",
        "call_start_time",
        "call_start_time_est",
        "recording_url",
        "public_log_url",
        "campaign_id",
        "list_id",
        "first_name",
        "last_name",
        "dob",
        "address",
        "city",
        "state",
        "zip",
        "gender",
        "Lead_type",
        "LeadBoughtDate",
        "LeadBoughtDate_est",
        "LeadBoughtDate_est_dateonly",
        "Vendor"
      ]
    });

    stringifier.pipe(res);

    for await (const doc of cursor) {
      stringifier.write(doc);
    }
    stringifier.end();
  } catch (e) {
    console.error(e);
    res.status(500).send("CSV export failed");
  }
});

app.get("/__health", (req, res) => res.send("ok"));
// ---- Start ----
app.listen(PORT, () => {
  console.log(`🚀 Dashboard running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  try {
    if (client) await client.close();
  } finally {
    process.exit(0);
  }
});