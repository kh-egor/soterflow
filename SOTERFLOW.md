# SoterFlow — Unified Work Inbox

SoterFlow aggregates work items from multiple channels (GitHub, Jira, Slack) into a single prioritized inbox. Built as a layer on top of the OpenClaw fork.

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
         │ (priority +  │──│ (workitems, │
         │  heuristics) │  │  sync_state)│
         └──────┬───────┘  └─────────────┘
                │
         ┌──────▼──────┐
         │   CLI / API  │
         └──────────────┘
```

## Directory Structure

```
src/
├── channels/       # Channel connectors (BaseChannel + implementations)
│   ├── base.ts     # WorkItem interface + BaseChannel abstract class
│   ├── github.ts   # GitHub via Octokit
│   ├── jira.ts     # Jira via REST API
│   └── slack.ts    # Slack via @slack/web-api
├── store/          # Persistence layer
│   ├── db.ts       # SQLite init + migrations
│   ├── workitems.ts # CRUD for work items
│   └── sync.ts     # Sync state per channel
├── agent/          # Intelligence layer
│   └── orchestrator.ts  # Sync all channels, apply priority heuristics
├── cli/            # CLI interface
│   └── inbox.ts    # Inbox display functions
└── api/            # (Future) REST/WebSocket API
```

## Key Concepts

- **WorkItem**: Universal unit — every notification, issue, PR, or message becomes a WorkItem
- **BaseChannel**: Abstract connector interface — implement `connect`, `sync`, `performAction`
- **Priority Heuristics**: Auto-escalation based on type (PRs, mentions → high) and keywords (urgent, outage → urgent)
- **SQLite + FTS5**: Local-first storage with full-text search

## Environment Variables

See `.env.example` for required configuration.

## Dependencies (to install)

```
@octokit/rest
@slack/web-api
better-sqlite3
@types/better-sqlite3
```
