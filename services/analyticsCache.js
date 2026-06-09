// services/analyticsCache.js — Redis cache layer for analytics API responses
const crypto = require("crypto");
const { GET_CACHE, SET_CACHE } = require("./redisService");

// 5 minutes for live/today data; 24 hours for historical (data won't change)
const TTL_TODAY_SECONDS = 300;
const TTL_HISTORY_SECONDS = 86400;

function buildCacheKey(page, params) {
  const sorted = Object.keys(params)
    .filter(k => params[k] != null && params[k] !== "")
    .sort()
    .reduce((acc, k) => { acc[k] = params[k]; return acc; }, {});
  const hash = crypto.createHash("sha1").update(JSON.stringify(sorted)).digest("hex");
  return `analytics:${page}:${hash}`;
}

function getTtl(params) {
  // Support both UTC ISO string (params.to) and ET date string (params.toDate)
  const toStr = params.to || (params.toDate ? `${params.toDate}T23:59:59Z` : null);
  if (!toStr) return TTL_TODAY_SECONDS;
  const to = new Date(toStr);
  if (Number.isNaN(to.getTime())) return TTL_TODAY_SECONDS;
  const nowUtc = new Date();
  return to.toDateString() === nowUtc.toDateString() || to > nowUtc
    ? TTL_TODAY_SECONDS
    : TTL_HISTORY_SECONDS;
}

async function getAnalyticsCache(page, params) {
  try {
    const key = buildCacheKey(page, params);
    const raw = await GET_CACHE(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setAnalyticsCache(page, params, data) {
  try {
    const key = buildCacheKey(page, params);
    const ttl = getTtl(params);
    await SET_CACHE(key, data, ttl);
  } catch (e) {
    console.error("[analyticsCache] set failed:", e.message);
  }
}

module.exports = { getAnalyticsCache, setAnalyticsCache };
