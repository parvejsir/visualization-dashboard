// analytics/vendorService.js — vendor/lead breakdown grouped by lead type
// realtimeleads are grouped by the "type" field (rtlonpoint, rtlIfficient24Hour, etc.)
// transcriptions are attributed to a type via phone lookup into realtimeleads
"use strict";
const { getDb } = require("../services/db");

function parseParams(params) {
  const from = params.from ? new Date(params.from) : null;
  const to   = params.to   ? new Date(params.to)   : null;
  return { from, to };
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

function buildTranscriptMatch(from, to) {
  // Outbound only for vendor attribution — phone is in to_number for outbound calls
  const m = { "body.event": "call_analyzed", "body.call.direction": "outbound" };
  if (from || to) {
    m.createdAt = {};
    if (from) m.createdAt.$gte = from;
    if (to)   m.createdAt.$lte = to;
  }
  return m;
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

async function compute(params) {
  const { from, to } = parseParams(params);
  const db = await getDb();

  const [vendorLeadsRows, vendorCallRows] = await Promise.all([

    // Lead count + cost grouped by type field (rtlonpoint, rtlIfficient24Hour, etc.)
    db.collection("realtimeleads").aggregate([
      { $match: buildLeadsMatch(from, to) },
      { $group: {
          _id:       { $ifNull: ["$type", "(no type)"] },
          leadCount: { $sum: 1 }
      }},
      { $project: { _id: 0, vendor: "$_id", leadCount: 1 } },
      { $sort: { leadCount: -1 } }
    ], { allowDiskUse: true }).toArray(),

    // Calls + transfers per lead type via phone lookup
    // Strip +1 from to_number → look up realtimeleads → group by type
    db.collection("transcriptions").aggregate([
      { $match: buildTranscriptMatch(from, to) },
      { $project: {
          _id: 0,
          phone_str:            { $substrBytes: [{ $ifNull: ["$body.call.to_number", ""] }, 2, 10] },
          disconnection_reason: "$body.call.disconnection_reason",
          call_disposition:     "$body.call.call_analysis.custom_analysis_data.call_disposition"
      }},
      { $addFields: {
          phone: { $convert: { input: "$phone_str", to: "long", onError: null, onNull: null } }
      }},
      { $match: { phone: { $ne: null } } },
      { $lookup: {
          from:       "realtimeleads",
          localField: "phone",
          foreignField: "phone",
          as:         "lead",
          pipeline:   [{ $project: { _id: 0, type: 1 } }]
      }},
      { $group: {
          _id:           { $ifNull: [{ $arrayElemAt: ["$lead.type", 0] }, "(no type)"] },
          callCount:     { $sum: 1 },
          transferCount: { $sum: { $cond: [{ $eq: ["$disconnection_reason", "call_transfer"] }, 1, 0] } },
          paidCount:     { $sum: { $cond: [{ $eq: ["$call_disposition", "XFER"] }, 1, 0] } }
      }},
      { $project: { _id: 0, vendor: "$_id", callCount: 1, transferCount: 1, paidCount: 1 } }
    ], { allowDiskUse: true }).toArray()
  ]);

  const callMap = new Map(vendorCallRows.map(r => [r.vendor, r]));

  return vendorLeadsRows.map(r => {
    const calls    = callMap.get(r.vendor) || { callCount: 0, transferCount: 0, paidCount: 0 };
    const leadCost = round2(r.leadCount * 0.05);
    const xferRate = r.leadCount > 0 ? round2((calls.transferCount / r.leadCount) * 100) : 0;
    return {
      vendor:        r.vendor,
      leadCount:     r.leadCount,
      leadCost,
      callCount:     calls.callCount,
      transferCount: calls.transferCount,
      paidCount:     calls.paidCount,
      xferRate
    };
  }).sort((a, b) => b.leadCount - a.leadCount);
}

module.exports = { compute };
