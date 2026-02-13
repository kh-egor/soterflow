# SoterFlow Code Review & Improvement Roadmap

**Date**: 2026-02-13  
**Scope**: Custom SoterFlow files only (~2,500 LOC across 15 files)

---

## 📊 Architecture Overview

```
src/
├── channels/       # 4 connectors: GitHub, Jira, Slack, Gmail
│   ├── base.ts     # WorkItem interface + BaseChannel abstract class
│   ├── retry.ts    # Shared retry with exponential backoff
│   ├── github.ts   # Octokit, notifications/issues/PRs/mentions
│   ├── jira.ts     # REST v3, ADF extraction, JQL pagination
│   ├── slack.ts    # Socket Mode + Web API, user token
│   └── gmail.ts    # IMAP via imapflow + mailparser
├── store/          # SQLite + FTS5
│   ├── db.ts       # Schema, migrations, WAL mode
│   ├── workitems.ts # CRUD + full-text search
│   └── sync.ts     # Per-channel sync state tracking
├── agent/
│   ├── orchestrator.ts  # Sync coordination, dedup, priority heuristics
│   └── director.ts      # Sub-agent management (simulated)
├── api/
│   ├── server.ts   # Express + WebSocket + REST endpoints
│   ├── auth.ts     # Telegram initData HMAC validation
│   ├── start.ts    # Entry point with graceful shutdown
│   └── public/index.html  # 1036-line SPA (vanilla JS)
└── soterflow-env.ts  # Env config
```

**Verdict**: Clean, well-structured for a day-one build. Good separation of concerns. The core abstractions (BaseChannel, WorkItem, retry) are solid.

---

## 🔴 Critical Issues

### 1. `createChannels()` called in action endpoint creates NEW instances

**File**: `server.ts:148` — `const channels = createChannels();`  
The `/api/inbox/:id/action` endpoint creates fresh channel instances instead of using `getCachedChannels()`. This means:

- Slack Socket Mode gets a new connection per action (wasteful, potential rate limit)
- Gmail creates new IMAP connection per action (slow, 2-3s overhead)

**Fix**: Use `getCachedChannels()` in the action endpoint.

### 2. FTS sync triggers are fragile

**File**: `workitems.ts:28-42`  
The FTS update does delete-then-insert manually. If the delete fails silently (catch block swallows errors), and the insert adds a duplicate, FTS search can return stale/duplicate results.

**Fix**: Use FTS5 triggers or a single `DELETE FROM workitems_fts WHERE rowid = ?` + insert. Better: use `content_rowid` triggers:

```sql
CREATE TRIGGER IF NOT EXISTS workitems_ai AFTER INSERT ON workitems BEGIN
  INSERT INTO workitems_fts(rowid, id, title, body, author) VALUES (new.rowid, new.id, new.title, new.body, new.author);
END;
CREATE TRIGGER IF NOT EXISTS workitems_ad AFTER DELETE ON workitems BEGIN
  INSERT INTO workitems_fts(workitems_fts, rowid, id, title, body, author) VALUES('delete', old.rowid, old.id, old.title, old.body, old.author);
END;
CREATE TRIGGER IF NOT EXISTS workitems_au AFTER UPDATE ON workitems BEGIN
  INSERT INTO workitems_fts(workitems_fts, rowid, id, title, body, author) VALUES('delete', old.rowid, old.id, old.title, old.body, old.author);
  INSERT INTO workitems_fts(rowid, id, title, body, author) VALUES (new.rowid, new.id, new.title, new.body, new.author);
END;
```

### 3. Gmail `connect()` called every sync

**File**: `orchestrator.ts:112` — `await channel.connect();`  
Every sync cycle calls `connect()` on ALL channels, including those already connected (GitHub, Jira, Slack). This is fine for stateless HTTP channels but:

- Gmail creates a new IMAP connection each time (then disconnects after)
- Slack's `connect()` does `auth.test()` on every sync (unnecessary API call)

**Fix**: Add an `isConnected()` method to BaseChannel, or track connection state:

```typescript
if (!channel.isConnected()) await channel.connect();
```

---

## 🟡 Important Improvements

### 4. Upsert doesn't update status — stale items never refresh

**File**: `workitems.ts:16`  
The `ON CONFLICT` update clause deliberately skips `status`. This is correct for user-set statuses (seen/done/dismissed), but means a Jira ticket that moves from "To-Do" to "In Progress" won't update in the metadata since the upsert only updates title/body/priority/metadata — wait, it DOES update metadata. OK, this is fine actually. The Jira status lives in `metadata.status`, not in `WorkItem.status`. ✅

### 5. No incremental sync — full re-fetch every time

All 4 channels do full fetches on every sync. For GitHub this means re-fetching all notifications, issues, PRs, and mentions (4 paginated API calls). For Gmail, it re-fetches up to 20 emails.

**Fix (medium-term)**:

- GitHub: Use `If-Modified-Since` header or `since` param with last sync timestamp from `sync_state`
- Jira: Use `cursor` from sync_state to track `nextPageToken`
- Gmail: Use IMAP `UIDNEXT` to only fetch new messages since last sync
- Slack: Already handled by Socket Mode (real-time), DM sync could use `oldest` param

### 6. No error propagation to frontend

