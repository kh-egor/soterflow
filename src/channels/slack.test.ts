import { describe, it, expect, vi } from "vitest";
import { mapSlackDM, mapSlackMention, mapSlackStar } from "./slack";

// --- DM mapping ---

describe("mapSlackDM", () => {
  it("maps a DM message to WorkItem", () => {
    const msg = { user: "U123", text: "Hello there", ts: "1700000000.000100" };
    const item = mapSlackDM(msg, "D456");
    expect(item.id).toBe("slack-dm-D456-1700000000.000100");
    expect(item.source).toBe("slack");
    expect(item.type).toBe("message");
    expect(item.title).toBe("DM from U123");
    expect(item.body).toBe("Hello there");
    expect(item.author).toBe("U123");
    expect(item.priority).toBe("normal");
    expect(item.metadata.isDM).toBe(true);
    expect(item.metadata.channel).toBe("D456");
    expect(item.url).toContain("D456");
  });

  it("handles missing user and text", () => {
    const msg = { ts: "1700000000.000200" };
    const item = mapSlackDM(msg, "D789");
    expect(item.author).toBe("unknown");
    expect(item.title).toBe("DM from unknown");
    expect(item.body).toBe("");
  });

  it("converts ts to correct timestamp", () => {
    const msg = { user: "U1", text: "hi", ts: "1700000000.000000" };
    const item = mapSlackDM(msg, "D1");
    expect(item.timestamp.getTime()).toBe(1700000000000);
  });
});

// --- Mention mapping ---

describe("mapSlackMention", () => {
  it("maps a mention match to WorkItem", () => {
    const match = {
      channel: { id: "C123", name: "general" },
      ts: "1700000001.000000",
      text: "Hey <@U456>",
      user: "U789",
      permalink: "https://slack.com/archives/C123/p1700000001000000",
    };
    const item = mapSlackMention(match);
    expect(item.id).toBe("slack-mention-C123-1700000001.000000");
    expect(item.type).toBe("mention");
    expect(item.priority).toBe("high");
    expect(item.title).toContain("#general");
    expect(item.url).toBe(match.permalink);
  });

  it("falls back to username when user is missing", () => {
    const match = { channel: { id: "C1" }, ts: "1.0", username: "bot" };
    expect(mapSlackMention(match).author).toBe("bot");
  });

  it("handles completely missing author", () => {
    const match = { channel: { id: "C1" }, ts: "1.0" };
    expect(mapSlackMention(match).author).toBe("unknown");
  });
});

// --- Star mapping ---

describe("mapSlackStar", () => {
  it("maps a starred message to WorkItem", () => {
    const star = {
      type: "message",
      channel: "C999",
      message: {
        user: "U111",
        text: "Important note",
        ts: "1700000002.000000",
        permalink: "https://example.com",
      },
    };
    const item = mapSlackStar(star);
    expect(item.id).toBe("slack-star-C999-1700000002.000000");
    expect(item.type).toBe("message");
    expect(item.metadata.starred).toBe(true);
    expect(item.body).toBe("Important note");
  });

  it("handles missing message fields", () => {
    const star = { type: "message", channel: "C1", message: {} };
    const item = mapSlackStar(star);
    expect(item.author).toBe("unknown");
    expect(item.body).toBe("");
  });
});

// --- SlackChannel class ---

describe("SlackChannel", () => {
  it("throws on missing SLACK_TOKEN", async () => {
    delete process.env.SLACK_TOKEN;
    const { SlackChannel } = await import("./slack");
    const channel = new SlackChannel();
    await expect(channel.connect()).rejects.toThrow("SLACK_TOKEN is not set");
  });

  it("throws when not connected", async () => {
    const { SlackChannel } = await import("./slack");
    const channel = new SlackChannel();
    await expect(channel.sync()).rejects.toThrow("Not connected");
    await expect(channel.performAction("x", "reply", {})).rejects.toThrow("Not connected");
  });
});
