# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
node server.js
```

Requires a `.env` file (gitignored) with:

```
MONGO_URI=mongodb+srv://...
DB_NAME=your_db_name
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_TTL=86400
```

There are no build steps, lint commands, or tests.

## Architecture

Single-file Express server (`server.js`) + three service modules + an EJS view + client-side JS/CSS.

**Data flow for the main table (`GET /api/transcriptions`):**

1. The date range is split into hourly buckets.
2. Each bucket is looked up in Redis as a hash: key = `calls:YYYY-MM-DD`, field = `HH_direction` (e.g. `09_outbound`).
3. Cache hits are merged immediately. Cache misses trigger a MongoDB aggregation for that specific hour, which is then stored back into Redis before returning.
4. The full in-memory merged result is sliced for pagination client-side.

**Stats charts (`GET /api/transcriptions/stats`)** bypass Redis entirely — they run a single MongoDB `$facet` aggregation over the full filtered set each time.

**MongoDB collections:**
- `transcriptions` — raw Retell webhook payloads (`body.event === "call_analyzed"`). The pipeline extracts `body.call.*` fields.
- `realtimeleads` — lead records joined by `phone` (a 10-digit integer). Phone is extracted from `to_number` (outbound) or `from_number` (inbound) by stripping the leading `+1`.

## Key design decisions

- **Chunked Redis caching**: `chunkService.js` contains the canonical chunk helpers (parallel `HMGET` using `Promise.all`). `server.js` has its own inline copy of the same logic — `chunkService.js` is not yet wired into `server.js`. The two implementations differ slightly; prefer `chunkService.js` as the authoritative version when refactoring.
- **Stats are computed two ways**: `statsService.js` computes stats from already-fetched rows in memory (used when rows come from Redis). `server.js#buildStatsPipeline` + `formatStatsResult` do the same thing via MongoDB `$facet` (used by `/api/transcriptions/stats`). Keep both in sync when adding new metrics.
- **Timezone**: All date inputs from the browser are America/New_York wall-clock time, converted to UTC ISO in `public/app.js` before being sent to the server. MongoDB stores `createdAt` in UTC. Display times are formatted back to ET via `$dateToString` with `timezone: "America/New_York"`.
- **Phone normalization**: Phone numbers are stored as 10-digit `long` integers in `realtimeleads`. The pipeline strips the `+1` prefix and uses `$convert` to cast to `long` before the `$lookup`.

## File map

| File | Purpose |
|---|---|
| `server.js` | Express routes, MongoDB aggregation pipelines, Redis chunk logic |
| `services/redisService.js` | Redis client + low-level hash/string helpers |
| `services/chunkService.js` | Higher-level chunking logic (parallel HMGET, populate missing) |
| `services/statsService.js` | In-memory stats computation from cached rows |
| `views/dashboard.ejs` | Single-page HTML shell; loads Chart.js from CDN |
| `public/app.js` | Filter UI, API calls, table rendering, pagination |
| `public/viz.js` | Chart.js wrappers; `window.renderViz(stats)` is the entry point |
| `public/styles.css` | All CSS |

## Security
- **Mongo Operation**: Never apply create,update,delete,put,patch operation for mongo query,You have permission only to read and fetch from mongodb database
