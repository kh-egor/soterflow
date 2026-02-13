/**
 * @module soterflow-integration.test
 * Integration tests for the SoterFlow pipeline: DB → channels → orchestrator → inbox → API.
 */

import Database from "better-sqlite3";
import fs from "fs";
import http from "node:http";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { WorkItem } from "./channels/base.js";
import { BaseChannel } from "./channels/base.js";

// ── Mock Channel ──

class MockChannel extends BaseChannel {
  name: string;
  private items: WorkItem[];
  connected = false;
  shouldFail = false;

  constructor(name: string, items: WorkItem[]) {
    super();
    this.name = name;
    this.items = items;
  }

  async connect(): Promise<void> {
    if (this.shouldFail) {
      throw new Error(`${this.name} connection failed`);
    }
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  async sync(): Promise<WorkItem[]> {
    if (this.shouldFail) {
      throw new Error(`${this.name} sync failed`);
    }
    return this.items;
  }
  async performAction(): Promise<void> {}
}

function makeItem(overrides: Partial<WorkItem> & { id: string; source: string }): WorkItem {
  return {
    type: "issue",
    title: `Item ${overrides.id}`,
    body: "",
    author: "testuser",
    timestamp: new Date(),
    priority: "normal",
    url: `https://example.com/${overrides.id}`,
    metadata: {},
    status: "new",
    ...overrides,
  };
}

// ── Test-scoped DB helpers ──
// We re-implement a minimal in-process version to avoid polluting real DB.

const TEST_DB_PATH = path.join(__dirname, "../data/test-integration.db");

function cleanDb() {
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
}

/**
 * We use dynamic imports + env override to point the store at our test DB.
 * Since the db module caches, we need to reset between tests.
 */
describe("SoterFlow Integration", () => {
  beforeEach(() => {
    cleanDb();
    // Set env so the store modules use our test DB
    process.env.SOTERFLOW_DB_PATH = TEST_DB_PATH;
    // Reset module cache for db.ts to pick up new path
    resetDbModule();
  });

  afterEach(() => {
    try {
      const { closeDb } = require("./store/db");
      closeDb();
    } catch {}
    cleanDb();
  });

  function resetDbModule() {
    // Force the cached db instance to null by calling closeDb
    try {
      const { closeDb } = require("./store/db");
      closeDb();
    } catch {}
  }

  it("1. full pipeline: init DB → sync → query inbox", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll, getInbox } = await import("./agent/orchestrator.js");

    getDb(); // init

    const items = [
      makeItem({ id: "gh-1", source: "github", type: "pr", title: "Fix login bug" }),
      makeItem({ id: "gh-2", source: "github", type: "issue", title: "Add dark mode" }),
    ];
    const mockGh = new MockChannel("github", items);

    const { stats } = await syncAll([mockGh]);

    expect(stats.totalItems).toBe(2);
    expect(stats.newItems).toBe(2);
    expect(stats.perSource.github.total).toBe(2);

    const inbox = getInbox();
    expect(inbox.length).toBe(2);
    // PR should be high priority (heuristic)
    const pr = inbox.find((i) => i.type === "pr");
    expect(pr).toBeDefined();
    expect(["high", "urgent"]).toContain(pr!.priority);
  });

  it("2. deduplication across channels", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll } = await import("./agent/orchestrator.js");

    getDb();

    const sharedUrl = "https://github.com/org/repo/issues/42";
    const ghItems = [
      makeItem({ id: "gh-42", source: "github", url: sharedUrl, priority: "normal" }),
    ];
    const slackItems = [
      makeItem({ id: "sl-42", source: "slack", url: sharedUrl, priority: "high" }),
    ];

    const { stats } = await syncAll([
      new MockChannel("github", ghItems),
      new MockChannel("slack", slackItems),
    ]);

    expect(stats.duplicatesSkipped).toBe(1);
    expect(stats.totalItems).toBe(1);
  });

  it("3. partial sync failure preserves successful results", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll, getInbox } = await import("./agent/orchestrator.js");

    getDb();

    const goodChannel = new MockChannel("github", [
      makeItem({ id: "gh-ok", source: "github", title: "Good item" }),
    ]);
    const badChannel = new MockChannel("jira", []);
    badChannel.shouldFail = true;

    // Should not throw — partial failure is handled
    const { stats } = await syncAll([goodChannel, badChannel]);

    // The good channel's item should still be stored
    const inbox = getInbox();
    expect(inbox.length).toBe(1);
    expect(inbox[0].title).toBe("Good item");
  });

  it("4. FTS search works after sync", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll } = await import("./agent/orchestrator.js");
    const { search } = await import("./store/workitems.js");

    getDb();

    await syncAll([
      new MockChannel("github", [
        makeItem({
          id: "gh-s1",
          source: "github",
          title: "Authentication refactor",
          body: "Rewrite OAuth flow",
        }),
        makeItem({ id: "gh-s2", source: "github", title: "UI polish", body: "Button colors" }),
      ]),
    ]);

    const results = search("OAuth");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("gh-s1");
  });

  it("5. status updates persist", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll, getInbox } = await import("./agent/orchestrator.js");
    const { updateStatus } = await import("./store/workitems.js");

    getDb();

    await syncAll([
      new MockChannel("github", [
        makeItem({ id: "gh-done", source: "github", title: "Done item" }),
        makeItem({ id: "gh-keep", source: "github", title: "Keep item" }),
      ]),
    ]);

    updateStatus("gh-done", "done");

    const inbox = getInbox();
    expect(inbox.length).toBe(1);
    expect(inbox[0].id).toBe("gh-keep");
  });

  it("6. age escalation bumps priority", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll, getInbox } = await import("./agent/orchestrator.js");

    getDb();

    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    await syncAll([
      new MockChannel("github", [
        makeItem({
          id: "gh-old",
          source: "github",
          title: "Old normal item",
          priority: "normal",
          timestamp: oldDate,
        }),
      ]),
    ]);

    const inbox = getInbox();
    // normal → high after 24h
    expect(inbox[0].priority).toBe("high");
  });

  it("7. CLI formatItem output structure", async () => {
    const { formatItem } = await import("./cli/inbox.js");

    const item = makeItem({
      id: "gh-fmt",
      source: "github",
      type: "pr",
      title: "Test PR",
      priority: "urgent",
    });
    const output = formatItem(item);

    expect(output).toContain("🔴"); // urgent icon
    expect(output).toContain("🐙"); // github icon
    expect(output).toContain("github/pr");
    expect(output).toContain("Test PR");
  });

  it("8. sync state is recorded per channel", async () => {
    const { getDb } = await import("./store/db.js");
    const { syncAll } = await import("./agent/orchestrator.js");
    const { getSyncState } = await import("./store/sync.js");

    getDb();

    await syncAll([new MockChannel("github", [makeItem({ id: "gh-ss", source: "github" })])]);

    const state = getSyncState("github");
    expect(state).not.toBeNull();
    expect(state!.channelName).toBe("github");
    expect(state!.lastSync).toBeInstanceOf(Date);
  });
});
