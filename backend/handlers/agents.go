package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/alghanim/agentboard/backend/db"
	"github.com/alghanim/agentboard/backend/models"

	"github.com/gorilla/mux"
)

type AgentHandler struct{}

// GetAgents handles GET /api/agents
func (h *AgentHandler) GetAgents(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(`
		SELECT id, display_name, emoji, role, team, model, status,
		       current_task_id, last_active, workspace_path, is_lead
		FROM agents ORDER BY team, id`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	agents := []models.Agent{}
	for rows.Next() {
		var agent models.Agent
		var displayName, emoji, role, team, model, currentTaskID, workspacePath sql.NullString
		var lastActive sql.NullTime

		if err := rows.Scan(&agent.ID, &displayName, &emoji, &role,
			&team, &model, &agent.Status, &currentTaskID,
			&lastActive, &workspacePath, &agent.IsLead); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		agent.DisplayName = models.NullStringToPtr(displayName)
		agent.Emoji = models.NullStringToPtr(emoji)
		agent.Role = models.NullStringToPtr(role)
		agent.Team = models.NullStringToPtr(team)
		agent.Model = models.NullStringToPtr(model)
		agent.CurrentTaskID = models.NullStringToPtr(currentTaskID)
		agent.WorkspacePath = models.NullStringToPtr(workspacePath)
		agent.LastActive = models.NullTimeToPtr(lastActive)

		agents = append(agents, agent)
	}
	if err := rows.Err(); err != nil {
		respondError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, agents)
}

// GetAgent handles GET /api/agents/:id
func (h *AgentHandler) GetAgent(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var agent models.Agent
	var displayName, emoji, role, team, model, currentTaskID, workspacePath sql.NullString
	var lastActive sql.NullTime

	err := db.DB.QueryRow(`
		SELECT id, display_name, emoji, role, team, model, status,
		       current_task_id, last_active, workspace_path, is_lead
		FROM agents WHERE id = $1`, id).
		Scan(&agent.ID, &displayName, &emoji, &role,
			&team, &model, &agent.Status, &currentTaskID,
			&lastActive, &workspacePath, &agent.IsLead)

	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "Agent not found")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	agent.DisplayName = models.NullStringToPtr(displayName)
	agent.Emoji = models.NullStringToPtr(emoji)
	agent.Role = models.NullStringToPtr(role)
	agent.Team = models.NullStringToPtr(team)
	agent.Model = models.NullStringToPtr(model)
	agent.CurrentTaskID = models.NullStringToPtr(currentTaskID)
	agent.WorkspacePath = models.NullStringToPtr(workspacePath)
	agent.LastActive = models.NullTimeToPtr(lastActive)

	respondJSON(w, http.StatusOK, agent)
}

// GetAgentActivity handles GET /api/agents/:id/activity
func (h *AgentHandler) GetAgentActivity(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	rows, err := db.DB.Query(`
		SELECT id, agent_id, action, task_id, details, created_at
		FROM activity_log WHERE agent_id = $1
		ORDER BY created_at DESC LIMIT 100`, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	activities := []models.ActivityLog{}
	for rows.Next() {
		var activity models.ActivityLog
		var agentID, taskID, details sql.NullString

		if err := rows.Scan(&activity.ID, &agentID, &activity.Action,
			&taskID, &details, &activity.CreatedAt); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		activity.AgentID = models.NullStringToPtr(agentID)
		activity.TaskID = models.NullStringToPtr(taskID)
		activity.Details = models.NullStringToPtr(details)
		activities = append(activities, activity)
	}
	if err := rows.Err(); err != nil {
		respondError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
		return
	}

	respondJSON(w, http.StatusOK, activities)
}

// GetAgentMetrics handles GET /api/agents/:id/metrics
func (h *AgentHandler) GetAgentMetrics(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	rows, err := db.DB.Query(`
		SELECT id, agent_id, date, tasks_completed, tasks_failed,
		       avg_completion_time_seconds, tokens_used, total_cost
		FROM agent_metrics
		WHERE agent_id = $1 AND date >= NOW() - INTERVAL '30 days'
		ORDER BY date DESC`, id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	metrics := []models.AgentMetrics{}
	for rows.Next() {
		var metric models.AgentMetrics
		if err := rows.Scan(&metric.ID, &metric.AgentID, &metric.Date,
			&metric.TasksCompleted, &metric.TasksFailed,
			&metric.AvgCompletionTimeSeconds, &metric.TokensUsed, &metric.TotalCost); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		metrics = append(metrics, metric)
	}
	if err := rows.Err(); err != nil {
		respondError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
		return
	}

	var totalCompleted, totalFailed int
	var totalTokens int64
	var totalCost float64
	db.DB.QueryRow(`
		SELECT COALESCE(SUM(tasks_completed),0), COALESCE(SUM(tasks_failed),0),
		       COALESCE(SUM(tokens_used),0), COALESCE(SUM(total_cost),0)
		FROM agent_metrics WHERE agent_id = $1`, id).
		Scan(&totalCompleted, &totalFailed, &totalTokens, &totalCost)

	result := map[string]interface{}{
		"daily_metrics":   metrics,
		"total_completed": totalCompleted,
		"total_failed":    totalFailed,
		"total_tokens":    totalTokens,
		"total_cost":      totalCost,
		"success_rate":    calculateSuccessRate(totalCompleted, totalFailed),
	}

	respondJSON(w, http.StatusOK, result)
}

// UpdateAgentStatus handles PUT /api/agents/:id/status
func (h *AgentHandler) UpdateAgentStatus(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB limit
	var data struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := db.DB.Exec(
		`UPDATE agents SET status = $1, last_active = NOW() WHERE id = $2`,
		data.Status, id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	logActivity(id, "status_changed", "", map[string]string{"status": data.Status})
	respondJSON(w, http.StatusOK, map[string]string{"message": "Status updated"})
}
