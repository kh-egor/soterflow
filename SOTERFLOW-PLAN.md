# SoterFlow — 7-Session Improvement Plan

## Session 1 — Foundation & Dependencies

- Install deps (`@octokit/rest`, `@slack/web-api`, `better-sqlite3`)
- Fix TypeScript config for SoterFlow modules
- Wire up `.env` loading (dotenv)
- Get `db.ts` running — verify SQLite init + FTS5 works
- First commit: `feat: soterflow foundation`

## Session 2 — GitHub Connector (end-to-end)

- Connect with real GITHUB_TOKEN
- Test: fetch notifications, assigned issues, review-requested PRs
- Test actions: comment, close, merge
- Handle pagination, rate limits, error handling
- Write unit tests for WorkItem mapping

## Session 3 — Jira + Slack Connectors

- Jira: connect with real credentials, test fetch + actions (transition, comment)
- Slack: connect with bot token, fetch DMs/mentions, test reply/react
- Unified error handling across all connectors
- Tests for both

## Session 4 — Orchestrator & CLI

- Wire orchestrator to all 3 channels
- Build real CLI entry point (register as `soterflow` command)
- `soterflow inbox`, `soterflow sync`, `soterflow task <id> --status=done`
- `soterflow config add-channel` flow
- Priority heuristics tuning with real data

## Session 5 — API Server for Telegram Mini App

- Build Express/Fastify API in `src/api/server.ts`
- Endpoints: `GET /inbox`, `POST /action`, `GET /sync-status`, `POST /config/channels`
- Auth: validate Telegram Mini App `initData`
- WebSocket for real-time inbox updates
- API key CRUD (stored in .env or encrypted local config)

## Session 6 — Telegram Mini App (Frontend)

- Next.js app in `app/` directory
- Inbox view with source/type filters
- Quick action buttons (close, merge, reply, dismiss)
- Sync status dashboard
- Settings page: manage API keys per channel
- Telegram Web App SDK integration

## Session 7 — Polish & Ship

- Upstream sync script (cron for merging OpenClaw changes)
- Integration tests across full pipeline
- Error recovery & offline mode (cached reads when no network)
- README rewrite with setup guide
- Tag v0.1.0, push to `kh-egor/soterflow`
