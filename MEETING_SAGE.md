# AgentBoard Product Meeting — Sage (Data & Ops Lead)
**Date:** 2026-02-21

---

## 1. Analytics & Reporting Dashboards

### Current State
- `AgentMetrics` model exists (`tasks_completed`, `tasks_failed`, `avg_completion_time_seconds`, `tokens_used`, `total_cost`) but **no endpoints or collection logic yet**.
- `DashboardStats` gives basic counts. `GetTeamStats` does a simple agent-task join. Both are read-only summaries with no time dimension.

### Recommendations

**Phase 1 — Core Metrics (v1.1)**
| Metric | Source | Visualization |
|---|---|---|
| Tasks completed per agent per day | `agent_metrics` table | Bar chart (stacked by agent) |
| Avg completion time | `created_at` → `completed_at` delta | Line chart (7-day rolling avg) |
| Error/failure rate | `tasks_failed / (tasks_completed + tasks_failed)` | Sparkline per agent card |
| WIP count | `tasks WHERE status = 'progress'` per agent | Number badge on agent card |
| Task throughput | Completed tasks per day/week | Area chart |

**Phase 2 — Advanced (v1.2+)**
| Metric | Notes |
|---|---|
| Token usage & cost per agent | Needs OpenClaw API integration or log parsing |
| Velocity (story points) | Requires adding `points` field to tasks |
| Cycle time distribution | Histogram: how long tasks sit in each status |
| Agent idle time | `last_active` vs now, flag agents idle > threshold |
| Heat map | Day-of-week × hour activity grid (from `activity_log`) |

**Real-time vs Scheduled:**
- **Real-time** for the dashboard (WebSocket hub already exists — push metric updates on task transitions).
- **Scheduled digest** as an optional feature: daily summary posted to a channel via webhook. Low priority for v1.

### New Endpoints Needed
```
GET /api/metrics/agents/:id?range=7d|30d|90d
GET /api/metrics/team?range=7d|30d|90d
GET /api/metrics/throughput?range=7d|30d|90d&granularity=day|week
```

### Data Collection Strategy
- **Option A (simple):** Compute metrics on-read from `tasks` + `activity_log` tables. No new writes needed. Fine for <10k tasks.
- **Option B (scalable):** Cron job (or Go ticker) that materializes daily rollups into `agent_metrics` at midnight. Query rollups for dashboards. **Recommend this** — the table already exists.

---

## 2. White Labeling — Data Angle

### v1: Single-Tenant is Fine
- Each deployment has its own `agents.yaml`, its own Postgres, its own Docker Compose. Data isolation is inherent.
- No need for multi-tenant scoping in v1.

### Future Multi-Tenant Prep (if needed)
- Add `org_id` column to `tasks`, `agents`, `agent_metrics`, `activity_log`.
- All queries get `WHERE org_id = $current_org`.
- `agents.yaml` becomes per-org or merged with an org identifier.
- **Don't build this now.** Just keep the schema extensible (avoid hard-coded single-org assumptions).

### Recommendation
- Document in README that v1 is single-tenant, one deployment per team.
- If white-label demand emerges, the migration path is: add `org_id` + row-level filtering. Straightforward with Postgres RLS if needed.

---

## 3. Agent Kanban Integration

### How Should Agents Query the Kanban?

**Current:** REST API (`GET /api/tasks?assignee=X&status=Y`). Agents poll.

**Recommended approach — hybrid:**
1. **WebSocket subscription** for real-time events (hub already broadcasts `task_created`, `task_assigned`, `task_transitioned`). Agents subscribe and react instantly to assignments.
2. **REST poll as fallback** — agents that can't hold a WebSocket open (e.g., spawned subagents) poll `GET /api/tasks?assignee=me&status=todo` on a 30s interval.

**WebSocket is already built** (`websocket.Hub`). Just need agent-side client code and maybe a filtered subscription (only events relevant to that agent).

### Task Lifecycle

Current valid transitions are already well-defined in `TransitionTask`:
```
backlog → todo → progress → review → done
                    ↓          ↓
                 blocked    progress (rejection)
```

**This is good.** Suggestions:
- Add `failed` as a terminal state (parallel to `done`). Currently `tasks_failed` exists in metrics but no `failed` status.
- Add `cancelled` for tasks that get dropped.
- Track **who** triggered each transition (already in `activity_log` via `logActivity`).

### Auto-assign vs Manual

**Recommendation: Both, configurable.**
- Default: **Manual assignment** by Thunder (orchestrator). This is the current model and it works.
- Optional: Agent can call `POST /api/tasks/{id}/assign` to self-assign from a pool of unassigned `todo` tasks. Add a config flag `allow_self_assign: true` in `agents.yaml`.
- WIP limit enforcement: if agent already has N tasks in `progress`, block self-assignment.

---

## 4. Improvement Ideas (Data/Ops Perspective)

### 4a. Activity Log → Audit Trail
The `activity_log` table is gold. Enhance it:
- Add `old_value` / `new_value` fields for change tracking
- Index on `(agent_id, created_at)` for fast per-agent timeline queries
- Expose `GET /api/activity?agent_id=X&action=Y&since=Z` with proper pagination

### 4b. Health Check / Heartbeat Endpoint
```
POST /api/agents/:id/heartbeat
```
Agents ping every 60s. If no heartbeat in 3 minutes, mark agent `offline`. The frontend already shows online/offline — just need the backend to enforce staleness.

### 4c. SLA / Due Date Tracking
- Tasks have `due_date` but nothing alerts on overdue.
- Add a query: `GET /api/tasks/overdue` — tasks past due date and not `done`.
- Dashboard widget: "3 tasks overdue" with red badge.

### 4d. Export & Reporting
- `GET /api/export/metrics?format=csv&range=30d` — download metrics as CSV.
- Future: PDF weekly report generation (low priority).

### 4e. Database Indexes (Performance)
Ensure these indexes exist:
```sql
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_activity_agent ON activity_log(agent_id, created_at);
CREATE INDEX idx_metrics_agent_date ON agent_metrics(agent_id, date);
```

### 4f. Metrics Collection Cron
Implement a Go goroutine that runs daily at midnight:
- Count completed/failed tasks per agent for that day
- Calculate avg completion time from `created_at` → `completed_at`
- Insert row into `agent_metrics`
- This populates the existing (but unused) `agent_metrics` table

---

## Summary of Priorities

| Priority | Item | Effort |
|---|---|---|
| 🔴 High | Metrics endpoints + daily rollup cron | Medium |
| 🔴 High | Agent heartbeat endpoint | Small |
| 🟡 Medium | Enhanced activity log (old/new values) | Small |
| 🟡 Medium | Overdue task tracking | Small |
| 🟡 Medium | Add `failed`/`cancelled` task statuses | Small |
| 🟢 Low | WebSocket filtered subscriptions | Medium |
| 🟢 Low | CSV export | Small |
| ⚪ Future | Multi-tenant org_id | Large |
| ⚪ Future | Token/cost tracking via OpenClaw | Medium |
