// services/db.js — shared MongoDB singleton, imported by server.js and all analytics services
const { MongoClient } = require("mongodb");

let client;
let db;

async function getDb() {
  if (db) return db;
  client = new MongoClient(process.env.MONGO_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000000
  });
  await client.connect();
  db = client.db(process.env.DB_NAME);
  console.log("Connected to MongoDB");
  return db;
}

async function closeDb() {
  if (client) await client.close();
}

module.exports = { getDb, closeDb };
