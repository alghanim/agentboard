# AgentBoard Backend — Code Review

**Reviewed by:** Forge (subagent)
**Date:** 2026-02-21
**Codebase:** `~/agentboard/backend/`
**Files reviewed:** `main.go`, `config/config.go`, `db/db.go`, `handlers/*.go`, `models/models.go`, `websocket/hub.go`, `schema.sql`

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 6 |
| 🟡 Medium | 8 |
| 🟢 Low | 6 |
| **Total** | **20** |

---

## 🟠 HIGH Severity

---

### H1 — Route Ordering Bug: `/api/tasks/mine` Is Dead Code
**File:** `main.go`, lines 71–79

**Description:**
Gorilla/mux tests routes in **registration order**. `GET /tasks/{id}` is registered before `GET /tasks/mine`. Any request to `GET /api/tasks/mine` matches `{id}` first with `id = "mine"`, then tries `SELECT ... FROM tasks WHERE id = 'mine'`. PostgreSQL rejects `'mine'` as an invalid UUID and returns an error — the handler responds with HTTP 500. `GetMyTasks` is **never reachable** via GET.

```go
// main.go (current — broken order)
api.HandleFunc("/tasks/{id}", taskHandler.GetTask).Methods("GET")   // matches first!
...
api.HandleFunc("/tasks/mine", taskHandler.GetMyTasks).Methods("GET") // never matched
```

**Fix:** Register the static route before the parameterised one.
```go
api.HandleFunc("/tasks/mine", taskHandler.GetMyTasks).Methods("GET") // must come first
api.HandleFunc("/tasks/{id}", taskHandler.GetTask).Methods("GET")
```

---

### H2 — WebSocket Concurrent Write Race Condition
**File:** `websocket/hub.go`, lines 67–80 (`sendPing`) and `WritePump`

**Description:**
The gorilla/websocket library **requires** that only one goroutine writes to a connection at a time. `Hub.sendPing()` calls `client.Conn.WriteControl()` (a write) while `WritePump` is concurrently writing data and ping messages on its own ticker. There is no mutex protecting these concurrent writes. This is a **data race** that can corrupt the WebSocket framing and cause panics or silent data loss.

Additionally, `WritePump` already sends its own pings (line 163: `c.Conn.WriteMessage(websocket.PingMessage, nil)`) on a 54-second ticker. The hub sends additional pings every 30 seconds. This creates **duplicate competing pings**.

**Fix:** Remove `sendPing` from the hub entirely and let each client's own `WritePump` manage its pings, which already does so correctly. If hub-side health checks are needed, use a channel to route the ping through `WritePump`.

```go
// Remove the sendPing call in hub.Run() and the sendPing method entirely.
// WritePump already handles keep-alives correctly.
```

---

### H3 — `GetTasks` Has No LIMIT / No Pagination
**File:** `handlers/tasks.go`, lines 27–80

**Description:**
`GET /api/tasks` returns **all rows** from the tasks table with no LIMIT or pagination support. As tasks accumulate, this query will scan the full table, load all rows into memory, and serialize the entire result set to JSON. This becomes a memory and latency problem with even modest data volumes (~10k+ rows).

**Fix:** Add cursor-based or offset pagination and a hard upper bound.
```go
query += " ORDER BY created_at DESC LIMIT $N OFFSET $M"
// Accept ?page=&per_page= query params; default per_page=100, max=500
```

---

### H4 — Missing `rows.Err()` Check (Widespread, Silent Data Truncation)
**Files:** `handlers/tasks.go`, `handlers/agents.go`, `handlers/activity.go`, `handlers/analytics.go`, `handlers/comments.go`, `handlers/dashboard.go`

**Description:**
After every `rows.Next()` loop, `rows.Err()` must be checked to detect network interruptions or server-side cursor errors that occur **during** iteration. None of the handlers check it. If a query is interrupted mid-stream, the handler silently returns a **partial result** with HTTP 200 — the caller has no idea the data is incomplete.

**Fix:** Add a check after every scan loop:
```go
if err := rows.Err(); err != nil {
    respondError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
    return
}
```
This applies to: `GetTasks`, `GetAgents`, `GetAgentActivity`, `GetAgentMetrics`, `GetActivity`, `GetTeamStats`, `GetComments`, `GetAgentAnalytics`, `GetThroughput`, `GetTeamAnalytics`, `ExportCSV`.

