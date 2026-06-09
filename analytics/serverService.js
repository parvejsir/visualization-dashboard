// analytics/serverService.js — server-wise breakdown: Vicidialer dials vs Retell calls vs Transfers
//
// Data sources:
//   carrierlogreports  — raw Vicidial CDR; "CALL DATE" = ET string "YYYY-MM-DD HH:MM:SS", "SERVER IP"
//   transcriptions     — Retell webhook payloads; createdAt = UTC;
//                        server IP at body.call.retell_llm_dynamic_variables.vicidial-telephony-ip
//
// Recommended indexes (create once via mongo shell — do NOT apply writes per security policy):
//   db.carrierlogreports.createIndex({ "CALL DATE": 1, "SERVER IP": 1 })
//   db.transcriptions.createIndex({ "body.event": 1, createdAt: 1, "body.call.agent_id": 1 })
"use strict";
const { getDb } = require("../services/db");

const KNOWN_SERVER_IPS = [
  "15.204.108.111",
  "15.204.110.171",
  "15.204.107.116",
  "15.204.107.118",
  "15.204.105.49",
  "15.204.105.37"
];

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ── ET → UTC (DST-aware) — same algorithm as aiSummaryService ────────────────
function getEtOffsetMinutes(utcInstant) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(utcInstant);
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second));
  return (asUTC - utcInstant.getTime()) / 60000;
}

function etToUtc(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, m]     = timeStr.split(":").map(Number);
  const wallAsUtc  = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  let utc = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    const off = getEtOffsetMinutes(utc);
    utc = new Date(wallAsUtc.getTime() - off * 60000);
  }
  return utc;
}

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

// ── Main compute ─────────────────────────────────────────────────────────────
// params:
//   fromDate / fromTime / toDate / toTime — ET wall-clock strings
//   servers   — array of IP strings, or null/empty = all known servers
//   agentMode — "all" | "retell" ($ne vicidial)
async function compute(params) {
  const fromDate  = params.fromDate  || getTodayEt();
  const fromTime  = params.fromTime  || "09:00";
  const toDate    = params.toDate    || fromDate;
  const toTime    = params.toTime    || "22:00";
  const agentMode = params.agentMode || "all";

  const servers  = Array.isArray(params.servers) && params.servers.length > 0
    ? params.servers : null;
  const serverIn = servers ? { $in: servers } : null;

  const db = await getDb();

  // ET → UTC for transcriptions
  const utcFrom = etToUtc(fromDate, fromTime);
  const utcTo   = etToUtc(toDate,   toTime);

  // ── transcriptions match ──────────────────────────────────────────────────
  const transcMatch = {
    "body.event": "call_analyzed",
    createdAt:    { $gte: utcFrom, $lte: utcTo }
  };
  // "retell" = exclude vicidial AMD drops; "all" = no agent filter
  if (agentMode === "retell") transcMatch["body.call.agent_id"] = { $ne: "vicidial" };
  // Only add server IP filter when specific IPs are selected — avoids scanning a
  // sparse nested field on the entire collection when "all servers" is chosen.
  if (serverIn) {
    transcMatch["body.call.retell_llm_dynamic_variables.vicidial-telephony-ip"] = serverIn;
  }

  // ── transcriptions: Retell calls + transfers per server ──────────────────
  const transcRows = await db.collection("transcriptions").aggregate([
    { $match: transcMatch },
    { $group: {
        _id:         "$body.call.retell_llm_dynamic_variables.vicidial-telephony-ip",
        retellCalls: { $sum: 1 },
        transfers:   { $sum: { $cond: [
          { $eq: ["$body.call.disconnection_reason", "call_transfer"] }, 1, 0
        ]}}
    }}
  ], { allowDiskUse: true, maxTimeMS: 60000 }).toArray();

  // ── Merge by server IP ────────────────────────────────────────────────────
  // Seed known servers so all 6 always appear even with zero data
  const map = new Map();
  for (const ip of KNOWN_SERVER_IPS) {
    if (!servers || servers.includes(ip)) {
      map.set(ip, { server: ip, retellCalls: 0, transfers: 0 });
    }
  }
  for (const r of transcRows) {
    const key = r._id || "(unknown)";
    if (!map.has(key)) map.set(key, { server: key, retellCalls: 0, transfers: 0 });
    map.get(key).retellCalls += r.retellCalls || 0;
    map.get(key).transfers   += r.transfers   || 0;
  }

  return [...map.values()]
    .map(e => ({
      server:       e.server,
      retellCalls:  e.retellCalls,
      transfers:    e.transfers,
      transferRate: e.retellCalls > 0 ? round2((e.transfers / e.retellCalls) * 100) : 0
    }))
    .sort((a, b) => b.retellCalls - a.retellCalls);
}

module.exports = { compute, KNOWN_SERVER_IPS };
