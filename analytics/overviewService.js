// analytics/overviewService.js — computes all 19 KPIs for the Overview page
"use strict";
const { getDb } = require("../services/db");

const HUMAN_ANSWER_DISPOSITIONS = ["HU", "CALLBK", "DNC", "NI", "NHO", "WN", "LB", "XFER"];

// Client transfer target number: calls reaching this number with duration > 100s = paid transfer
// Present in 382 CDR as "Terminating Number" (numeric) and TBI CDR as dst_number (numeric)
const CLIENT_PHONE = 8482371501;

function parseParams(params) {
  const from = params.from ? new Date(params.from) : null;
  const to   = params.to   ? new Date(params.to)   : null;

  const fromDay = from ? new Date(`${params.from.substring(0, 10)}T00:00:00.000Z`) : null;
  const toDay   = to   ? new Date(`${params.to.substring(0, 10)}T00:00:00.000Z`)   : null;

  const fromStr = params.from ? `${params.from.substring(0, 10)} 00:00:00` : null;
  const toStr   = params.to   ? `${params.to.substring(0, 10)} 23:59:59`   : null;

  return { from, to, fromDay, toDay, fromStr, toStr };
}

function buildTranscriptMatch(from, to) {
  // Count ALL analyzed calls — both inbound and outbound — no direction filter
  // vicidial = AI AMD/silence detection that disconnects before Retell; exclude per-facet where needed
  const m = { "body.event": "call_analyzed" };
  if (from || to) {
    m.createdAt = {};
    if (from) m.createdAt.$gte = from;
    if (to)   m.createdAt.$lte = to;
  }
  return m;
}

function buildCdrSureMatch(fromDay, toDay) {
  const m = {};
  if (fromDay || toDay) {
    m.Date = {};
    if (fromDay) m.Date.$gte = fromDay;
    if (toDay)   m.Date.$lte = toDay;
  }
  return m;
}

// Return the next calendar day as "YYYY-MM-DD" — used for TBI's $lt upper bound
function nextDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// TBI date field is "YYYY-MM-DD HH:MM:SS" string (ET).
// Rule: same-day → $gte fromDate, $lt nextDay(fromDate) (includes full day)
//       multi-day → $gte fromDate, $lt toDate           (toDate is exclusive)
// fromStr / toStr may carry a time suffix — strip to date-only before comparing.
function buildCdrTbiMatch(fromStr, toStr) {
  const m = {};
  const fromDate = fromStr ? fromStr.substring(0, 10) : null;
  const toDate   = toStr   ? toStr.substring(0, 10)   : null;
  if (fromDate || toDate) {
    m.date = {};
    if (fromDate) m.date.$gte = fromDate;
    if (toDate)   m.date.$lt  = fromDate === toDate ? nextDay(fromDate) : toDate;
  }
  return m;
}

function buildLeadsMatch(from, to) {
  const m = { env: "production" };
  if (from || to) {
    m.createdAt = {};
    if (from) m.createdAt.$gte = from;
    if (to)   m.createdAt.$lte = to;
  }
  return m;
}

function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

function computeKpis(transcFacet, sureFacet, sharkFacet, tbiFacet, leadsCount) {
  const t  = transcFacet || {};
  const s  = sureFacet   || {};
  const sh = sharkFacet  || {};
  const tb = tbiFacet    || {};

  const totalAIDialed    = t.totalCount?.[0]?.n    ?? 0;
  const retellCost       = t.retellCost?.[0]?.total ?? 0;
  const humanAnswerCount = t.humanAnswer?.[0]?.n    ?? 0;
  const transferCount    = t.transfers?.[0]?.n      ?? 0;

  // Paid = CDR calls that reached the client number AND lasted > 100 seconds
  const paidCount = (s.paidCount?.[0]?.n  ?? 0) +
                    (sh.paidCount?.[0]?.n  ?? 0) +
                    (tb.paidCount?.[0]?.n  ?? 0);

  // 382 = cdrsuretouchleads + cdrsuretouchsharks combined
  const goTo382      = (s.totalCount?.[0]?.n       ?? 0) + (sh.totalCount?.[0]?.n       ?? 0);
  const complete382  = (s.completedCount?.[0]?.n   ?? 0) + (sh.completedCount?.[0]?.n   ?? 0);
  const cost382      = (s.totalCost?.[0]?.total    ?? 0) + (sh.totalCost?.[0]?.total    ?? 0);
  const acd382Raw    = s.avgDuration?.[0]?.avg      ?? 0;

  const goToTBI     = tb.totalCount?.[0]?.n         ?? 0;
  const completeTBI = tb.completedCount?.[0]?.n     ?? 0;
  const costTBI     = tb.totalCost?.[0]?.total      ?? 0;
  const tbiTotalDur = tb.totalDuration?.[0]?.total  ?? 0;
  const acdTBIRaw   = goToTBI > 0 ? tbiTotalDur / goToTBI : 0;

  const leadsTotal  = leadsCount?.n ?? 0;
  const leadsCost   = leadsTotal * 0.05;

  const totalCost       = cost382 + costTBI + leadsCost + retellCost;
  const asr382          = goTo382  > 0 ? (complete382  / goTo382)  * 100 : 0;
  const asrTBI          = goToTBI  > 0 ? (completeTBI  / goToTBI)  * 100 : 0;
  const humanAnswerPct  = totalAIDialed > 0 ? (humanAnswerCount / totalAIDialed) * 100 : 0;
  const costPerTransfer = transferCount > 0 ? totalCost / transferCount : 0;
  const costPerPaid     = paidCount     > 0 ? totalCost / paidCount     : 0;

  return {
    totalAIDialed,
    goTo382,
    complete382,
    asr382:         round2(asr382),
    acd382:         round2(acd382Raw),
    goToTBI,
    completeTBI,
    asrTBI:         round2(asrTBI),
    acdTBI:         round2(acdTBIRaw),
    cost382:        round2(cost382),
    costTBI:        round2(costTBI),
    leadsCost:      round2(leadsCost),
    retellCost:     round2(retellCost),
    totalCost:      round2(totalCost),
    humanAnswerPct: round2(humanAnswerPct),
    transferCount,
    paidCount,
    costPerTransfer: round2(costPerTransfer),
    costPerPaid:     round2(costPerPaid)
  };
}

