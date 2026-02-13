/**
 * @module store/sync
 * Sync state management — tracks last sync time and cursor per channel.
 */

import { getDb } from "./db";

export interface SyncState {
  channelName: string;
  lastSync: Date;
  cursor: string | null;
}

/**
 * Get the sync state for a channel.
 * @param channelName - Channel identifier (e.g. 'github', 'jira')
 * @returns The sync state, or null if never synced
 */
export function getSyncState(channelName: string): SyncState | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sync_state WHERE channel_name = ?").get(channelName) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  return {
    channelName: row.channel_name as string,
    lastSync: new Date(row.last_sync as string),
    cursor: row.cursor as string | null,
  };
}

/**
 * Update (or create) the sync state for a channel.
 * @param channelName - Channel identifier
 * @param cursor - Optional opaque cursor for pagination/incremental sync
 */
export function updateSyncState(channelName: string, cursor?: string | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_state (channel_name, last_sync, cursor)
    VALUES (?, datetime('now'), ?)
    ON CONFLICT(channel_name) DO UPDATE SET
      last_sync = datetime('now'),
      cursor = excluded.cursor
  `).run(channelName, cursor ?? null);
}

/**
 * Get all sync states.
 */
export function getAllSyncStates(): SyncState[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM sync_state ORDER BY last_sync DESC").all() as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    channelName: r.channel_name as string,
    lastSync: new Date(r.last_sync as string),
    cursor: r.cursor as string | null,
  }));
}
