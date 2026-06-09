// scripts/create-indexes.js — one-time index creation for analytics performance
// Run once: node scripts/create-indexes.js
// Safe to re-run: createIndex is idempotent (no-op if index already exists)
"use strict";
const { MongoClient } = require("mongodb");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME   = process.env.DB_NAME;

if (!MONGO_URI) { console.error("Missing MONGO_URI in .env"); process.exit(1); }
if (!DB_NAME)   { console.error("Missing DB_NAME in .env");   process.exit(1); }

const INDEXES = [
  // carrierlogreports: "CALL DATE" range + "SERVER IP" equality
  // Enables covered queries for the server-wise vicidialer dials report.
  // With 1M+ records/day this is REQUIRED — without it every query does a full COLLSCAN.
  {
    collection: "carrierlogreports",
    index: { "CALL DATE": 1, "SERVER IP": 1 },
    options: { name: "calldate_serverip" }
  },

  // transcriptions: event + createdAt — primary analytics filter path
  {
    collection: "transcriptions",
    index: { "body.event": 1, createdAt: 1 },
    options: { name: "event_createdAt" }
  },

  // transcriptions: agent_id filter (retell vs vicidial) — used by server + overview pages
  {
    collection: "transcriptions",
    index: { "body.event": 1, createdAt: 1, "body.call.agent_id": 1 },
    options: { name: "event_createdAt_agentId" }
  },

  // cdrtbirecords: date string range filter
  {
    collection: "cdrtbirecords",
    index: { date: 1, dst_number: 1 },
    options: { name: "date_dstNumber" }
  }
];

async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    console.log("Connected to MongoDB:", DB_NAME);
    const db = client.db(DB_NAME);

    for (const { collection, index, options } of INDEXES) {
      process.stdout.write(`  Creating index on ${collection} ${JSON.stringify(index)} ... `);
      const result = await db.collection(collection).createIndex(index, options);
      console.log(result === options.name ? "created" : `already exists (${result})`);
    }

    console.log("\nDone. All indexes are in place.");
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
