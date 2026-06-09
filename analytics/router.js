// analytics/router.js — view routes (mounted at /analytics) and API routes (mounted at /api/analytics)
"use strict";
const express = require("express");
const overviewService   = require("./overviewService");
const serverService     = require("./serverService");
const vendorService     = require("./vendorService");
const hourlyService     = require("./hourlyService");
const aiSummaryService  = require("./aiSummaryService");
const { getAnalyticsCache, setAnalyticsCache } = require("../services/analyticsCache");

// ---- View router (serves EJS pages) ----
const viewRouter = express.Router();

viewRouter.get("/overview",    (req, res) => res.render("analytics/overview"));
viewRouter.get("/server",      (req, res) => res.render("analytics/server"));
viewRouter.get("/vendor",      (req, res) => res.render("analytics/vendor"));
viewRouter.get("/hourly",      (req, res) => res.render("analytics/hourly"));
viewRouter.get("/ai-summary",  (req, res) => res.render("analytics/ai-summary"));

// ---- API router (serves JSON) ----
const apiRouter = express.Router();

// Normalize query params — from/to arrive as UTC ISO strings from the frontend
function extractParams(query) {
  const out = {};
  if (query.from && !Number.isNaN(new Date(query.from).getTime())) out.from = query.from;
  if (query.to   && !Number.isNaN(new Date(query.to).getTime()))   out.to   = query.to;
  return out;
}

// Wrap data for JSON response — arrays get { data: [], cache } to avoid spreading issues
function wrapResponse(data, cacheStatus) {
  if (Array.isArray(data)) return { data, cache: cacheStatus };
  return { ...data, cache: cacheStatus };
}

// Generic handler factory — reduces boilerplate across 4 endpoints
function makeHandler(page, service) {
  return async function (req, res) {
    const params = extractParams(req.query);
    try {
      const cached = await getAnalyticsCache(page, params);
      if (cached) {
        return res.json(wrapResponse(cached, "HIT"));
      }
      const started = Date.now();
      const data = await service.compute(params);
      console.log(`[analytics:${page}] computed in ${Date.now() - started}ms`);
      await setAnalyticsCache(page, params, data);
      res.json(wrapResponse(data, "MISS"));
    } catch (e) {
      console.error(`[analytics:${page}] error:`, e);
      res.status(500).json({ error: `${page} analytics failed`, message: e.message });
    }
  };
}

apiRouter.get("/overview", makeHandler("overview", overviewService));
apiRouter.get("/vendor",   makeHandler("vendor",   vendorService));
apiRouter.get("/hourly",   makeHandler("hourly",   hourlyService));

// server uses fromDate/fromTime/toDate/toTime (ET) + servers + agentMode
apiRouter.get("/server", async (req, res) => {
  const params = {};
  if (req.query.fromDate)  params.fromDate  = req.query.fromDate;
  if (req.query.fromTime)  params.fromTime  = req.query.fromTime;
  if (req.query.toDate)    params.toDate    = req.query.toDate;
  if (req.query.toTime)    params.toTime    = req.query.toTime;
  if (req.query.agentMode) params.agentMode = req.query.agentMode;
  if (req.query.servers) {
    const srvs = String(req.query.servers).split(",").map(s => s.trim()).filter(Boolean);
    if (srvs.length > 0) params.servers = srvs;
  }
  try {
    const cached = await getAnalyticsCache("server", params);
    if (cached) return res.json({ data: cached, cache: "HIT" });
    const started = Date.now();
    const data = await serverService.compute(params);
    console.log(`[analytics:server] computed in ${Date.now() - started}ms`);
    await setAnalyticsCache("server", params, data);
    res.json({ data, cache: "MISS" });
  } catch (e) {
    console.error("[analytics:server] error:", e);
    res.status(500).json({ error: "server analytics failed", message: e.message });
  }
});

// ai-summary uses fromDate/fromTime/toDate/toTime (ET) instead of UTC from/to
apiRouter.get("/ai-summary", async (req, res) => {
  const params = {};
  if (req.query.fromDate) params.fromDate = req.query.fromDate;
  if (req.query.fromTime) params.fromTime = req.query.fromTime;
  if (req.query.toDate)   params.toDate   = req.query.toDate;
  if (req.query.toTime)   params.toTime   = req.query.toTime;
  try {
    const cached = await getAnalyticsCache("ai-summary", params);
    if (cached) return res.json({ ...cached, cache: "HIT" });
    const started = Date.now();
    const data = await aiSummaryService.compute(params);
    console.log(`[analytics:ai-summary] computed in ${Date.now() - started}ms`);
    await setAnalyticsCache("ai-summary", params, data);
    res.json({ ...data, cache: "MISS" });
  } catch (e) {
    console.error("[analytics:ai-summary] error:", e);
    res.status(500).json({ error: "ai-summary analytics failed", message: e.message });
  }
});

module.exports = { viewRouter, apiRouter };
