/**
 * @module channels/github
 * GitHub channel connector — fetches notifications, assigned issues, review-requested PRs, and mentions.
 */

import { Octokit } from "@octokit/rest";
import { BaseChannel, WorkItem } from "./base";

export class GitHubChannel extends BaseChannel {
  name = "github";
  private octokit: Octokit | null = null;

  /** Connect to GitHub using GITHUB_TOKEN from environment. */
  async connect(): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN is not set");
    }
    this.octokit = new Octokit({ auth: token });
    // Verify auth
    await this.octokit.users.getAuthenticated();
  }

  async disconnect(): Promise<void> {
    this.octokit = null;
  }

  /** Fetch notifications, assigned issues, and review-requested PRs. */
  async sync(): Promise<WorkItem[]> {
    if (!this.octokit) {
      throw new Error("Not connected — call connect() first");
    }
    const items: WorkItem[] = [];

    // 1. Notifications
    const { data: notifications } =
      await this.octokit.activity.listNotificationsForAuthenticatedUser({
        all: false,
        per_page: 50,
      });
    for (const n of notifications) {
      items.push({
        id: `github-notif-${n.id}`,
        source: "github",
        type: "notification",
        title: n.subject.title,
        body: n.reason,
        author: n.repository.full_name,
        timestamp: new Date(n.updated_at),
        priority: "normal",
        url: n.subject.url ?? `https://github.com/${n.repository.full_name}`,
        metadata: { reason: n.reason, subjectType: n.subject.type, threadId: n.id },
        status: "new",
      });
    }

    // 2. Assigned issues
    const { data: issues } = await this.octokit.issues.list({
      filter: "assigned",
      state: "open",
      per_page: 50,
    });
    for (const issue of issues) {
      if (issue.pull_request) {
        continue;
      } // skip PRs here
      items.push({
        id: `github-issue-${issue.id}`,
        source: "github",
        type: "issue",
        title: issue.title,
        body: issue.body ?? "",
        author: issue.user?.login ?? "unknown",
        timestamp: new Date(issue.updated_at),
        priority: "normal",
        url: issue.html_url,
        metadata: {
          number: issue.number,
          labels: issue.labels.map((l: any) => (typeof l === "string" ? l : l.name)),
          repo: issue.repository?.full_name,
        },
        status: "new",
      });
    }

    // 3. PRs where review is requested
    const { data: viewer } = await this.octokit.users.getAuthenticated();
    const { data: reviewPrs } = await this.octokit.search.issuesAndPullRequests({
      q: `is:pr is:open review-requested:${viewer.login}`,
      per_page: 50,
    });
    for (const pr of reviewPrs.items) {
      items.push({
        id: `github-pr-${pr.id}`,
        source: "github",
        type: "pr",
        title: pr.title,
        body: pr.body ?? "",
        author: pr.user?.login ?? "unknown",
        timestamp: new Date(pr.updated_at),
        priority: "high",
        url: pr.html_url,
        metadata: { number: pr.number },
        status: "new",
      });
    }

    return items;
  }

  /**
   * Perform an action on a GitHub work item.
   * Supported actions: close, merge, approve, comment.
   */
  async performAction(itemId: string, action: string, params?: Record<string, any>): Promise<void> {
    if (!this.octokit) {
      throw new Error("Not connected");
    }
    const meta = params ?? {};

    const owner = meta.owner as string;
    const repo = meta.repo as string;
    const number = meta.number as number;

    switch (action) {
      case "close":
        await this.octokit.issues.update({ owner, repo, issue_number: number, state: "closed" });
        break;
      case "merge":
        await this.octokit.pulls.merge({ owner, repo, pull_number: number });
        break;
      case "approve":
        await this.octokit.pulls.createReview({
          owner,
          repo,
          pull_number: number,
          event: "APPROVE",
          body: meta.body ?? "",
        });
        break;
      case "comment":
        await this.octokit.issues.createComment({
          owner,
          repo,
          issue_number: number,
          body: meta.body as string,
        });
        break;
      default:
        throw new Error(`Unsupported GitHub action: ${action}`);
    }
  }
}