---

### H5 — No HTTP Request Body Size Limit (Potential DoS)
**File:** `handlers/tasks.go` (CreateTask, UpdateTask), `handlers/comments.go` (CreateComment), `handlers/agents.go` (UpdateAgentStatus), `handlers/tasks.go` (AssignTask, TransitionTask)

**Description:**
All JSON-decoding handlers use `json.NewDecoder(r.Body).Decode()` with no body size limit. An attacker can send a request with a multi-gigabyte body and exhaust server memory. The server has no timeout protection for this specific case (ReadTimeout only covers the initial read).

**Fix:** Wrap the body before decoding everywhere a request body is parsed:
```go
r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB limit
if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
    respondError(w, http.StatusBadRequest, err.Error())
    return
}
```

---

### H6 — Overly Permissive CORS: Wildcard Origin + AllowCredentials
**File:** `main.go`, lines 106–112

**Description:**
```go
corsHandler := cors.New(cors.Options{
    AllowedOrigins:   []string{"*"},
    AllowedHeaders:   []string{"*"},
    AllowCredentials: true,
})
```
Per the CORS spec, `Access-Control-Allow-Origin: *` cannot be combined with `Access-Control-Allow-Credentials: true`. The `rs/cors` library works around this by reflecting the `Origin` request header back verbatim when credentials are enabled — meaning **every origin is individually allowed with credentials**. This is effectively `allow-all-origins-with-credentials`, which enables CSRF attacks from any website against any user who has a session (relevant once auth is added).

**Fix:** Pin allowed origins explicitly:
```go
AllowedOrigins: []string{"http://localhost:3000", "https://your-domain.com"},
AllowCredentials: true,
```
Or, if authentication is not planned, keep the wildcard but drop `AllowCredentials`:
```go
AllowedOrigins: []string{"*"},
AllowCredentials: false,
```

---

## 🟡 MEDIUM Severity

---

### M1 — `UpdateTask` and `DeleteTask` Return 200 When No Row Exists
**File:** `handlers/tasks.go`, lines 122–155 (UpdateTask), 157–167 (DeleteTask)

**Description:**
Neither `UpdateTask` nor `DeleteTask` checks `RowsAffected`. A `PUT /api/tasks/<nonexistent-uuid>` returns HTTP 200 with no indication that nothing was updated. Same for DELETE. The client has no way to tell that the operation was a no-op.

**Fix:**
```go
result, err := db.DB.Exec(`UPDATE tasks SET ... WHERE id=$N`, ..., id)
if err != nil {
    respondError(w, http.StatusInternalServerError, err.Error())
    return
}
if n, _ := result.RowsAffected(); n == 0 {
    respondError(w, http.StatusNotFound, "Task not found")
    return
}
```

---

### M2 — `UpdateTask` Response Contains Stale `updated_at`
**File:** `handlers/tasks.go`, lines 122–155

**Description:**
`UpdateTask` decodes the request body into `task`, runs the UPDATE, then returns `task`. The `updated_at` field is updated by a DB trigger (`update_updated_at_column`), but the response is returned from the request body (which has a zero-value or client-supplied `updated_at`). The client receives incorrect metadata.

**Fix:** After updating, re-fetch the relevant fields from DB (or use `RETURNING updated_at` in the UPDATE statement):
```go
_, err := db.DB.Exec(`UPDATE tasks SET ... WHERE id=$N`, ...)
// then:
db.DB.QueryRow(`SELECT updated_at FROM tasks WHERE id=$1`, id).Scan(&task.UpdatedAt)
```

---

### M3 — Non-Atomic `completed_at` Update (Two Separate Queries)
**Files:** `handlers/tasks.go` lines 148–150 (UpdateTask), lines 217–219 (TransitionTask)

**Description:**
When a task transitions to `done`, two separate DB statements are executed:
1. `UPDATE tasks SET status='done' ...`
2. `UPDATE tasks SET completed_at = NOW() WHERE id = $1`

The second query's error is silently ignored. If the process crashes between them (or the second query fails), the task is in `done` status with NULL `completed_at`. The analytics query `WHERE status = 'done' AND completed_at IS NOT NULL` will then **exclude** this task from completion averages, causing incorrect analytics results.

