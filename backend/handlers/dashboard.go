package handlers

import (
	"net/http"

	"github.com/alghanim/agentboard/backend/db"
	"github.com/alghanim/agentboard/backend/models"
)

type DashboardHandler struct{}

// GetStats handles GET /api/dashboard/stats
func (h *DashboardHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats := models.DashboardStats{}

	db.DB.QueryRow(`SELECT COUNT(*) FROM agents`).Scan(&stats.TotalAgents)
	db.DB.QueryRow(`SELECT COUNT(*) FROM agents WHERE status = 'online'`).Scan(&stats.OnlineAgents)
	db.DB.QueryRow(`SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done', 'backlog')`).Scan(&stats.ActiveTasks)
	db.DB.QueryRow(`SELECT COUNT(*) FROM tasks WHERE status = 'done'`).Scan(&stats.CompletedTasks)

	var totalTasks int
	db.DB.QueryRow(`SELECT COUNT(*) FROM tasks`).Scan(&totalTasks)
	if totalTasks > 0 {
		stats.CompletionRate = float64(stats.CompletedTasks) / float64(totalTasks) * 100.0
	}

	respondJSON(w, http.StatusOK, stats)
}

// GetTeamStats handles GET /api/dashboard/teams
func (h *DashboardHandler) GetTeamStats(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT
			a.team,
			COUNT(a.id) as total_agents,
			COUNT(CASE WHEN a.status = 'online' THEN 1 END) as online_agents,
			COUNT(t.id) as active_tasks,
			COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks
		FROM agents a
		LEFT JOIN tasks t ON t.assignee = a.id
		GROUP BY a.team
		ORDER BY a.team`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	type TeamStat struct {
		Team           string `json:"team"`
		TotalAgents    int    `json:"total_agents"`
		OnlineAgents   int    `json:"online_agents"`
		ActiveTasks    int    `json:"active_tasks"`
		CompletedTasks int    `json:"completed_tasks"`
	}

	teams := []TeamStat{}
	for rows.Next() {
		var team TeamStat
		var teamName *string
		if err := rows.Scan(&teamName, &team.TotalAgents, &team.OnlineAgents,
			&team.ActiveTasks, &team.CompletedTasks); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if teamName != nil {
			team.Team = *teamName
		}
		teams = append(teams, team)
	}

	respondJSON(w, http.StatusOK, teams)
}
