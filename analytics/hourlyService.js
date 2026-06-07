// analytics/hourlyService.js — hourly breakdown across all call data sources
// 4 parallel queries, each grouping by hour using the appropriate date extraction
// for that collection's storage format. Results are merged into a 24-slot array.
"use strict";
const { getDb } = require("../services/db");

function parseParams(params) {
  const from    = params.from ? new Date(params.from) : null;
  const to      = params.to   ? new Date(params.to)   : null;
  const fromDay = params.from ? new Date(`${params.from.substring(0, 10)}T00:00:00.000Z`) : null;
  const toDay   = params.to   ? new Date(`${params.to.substring(0, 10)}T00:00:00.000Z`)   : null;
  const fromStr = params.from ? `${params.from.substring(0, 10)} 00:00:00` : null;
  const toStr   = params.to   ? `${params.to.substring(0, 10)} 23:59:59`   : null;
  return { from, to, fromDay, toDay, fromStr, toStr };
}

function buildTranscriptMatch(from, to) {
  // All call_analyzed events (both inbound and outbound) for accurate hourly totals
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

function buildCdrTbiMatch(fromStr, toStr) {
  const m = {};
  if (fromStr || toStr) {
    m.date = {};
    if (fromStr) m.date.$gte = fromStr;
    if (toStr)   m.date.$lte = toStr;
  }
  return m;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

// Build a 24-slot array (hours 0-23) and aggregate all source rows into it
function buildHourlyMatrix(rows) {
  const slots = Array.from({ length: 24 }, (_, h) => ({
    hour:          h,
    label:         `${String(h).padStart(2, "0")}:00`,
    retellCalls:   0,
    sureCalls:     0,
    tbiCalls:      0,
    totalCalls:    0,
    totalCost:     0,
    retellCost:    0,
    sureCost:      0,
    tbiCost:       0
  }));

  for (const r of rows) {
    const h = r.hour;
    if (h == null || h < 0 || h > 23) continue;
    const slot = slots[h];
    slot.totalCalls += r.callCount || 0;

    if (r.source === "retell") {
      slot.retellCalls += r.callCount || 0;
      slot.retellCost  += r.cost     || 0;
      slot.totalCost   += r.cost     || 0;
    } else if (r.source === "sure") {
      slot.sureCalls += r.callCount || 0;
      slot.sureCost  += r.cost      || 0;
      slot.totalCost += r.cost      || 0;
    } else if (r.source === "tbi") {
      slot.tbiCalls += r.callCount || 0;
      slot.tbiCost  += r.cost      || 0;
      slot.totalCost += r.cost     || 0;
    }
  }

  return slots.map(s => ({
    ...s,
    totalCost:  round2(s.totalCost),
    retellCost: round2(s.retellCost),
    sureCost:   round2(s.sureCost),
    tbiCost:    round2(s.tbiCost)
  }));
}

async function compute(params) {
  const { from, to, fromDay, toDay, fromStr, toStr } = parseParams(params);
  const db = await getDb();

  // All 4 queries fire in parallel
  const [transcRows, sureLeadsRows, sureSharksRows, tbiRows] = await Promise.all([

    // transcriptions: use $hour with ET timezone on createdAt (ISODate)
    db.collection("transcriptions").aggregate([
      { $match: buildTranscriptMatch(from, to) },
      { $project: {
          _id:  0,
          // Convert createdAt to ET hour — key for US call center business hours
          hour: { $hour: { date: "$createdAt", timezone: "America/New_York" } },
          cost: "$body.call.call_cost.combined_cost"
      }},
      { $group: {
          _id:       "$hour",
          callCount: { $sum: 1 },
          cost:      { $sum: "$cost" }
      }},
      { $project: { _id: 0, hour: "$_id", callCount: 1, cost: 1, source: { $literal: "retell" } } }
    ], { allowDiskUse: true }).toArray(),

    // cdrsuretouchleads: Time is "HH:MM:SS" — extract first 2 chars as integer hour
    db.collection("cdrsuretouchleads").aggregate([
      { $match: buildCdrSureMatch(fromDay, toDay) },
      { $project: {
          _id:  0,
          hour: { $toInt: { $substr: ["$Time", 0, 2] } },
          cost: "$Charge"
      }},
      { $group: {
          _id:       "$hour",
          callCount: { $sum: 1 },
          cost:      { $sum: "$cost" }
      }},
      { $project: { _id: 0, hour: "$_id", callCount: 1, cost: 1, source: { $literal: "sure" } } }
    ], { allowDiskUse: true }).toArray(),

    // cdrsuretouchsharks: same schema as leads
    db.collection("cdrsuretouchsharks").aggregate([
      { $match: buildCdrSureMatch(fromDay, toDay) },
      { $project: {
          _id:  0,
          hour: { $toInt: { $substr: ["$Time", 0, 2] } },
          cost: "$Charge"
      }},
      { $group: {
          _id:       "$hour",
          callCount: { $sum: 1 },
          cost:      { $sum: "$cost" }
      }},
      { $project: { _id: 0, hour: "$_id", callCount: 1, cost: 1, source: { $literal: "sure" } } }
    ], { allowDiskUse: true }).toArray(),

    // cdrtbirecords: date is string "YYYY-MM-DD HH:MM:SS" — chars 11-12 are the hour
    db.collection("cdrtbirecords").aggregate([
      { $match: buildCdrTbiMatch(fromStr, toStr) },
      { $project: {
          _id:  0,
          hour: { $toInt: { $substr: ["$date", 11, 2] } },
          cost: "$account_cost"
      }},
      { $group: {
          _id:       "$hour",
          callCount: { $sum: 1 },
          cost:      { $sum: "$cost" }
      }},
      { $project: { _id: 0, hour: "$_id", callCount: 1, cost: 1, source: { $literal: "tbi" } } }
    ], { allowDiskUse: true }).toArray()
  ]);

  const allRows = [...transcRows, ...sureLeadsRows, ...sureSharksRows, ...tbiRows];
  return buildHourlyMatrix(allRows);
}

module.exports = { compute };