**Fix:** Merge into a single statement:
```go
UPDATE tasks SET status=$1,
    completed_at = CASE WHEN $1 = 'done' THEN NOW() ELSE completed_at END
WHERE id=$2
```

---

### M4 — `UpdateAgentStatus` Accepts Invalid Status Values (Returns 500 Not 400)
**File:** `handlers/agents.go`, lines 105–121

**Description:**
The handler passes any client-supplied status string directly to the DB. The DB constraint `CHECK (status IN ('online', 'offline', 'busy', 'idle'))` will reject invalid values, but the error bubbles up as HTTP 500 Internal Server Error. This leaks DB error messages to the client and provides a poor API contract.

**Fix:** Validate before hitting the DB:
```go
validStatuses := map[string]bool{"online": true, "offline": true, "busy": true, "idle": true}
if !validStatuses[data.Status] {
    respondError(w, http.StatusBadRequest, "invalid status: must be online, offline, busy, or idle")
    return
}
```

---

### M5 — Unhandled Scan Errors in Analytics Handlers
**File:** `handlers/analytics.go`, lines in `GetAgentAnalytics`, `GetThroughput`, `GetTeamAnalytics`, `ExportCSV`

**Description:**
All `rows.Scan()` return values inside analytics loops are discarded:
```go
rows.Scan(&id, &name, &completed, &inProgress, &avgHours, &lastActive) // error ignored
```
A scan failure causes the variables to retain their zero values or partial data, resulting in silently incorrect output. `ExportCSV` is especially problematic as it writes incorrect rows to the CSV without any error indication.

**Fix:** Check and handle every `Scan` error:
```go
if err := rows.Scan(...); err != nil {
    respondError(w, http.StatusInternalServerError, "scan error: "+err.Error())
    return
}
```

---

### M6 — Path Traversal Risk in Soul Viewer (Mitigated but Incomplete)
**File:** `handlers/openclaw.go`, `GetAgentSoul`, ~lines 148–200

**Description:**
The workspace directory is built as:
```go
filepath.Join(openClawDir, "workspace-"+agentID)
```
Where `agentID` comes from `ca.ID` (resolved from config, not directly from user input). The file targets (`SOUL.md`, `AGENTS.md`, `MEMORY.md`) are hardcoded — so typical path traversal via the URL is blocked. However, there is **no validation** that the resolved `workspaceDir` is actually beneath `openClawDir`. A maliciously crafted `agents.yaml` (with an ID containing `../`) would allow reading files outside the openclaw directory.

More critically, the file content is served **without any size limit**. A very large `MEMORY.md` could cause memory pressure.

**Fix:**
1. Validate that the resolved path is within `openClawDir`:
```go
if !strings.HasPrefix(filepath.Clean(workspaceDir), filepath.Clean(openClawDir)) {
    http.Error(w, "forbidden", http.StatusForbidden)
    return
}
```
2. Limit file reads (e.g., 1MB max per file).

---

### M7 — Missing Index on `tasks.completed_at`
**File:** `schema.sql`

**Description:**
The analytics queries heavily filter on `completed_at`:
```sql
WHERE status = 'done' AND completed_at IS NOT NULL
WHERE completed_at >= NOW() - INTERVAL '30 days'
WHERE completed_at::date = d::date
```
There is no index on `tasks.completed_at`. With a large tasks table, these queries will do full table scans.

**Fix:**
```sql
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at)
    WHERE completed_at IS NOT NULL;
```

---

### M8 — `DashboardHandler.GetStats` Runs 5 Sequential Unchecked Queries
**File:** `handlers/dashboard.go`, lines 10–27

**Description:**
`GetStats` fires five separate `QueryRow` calls serially. None of their errors are checked (the `Scan` return values are all ignored). A DB hiccup silently returns zeros. Additionally, `totalTasks` and `CompletedTasks` are computed in separate queries — a task could be inserted between them, producing a `CompletionRate` > 100% or other nonsensical values.

**Fix:** Compute all stats in a single query with conditional aggregation, and check errors:
```sql
SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'done') AS completed,
    COUNT(*) FILTER (WHERE status NOT IN ('done','backlog')) AS active,
    COUNT(DISTINCT id) FILTER (WHERE status IN ('online','busy','idle')) AS online_agents
FROM tasks, agents -- use subquery or CTE
```

---

## 🟢 LOW Severity

---

