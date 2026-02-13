/**
 * @module api/server
 * Express API server for SoterFlow Telegram Mini App.
 */

import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { WorkItem } from "../channels/base.js";
import { Director } from "../agent/director.js";
import { getInbox, syncAll, createChannels, getConfiguredChannels } from "../agent/orchestrator.js";
import { env } from "../soterflow-env.js";
import { getAllSyncStates } from "../store/sync.js";
import { getAll, search, updateStatus } from "../store/workitems.js";
import { authMiddleware } from "./auth.js";

export function createServer() {
  const app = express();
  const server = http.createServer(app);

  // CORS
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (_req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json());

  // Serve static Mini App frontend
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, "public")));

  // Auth for /api/* routes — skip for health and local requests
  app.use("/api", (req, res, next) => {
    if (req.path === "/health") {
      return next();
    }
    // Allow local requests without auth (localhost / 127.0.0.1)
    const ip = req.ip ?? req.socket.remoteAddress ?? "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return next();
    }
    return (authMiddleware as express.RequestHandler)(req, res, next);
  });

  // --- Health ---
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, data: { status: "running" } });
  });

  // --- Inbox ---
  app.get("/api/inbox", (req, res) => {
    try {
      const {
        source,
        type,
        status,
        search: q,
        since,
        excludeStatuses,
      } = req.query as Record<string, string>;
      // Default to 7 days ago if no since param
      const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let items: WorkItem[];
      if (q) {
        items = search(q);
      } else {
        items = getInbox({ source, type, status, since: sinceDate });
      }
      // Filter out excluded Jira statuses
      if (excludeStatuses) {
        const excluded = new Set(excludeStatuses.split(",").map((s) => s.trim().toLowerCase()));
        items = items.filter((i) => {
          if (i.source !== "jira") return true;
          const jiraStatus = (
            ((i.metadata as Record<string, unknown>)?.status as string) || ""
          ).toLowerCase();
          return !excluded.has(jiraStatus);
        });
      }
      res.json({ ok: true, data: items });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get("/api/inbox/:id", (req, res) => {
    try {
      const all = getAll();
      const item = all.find((i) => i.id === req.params.id);
      if (!item) {
        res.status(404).json({ ok: false, error: "Not found" });
        return;
      }
      res.json({ ok: true, data: item });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // Get unique Jira statuses from current items
  app.get("/api/jira/statuses", (_req, res) => {
    try {
      const all = getAll({ source: "jira" });
      const statuses = [
        ...new Set(
          all.map((i) => (i.metadata as Record<string, unknown>)?.status as string).filter(Boolean),
        ),
      ].toSorted();
      res.json({ ok: true, data: statuses });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post("/api/inbox/:id/action", async (req, res) => {
    try {
      const { action, params } = req.body ?? {};
      if (!action) {
        res.status(400).json({ ok: false, error: "action required" });
        return;
      }

      // Find the item to determine its source channel
      const all = getAll();
      const item = all.find((i) => i.id === req.params.id);
      if (!item) {
        res.status(404).json({ ok: false, error: "Not found" });
        return;
      }

      // Simple built-in actions
      if (["seen", "in_progress", "done", "dismissed"].includes(action)) {
        updateStatus(item.id, action as WorkItem["status"]);
        res.json({ ok: true, data: { id: item.id, status: action } });
        return;
      }

      // Channel-specific action
      const channels = createChannels();
      const channel = channels.find((c) => c.name === item.source);
      if (!channel) {
        res.status(400).json({ ok: false, error: `No channel for source: ${item.source}` });
        return;
      }

      await channel.connect();
      await channel.performAction(item.id, action, params);
      await channel.disconnect();

      res.json({ ok: true, data: { id: item.id, action } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // --- Sync ---
  app.post("/api/sync", async (_req, res) => {
    try {
      const channels = createChannels();
      const { stats } = await syncAll(channels);
      broadcast(wss, { type: "sync_complete", stats });
      res.json({ ok: true, data: stats });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.get("/api/sync/status", (_req, res) => {
    try {
      const states = getAllSyncStates();
      const configured = getConfiguredChannels();
      res.json({ ok: true, data: { syncStates: states, channels: configured } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // --- Orchestrator status ---
  app.get("/api/orchestrator/status", (_req, res) => {
    try {
      const items = getAll();
      const itemCounts: Record<string, number> = {};
      for (const item of items) {
        itemCounts[item.source] = (itemCounts[item.source] || 0) + 1;
      }
      const states = getAllSyncStates();
      const lastSync = states.length > 0 ? states[0].lastSync.toISOString() : null;
      res.json({
        ok: true,
        data: {
          running: true,
          lastSync,
          itemCounts,
          syncWindowDays: env.SOTERFLOW_SYNC_WINDOW_DAYS,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // --- Config ---
  app.get("/api/config/channels", (_req, res) => {
    res.json({ ok: true, data: getConfiguredChannels() });
  });

  app.post("/api/config/channels", (_req, res) => {
    // Placeholder — writing to .env is risky; just acknowledge for now
    res.status(501).json({ ok: false, error: "Channel config update not yet implemented" });
  });

  // --- Director ---
  const director = Director.getInstance();

  app.get("/api/director/skills", (_req, res) => {
    res.json({ ok: true, data: director.getSkills() });
  });

  app.get("/api/director/agents", (_req, res) => {
    res.json({ ok: true, data: director.getAgents() });
  });

  app.get("/api/director/agents/:id", (req, res) => {
    const agent = director.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }
    res.json({ ok: true, data: agent });
  });

  app.post("/api/director/dispatch", (req, res) => {
    try {
      const { workItemId, skill } = req.body ?? {};
      if (!workItemId || !skill) {
        res.status(400).json({ ok: false, error: "workItemId and skill required" });
        return;
      }
      const agent = director.dispatch(workItemId, skill);
      broadcast(wss, { type: "director_dispatch", agent });
      res.json({ ok: true, data: agent });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.get("/api/director/logs", (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    res.json({ ok: true, data: director.getLogs(limit) });
  });

  app.get("/api/director/memory", (_req, res) => {
    res.json({ ok: true, data: director.getMemory() });
  });

  app.post("/api/director/memory", (req, res) => {
    const { key, value } = req.body ?? {};
    if (!key || value === undefined) {
      res.status(400).json({ ok: false, error: "key and value required" });
      return;
    }
    director.setMemory(key, value);
    res.json({ ok: true });
  });

  app.delete("/api/director/memory/:key", (req, res) => {
    director.deleteMemory(req.params.key);
    res.json({ ok: true });
  });

  // --- WebSocket ---
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "connected" }));
  });

  return { app, server, wss };
}

/**
 * Graceful shutdown: close all WebSocket connections, stop the HTTP server, close the DB.
 */
export async function gracefulShutdown(server: http.Server, wss: WebSocketServer): Promise<void> {
  const { closeDb } = await import("../store/db.js");

  // Close all WS connections
  for (const client of wss.clients) {
    client.close(1001, "Server shutting down");
  }
  wss.close();

  // Close HTTP server
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  // Close database
  closeDb();
  console.log("[soterflow] Graceful shutdown complete.");
}

function broadcast(wss: WebSocketServer, data: Record<string, unknown>) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}
