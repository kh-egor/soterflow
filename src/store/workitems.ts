/**
 * @module store/workitems
 * CRUD operations for work items in the SQLite store.
 */

import type { WorkItem } from "../channels/base";
import { getDb } from "./db";

/** Filter options for querying work items. */
export interface WorkItemFilters {
  source?: string;
  type?: string;
  status?: string;
}

/**
 * Insert or update a work item. Matching is by id.
 * @param item - The WorkItem to upsert
 */
export function upsert(item: WorkItem): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO workitems (id, source, type, title, body, author, timestamp, priority, url, metadata, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      author = excluded.author,
      timestamp = excluded.timestamp,
      priority = excluded.priority,
      url = excluded.url,
      metadata = excluded.metadata,
      updated_at = datetime('now')
  `).run(
    item.id,
    item.source,
    item.type,
    item.title,
    item.body,
    item.author,
    item.timestamp.toISOString(),
    item.priority,
    item.url,
    JSON.stringify(item.metadata),
    item.status,
  );

  // Update FTS index — rebuild for this row
  const row = db.prepare("SELECT rowid FROM workitems WHERE id = ?").get(item.id) as
    | { rowid: number }
    | undefined;
  if (row) {
    // Try to delete old FTS entry (ignore errors for new rows)
    try {
      db.prepare(`
        INSERT INTO workitems_fts(workitems_fts, rowid, id, title, body, author)
        VALUES('delete', ?, ?, ?, ?, ?)
      `).run(row.rowid, item.id, item.title, item.body, item.author);
    } catch {}

    db.prepare(`
      INSERT INTO workitems_fts(rowid, id, title, body, author)
      VALUES(?, ?, ?, ?, ?)
    `).run(row.rowid, item.id, item.title, item.body, item.author);
  }
}

/**
 * Retrieve all work items, optionally filtered.
 * @param filters - Optional filters by source, type, and/or status
 */
export function getAll(filters?: WorkItemFilters): WorkItem[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.source) {
    conditions.push("source = ?");
    params.push(filters.source);
  }
  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM workitems ${where} ORDER BY timestamp DESC`)
    .all(...params) as any[];

  return rows.map(rowToWorkItem);
}

/**
 * Update the status of a work item.
 * @param id - Work item ID
 * @param status - New status
 */
export function updateStatus(id: string, status: WorkItem["status"]): void {
  const db = getDb();
  db.prepare(`UPDATE workitems SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    id,
  );
}

/**
 * Full-text search across work items.
 * @param query - Search query string
 */
export function search(query: string): WorkItem[] {
  const db = getDb();
  const rows = db
    .prepare(`
    SELECT w.* FROM workitems w
    JOIN workitems_fts fts ON w.rowid = fts.rowid
    WHERE workitems_fts MATCH ?
    ORDER BY rank
  `)
    .all(query) as any[];

  return rows.map(rowToWorkItem);
}

function rowToWorkItem(row: any): WorkItem {
  return {
    id: row.id,
    source: row.source,
    type: row.type,
    title: row.title,
    body: row.body,
    author: row.author,
    timestamp: new Date(row.timestamp),
    priority: row.priority,
    url: row.url,
    metadata: JSON.parse(row.metadata),
    status: row.status,
  };
}