### L1 — N+1 Queries in `UpsertAgentsFromConfig`
**File:** `db/db.go`, lines 54–75

**Description:**
One `DB.Exec` is called per agent in a loop. For a config with 30 agents, that's 30 round-trips at startup. Low impact (startup only) but worth batching for correctness and speed.

**Fix:** Use `UNNEST` bulk upsert or a prepared statement executed in a transaction.

---

### L2 — `logActivity` Errors Silently Ignored
**File:** `handlers/helpers.go`, lines 32–39

**Description:**
```go
db.DB.Exec(`INSERT INTO activity_log ...`, ...)  // return values discarded
```
Failed activity log inserts are completely silent. Activity data may be missing without any indication. Given activity is an audit trail, silent loss is undesirable.

**Fix:** At minimum, log the error:
```go
if _, err := db.DB.Exec(...); err != nil {
    log.Printf("[activity] failed to log %s: %v", action, err)
}
```

---

### L3 — WebSocket Client ID Uses Nanosecond Timestamp (Collision Risk)
**File:** `main.go`, line 84

**Description:**
```go
ID: fmt.Sprintf("client-%d", time.Now().UnixNano()),
```
If two clients connect within the same nanosecond, they get the same ID. This is cosmetic (ID is only used for logging), but could cause confusing log output.

**Fix:** Use `crypto/rand` or an atomic counter:
```go
import "crypto/rand"; import "fmt"
b := make([]byte, 8); rand.Read(b)
ID: fmt.Sprintf("client-%x", b)
```

---

### L4 — `config.go`: `filepath.Abs` Error Silently Ignored
**File:** `config/config.go`, line ~118

**Description:**
```go
abs, _ := filepath.Abs(path)
```
`filepath.Abs` can fail (e.g., `os.Getwd()` failure). The error is discarded and `abs` is logged — if it fails, `abs` is empty and the log message is misleading. Extremely low risk in practice.

**Fix:**
```go
abs, err := filepath.Abs(path)
if err != nil {
    abs = path // fallback to relative
}
```

---

### L5 — `ExportCSV` Sets Headers After Potential Error
**File:** `handlers/analytics.go`, `ExportCSV`

**Description:**
If `db.DB.Query` fails, `respondError` is correctly called. But if a row scan fails mid-stream, `writer.Flush()` is still called and a partial CSV has already been written to the response with the correct Content-Type/Content-Disposition headers set. The client receives a broken CSV with no error indication.

**Fix:** Either buffer the full result before writing headers (for small exports), or document that partial output is possible and add a sentinel footer row.

---

### L6 — `GetAgentAnalytics` Uses `display_name` Column But Scans Into `string` (No NULL Handling)
**File:** `handlers/analytics.go`, lines ~40–65

**Description:**
```go
var id, name string
rows.Scan(&id, &name, ...)
```
`display_name` in the `agents` table is nullable (`VARCHAR(255)` without NOT NULL). If `display_name` is NULL, scanning into `string` will cause a scan error (cannot scan NULL into string). The error is ignored (see M5), so `name` silently becomes `""`.

**Fix:** Use `sql.NullString` or scan into `*string`:
```go
var id string
var name sql.NullString
rows.Scan(&id, &name, ...)
displayName := ""
if name.Valid { displayName = name.String }
```

---

## Additional Observations (No Issue Ticket)

- **No authentication/authorization:** Known and accepted. All endpoints are open. When auth is added, the `X-Agent-ID` header trust model in `getAgentFromContext` will need re-evaluation — it's trivially spoofable.
- **No input length validation:** Task titles, comments, agent IDs from URL params are passed directly to DB. DB column constraints (`VARCHAR(255)`, etc.) handle the truncation, but explicit validation gives better UX.
- **`AssignTask` updates `agents.current_task_id` using the assignee ID without confirming the agent exists** in the `agents` table. The FK constraint prevents orphaned references but returns a confusing 500.
- **`schema.sql` is idempotent** — well done. The `ALTER TABLE agents ADD COLUMN IF NOT EXISTS team_color` pattern is correct for schema evolution.
- **Connection pool settings** (`MaxOpenConns=25`, `MaxIdleConns=5`, `ConnMaxLifetime=5m`) are reasonable defaults.
- **`readLastJSONLEntries` scanner buffer** is set to 1MB max line size, which is generous and correct for JSONL files.
