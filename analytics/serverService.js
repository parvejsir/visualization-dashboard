// analytics/serverService.js — server/IP breakdown across CDR collections
// Groups by originating server IP in parallel across 3 CDR collections,
// then merges in Node.js (cheaper than a $lookup join for this use case).
"use strict";
const { getDb } = require("../services/db");

function parseParams(params) {
  const fromDay = params.from ? new Date(`${params.from.substring(0, 10)}T00:00:00.000Z`) : null;
  const toDay   = params.to   ? new Date(`${params.to.substring(0, 10)}T00:00:00.000Z`)   : null;
  const fromStr = params.from ? `${params.from.substring(0, 10)} 00:00:00` : null;
  const toStr   = params.to   ? `${params.to.substring(0, 10)} 23:59:59`   : null;
  return { fromDay, toDay, fromStr, toStr };
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

// Merge rows by server IP across all sources; compute derived metrics in Node.js
function mergeByServer(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.server || "(unknown)";
    if (!map.has(key)) {
      map.set(key, { server: key, totalCalls: 0, completedCalls: 0, totalCost: 0, totalDuration: 0 });
    }
    const entry = map.get(key);
    entry.totalCalls     += r.totalCalls     || 0;
    entry.completedCalls += r.completedCalls || 0;
    entry.totalCost      += r.totalCost      || 0;
    entry.totalDuration  += r.totalDuration  || 0;
  }
  return [...map.values()]
    .map(e => ({
      server:       e.server,
      totalCalls:   e.totalCalls,
      completedCalls: e.completedCalls,
      asr:          e.totalCalls > 0 ? round2((e.completedCalls / e.totalCalls) * 100) : 0,
      acd:          e.completedCalls > 0 ? round2(e.totalDuration / e.completedCalls) : 0,
      totalCost:    round2(e.totalCost)
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls);
}

async function compute(params) {
  const { fromDay, toDay, fromStr, toStr } = parseParams(params);
  const db = await getDb();

  const sureMatch = buildCdrSureMatch(fromDay, toDay);
  const tbiMatch  = buildCdrTbiMatch(fromStr, toStr);

  // All 3 CDR collection queries in parallel
  const [leadsRows, sharksRows, tbiRows] = await Promise.all([

    db.collection("cdrsuretouchleads").aggregate([
      { $match: sureMatch },
      { $group: {
          _id:          "$Source",
          totalCalls:   { $sum: 1 },
          completedCalls: { $sum: { $cond: [{ $gt: ["$Duration", 0] }, 1, 0] } },
          totalCost:    { $sum: "$Charge" },
          totalDuration: { $sum: { $cond: [{ $gt: ["$Duration", 0] }, "$Duration", 0] } }
      }},
      { $project: { _id: 0, server: "$_id", totalCalls: 1, completedCalls: 1, totalCost: 1, totalDuration: 1 } }
    ], { allowDiskUse: true }).toArray(),

    db.collection("cdrsuretouchsharks").aggregate([
      { $match: sureMatch },
      { $group: {
          _id:          "$Source",
          totalCalls:   { $sum: 1 },
          completedCalls: { $sum: { $cond: [{ $gt: ["$Duration", 0] }, 1, 0] } },
          totalCost:    { $sum: "$Charge" },
          totalDuration: { $sum: { $cond: [{ $gt: ["$Duration", 0] }, "$Duration", 0] } }
      }},
      { $project: { _id: 0, server: "$_id", totalCalls: 1, completedCalls: 1, totalCost: 1, totalDuration: 1 } }
    ], { allowDiskUse: true }).toArray(),

    db.collection("cdrtbirecords").aggregate([
      { $match: tbiMatch },
      { $group: {
          _id:          "$src_ip",
          totalCalls:   { $sum: 1 },
          completedCalls: { $sum: { $cond: [{ $gt: ["$duration", 0] }, 1, 0] } },
          totalCost:    { $sum: "$account_cost" },
          totalDuration: { $sum: { $cond: [{ $gt: ["$duration", 0] }, "$duration", 0] } }
      }},
      { $project: { _id: 0, server: "$_id", totalCalls: 1, completedCalls: 1, totalCost: 1, totalDuration: 1 } }
    ], { allowDiskUse: true }).toArray()
  ]);

  return mergeByServer([...leadsRows, ...sharksRows, ...tbiRows]);
}

module.exports = { compute };
