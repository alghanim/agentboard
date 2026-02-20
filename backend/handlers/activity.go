package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/alghanim/agentboard/backend/db"
	"github.com/alghanim/agentboard/backend/models"
)

type ActivityHandler struct{}

// GetActivity handles GET /api/activity
func (h *ActivityHandler) GetActivity(w http.ResponseWriter, r *http.Request) {
	query := `SELECT id, agent_id, action, task_id, details, created_at
	          FROM activity_log WHERE 1=1`
	args := []interface{}{}
	argCount := 1

	if agentID := r.URL.Query().Get("agent_id"); agentID != "" {
		query += fmt.Sprintf(" AND agent_id = $%d", argCount)
		args = append(args, agentID)
		argCount++
	}
	if action := r.URL.Query().Get("action"); action != "" {
		query += fmt.Sprintf(" AND action = $%d", argCount)
		args = append(args, action)
		argCount++
	}
	if taskID := r.URL.Query().Get("task_id"); taskID != "" {
		query += fmt.Sprintf(" AND task_id = $%d", argCount)
		args = append(args, taskID)
		argCount++
	}
	if startDate := r.URL.Query().Get("start_date"); startDate != "" {
		if t, err := time.Parse(time.RFC3339, startDate); err == nil {
			query += fmt.Sprintf(" AND created_at >= $%d", argCount)
			args = append(args, t)
			argCount++
		}
	}
	if endDate := r.URL.Query().Get("end_date"); endDate != "" {
		if t, err := time.Parse(time.RFC3339, endDate); err == nil {
			query += fmt.Sprintf(" AND created_at <= $%d", argCount)
			args = append(args, t)
			argCount++
		}
	}
	_ = argCount

	query += " ORDER BY created_at DESC LIMIT 200"

	rows, err := db.DB.Query(query, args...)
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