When a sync fails for one channel, the error is logged to console but the frontend has no visibility. The `/api/sync` endpoint returns stats but no per-channel error info.

**Fix**: Add `errors` field to SyncStats:

```typescript
perSource: Record<string, { total: number; new: number; error?: string }>;
```

### 7. Age escalation mutates items in-place

**File**: `orchestrator.ts:177` — `applyPriorityHeuristics(item)` mutates the item before upsert.  
Age escalation runs on every sync, which means a "normal" item becomes "high" after 24h, then gets persisted as "high". Next sync, it's already "high" so after 48h it becomes "urgent" — permanently. The `getInbox()` escalation is correctly non-persistent (uses spread), but the one in `_syncAllInner` persists.

**Fix**: Don't call `applyAgeEscalation()` inside `applyPriorityHeuristics()`. Only apply age escalation at read time (in `getInbox()`).

### 8. Missing `import { createChannels }` in server.ts

**File**: `server.ts:148` — Uses `createChannels()` but it's not in the imports at the top. The import only has `getInbox, syncAll, getConfiguredChannels`. This would be a runtime error.

**Fix**: Import `createChannels` or better, use `getCachedChannels()`.

### 9. The 1036-line SPA should be componentized

`index.html` is a monolith with inline CSS, JS, and HTML. As features grow, this becomes unmaintainable.

**Near-term fix**: Split into `index.html` + `app.css` + `app.js` (still vanilla, just separated files).  
**Medium-term**: Consider Preact/htm (tiny, no build step) or a simple Svelte SPA if complexity grows.

---

## 🟢 Quick Wins

### 10. Clean up test files

3 test files (`test-gmail.ts`, `test-jira.ts`, `test-slack.ts`) are standalone scripts, not proper tests. Move test logic into `.test.ts` files or delete them.

### 11. Add TypeScript strict mode

The `any` types in gmail.ts (11 oxlint errors) indicate missing type definitions. Add proper types for `imapflow` responses.

### 12. Missing `.env.example`

No `.env.example` file to document required/optional env vars. New contributors (or future-you) won't know what to set.

### 13. Add request timeout to Jira/GitHub HTTP calls

Jira's `fetch()` calls have no timeout. If the Jira server hangs, the sync hangs until the 60s orchestrator timeout. Add `AbortSignal.timeout(30000)` to fetch calls.

### 14. Slack unused exported functions

`mapSlackMention()` and `mapSlackStar()` are exported but never used (channel/starred sync was removed). Dead code.

### 15. DB migration versioning

Current approach re-runs all `CREATE TABLE IF NOT EXISTS` on every startup. This works for additive changes but breaks for alterations (rename column, add NOT NULL column). Add a simple `schema_version` table.

---

## 🏗️ Architecture Recommendations

### Short-term (this week)

1. **Fix #1** (createChannels in action endpoint) — 5 min
2. **Fix #3** (connect guard) — 15 min
3. **Fix #7** (age escalation persistence) — 10 min
4. **Fix #8** (missing import) — 1 min
5. **Create `.env.example`** — 5 min
6. **Delete dead code** (#10, #14) — 5 min

### Medium-term (next 2 weeks)

7. **FTS triggers** (#2) — 30 min
8. **Incremental sync** (#5) — 2-3h per channel
9. **Error propagation** (#6) — 30 min
10. **Split SPA** (#9) — 1h
11. **Wire Director** to actually call channel.performAction() instead of simulating

### Long-term (next month)

12. **Prune inherited OpenClaw** — remove unused modules (browser automation, TTS, media, unused channel adapters). Currently ~1.6M lines of dead weight.
13. **SMTP for Gmail replies** — IMAP is read-only, need nodemailer for send
14. **OAuth2 for Gmail** — App Passwords work but OAuth2 is more robust + allows token refresh
15. **Named Cloudflare tunnel** — stable URL for Mini App
16. **Push notifications** — WebSocket is for when the app is open; use Telegram bot messages for async alerts

---

## 📈 Quality Metrics

| Metric            | Current                               | Target                      |
| ----------------- | ------------------------------------- | --------------------------- |
| Custom LOC        | ~2,500                                | ~3,500 (after improvements) |
| Test coverage     | ~40% (GitHub, Jira, Slack have tests) | 80%+                        |
| TypeScript strict | No (`any` types)                      | Yes                         |
| Channels          | 4 (GH, Jira, Slack, Gmail)            | 5+ (Calendar?)              |
| Incremental sync  | None                                  | All channels                |
| Error visibility  | Console only                          | Frontend + logs             |

---

## ✅ What's Already Good

- **BaseChannel abstraction** — clean interface, easy to add new channels
- **Retry with backoff** — production-grade, handles rate limits properly
- **FTS5 search** — full-text search across all items, great UX
- **Deduplication** — cross-channel dedup by URL with priority-aware merging
- **Priority heuristics** — keyword detection, age escalation, source-aware defaults
- **Auth** — proper HMAC validation for Telegram Mini App
- **Graceful shutdown** — closes DB, WS connections, HTTP server
- **Cached channels** — singleton pattern prevents duplicate Socket Mode connections
- **WebSocket** — real-time updates to frontend on sync complete

This is a solid v0.1. The architecture is extensible and the core loop (connect → sync → dedup → store → serve → act) works end-to-end across 4 channels.
