# AgentBoard Product Meeting — Titan (Engineering Lead)
**Date:** 2026-02-21

---

## 1. White Labeling — Engineering Plan

**Recommendation: Config-driven CSS variables served via API endpoint.**

### Implementation

1. **Add `branding` section to `agents.yaml`:**
   ```yaml
   branding:
     app_title: "Thunder Team Board"
     logo_path: "/custom/logo.png"       # or URL
     favicon_path: "/custom/favicon.ico"
     primary_color: "#6C5CE7"
     accent_color: "#00B894"
     background_color: "#1A1A2E"
     sidebar_color: "#16213E"
     text_color: "#EAEAEA"
   ```

2. **New API endpoint: `GET /api/branding`** — returns the branding config as JSON. Frontend fetches on load.

3. **Frontend: CSS custom properties injection.** On app init, fetch `/api/branding` and set:
   ```js
   document.documentElement.style.setProperty('--primary', data.primary_color);
   document.documentElement.style.setProperty('--accent', data.accent_color);
   // etc.
   ```
   Refactor existing hardcoded colors in CSS to use `var(--primary)`, `var(--accent)`, etc.

4. **Logo/favicon:** Serve static files from a configurable directory (`BRANDING_DIR` env var, default `./branding/`). The `<title>` and `<link rel="icon">` are set dynamically from the branding response.

5. **Team name** is already sourced from `agents.yaml` — no change needed.

**Why this approach:**
- Zero rebuild required — purely runtime config
- Single source of truth (`agents.yaml`)
- Works with Docker (mount a volume for logo files)
- No theme file compilation step

**Estimated effort:** ~2-3 days (backend endpoint: 2h, CSS variable refactor: 1 day, logo/favicon/title: half day, testing: half day)

---

## 2. Analytics & Reporting Dashboards

### What already exists
- `agent_metrics` table (daily aggregates: tasks_completed, tasks_failed, tokens_used, total_cost)
- `agent_sessions` table (session tracking with token counts)
- `activity_log` table (granular action log with JSONB details)
- Basic `DashboardHandler` with stats/team endpoints

### What's needed

**No new tables required** — the schema already supports analytics. We need:

#### New API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/analytics/throughput?period=week&agent=X` | Tasks completed per agent per time period |
| `GET /api/analytics/velocity?team=X&weeks=8` | Backlog burn-down (tasks created vs completed over time) |
| `GET /api/analytics/activity?agent=X&from=&to=` | Agent activity timeline from `activity_log` |
| `GET /api/analytics/export?format=csv&report=throughput` | CSV export |
| `GET /api/analytics/export?format=pdf&report=velocity` | PDF export (use Go `gofpdf` or similar) |

#### Backend Work

1. **Aggregation queries** — all data is in `tasks` (with `completed_at`, `created_at`) and `agent_metrics`. Write SQL with `date_trunc` grouping.

2. **Populate `agent_metrics` properly** — add a daily cron/goroutine that rolls up yesterday's data from `activity_log` and `tasks` into `agent_metrics`. Currently the table exists but nothing writes to it.

3. **CSV export** — straightforward, stream rows as `text/csv`.

4. **PDF export** — use `go-pdf` or `maroto` library. Keep it simple: table + one chart image (render chart server-side or just tabular data).

5. **Token tracking** — if OpenClaw exposes token usage per session, pipe it into `agent_sessions.tokens_in/tokens_out`. Otherwise, mark as "N/A" in the UI.

#### Frontend
- New `/analytics` page with chart.js or extend D3.js usage
- Date range picker, agent/team filter dropdowns
- Export buttons

**Estimated effort:** ~5-7 days total (backend endpoints: 2d, metrics aggregation job: 1d, frontend charts: 2d, export: 1d)

---

## 3. Agent Kanban Instructions

### Recommended one-liner for AGENTS.md or HEARTBEAT.md:

```
## Kanban
During heartbeats, check AgentBoard for assigned tasks: `curl -s http://localhost:8891/api/tasks?assignee={YOUR_AGENT_ID}&status=todo` — pick up tasks by PATCHing status to "progress" (`curl -X POST http://localhost:8891/api/tasks/{id}/transition -d '{"status":"progress"}'`), and mark done when complete (`{"status":"done"}`).
```

### Simplified version (single line):

```
Check http://localhost:8891/api/tasks?assignee=YOUR_ID&status=todo each heartbeat. Pick up tasks: POST /api/tasks/{id}/transition {"status":"progress"}. When done: POST /api/tasks/{id}/transition {"status":"done"}.
```

### Engineering recommendation:
- Add `?assignee=X&status=Y` query filters to `GET /api/tasks` if not already present (check handler)
- Consider adding a convenience endpoint: `GET /api/tasks/mine?agent=X` that returns only actionable tasks for that agent, sorted by priority
- Document the full API contract in the README with curl examples

---

## 4. Engineering Improvement Ideas

### 4a. WebSocket Event Bus for Agent-to-Agent Communication
Currently WebSocket is used for UI updates. Extend it so agents can subscribe to events (task assigned, task blocked, review requested). This enables reactive workflows instead of polling.

### 4b. API Authentication
Right now all endpoints are open. Add optional API key auth (`X-API-Key` header) configurable in `.env`. Critical before any public/multi-tenant deployment.

### 4c. Task Dependencies & DAG Execution
Add a `depends_on` field to tasks (array of task UUIDs). The UI shows dependency arrows on kanban. Tasks can't move to "todo" until dependencies are "done". This enables pipeline-style execution.

### 4d. Health Check Endpoint
`GET /api/health` returning DB connectivity, uptime, version. Essential for Docker orchestration and monitoring.

### 4e. Rate Limiting
Add basic rate limiting middleware (e.g., `golang.org/x/time/rate`) to prevent runaway agents from hammering the API.

### 4f. Webhook/Callback Support
Allow configuring webhooks in `agents.yaml` so AgentBoard can POST to external URLs on events (task completed, agent went offline, etc.). Enables integration with Slack, Discord, custom dashboards.

### 4g. Database Migrations
Move from "idempotent schema.sql" to proper migrations (golang-migrate). The current approach works but won't scale as schema evolves — ALTER TABLE statements are already accumulating.

---

## Summary

| Item | Complexity | Priority |
|------|-----------|----------|
| White labeling (CSS vars + branding API) | Medium (2-3d) | High |
| Analytics endpoints + aggregation | Medium-High (5-7d) | High |
| Kanban agent instructions | Low (0.5d) | Quick win |
| API auth | Low (1d) | High (security) |
| Task dependencies | Medium (3d) | Medium |
| WebSocket event bus | Medium (2d) | Medium |
| Health check | Low (2h) | Quick win |
| DB migrations | Low (1d) | Medium |
