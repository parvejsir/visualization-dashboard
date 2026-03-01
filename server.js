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
  client = new MongoClient(MONGO_URI, { maxPoolSize: 20 });
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

function buildMatchFromFilters(q) {
  // Fixed constraints from your example
  const match = {
    "body.event": "call_analyzed",
    "body.call.direction": "outbound"
  };

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
  // durationBucket = "gte10" | "gte50" | "gte100" | ""
  const durationBucket = String(q.durationBucket || "");
  const field = "body.call.call_cost.total_duration_seconds";
  if (durationBucket === "gte10") match[field] = { $gte: 10 };
  if (durationBucket === "gte50") match[field] = { $gte: 50 };
  if (durationBucket === "gte100") match[field] = { $gte: 100 };

  return match;
}

function buildBasePipeline(match) {
  return [
    { $match: match },

    // Normalize phone once: remove "+1" (your logic)
    {
      $addFields: {
        phone: {
          $toLong: { $substr: ["$body.call.to_number", 2, 10] }
        }
      }
    },

    // NOTE: Requires MongoDB 5.0+ (window functions)
    {
      $setWindowFields: {
        partitionBy: "$phone",
        output: { phone_entry_count: { $count: {} } }
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
        disconnection_reason: "$body.call.disconnection_reason",
        call_duration_seconds: "$body.call.call_cost.total_duration_seconds",
        call_disposition: "$body.call.call_analysis.custom_analysis_data.call_disposition",
        call_direction: "$body.call.direction",
        agent_id: "$body.call.agent_id",
        call_start_time: "$body.call.start_timestamp",
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

// ---- Views ----
app.get("/", (req, res) => {
  res.render("dashboard");
});

// ---- Filters metadata (distinct lists for dropdowns) ----
app.get("/api/meta", async (req, res) => {
  try {
    const db = await getDb();
    const col = db.collection("transcriptions");

    // Keep it consistent with your fixed constraints
    const baseMatch = {
      "body.event": "call_analyzed",
      "body.call.direction": "outbound"
    };

    const [disconnectionReasons, callDispositions] = await Promise.all([
      col.distinct("body.call.disconnection_reason", baseMatch),
      col.distinct("body.call.call_analysis.custom_analysis_data.call_disposition", baseMatch)
    ]);

    res.json({
      disconnectionReasons: (disconnectionReasons || []).filter(Boolean).sort(),
      callDispositions: (callDispositions || []).filter(Boolean).sort()
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to load meta" });
  }
});

// ---- Main data endpoint (pagination) ----
app.get("/api/transcriptions", async (req, res) => {
  try {
    const db = await getDb();
    const col = db.collection("transcriptions");

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || "25", 10), 1), 200);

    const match = buildMatchFromFilters(req.query);
    const base = buildBasePipeline(match);

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

    const agg = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const out = agg[0] || { data: [], total: [] };
    const total = out.total?.[0]?.count || 0;

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

// ---- CSV Export (all rows for current filters) ----
app.get("/api/transcriptions/export.csv", async (req, res) => {
  try {
    const db = await getDb();
    const col = db.collection("transcriptions");

    const match = buildMatchFromFilters(req.query);
    const base = buildBasePipeline(match);

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
        "phone_number",
        "phone_entry_count",
        "call_id",
        "disconnection_reason",
        "call_duration_seconds",
        "call_disposition",
        "call_direction",
        "agent_id",
        "call_start_time",
        "call_start_time_est",
        "public_log_url",
        "recording_url",
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