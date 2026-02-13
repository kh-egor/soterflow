/**
 * Tests for the SoterFlow API server and auth.
 */

import crypto from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";

const BOT_TOKEN = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz";

// Set env BEFORE dynamic imports
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.SOTERFLOW_DB_PATH = ":memory:";

function makeInitData(user: object, botToken: string, overrides?: { expire?: boolean }): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(Math.floor(Date.now() / 1000) - (overrides?.expire ? 7200 : 60)));
  params.set("query_id", "test123");

  const sorted = [...params.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(sorted).digest("hex");
  params.set("hash", hash);

  return params.toString();
}

describe("validateInitData", () => {
  const testUser = { id: 123, first_name: "Test", username: "testuser" };
  let validateInitData: any;

  beforeAll(async () => {
    const mod = await import("./auth.js");
    validateInitData = mod.validateInitData;
  });

  it("should validate correct initData", () => {
    const initData = makeInitData(testUser, BOT_TOKEN);
    const result = validateInitData(initData, BOT_TOKEN);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(123);
    expect(result!.username).toBe("testuser");
  });

  it("should reject wrong bot token", () => {
    const initData = makeInitData(testUser, BOT_TOKEN);
    expect(validateInitData(initData, "wrong_token")).toBeNull();
  });

  it("should reject tampered data", () => {
    const initData = makeInitData(testUser, BOT_TOKEN);
    expect(validateInitData(initData.replace("testuser", "hacker"), BOT_TOKEN)).toBeNull();
  });

  it("should reject expired initData", () => {
    const initData = makeInitData(testUser, BOT_TOKEN, { expire: true });
    expect(validateInitData(initData, BOT_TOKEN)).toBeNull();
  });

  it("should reject empty initData", () => {
    expect(validateInitData("", BOT_TOKEN)).toBeNull();
    expect(validateInitData("foo=bar", BOT_TOKEN)).toBeNull();
  });
});

describe("API server endpoints", () => {
  let baseUrl: string;
  let server: any;
  let validAuth: string;

  beforeAll(async () => {
    const { getDb } = await import("../store/db.js");
    getDb();

    const { createServer } = await import("./server.js");
    const s = createServer();
    server = s.server;

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const addr = server.address();
    baseUrl = `http://localhost:${addr.port}`;

    const user = { id: 1, first_name: "Test" };
    validAuth = "tma " + makeInitData(user, BOT_TOKEN);
  });

  it("GET /api/health returns ok without auth", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("GET /api/inbox requires auth", async () => {
    const res = await fetch(`${baseUrl}/api/inbox`);
    expect(res.status).toBe(401);
  });

  it("GET /api/inbox returns items with auth", async () => {
    const res = await fetch(`${baseUrl}/api/inbox`, {
      headers: { Authorization: validAuth },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /api/inbox/:id returns 404 for missing", async () => {
    const res = await fetch(`${baseUrl}/api/inbox/nonexistent`, {
      headers: { Authorization: validAuth },
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/sync/status returns sync info", async () => {
    const res = await fetch(`${baseUrl}/api/sync/status`, {
      headers: { Authorization: validAuth },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveProperty("syncStates");
    expect(body.data).toHaveProperty("channels");
  });

  it("GET /api/config/channels returns channel list", async () => {
    const res = await fetch(`${baseUrl}/api/config/channels`, {
      headers: { Authorization: validAuth },
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("POST /api/inbox/:id/action rejects missing action", async () => {
    const res = await fetch(`${baseUrl}/api/inbox/test/action`, {
      method: "POST",
      headers: { Authorization: validAuth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
