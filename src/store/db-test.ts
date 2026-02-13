/**
 * Smoke test for SoterFlow DB initialization.
 * Run with: npx tsx src/store/db-test.ts
 */

// Set env BEFORE importing modules so the env helper picks it up
process.env.SOTERFLOW_DB_PATH = "./data/soterflow-test.db";

import type { WorkItem } from "../channels/base.js";
import { getDb, closeDb } from "./db.js";
import { upsert, getAll } from "./workitems.js";

const testItem: WorkItem = {
  id: "test-001",
  source: "github",
  type: "issue",
  title: "Test issue for smoke test",
  body: "This is a smoke test body.",
  author: "soterflow-test",
  timestamp: new Date(),
  priority: "normal",
  url: "https://example.com/test",
  metadata: { test: true },
  status: "new",
};

try {
  console.log("Initializing DB...");
  const db = getDb();
  console.log("✅ DB initialized");

  console.log("Upserting test work item...");
  upsert(testItem);
  console.log("✅ Upserted");

  console.log("Querying all items...");
  const items = getAll();
  console.log(`✅ Found ${items.length} item(s)`);

  const found = items.find((i) => i.id === "test-001");
  if (!found) {
    throw new Error("Test item not found!");
  }
  if (found.title !== testItem.title) {
    throw new Error("Title mismatch!");
  }
  console.log("✅ Smoke test PASSED");

  closeDb();

  // Clean up test DB
  try {
    const fs = await import("fs");
    const dbPath = process.env.SOTERFLOW_DB_PATH;
    fs.unlinkSync(dbPath);
    try {
      fs.unlinkSync(dbPath + "-wal");
    } catch {}
    try {
      fs.unlinkSync(dbPath + "-shm");
    } catch {}
    console.log("🧹 Cleaned up test DB");
  } catch {
    console.log("⚠️ Could not clean up test DB (non-fatal)");
  }
} catch (err) {
  console.error("❌ Smoke test FAILED:", err);
  process.exit(1);
}
