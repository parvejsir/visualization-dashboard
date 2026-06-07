// analytics/router.js — view routes (mounted at /analytics) and API routes (mounted at /api/analytics)
"use strict";
const express = require("express");
const overviewService = require("./overviewService");
const serverService   = require("./serverService");
const vendorService   = require("./vendorService");
const hourlyService   = require("./hourlyService");
const { getAnalyticsCache, setAnalyticsCache } = require("../services/analyticsCache");

// ---- View router (serves EJS pages) ----
const viewRouter = express.Router();

viewRouter.get("/overview", (req, res) => res.render("analytics/overview"));
viewRouter.get("/server",   (req, res) => res.render("analytics/server"));
viewRouter.get("/vendor",   (req, res) => res.render("analytics/vendor"));
viewRouter.get("/hourly",   (req, res) => res.render("analytics/hourly"));

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
apiRouter.get("/server",   makeHandler("server",   serverService));
apiRouter.get("/vendor",   makeHandler("vendor",   vendorService));
apiRouter.get("/hourly",   makeHandler("hourly",   hourlyService));

module.exports = { viewRouter, apiRouter };
