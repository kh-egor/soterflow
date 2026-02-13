/**
 * @module agent/director
 * The Director — orchestration layer for sub-agent management, skills dispatch, logs, and memory.
 */

import { randomUUID } from "node:crypto";
import { getDb } from "../store/db.js";

// --- Interfaces ---

export interface SubAgent {
  id: string;
  name: string;
  skill: string;
  status: "idle" | "running" | "completed" | "failed";
  task?: string;
  result?: string;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface DirectorLog {
  id: string;
  timestamp: Date;
  level: "info" | "warn" | "error";
  message: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  applicableTo: string[];
  actions: string[];
}

// --- Skills registry ---

const SKILLS: Skill[] = [
  {
    id: "github-pr",
    name: "github-pr",
    description: "Review, approve, merge PRs",
    applicableTo: ["github"],
    actions: ["approve", "merge", "comment", "close"],
  },
  {
    id: "github-issue",
    name: "github-issue",
    description: "Manage issues",
    applicableTo: ["github"],
    actions: ["comment", "close", "label", "assign"],
  },
  {
    id: "jira-update",
    name: "jira-update",
    description: "Transition tickets, add comments",
    applicableTo: ["jira"],
    actions: ["transition", "comment", "assign"],
  },
  {
    id: "slack-reply",
    name: "slack-reply",
    description: "Respond to messages",
    applicableTo: ["slack"],
    actions: ["reply", "react", "thread-reply"],
  },
  {
    id: "deploy",
    name: "deploy",
    description: "Trigger CI/CD pipelines",
    applicableTo: ["github"],
    actions: ["trigger-workflow", "check-status"],
  },
  {
    id: "summarize",
    name: "summarize",
    description: "Summarize a work item or thread",
    applicableTo: ["github", "jira", "slack"],
    actions: ["summarize"],
  },
];

// --- Director class ---

export class Director {
  private static instance: Director | null = null;

  static getInstance(): Director {
    if (!Director.instance) {
      Director.instance = new Director();
    }
    return Director.instance;
  }

  /** Dispatch a task: create a sub-agent, assign skill, simulate execution. */
  dispatch(workItemId: string, skillName: string): SubAgent {
    const skill = SKILLS.find((s) => s.id === skillName);
    if (!skill) {
      throw new Error(`Unknown skill: ${skillName}`);
    }

    const agent: SubAgent = {
      id: randomUUID(),
      name: `agent-${skillName}-${Date.now().toString(36)}`,
      skill: skillName,
      status: "running",
      task: workItemId,
      startedAt: new Date(),
    };

    // Persist
    const db = getDb();
    db.prepare(
      `INSERT INTO sub_agents (id, name, skill, status, task, result, started_at, completed_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      agent.id,
      agent.name,
      agent.skill,
      agent.status,
      agent.task ?? null,
      agent.result ?? null,
      agent.startedAt?.toISOString() ?? null,
      agent.completedAt?.toISOString() ?? null,
      agent.error ?? null,
    );

    this.log("info", `Dispatched ${skillName} for work item ${workItemId}`, agent.id);

    // Simulate async completion after 2s
    setTimeout(() => {
      this.completeAgent(agent.id, `Completed ${skillName} on ${workItemId}`);
    }, 2000);

    return agent;
  }

  private completeAgent(id: string, result: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE sub_agents SET status = 'completed', result = ?, completed_at = ? WHERE id = ?`,
    ).run(result, now, id);
    this.log("info", `Agent ${id} completed`, id);
  }

  getAgents(): SubAgent[] {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM sub_agents ORDER BY started_at DESC`).all() as any[];
    return rows.map(rowToAgent);
  }

  getAgent(id: string): SubAgent | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM sub_agents WHERE id = ?`).get(id) as any;
    return row ? rowToAgent(row) : null;
  }

  log(
    level: DirectorLog["level"],
    message: string,
    agentId?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const db = getDb();
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO director_logs (id, timestamp, level, message, agent_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      timestamp,
      level,
      message,
      agentId ?? null,
      metadata ? JSON.stringify(metadata) : null,
    );
  }

  getLogs(limit = 50): DirectorLog[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM director_logs ORDER BY timestamp DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      timestamp: new Date(r.timestamp),
      level: r.level,
      message: r.message,
      agentId: r.agent_id ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  getMemory(): Record<string, string> {
    const db = getDb();
    const rows = db.prepare(`SELECT key, value FROM director_memory`).all() as any[];
    const mem: Record<string, string> = {};
    for (const r of rows) {
      mem[r.key] = r.value;
    }
    return mem;
  }

  setMemory(key: string, value: string): void {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO director_memory (key, value, updated_at) VALUES (?, ?, ?)`,
    ).run(key, value, new Date().toISOString());
  }

  deleteMemory(key: string): void {
    const db = getDb();
    db.prepare(`DELETE FROM director_memory WHERE key = ?`).run(key);
  }

  getSkills(): Skill[] {
    return SKILLS;
  }
}

function rowToAgent(r: any): SubAgent {
  return {
    id: r.id,
    name: r.name,
    skill: r.skill,
    status: r.status,
    task: r.task ?? undefined,
    result: r.result ?? undefined,
    startedAt: r.started_at ? new Date(r.started_at) : undefined,
    completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
    error: r.error ?? undefined,
  };
}
