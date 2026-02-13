/**
 * @module channels/github
 * GitHub channel connector — fetches notifications, assigned issues, review-requested PRs, and mentions.
 * Features: pagination, rate-limit handling, exponential backoff retries.
 */

import { Octokit } from "@octokit/rest";
import { BaseChannel, WorkItem } from "./base";
import { withRetry, sleep } from "./retry";

const RATE_LIMIT_THRESHOLD = 10; // back off when remaining < this

/** Minimal label shape from GitHub API */
interface GhLabel {
  name?: string;
  [key: string]: unknown;
}

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
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this.octokit = null;
    this.username = "";
    this._connected = false;
  }

  /** Retry wrapper with exponential backoff and rate-limit awareness. */
  private withRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      isRetryable: (err: unknown) => {
        const e = err as Record<string, unknown>;
        const status = (e?.status ?? (e?.response as Record<string, unknown>)?.status) as
          | number
          | undefined;
        const msg = typeof e?.message === "string" ? e.message : "";
        const isRateLimit = status === 403 && /rate limit/i.test(msg);
        return isRateLimit || (status !== undefined && status >= 500) || e?.code === "ECONNRESET";
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
      const id = m.pull_request ? `github-pr-${String(m.id)}` : `github-issue-${String(m.id)}`;
      if (!items.some((i) => i.id === id)) {
        items.push(mapMention(m));
      }
    }

    return items;
  }

  async performAction(
    itemId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
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
            body: (meta.body as string) ?? "",
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

function labelName(l: string | GhLabel): string {
  return typeof l === "string" ? l.toLowerCase() : ((l.name as string) ?? "").toLowerCase();
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels.map((l: string | GhLabel) => labelName(l));
}

export function assignPriority(item: {
  labels?: unknown[];
  reason?: string;
  isPR?: boolean;
  isReviewRequest?: boolean;
}): WorkItem["priority"] {
  const names = labelNames(item.labels);

  if (names.some((l) => l.includes("urgent") || l.includes("critical") || l === "p0")) {
    return "urgent";
  }
  if (names.some((l) => l.includes("high") || l === "p1") || item.reason === "security_alert") {
    return "urgent";
  }
  if (item.isReviewRequest || item.reason === "review_requested") {
    return "high";
  }
  if (item.reason === "assign" || item.reason === "mention") {
    return "high";
  }
  if (names.some((l) => l.includes("low") || l === "p3")) {
    return "low";
  }
  return "normal";
}

export function mapNotification(n: Record<string, unknown>): WorkItem {
  const subject = n.subject as Record<string, unknown>;
  const repository = n.repository as Record<string, unknown>;

  // Convert API URL to web URL
  const apiUrl: string = (subject.url as string) ?? "";
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
  const reason = n.reason as string;
  const reasonText = reasonMap[reason] ?? reason;
  const fullName = (repository.full_name as string) ?? "";

  return {
    id: `github-notif-${String(n.id)}`,
    source: "github",
    type:
      subject.type === "PullRequest" ? "pr" : subject.type === "Issue" ? "issue" : "notification",
    title: subject.title as string,
    body: `${reasonText} · ${fullName} · ${subject.type as string}`,
    author: fullName.split("/")[1] ?? fullName,
    timestamp: new Date(n.updated_at as string),
    priority: assignPriority({ reason }),
    url: webUrl || `https://github.com/${fullName}`,
    metadata: {
      reason,
      reasonText,
      subjectType: subject.type,
      threadId: n.id,
      repo: fullName,
    },
    status: "new",
  };
}

export function mapIssue(issue: Record<string, unknown>): WorkItem {
  const user = issue.user as Record<string, unknown> | undefined;
  const repo = issue.repository as Record<string, unknown> | undefined;
  return {
    id: `github-issue-${String(issue.id)}`,
    source: "github",
    type: "issue",
    title: issue.title as string,
    body: (issue.body as string) ?? "",
    author: (user?.login as string) ?? "unknown",
    timestamp: new Date(issue.updated_at as string),
    priority: assignPriority({ labels: issue.labels as unknown[], reason: "assign" }),
    url: issue.html_url as string,
    metadata: {
      number: issue.number,
      labels: labelNames(issue.labels).map((l) => l),
      repo: repo?.full_name,
    },
    status: "new",
  };
}

export function mapPR(pr: Record<string, unknown>): WorkItem {
  const user = pr.user as Record<string, unknown> | undefined;
  return {
    id: `github-pr-${String(pr.id)}`,
    source: "github",
    type: "pr",
    title: pr.title as string,
    body: (pr.body as string) ?? "",
    author: (user?.login as string) ?? "unknown",
    timestamp: new Date(pr.updated_at as string),
    priority: assignPriority({ isReviewRequest: true, labels: pr.labels as unknown[] }),
    url: pr.html_url as string,
    metadata: { number: pr.number },
    status: "new",
  };
}

export function mapMention(m: Record<string, unknown>): WorkItem {
  const isPR = !!m.pull_request;
  const user = m.user as Record<string, unknown> | undefined;
  return {
    id: isPR ? `github-pr-${String(m.id)}` : `github-issue-${String(m.id)}`,
    source: "github",
    type: isPR ? "pr" : "issue",
    title: m.title as string,
    body: (m.body as string) ?? "",
    author: (user?.login as string) ?? "unknown",
    timestamp: new Date(m.updated_at as string),
    priority: assignPriority({ labels: m.labels as unknown[], reason: "mention" }),
    url: m.html_url as string,
    metadata: {
      number: m.number,
      labels: labelNames(m.labels),
    },
    status: "new",
  };
}
