// analytics/aiSummaryService.js
// Params (all ET / America/New_York): fromDate, fromTime, toDate, toTime
// Transcriptions stored UTC  → convert ET → UTC before querying.
// CDR Sure: Date = ISODate-midnight-UTC for the ET date, Time = HH:MM:SS string in ET.
// CDR TBI : date = string "YYYY-MM-DD HH:MM:SS" in ET.
//
// Recommended indexes for fast queries:
//   transcriptions:       { "body.event": 1, createdAt: 1 }
//   cdrsuretouchleads:    { Date: 1, Time: 1, "Terminating Number": 1 }
//   cdrsuretouchsharks:   { Date: 1, Time: 1, "Terminating Number": 1 }
//   cdrtbirecords:        { date: 1, dst_number: 1 }
"use strict";
const { getDb } = require("../services/db");

const CLIENT_PHONE       = 8482371501;
const PAID_MIN_SECS      = 100;
const HUMAN_DISPOSITIONS = ["HU", "NI", "NHO", "LB", "WN", "CALLBK", "XFER", "DNC"];

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// ── ET → UTC conversion (DST-aware, same algorithm as store.js) ──────────────
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
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour), Number(map.minute), Number(map.second)
  );
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

// Return the next calendar day as "YYYY-MM-DD" — used for TBI's $lt upper bound
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`); // noon UTC avoids any DST edge cases
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── Main compute ─────────────────────────────────────────────────────────────
async function compute(params) {
  const fromDate = params.fromDate || getTodayEt();
  const fromTime = params.fromTime || "09:00";
  const toDate   = params.toDate   || fromDate;
  const toTime   = params.toTime   || "22:00";

  const db = await getDb();

  // Transcriptions: ET → UTC
  const utcFrom = etToUtc(fromDate, fromTime);
  const utcTo   = etToUtc(toDate,   toTime);

  // ── TBI: date field "YYYY-MM-DD HH:MM:SS" but timestamps are unreliable — filter by date only.
  // Rule (per business requirement):
  //   Same-day  (from = to = Jun 3)  → $gte:"2026-06-03", $lt:"2026-06-04"  (full Jun 3)
  //   Multi-day (from=Jun3, to=Jun4) → $gte:"2026-06-03", $lt:"2026-06-04"  (Jun 3 only, Jun 4 excluded)
  //   Multi-day (from=Jun1, to=Jun10)→ $gte:"2026-06-01", $lt:"2026-06-10"  (Jun 1–9, Jun 10 excluded)
  // So toDate is ALWAYS the exclusive upper bound; for same-day we bump it by 1 so Jun3 is included.
  const tbiGte = fromDate;
  const tbiLt  = fromDate === toDate ? nextDay(fromDate) : toDate;

  console.log(`[ai-summary] TBI query: date >= "${tbiGte}", date < "${tbiLt}" (fromDate=${fromDate}, toDate=${toDate})`);

  // ── Leads (realtimeleads): same day-only logic as TBI, but UTC-stored — convert ET midnight → UTC.
  // Same-day (Jun3→Jun3): full Jun3. Multi-day (Jun3→Jun4): Jun3 only. Jun1→Jun10: Jun1–9 only.
  const leadsEffectiveEnd = fromDate === toDate ? nextDay(fromDate) : toDate;
  const leadsFromUtc      = etToUtc(fromDate, "00:00");
  const leadsToUtc        = new Date(etToUtc(leadsEffectiveEnd, "00:00").getTime() - 1);
  console.log(`[ai-summary] Leads query: createdAt >= "${leadsFromUtc.toISOString()}", createdAt <= "${leadsToUtc.toISOString()}" (fromDate=${fromDate})`);

  // ── CDR Sure (382com): Date = ISODate midnight UTC for the ET calendar day;
  // Time = "HH:MM:SS" string in ET.  We build "YYYY-MM-DD HH:MM:SS" via $expr + $concat
  // so overnight/multi-day ranges work correctly (avoids the impossible Time range bug).
  // A Date pre-filter lets MongoDB use the index before evaluating the expression.
  const cdrGte = `${fromDate} ${fromTime}:00`;   // e.g. "2026-06-03 09:00:00"
  const cdrLte = `${toDate} ${toTime}:00`;       // e.g. "2026-06-04 22:00:00"

  const sureDateFrom = new Date(`${fromDate}T00:00:00.000Z`);
  const sureDateTo   = new Date(`${toDate}T00:00:00.000Z`);

  // $expr that builds "YYYY-MM-DD HH:MM:SS" from the two separate CDR Sure fields
  const sureExpr = {
    $expr: {
      $and: [
        { $gte: [{ $concat: [{ $dateToString: { format: "%Y-%m-%d", date: "$Date" } }, " ", "$Time"] }, cdrGte] },
        { $lte: [{ $concat: [{ $dateToString: { format: "%Y-%m-%d", date: "$Date" } }, " ", "$Time"] }, cdrLte] }
      ]
    }
  };

  const [transcRaw, sureLeadsRaw, sureSharksRaw, tbiRaw, leadsCountRaw] = await Promise.all([

    // ── Transcriptions ─────────────────────────────────────────────────────
    db.collection("transcriptions").aggregate([
      { $match: {
          "body.event": "call_analyzed",
          createdAt: { $gte: utcFrom, $lte: utcTo }
      }},
      { $project: {
          _id: 0,
          disconnection_reason: "$body.call.disconnection_reason",
          agent_id:             "$body.call.agent_id",
          combined_cost:        "$body.call.call_cost.combined_cost",
          call_disposition:     "$body.call.call_analysis.custom_analysis_data.call_disposition"
      }},
      { $facet: {
          totalDialed:   [{ $count: "n" }],
          totalTransfer: [
            { $match: { disconnection_reason: "call_transfer" } },
            { $count: "n" }
          ],
          retellCost: [
            { $match: { agent_id: { $ne: "vicidial" } } },
            { $group: { _id: null, total: { $sum: "$combined_cost" } } }
          ],
          humanAnswer: [
            { $match: { call_disposition: { $in: HUMAN_DISPOSITIONS } } },
            { $count: "n" }
          ]
      }}
    ], { allowDiskUse: true }).toArray(),

    // ── cdrsuretouchleads ──────────────────────────────────────────────────
    // Date pre-filter uses the index; $expr applies the precise datetime string comparison
    // (same "YYYY-MM-DD HH:MM:SS" logic as TBI so overnight / multi-day ranges work).
    // "Terminating Number" (field with space) is aliased via $addFields before $group.
    db.collection("cdrsuretouchleads").aggregate([
      { $match: { Date: { $gte: sureDateFrom, $lte: sureDateTo }, ...sureExpr } },
      { $addFields: { _tn: "$Terminating Number" } },
      { $group: {
          _id: null,
          totalDialed:   { $sum: 1 },
          attempts:      { $sum: { $cond: [{ $eq: ["$_tn", CLIENT_PHONE] }, 1, 0] } },
          paid:          { $sum: { $cond: [
            { $and: [{ $eq: ["$_tn", CLIENT_PHONE] }, { $gte: ["$Duration", PAID_MIN_SECS] }] },
            1, 0
          ]}},
          totalCost:     { $sum: "$Charge" },
          totalDuration: { $sum: "$Duration" }
      }}
    ], { allowDiskUse: true }).toArray(),

    // ── cdrsuretouchsharks (identical schema to leads) ─────────────────────
    db.collection("cdrsuretouchsharks").aggregate([
      { $match: { Date: { $gte: sureDateFrom, $lte: sureDateTo }, ...sureExpr } },
      { $addFields: { _tn: "$Terminating Number" } },
      { $group: {
          _id: null,
          totalDialed:   { $sum: 1 },
          attempts:      { $sum: { $cond: [{ $eq: ["$_tn", CLIENT_PHONE] }, 1, 0] } },
          paid:          { $sum: { $cond: [
            { $and: [{ $eq: ["$_tn", CLIENT_PHONE] }, { $gte: ["$Duration", PAID_MIN_SECS] }] },
            1, 0
          ]}},
          totalCost:     { $sum: "$Charge" },
          totalDuration: { $sum: "$Duration" }
      }}
    ], { allowDiskUse: true }).toArray(),

    // ── cdrtbirecords ──────────────────────────────────────────────────────
    // TBI: date-only filter — toDate is exclusive ($lt), same-day bumped by 1 so full day included.
    db.collection("cdrtbirecords").aggregate([
      { $match: { date: { $gte: tbiGte, $lt: tbiLt } } },
      { $project: { _id: 0, duration: 1, account_cost: 1, dst_number: 1 } },
      { $facet: {
          totalDialed: [{ $count: "n" }],
          attempts:    [
            { $match: { dst_number: CLIENT_PHONE } },
            { $count: "n" }
          ],
          paid: [
            { $match: { dst_number: CLIENT_PHONE, duration: { $gte: PAID_MIN_SECS } } },
            { $count: "n" }
          ],
          totalCost:     [{ $group: { _id: null, total: { $sum: "$account_cost" } } }],
          totalDuration: [{ $group: { _id: null, total: { $sum: "$duration"     } } }]
      }}
    ], { allowDiskUse: true }).toArray(),

    // ── realtimeleads — Leads Cost ─────────────────────────────────────────
    // Count Queued/production leads in fromDate's full calendar day (ET → UTC).
    db.collection("realtimeleads").aggregate([
      { $match: {
          createdAt: { $gte: leadsFromUtc, $lte: leadsToUtc },
          //status: "Queued",
          status: {
          $nin: ["InternalDNC", "Invalid"]
          },
          env: "production"
      }},
      { $project: {
          retellCallAnalysedLogs: 0,
          retellDialedLogs: 0,
          retellCallEndedLogs: 0,
          scrub: 0,
          lastConcurrencyCheck: 0,
          requestBody: 0
      }},
      { $count: "n" }
    ], { allowDiskUse: true }).toArray()
  ]);

  // ── Extract results ──────────────────────────────────────────────────────
  // transcriptions + TBI use $facet → result is { key: [ {n:N} | {total:T} ] }
  // 382com (leads + sharks) use $group → result is a flat { totalDialed, attempts, paid, totalCost }
  const t  = transcRaw[0]     || {};
  const sl = sureLeadsRaw[0]  || {};   // $group document — flat
  const ss = sureSharksRaw[0] || {};   // $group document — flat
  const tb = tbiRaw[0]        || {};   // $facet document — array fields

  // Transcriptions ($facet)
  const totalDialed    = t.totalDialed?.[0]?.n    ?? 0;
  const totalTransfer  = t.totalTransfer?.[0]?.n  ?? 0;
  const retellCostRaw  = t.retellCost?.[0]?.total ?? 0;
  const retellCost     = round2(retellCostRaw / 100);
  const humanAnswerCnt = t.humanAnswer?.[0]?.n    ?? 0;
  const humanAnswerPct = totalDialed > 0 ? round2((humanAnswerCnt / totalDialed) * 100) : 0;

  // Leads (realtimeleads)
  const rlCount = leadsCountRaw[0]?.n ?? 0;
  const rlCost  = round2(rlCount * 0.05);

  // 382com leads — $group returns flat numbers directly
  const leadsDialed    = sl.totalDialed    ?? 0;
  const leadsAttempts  = sl.attempts       ?? 0;
  const leadsPaid      = sl.paid           ?? 0;
  const leadsCost      = sl.totalCost      ?? 0;
  const leadsDuration  = sl.totalDuration  ?? 0;

  // 382com sharks — same
  const sharksDialed    = ss.totalDialed    ?? 0;
  const sharksAttempts  = ss.attempts       ?? 0;
  const sharksPaid      = ss.paid           ?? 0;
  const sharksCost      = ss.totalCost      ?? 0;
  const sharksDuration  = ss.totalDuration  ?? 0;

  // TBI ($facet)
  const tbiDialed   = tb.totalDialed?.[0]?.n            ?? 0;
  const tbiAttempts = tb.attempts?.[0]?.n                ?? 0;
  const tbiPaid     = tb.paid?.[0]?.n                    ?? 0;
  const tbiCost     = tb.totalCost?.[0]?.total           ?? 0;
  const tbiDuration = tb.totalDuration?.[0]?.total       ?? 0;

  // 382com combined
  const carrier382Dialed    = leadsDialed    + sharksDialed;
  const carrier382Attempts  = leadsAttempts  + sharksAttempts;
  const carrier382Paid      = leadsPaid      + sharksPaid;
  const carrier382Cost      = leadsCost      + sharksCost;
  const carrier382Duration  = leadsDuration  + sharksDuration;

  // ACD (Average Call Duration in seconds)
  const carrier382ACD = carrier382Dialed > 0 ? round2(carrier382Duration / carrier382Dialed) : 0;
  const tbiACD        = tbiDialed        > 0 ? round2(tbiDuration        / tbiDialed)        : 0;

  // Overall CDR totals
  const totalAttempts = carrier382Attempts + tbiAttempts;
  const totalPaid     = carrier382Paid     + tbiPaid;
  const totalCdrCost  = carrier382Cost     + tbiCost;

  // Grand total cost = 382com + TBI + Retell + Leads
  const grandTotalCost      = round2(totalCdrCost + retellCost + rlCost);
  const costPerTransfer     = totalTransfer > 0 ? round2(grandTotalCost / totalTransfer) : 0;
  const costPerPaidTransfer = totalPaid     > 0 ? round2(grandTotalCost / totalPaid)     : 0;

  return {
    fromDate, fromTime, toDate, toTime,

    // ── AI dialing (Retell / transcriptions) ─────────────────────────────
    totalDialed,
    totalTransfer,
    retellCost,
    humanAnswerCount: humanAnswerCnt,
    humanAnswerPct,
    leadsCount: rlCount,
    leadsCost:  rlCost,

    // ── CDR overall ───────────────────────────────────────────────────────
    totalAttempts,
    totalPaid,
    totalCdrCost: round2(totalCdrCost),

    // ── Grand total cost (all sources) ────────────────────────────────────
    grandTotalCost,
    costPerTransfer,
    costPerPaidTransfer,

    // ── Carrier: 382com ───────────────────────────────────────────────────
    carrier382: {
      dialed:   carrier382Dialed,
      attempts: carrier382Attempts,
      paid:     carrier382Paid,
      cost:     round2(carrier382Cost),
      acd:      carrier382ACD
    },

    // ── Carrier: TBI ──────────────────────────────────────────────────────
    carrierTbi: {
      dialed:   tbiDialed,
      attempts: tbiAttempts,
      paid:     tbiPaid,
      cost:     round2(tbiCost),
      acd:      tbiACD
    },

    // ── Sub-collection breakdown ──────────────────────────────────────────
    breakdown: {
      leads:  { dialed: leadsDialed,  attempts: leadsAttempts,  paid: leadsPaid,  cost: round2(leadsCost)  },
      sharks: { dialed: sharksDialed, attempts: sharksAttempts, paid: sharksPaid, cost: round2(sharksCost) },
      tbi:    { dialed: tbiDialed,    attempts: tbiAttempts,    paid: tbiPaid,    cost: round2(tbiCost)    }
    }
  };
}

module.exports = { compute };
