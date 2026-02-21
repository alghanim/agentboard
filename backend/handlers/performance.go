package handlers

import (
	"net/http"

	"github.com/alghanim/agentboard/backend/db"
)

// PerformanceHandler handles agent performance analytics
type PerformanceHandler struct{}

// AgentPerformance holds per-agent computed stats
type AgentPerformance struct {
	AgentID             string  `json:"agent_id"`
	Name                string  `json:"name"`
	TasksCompletedToday int     `json:"tasks_completed_today"`
	TasksCompletedWeek  int     `json:"tasks_completed_week"`
	TasksInProgress     int     `json:"tasks_in_progress"`
	TasksTotal          int     `json:"tasks_total"`
	AvgCompletionHours  float64 `json:"avg_completion_hours"`
}

// GetPerformance handles GET /api/analytics/performance
func (h *PerformanceHandler) GetPerformance(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT
			a.id as agent_id,
			a.name,
			COUNT(CASE WHEN t.status='done' AND t.updated_at >= NOW()-INTERVAL '1 day' THEN 1 END) as today,
			COUNT(CASE WHEN t.status='done' AND t.updated_at >= NOW()-INTERVAL '7 days' THEN 1 END) as week,
			COUNT(CASE WHEN t.status='progress' THEN 1 END) as in_progress,
			COUNT(t.id) as total,
			COALESCE(
				ROUND(AVG(CASE WHEN t.status='done'
					THEN EXTRACT(EPOCH FROM (t.updated_at - t.created_at))/3600
					END)::numeric, 1),
				0
			) as avg_hours
		FROM agents a
		LEFT JOIN tasks t ON t.assignee = a.id
		GROUP BY a.id, a.name
		ORDER BY week DESC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "query error: "+err.Error())
		return
	}
	defer rows.Close()

	var results []AgentPerformance
	for rows.Next() {
		var p AgentPerformance
		if err := rows.Scan(
			&p.AgentID,
			&p.Name,
			&p.TasksCompletedToday,
			&p.TasksCompletedWeek,
			&p.TasksInProgress,
			&p.TasksTotal,
			&p.AvgCompletionHours,
		); err != nil {
			respondError(w, http.StatusInternalServerError, "scan error: "+err.Error())
			return
		}
		results = append(results, p)
	}
	if err := rows.Err(); err != nil {
		respondError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
		return
	}
	if results == nil {
		results = []AgentPerformance{}
	}
	respondJSON(w, http.StatusOK, results)
}
