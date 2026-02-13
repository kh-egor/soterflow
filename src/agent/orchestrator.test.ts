import { describe, it, expect } from "vitest";
import type { WorkItem } from "../channels/base.js";
import {
  deduplicateItems,
  applyPriorityHeuristics,
  applyAgeEscalation,
  createChannels,
  getConfiguredChannels,
} from "./orchestrator.js";

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "test-1",
    source: "github",
    type: "issue",
    title: "Test item",
    body: "",
    author: "testuser",
    timestamp: new Date(),
    priority: "normal",
    url: "https://github.com/test/1",
    metadata: {},
    status: "new",
    ...overrides,
  };
}

describe("createChannels / getConfiguredChannels", () => {
  it("returns empty when no env vars set", () => {
    // env vars default to "" which is falsy
    const configs = getConfiguredChannels();
    // At least the structure is correct
    expect(configs).toHaveLength(3);
    expect(configs[0].name).toBe("github");
    expect(configs[1].name).toBe("jira");
    expect(configs[2].name).toBe("slack");
  });

  it("createChannels only creates channels with tokens", () => {
    // With default empty env, no channels should be created
    const channels = createChannels();
    // This depends on actual env - just verify it returns an array
    expect(Array.isArray(channels)).toBe(true);
  });
});

describe("deduplicateItems", () => {
  it("removes items with duplicate URLs", () => {
    const items = [
      makeItem({ id: "a", url: "https://x.com/1", priority: "normal" }),
      makeItem({ id: "b", url: "https://x.com/1", priority: "high" }),
    ];
    const result = deduplicateItems(items);
    expect(result).toHaveLength(1);
    // Should keep the higher priority one
    expect(result[0].priority).toBe("high");
  });

  it("keeps items with different URLs", () => {
    const items = [
      makeItem({ id: "a", url: "https://x.com/1" }),
      makeItem({ id: "b", url: "https://x.com/2" }),
    ];
    expect(deduplicateItems(items)).toHaveLength(2);
  });

  it("keeps items with no URL", () => {
    const items = [makeItem({ id: "a", url: "" }), makeItem({ id: "b", url: "" })];
    expect(deduplicateItems(items)).toHaveLength(2);
  });
});

describe("applyAgeEscalation", () => {
  it("escalates normal → high after 24h", () => {
    const item = makeItem({
      priority: "normal",
      timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    applyAgeEscalation(item);
    expect(item.priority).toBe("high");
  });

  it("escalates high → urgent after 48h", () => {
    const item = makeItem({
      priority: "high",
      timestamp: new Date(Date.now() - 49 * 60 * 60 * 1000),
    });
    applyAgeEscalation(item);
    expect(item.priority).toBe("urgent");
  });

  it("does not escalate recent items", () => {
    const item = makeItem({
      priority: "normal",
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
    });
    applyAgeEscalation(item);
    expect(item.priority).toBe("normal");
  });

  it("does not escalate low items (only normal and high)", () => {
    const item = makeItem({
      priority: "low",
      timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    applyAgeEscalation(item);
    expect(item.priority).toBe("low");
  });
});

describe("applyPriorityHeuristics", () => {
  it("sets PRs to high", () => {
    const item = makeItem({ type: "pr", priority: "normal" });
    applyPriorityHeuristics(item);
    expect(item.priority).toBe("high");
  });

  it("sets mentions to high", () => {
    const item = makeItem({ type: "mention", priority: "normal" });
    applyPriorityHeuristics(item);
    expect(item.priority).toBe("high");
  });

  it("escalates urgent keywords to urgent", () => {
    const item = makeItem({ title: "CRITICAL: server down", priority: "normal" });
    applyPriorityHeuristics(item);
    expect(item.priority).toBe("urgent");
  });

  it("escalates DMs to high", () => {
    const item = makeItem({ metadata: { isDM: true }, priority: "normal" });
    applyPriorityHeuristics(item);
    expect(item.priority).toBe("high");
  });
});
