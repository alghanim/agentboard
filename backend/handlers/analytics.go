package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"time"

	"github.com/alghanim/agentboard/backend/db"
)

type AnalyticsHandler struct{}

// GetOverview handles GET /api/analytics/overview
func (h *AnalyticsHandler) GetOverview(w http.ResponseWriter, r *http.Request) {
	var totalTasks int
	db.DB.QueryRow(`SELECT COUNT(*) FROM tasks`).Scan(&totalTasks)

	var completedThisWeek int
	db.DB.QueryRow(`SELECT COUNT(*) FROM tasks WHERE status = 'done' AND completed_at >= date_trunc('week', NOW())`).Scan(&completedThisWeek)

	var avgHours *float64
	db.DB.QueryRow(`SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600) FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL`).Scan(&avgHours)

	var agentsActiveToday int
	db.DB.QueryRow(`SELECT COUNT(DISTINCT agent_id) FROM activity_log WHERE created_at >= CURRENT_DATE`).Scan(&agentsActiveToday)

	avg := 0.0
	if avgHours != nil {
		avg = *avgHours
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"total_tasks":        totalTasks,
		"completed_this_week": completedThisWeek,
		"avg_completion_hours": fmt.Sprintf("%.1f", avg),
		"agents_active_today": agentsActiveToday,
	})
}

// GetAgentAnalytics handles GET /api/analytics/agents
func (h *AnalyticsHandler) GetAgentAnalytics(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT
			a.id,
			a.display_name,
			COALESCE(done.cnt, 0) AS completed,
			COALESCE(prog.cnt, 0) AS in_progress,
			COALESCE(done.avg_hours, 0) AS avg_hours,
			a.last_active
		FROM agents a
		LEFT JOIN (
			SELECT assignee, COUNT(*) AS cnt,
				AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600) AS avg_hours
			FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL
			GROUP BY assignee
		) done ON done.assignee = a.id
		LEFT JOIN (
			SELECT assignee, COUNT(*) AS cnt
			FROM tasks WHERE status IN ('progress', 'todo')
			GROUP BY assignee
		) prog ON prog.assignee = a.id
		ORDER BY completed DESC
	`)
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var id, name string
		var completed, inProgress int
		var avgHours float64
		var lastActive *time.Time
		rows.Scan(&id, &name, &completed, &inProgress, &avgHours, &lastActive)
		results = append(results, map[string]interface{}{
			"id":                  id,
			"display_name":       name,
			"tasks_completed":    completed,
			"tasks_in_progress":  inProgress,
			"avg_completion_hours": fmt.Sprintf("%.1f", avgHours),
			"last_active":        lastActive,
		})
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	respondJSON(w, http.StatusOK, results)
}

// GetThroughput handles GET /api/analytics/throughput
func (h *AnalyticsHandler) GetThroughput(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT d::date AS date, COALESCE(t.cnt, 0) AS count
		FROM generate_series(NOW() - INTERVAL '29 days', NOW(), '1 day') d
		LEFT JOIN (
			SELECT completed_at::date AS day, COUNT(*) AS cnt
			FROM tasks WHERE status = 'done' AND completed_at >= NOW() - INTERVAL '30 days'
			GROUP BY day
		) t ON t.day = d::date
		ORDER BY date
	`)
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var date time.Time
		var count int
		rows.Scan(&date, &count)
		results = append(results, map[string]interface{}{
			"date":  date.Format("2006-01-02"),
			"count": count,
		})
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	respondJSON(w, http.StatusOK, results)
}

// GetTeamAnalytics handles GET /api/analytics/team
func (h *AnalyticsHandler) GetTeamAnalytics(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT
			COALESCE(a.team, 'unassigned') AS team,
			COUNT(*) FILTER (WHERE t.status = 'done') AS completed,
			COUNT(*) FILTER (WHERE t.status IN ('progress', 'todo')) AS in_progress,
			COUNT(*) AS total
		FROM tasks t
		LEFT JOIN agents a ON a.id = t.assignee
		GROUP BY a.team
		ORDER BY completed DESC
	`)
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var team string
		var completed, inProgress, total int
		rows.Scan(&team, &completed, &inProgress, &total)
		results = append(results, map[string]interface{}{
			"team":        team,
			"completed":   completed,
			"in_progress": inProgress,
			"total":       total,
		})
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	respondJSON(w, http.StatusOK, results)
}

// ExportCSV handles GET /api/analytics/export/csv
func (h *AnalyticsHandler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT id, title, COALESCE(description,''), status, COALESCE(priority,''),
			COALESCE(assignee,''), COALESCE(team,''), created_at, updated_at,
			completed_at
		FROM tasks ORDER BY created_at DESC
	`)
	if err != nil {
		respondError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=tasks_export.csv")

	writer := csv.NewWriter(w)
	writer.Write([]string{"id", "title", "description", "status", "priority", "assignee", "team", "created_at", "updated_at", "completed_at"})

	for rows.Next() {
		var id, title, desc, status, priority, assignee, team string
		var createdAt, updatedAt time.Time
		var completedAt *time.Time
		rows.Scan(&id, &title, &desc, &status, &priority, &assignee, &team, &createdAt, &updatedAt, &completedAt)
		ca := ""
		if completedAt != nil {
			ca = completedAt.Format(time.RFC3339)
		}
		writer.Write([]string{id, title, desc, status, priority, assignee, team, createdAt.Format(time.RFC3339), updatedAt.Format(time.RFC3339), ca})
	}
	writer.Flush()
}
