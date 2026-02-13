/**
 * @module store/db
 * SQLite database initialization and migration using better-sqlite3.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "../soterflow-env.js";

let db: Database.Database | null = null;

/** Get the database path from env or default. */
function getDbPath(): string {
  return env.SOTERFLOW_DB_PATH;
}

/**
 * Initialize the SQLite database, run migrations, and return the instance.
 * Safe to call multiple times — returns cached instance.
 */
export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

/** Run all schema migrations. */
function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workitems (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      url TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workitems_source ON workitems(source);
    CREATE INDEX IF NOT EXISTS idx_workitems_status ON workitems(status);
    CREATE INDEX IF NOT EXISTS idx_workitems_priority ON workitems(priority);
    CREATE INDEX IF NOT EXISTS idx_workitems_timestamp ON workitems(timestamp DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS workitems_fts USING fts5(
      id, title, body, author,
      content=workitems,
      content_rowid=rowid
    );

    -- FTS sync triggers (auto-update index on insert/update/delete)
    CREATE TRIGGER IF NOT EXISTS workitems_ai AFTER INSERT ON workitems BEGIN
      INSERT INTO workitems_fts(rowid, id, title, body, author)
      VALUES (new.rowid, new.id, new.title, new.body, new.author);
    END;
    CREATE TRIGGER IF NOT EXISTS workitems_ad AFTER DELETE ON workitems BEGIN
      INSERT INTO workitems_fts(workitems_fts, rowid, id, title, body, author)
      VALUES('delete', old.rowid, old.id, old.title, old.body, old.author);
    END;
    CREATE TRIGGER IF NOT EXISTS workitems_au AFTER UPDATE ON workitems BEGIN
      INSERT INTO workitems_fts(workitems_fts, rowid, id, title, body, author)
      VALUES('delete', old.rowid, old.id, old.title, old.body, old.author);
      INSERT INTO workitems_fts(rowid, id, title, body, author)
      VALUES (new.rowid, new.id, new.title, new.body, new.author);
    END;

    CREATE TABLE IF NOT EXISTS sync_state (
      channel_name TEXT PRIMARY KEY,
      last_sync TEXT NOT NULL,
      cursor TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS director_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      agent_id TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS director_memory (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      skill TEXT NOT NULL,
      status TEXT NOT NULL,
      task TEXT,
      result TEXT,
      started_at TEXT,
      completed_at TEXT,
      error TEXT
    );
  `);
}

/** Close the database connection. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