async function compute(params) {
  const { from, to, fromDay, toDay, fromStr, toStr } = parseParams(params);
  const db = await getDb();

  const transcMatch = buildTranscriptMatch(from, to);
  const sureMatch   = buildCdrSureMatch(fromDay, toDay);
  const tbiMatch    = buildCdrTbiMatch(fromStr, toStr);
  const leadsMatch  = buildLeadsMatch(from, to);

  const [
    transcRaw,
    sureLeadsRaw,
    sureSharksRaw,
    tbiRaw,
    leadsRaw
  ] = await Promise.all([

    // transcriptions: all call_analyzed (both directions); vicidial excluded per-facet
    db.collection("transcriptions").aggregate([
      { $match: transcMatch },
      { $project: {
          _id:                  0,
          combined_cost:        "$body.call.call_cost.combined_cost",
          disconnection_reason: "$body.call.disconnection_reason",
          call_disposition:     "$body.call.call_analysis.custom_analysis_data.call_disposition",
          agent_id:             "$body.call.agent_id"
      }},
      { $facet: {
          // Total dialed = all call_analyzed events regardless of direction or agent
          totalCount: [{ $count: "n" }],

          // Retell cost excludes vicidial (vicidial = call dropped before reaching Retell)
          retellCost: [
            { $match: { agent_id: { $ne: "vicidial" } } },
            { $group: { _id: null, total: { $sum: "$combined_cost" } } }
          ],

          // Human answer: only calls that reached Retell (agent != vicidial)
          humanAnswer: [
            { $match: { agent_id: { $ne: "vicidial" }, call_disposition: { $in: HUMAN_ANSWER_DISPOSITIONS } } },
            { $count: "n" }
          ],

          // Transfers: disconnection_reason = call_transfer (all directions)
          transfers: [
            { $match: { disconnection_reason: "call_transfer" } },
            { $count: "n" }
          ]
      }}
    ], { allowDiskUse: true }).toArray(),

    // cdrsuretouchleads: "Terminating Number" field identifies the client's transfer target
    db.collection("cdrsuretouchleads").aggregate([
      { $match: sureMatch },
      { $project: { _id: 0, Duration: 1, Charge: 1, "Terminating Number": 1 } },
      { $facet: {
          totalCount:     [{ $count: "n" }],
          completedCount: [{ $match: { Duration: { $gt: 0 } } }, { $count: "n" }],
          totalCost:      [{ $group: { _id: null, total: { $sum: "$Charge" } } }],
          avgDuration:    [{ $match: { Duration: { $gt: 0 } } }, { $group: { _id: null, avg: { $avg: "$Duration" } } }],
          // Paid: routed to client number AND call lasted > 100 seconds
          paidCount:      [{ $match: { "Terminating Number": CLIENT_PHONE, Duration: { $gt: 100 } } }, { $count: "n" }]
      }}
    ], { allowDiskUse: true }).toArray(),

    // cdrsuretouchsharks: same schema as cdrsuretouchleads
    db.collection("cdrsuretouchsharks").aggregate([
      { $match: sureMatch },
      { $project: { _id: 0, Duration: 1, Charge: 1, "Terminating Number": 1 } },
      { $facet: {
          totalCount:     [{ $count: "n" }],
          completedCount: [{ $match: { Duration: { $gt: 0 } } }, { $count: "n" }],
          totalCost:      [{ $group: { _id: null, total: { $sum: "$Charge" } } }],
          paidCount:      [{ $match: { "Terminating Number": CLIENT_PHONE, Duration: { $gt: 100 } } }, { $count: "n" }]
      }}
    ], { allowDiskUse: true }).toArray(),

    // cdrtbirecords: dst_number is the transfer destination; string date field
    db.collection("cdrtbirecords").aggregate([
      { $match: tbiMatch },
      { $project: { _id: 0, duration: 1, account_cost: 1, dst_number: 1 } },
      { $facet: {
          totalCount:     [{ $count: "n" }],
          completedCount: [{ $match: { duration: { $gt: 0 } } }, { $count: "n" }],
          totalCost:      [{ $group: { _id: null, total: { $sum: "$account_cost" } } }],
          totalDuration:  [{ $group: { _id: null, total: { $sum: "$duration" } } }],
          paidCount:      [{ $match: { dst_number: CLIENT_PHONE, duration: { $gt: 100 } } }, { $count: "n" }]
      }}
    ], { allowDiskUse: true }).toArray(),

    // realtimeleads: production only; $0.05 per lead
    db.collection("realtimeleads").aggregate([
      { $match: leadsMatch },
      { $count: "n" }
    ], { allowDiskUse: true }).toArray()
  ]);

  return computeKpis(
    transcRaw[0],
    sureLeadsRaw[0],
    sureSharksRaw[0],
    tbiRaw[0],
    leadsRaw[0]
  );
}

module.exports = { compute };
