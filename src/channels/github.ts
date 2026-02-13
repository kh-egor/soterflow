/**
 * @module channels/github
 * GitHub channel connector — fetches notifications, assigned issues, review-requested PRs, and mentions.
 * Features: pagination, rate-limit handling, exponential backoff retries.
 */

import { Octokit } from "@octokit/rest";
import { BaseChannel, WorkItem } from "./base";
import { withRetry, sleep } from "./retry";

const RATE_LIMIT_THRESHOLD = 10; // back off when remaining < this

export class GitHubChannel extends BaseChannel {
  name = "github";
  private octokit: Octokit | null = null;
  private username = "";

  async connect(): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is not set");
    }
    this.octokit = new Octokit({ auth: token });
    const { data } = await this.octokit.users.getAuthenticated();
    this.username = data.login;
  }

  async disconnect(): Promise<void> {
    this.octokit = null;
    this.username = "";
  }

  /** Retry wrapper with exponential backoff and rate-limit awareness. */
  private withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      isRetryable: (err: any) => {
        const status = err?.status ?? err?.response?.status;
        const isRateLimit = status === 403 && /rate limit/i.test(err?.message ?? "");
        return isRateLimit || status >= 500 || err?.code === "ECONNRESET";
      },
    });
  }

  /** Check rate limit after a response, sleep if low. */
  private async checkRateLimit(): Promise<void> {
    if (!this.octokit) {
      return;
    }
    try {
      const { data } = await this.octokit.rateLimit.get();
      const core = data.resources.core;
      if (core.remaining < RATE_LIMIT_THRESHOLD) {
        const waitMs = Math.max(0, core.reset * 1000 - Date.now()) + 1000;
        await sleep(Math.min(waitMs, 120_000));
      }
    } catch {
      // non-critical
    }
  }

  async sync(): Promise<WorkItem[]> {
    if (!this.octokit) {
      throw new Error("Not connected — call connect() first");
    }

    const items: WorkItem[] = [];
    const syncDays = parseInt(process.env.SOTERFLOW_SYNC_WINDOW_DAYS ?? "7", 10);
    const sinceDate = new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Notifications (paginated, filtered by since)
    const notifications = await this.withRetry(() =>
      this.octokit!.paginate(this.octokit!.activity.listNotificationsForAuthenticatedUser, {
        all: false,
        since: sinceDate,
        per_page: 100,
      }),
    );
    for (const n of notifications) {
      items.push(mapNotification(n));
    }

    await this.checkRateLimit();

    // 2. Assigned issues (paginated, filtered by since)
    const issues = await this.withRetry(() =>
      this.octokit!.paginate(this.octokit!.issues.list, {
        filter: "assigned",
        state: "open",
        since: sinceDate,
        per_page: 100,
      }),
    );
    for (const issue of issues) {
      if (issue.pull_request) {
        continue;
      }
      items.push(mapIssue(issue));
    }

    await this.checkRateLimit();

    // 3. PRs where review is requested (search, paginated)
    const reviewPrs = await this.withRetry(() =>
      this.octokit!.paginate(this.octokit!.search.issuesAndPullRequests, {
        q: `is:pr is:open review-requested:${this.username}`,
        per_page: 100,
      }),
    );
    for (const pr of reviewPrs) {
      items.push(mapPR(pr));
    }

    await this.checkRateLimit();

    // 4. Mentions in issues/PRs
    const mentions = await this.withRetry(() =>
      this.octokit!.paginate(this.octokit!.search.issuesAndPullRequests, {
        q: `mentions:${this.username} is:open`,
        per_page: 100,
      }),
    );
    for (const m of mentions) {
      // avoid duplicates
      const id = m.pull_request ? `github-pr-${m.id}` : `github-issue-${m.id}`;
      if (!items.some((i) => i.id === id)) {
        items.push(mapMention(m));
      }
    }

    return items;
  }

  async performAction(itemId: string, action: string, params?: Record<string, any>): Promise<void> {
    if (!this.octokit) {
      throw new Error("Not connected");
    }
    const meta = params ?? {};
    const owner = meta.owner as string;
    const repo = meta.repo as string;
    const number = meta.number as number;

    await this.withRetry(async () => {
      switch (action) {
        case "close":
          await this.octokit!.issues.update({ owner, repo, issue_number: number, state: "closed" });
          break;
        case "merge":
          await this.octokit!.pulls.merge({ owner, repo, pull_number: number });
          break;
        case "approve":
          await this.octokit!.pulls.createReview({
            owner,
            repo,
            pull_number: number,
            event: "APPROVE",
            body: meta.body ?? "",
          });
          break;
        case "comment":
          await this.octokit!.issues.createComment({
            owner,
            repo,
            issue_number: number,
            body: meta.body as string,
          });
          break;
        default:
          throw new Error(`Unsupported GitHub action: ${action}`);
      }
    });
  }
}

