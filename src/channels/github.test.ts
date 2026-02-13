import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assignPriority,
  mapNotification,
  mapIssue,
  mapPR,
  mapMention,
  GitHubChannel,
} from "./github";

// --- Priority assignment ---

describe("assignPriority", () => {
  it("returns urgent for critical/urgent labels", () => {
    expect(assignPriority({ labels: [{ name: "critical" }] })).toBe("urgent");
    expect(assignPriority({ labels: [{ name: "P0" }] })).toBe("urgent");
    expect(assignPriority({ labels: ["urgent-fix"] })).toBe("urgent");
  });

  it("returns urgent for high/p1 labels or security_alert", () => {
    expect(assignPriority({ labels: [{ name: "high-priority" }] })).toBe("urgent");
    expect(assignPriority({ reason: "security_alert" })).toBe("urgent");
  });

  it("returns high for review requests, assign, mention", () => {
    expect(assignPriority({ isReviewRequest: true })).toBe("high");
    expect(assignPriority({ reason: "review_requested" })).toBe("high");
    expect(assignPriority({ reason: "assign" })).toBe("high");
    expect(assignPriority({ reason: "mention" })).toBe("high");
  });

  it("returns low for low/p3 labels", () => {
    expect(assignPriority({ labels: [{ name: "low" }] })).toBe("low");
    expect(assignPriority({ labels: [{ name: "P3" }] })).toBe("low");
  });

  it("returns normal by default", () => {
    expect(assignPriority({})).toBe("normal");
    expect(assignPriority({ labels: [{ name: "feature" }] })).toBe("normal");
  });
});

// --- Mapping functions ---

describe("mapNotification", () => {
  it("maps a GitHub notification to WorkItem", () => {
    const n = {
      id: "123",
      subject: {
        title: "Bug fix",
        type: "Issue",
        url: "https://api.github.com/repos/o/r/issues/1",
      },
      reason: "assign",
      repository: { full_name: "org/repo" },
      updated_at: "2026-01-15T10:00:00Z",
    };
    const item = mapNotification(n);
    expect(item.id).toBe("github-notif-123");
    expect(item.source).toBe("github");
    expect(item.type).toBe("notification");
    expect(item.title).toBe("Bug fix");
    expect(item.priority).toBe("high"); // reason=assign
    expect(item.metadata.reason).toBe("assign");
  });
});

describe("mapIssue", () => {
  it("maps a GitHub issue to WorkItem", () => {
    const issue = {
      id: 456,
      title: "Fix login",
      body: "Login is broken",
      user: { login: "alice" },
      updated_at: "2026-01-15T10:00:00Z",
      html_url: "https://github.com/org/repo/issues/1",
      number: 1,
      labels: [{ name: "bug" }],
      repository: { full_name: "org/repo" },
    };
    const item = mapIssue(issue);
    expect(item.id).toBe("github-issue-456");
    expect(item.type).toBe("issue");
    expect(item.author).toBe("alice");
    expect(item.priority).toBe("high"); // assigned issues get reason=assign
  });
});

describe("mapPR", () => {
  it("maps a review-requested PR to WorkItem with high priority", () => {
    const pr = {
      id: 789,
      title: "Add feature",
      body: "New feature",
      user: { login: "bob" },
      updated_at: "2026-01-15T10:00:00Z",
      html_url: "https://github.com/org/repo/pull/2",
      number: 2,
      labels: [],
    };
    const item = mapPR(pr);
    expect(item.id).toBe("github-pr-789");
    expect(item.type).toBe("pr");
    expect(item.priority).toBe("high"); // isReviewRequest=true
  });
});

describe("mapMention", () => {
  it("maps a mention in issue", () => {
    const m = {
      id: 101,
      title: "Need input",
      body: "@me thoughts?",
      user: { login: "carol" },
      updated_at: "2026-01-15T10:00:00Z",
      html_url: "https://github.com/org/repo/issues/5",
      number: 5,
      labels: [],
      pull_request: undefined,
    };
    const item = mapMention(m);
    expect(item.id).toBe("github-issue-101");
    expect(item.type).toBe("issue");
    expect(item.priority).toBe("high"); // reason=mention
  });

  it("maps a mention in PR", () => {
    const m = {
      id: 102,
      title: "Review this",
      body: "@me pls",
      user: { login: "dave" },
      updated_at: "2026-01-15T10:00:00Z",
      html_url: "https://github.com/org/repo/pull/6",
      number: 6,
      labels: [],
      pull_request: { url: "..." },
    };
    const item = mapMention(m);
    expect(item.id).toBe("github-pr-102");
    expect(item.type).toBe("pr");
  });
});

// --- GitHubChannel with mocked Octokit ---

describe("GitHubChannel", () => {
  let channel: GitHubChannel;

  beforeEach(() => {
    channel = new GitHubChannel();
  });

  describe("connect", () => {
    it("throws if GITHUB_TOKEN not set", async () => {
      delete process.env.GITHUB_TOKEN;
      await expect(channel.connect()).rejects.toThrow("GITHUB_TOKEN is not set");
    });
  });

  describe("sync error handling", () => {
    it("throws if not connected", async () => {
      await expect(channel.sync()).rejects.toThrow("Not connected");
    });
  });

  describe("retry logic", () => {
    it("retries on 500 errors", async () => {
      // Access private method via any
      const ch = channel as any;
      let calls = 0;
      const fn = async () => {
        calls++;
        if (calls < 3) {
          const err: any = new Error("Server error");
          err.status = 500;
          throw err;
        }
        return "ok";
      };
      // Need to set octokit to something so withRetry is accessible
      ch.octokit = {}; // just to not be null
      const result = await ch.withRetry(fn);
      expect(result).toBe("ok");
      expect(calls).toBe(3);
    });

    it("throws non-retryable errors immediately", async () => {
      const ch = channel as any;
      ch.octokit = {};
      const err: any = new Error("Not found");
      err.status = 404;
      await expect(
        ch.withRetry(async () => {
          throw err;
        }),
      ).rejects.toThrow("Not found");
    });

    it("retries on rate limit errors", async () => {
      const ch = channel as any;
      ch.octokit = {};
      let calls = 0;
      const fn = async () => {
        calls++;
        if (calls === 1) {
          const err: any = new Error("API rate limit exceeded");
          err.status = 403;
          err.response = {
            headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)) },
          };
          throw err;
        }
        return "done";
      };
      const result = await ch.withRetry(fn);
      expect(result).toBe("done");
      expect(calls).toBe(2);
    });
  });
});
