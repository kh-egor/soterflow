# SoterFlow — Unified Work Inbox

A personal work-item aggregator that pulls notifications, issues, PRs, and messages from **GitHub**, **Jira**, and **Slack** into a single prioritized inbox. Built as a layer on top of [OpenClaw](https://github.com/openclaw/openclaw).

## Quick Start

```bash
# Clone
git clone https://github.com/soter/soterflow.git
cd soterflow

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — add your API tokens (see Environment Variables below)

# Run CLI
npx tsx src/cli/soterflow-cli.ts sync
npx tsx src/cli/soterflow-cli.ts inbox

# Run API server
npx tsx src/api/start.ts
```

## CLI Usage

```bash
# Sync all configured channels
soterflow sync

# Sync a specific channel
soterflow sync --source=github

# View inbox (all items)
soterflow inbox

# Filter inbox
soterflow inbox --source=github --type=pr
soterflow inbox --status=new

# Update item status (use ID prefix)
soterflow task abc123 --status=done
soterflow task abc123 --status=dismissed

# Show configuration
soterflow config list
```

## API Endpoints

All endpoints (except health) require Telegram Mini App auth via `Authorization: tma <initData>`.

| Method | Path                    | Description                                               |
| ------ | ----------------------- | --------------------------------------------------------- |
| `GET`  | `/api/health`           | Health check (no auth)                                    |
| `GET`  | `/api/inbox`            | List inbox items. Query: `?source=&type=&status=&search=` |
| `GET`  | `/api/inbox/:id`        | Get single item                                           |
| `POST` | `/api/inbox/:id/action` | Perform action. Body: `{ "action": "done" }`              |
| `POST` | `/api/sync`             | Trigger sync across all channels                          |
| `GET`  | `/api/sync/status`      | Get sync state per channel                                |
| `GET`  | `/api/config/channels`  | List configured channels                                  |
| `WS`   | `/ws`                   | WebSocket — receives `sync_complete` events               |

## Mini App

The Telegram Mini App lives in `app/soterflow/` (Next.js):

```bash
cd app/soterflow
npm install
npm run dev
```

Features: inbox list with priority grouping, item detail view, settings page, pull-to-refresh sync.

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   GitHub     │  │    Jira     │  │    Slack    │
│  Connector   │  │  Connector  │  │  Connector  │
└──────┬───────┘  └──────┬──────┘  └──────┬──────┘
       │                 │                 │
       └────────┬────────┴────────┬────────┘
                │                 │
         ┌──────▼──────┐  ┌──────▼──────┐
         │ Orchestrator │  │  SQLite DB  │
         │ (dedup,      │──│ (workitems, │
         │  priority,   │  │  FTS5,      │
         │  escalation) │  │  sync_state)│
         └──────┬───────┘  └─────────────┘
                │
     ┌──────────┼──────────┐
     │          │          │
┌────▼───┐ ┌───▼────┐ ┌───▼──────┐
│  CLI   │ │  API   │ │ Mini App │
│        │ │Express │ │ (Next.js)│
│        │ │  + WS  │ │ Telegram │
└────────┘ └────────┘ └──────────┘
```

## Directory Structure

```
src/
├── channels/
│   ├── base.ts          # WorkItem interface + BaseChannel abstract class
│   ├── github.ts        # GitHub via Octokit (pagination, rate limits)
│   ├── jira.ts          # Jira via REST API
│   ├── slack.ts         # Slack via @slack/web-api
│   └── retry.ts         # Shared retry with exponential backoff
├── store/
│   ├── db.ts            # SQLite init + migrations (WAL, FTS5)
│   ├── workitems.ts     # CRUD for work items
│   └── sync.ts          # Sync state per channel
├── agent/
│   └── orchestrator.ts  # Sync all, dedup, priority heuristics, age escalation
├── cli/
│   ├── soterflow-cli.ts # CLI entry point (inbox/sync/task/config)
│   └── inbox.ts         # Display formatting helpers
├── api/
│   ├── server.ts        # Express + WebSocket server
│   ├── auth.ts          # Telegram initData HMAC validation
│   └── start.ts         # Standalone entry point with graceful shutdown
└── soterflow-env.ts     # Environment variable config

app/soterflow/           # Telegram Mini App (Next.js)
scripts/sync-upstream.sh # Fork sync with upstream OpenClaw
```

## Environment Variables

```bash
# GitHub (personal access token with notifications/repo scope)
GITHUB_TOKEN=ghp_...

# Jira
JIRA_URL=https://yourorg.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_TOKEN=...

# Slack (bot token with channels:history, im:history scopes)
SLACK_TOKEN=xoxb-...

# Telegram (for Mini App auth)
TELEGRAM_BOT_TOKEN=123456:ABC...

# Optional
SOTERFLOW_DB_PATH=./data/soterflow.db
SOTERFLOW_API_PORT=3847
```

## Key Concepts

- **WorkItem** — Universal unit. Every notification, issue, PR, or message becomes a WorkItem with unified schema.
- **BaseChannel** — Abstract connector. Implement `connect`, `sync`, `performAction` to add new sources.
- **Priority Heuristics** — PRs and mentions auto-escalate to high. Keywords like "urgent", "outage" → urgent.
- **Age Escalation** — Normal items become high after 24h, high becomes urgent after 48h.
- **Deduplication** — Same URL across channels = same item. Keeps highest priority version.
- **Offline-first** — SQLite local DB. Reads always work; syncs happen when channels are reachable.

## Upstream Sync

This is a fork of OpenClaw. To stay up to date:

```bash
./scripts/sync-upstream.sh
```

Or set up a weekly cron: `0 3 * * 1 ./path/to/scripts/sync-upstream.sh`

The script adds the upstream remote, fetches, and merges. If there are conflicts, it aborts cleanly and tells you how to resolve manually.

## Testing

```bash
# Unit tests
npx vitest run src/channels/github.test.ts
npx vitest run src/agent/orchestrator.test.ts

# Integration tests
npx vitest run src/soterflow-integration.test.ts

# All SoterFlow tests
npx vitest run --reporter=verbose src/**/*soterflow*.test.ts src/channels/{github,jira,slack}.test.ts src/agent/orchestrator.test.ts src/api/server.test.ts
```

## Contributing

1. Fork and create a feature branch
2. Keep SoterFlow code in the directories listed above
3. Run tests before pushing
4. PR against `main`

## License

Same as upstream OpenClaw.