// --- Mapping helpers (exported for testing) ---

export function assignPriority(item: {
  labels?: any[];
  reason?: string;
  isPR?: boolean;
  isReviewRequest?: boolean;
}): WorkItem["priority"] {
  const labelNames: string[] = (item.labels ?? []).map((l: any) =>
    typeof l === "string" ? l.toLowerCase() : (l.name ?? "").toLowerCase(),
  );

  if (labelNames.some((l) => l.includes("urgent") || l.includes("critical") || l === "p0")) {
    return "urgent";
  }
  if (
    labelNames.some((l) => l.includes("high") || l === "p1") ||
    item.reason === "security_alert"
  ) {
    return "urgent";
  }
  if (item.isReviewRequest || item.reason === "review_requested") {
    return "high";
  }
  if (item.reason === "assign" || item.reason === "mention") {
    return "high";
  }
  if (labelNames.some((l) => l.includes("low") || l === "p3")) {
    return "low";
  }
  return "normal";
}

export function mapNotification(n: any): WorkItem {
  // Convert API URL to web URL
  const apiUrl: string = n.subject.url ?? "";
  const webUrl = apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace("/pulls/", "/pull/");

  // Human-readable reason
  const reasonMap: Record<string, string> = {
    author: "You authored this",
    assign: "Assigned to you",
    review_requested: "Review requested",
    mention: "You were mentioned",
    comment: "New comment",
    ci_activity: "CI activity",
    security_alert: "Security alert",
    state_change: "State changed",
    subscribed: "Subscribed",
    team_mention: "Team mentioned",
  };
  const reasonText = reasonMap[n.reason] ?? n.reason;

  return {
    id: `github-notif-${n.id}`,
    source: "github",
    type:
      n.subject.type === "PullRequest"
        ? "pr"
        : n.subject.type === "Issue"
          ? "issue"
          : "notification",
    title: n.subject.title,
    body: `${reasonText} · ${n.repository.full_name} · ${n.subject.type}`,
    author: n.repository.full_name.split("/")[1] ?? n.repository.full_name,
    timestamp: new Date(n.updated_at),
    priority: assignPriority({ reason: n.reason }),
    url: webUrl || `https://github.com/${n.repository.full_name}`,
    metadata: {
      reason: n.reason,
      reasonText,
      subjectType: n.subject.type,
      threadId: n.id,
      repo: n.repository.full_name,
    },
    status: "new",
  };
}

export function mapIssue(issue: any): WorkItem {
  return {
    id: `github-issue-${issue.id}`,
    source: "github",
    type: "issue",
    title: issue.title,
    body: issue.body ?? "",
    author: issue.user?.login ?? "unknown",
    timestamp: new Date(issue.updated_at),
    priority: assignPriority({ labels: issue.labels, reason: "assign" }),
    url: issue.html_url,
    metadata: {
      number: issue.number,
      labels: (issue.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      repo: issue.repository?.full_name,
    },
    status: "new",
  };
}

export function mapPR(pr: any): WorkItem {
  return {
    id: `github-pr-${pr.id}`,
    source: "github",
    type: "pr",
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user?.login ?? "unknown",
    timestamp: new Date(pr.updated_at),
    priority: assignPriority({ isReviewRequest: true, labels: pr.labels }),
    url: pr.html_url,
    metadata: { number: pr.number },
    status: "new",
  };
}

export function mapMention(m: any): WorkItem {
  const isPR = !!m.pull_request;
  return {
    id: isPR ? `github-pr-${m.id}` : `github-issue-${m.id}`,
    source: "github",
    type: isPR ? "pr" : "issue",
    title: m.title,
    body: m.body ?? "",
    author: m.user?.login ?? "unknown",
    timestamp: new Date(m.updated_at),
    priority: assignPriority({ labels: m.labels, reason: "mention" }),
    url: m.html_url,
    metadata: {
      number: m.number,
      labels: (m.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
    },
    status: "new",
  };
}
