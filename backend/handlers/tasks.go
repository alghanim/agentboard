package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/alghanim/agentboard/backend/db"
	"github.com/alghanim/agentboard/backend/models"
	"github.com/alghanim/agentboard/backend/websocket"

	"github.com/gorilla/mux"
	"github.com/lib/pq"
)

type TaskHandler struct {
	Hub *websocket.Hub
}

// GetTasks handles GET /api/tasks
func (h *TaskHandler) GetTasks(w http.ResponseWriter, r *http.Request) {
	query := `SELECT id, title, description, status, priority, assignee, team,
	          due_date, created_at, updated_at, completed_at, parent_task_id, labels
	          FROM tasks WHERE 1=1`
	args := []interface{}{}
	argCount := 1

	if status := r.URL.Query().Get("status"); status != "" {
		query += fmt.Sprintf(" AND status = $%d", argCount)
		args = append(args, status)
		argCount++
	}
	if assignee := r.URL.Query().Get("assignee"); assignee != "" {
		query += fmt.Sprintf(" AND assignee = $%d", argCount)
		args = append(args, assignee)
		argCount++
	}
	if priority := r.URL.Query().Get("priority"); priority != "" {
		query += fmt.Sprintf(" AND priority = $%d", argCount)
		args = append(args, priority)
		argCount++
	}
	if team := r.URL.Query().Get("team"); team != "" {
		query += fmt.Sprintf(" AND team = $%d", argCount)
		args = append(args, team)
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

	query += " ORDER BY created_at DESC"

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	tasks := []models.Task{}
	for rows.Next() {
		var task models.Task
		var desc, assignee, team, parentID sql.NullString
		var dueDate, completedAt sql.NullTime

		if err := rows.Scan(&task.ID, &task.Title, &desc, &task.Status,
			&task.Priority, &assignee, &team, &dueDate,
			&task.CreatedAt, &task.UpdatedAt, &completedAt,
			&parentID, &task.Labels); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}

		task.Description = models.NullStringToPtr(desc)
		task.Assignee = models.NullStringToPtr(assignee)
		task.Team = models.NullStringToPtr(team)
		task.ParentTaskID = models.NullStringToPtr(parentID)
		task.DueDate = models.NullTimeToPtr(dueDate)
		task.CompletedAt = models.NullTimeToPtr(completedAt)

		tasks = append(tasks, task)
	}

	respondJSON(w, http.StatusOK, tasks)
}

// GetTask handles GET /api/tasks/:id
func (h *TaskHandler) GetTask(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var task models.Task
	var desc, assignee, team, parentID sql.NullString
	var dueDate, completedAt sql.NullTime

	err := db.DB.QueryRow(
		`SELECT id, title, description, status, priority, assignee, team,
		 due_date, created_at, updated_at, completed_at, parent_task_id, labels
		 FROM tasks WHERE id = $1`, id,
	).Scan(&task.ID, &task.Title, &desc, &task.Status,
		&task.Priority, &assignee, &team, &dueDate,
		&task.CreatedAt, &task.UpdatedAt, &completedAt,
		&parentID, &task.Labels)

	if err == sql.ErrNoRows {
		respondError(w, http.StatusNotFound, "Task not found")
		return
	}
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	task.Description = models.NullStringToPtr(desc)
	task.Assignee = models.NullStringToPtr(assignee)
	task.Team = models.NullStringToPtr(team)
	task.ParentTaskID = models.NullStringToPtr(parentID)
	task.DueDate = models.NullTimeToPtr(dueDate)
	task.CompletedAt = models.NullTimeToPtr(completedAt)

	respondJSON(w, http.StatusOK, task)
}

// CreateTask handles POST /api/tasks
func (h *TaskHandler) CreateTask(w http.ResponseWriter, r *http.Request) {
	var task models.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if task.Status == "" {
		task.Status = "todo"
	}
	if task.Priority == "" {
		task.Priority = "medium"
	}

	err := db.DB.QueryRow(
		`INSERT INTO tasks (title, description, status, priority, assignee, team, due_date, parent_task_id, labels)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING id, created_at, updated_at`,
		task.Title, models.PtrToNullString(task.Description), task.Status, task.Priority,
		models.PtrToNullString(task.Assignee), models.PtrToNullString(task.Team),
		models.PtrToNullTime(task.DueDate), models.PtrToNullString(task.ParentTaskID),
		pq.Array(task.Labels),
	).Scan(&task.ID, &task.CreatedAt, &task.UpdatedAt)

	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	logActivity(getAgentFromContext(r), "task_created", task.ID, map[string]string{"title": task.Title})
	h.Hub.Broadcast("task_created", task)

	respondJSON(w, http.StatusCreated, task)
}

// UpdateTask handles PUT /api/tasks/:id
func (h *TaskHandler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var task models.Task
	if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	task.ID = id

	_, err := db.DB.Exec(
		`UPDATE tasks SET title=$1, description=$2, status=$3, priority=$4,
		 assignee=$5, team=$6, due_date=$7, parent_task_id=$8, labels=$9
		 WHERE id=$10`,
		task.Title, models.PtrToNullString(task.Description), task.Status, task.Priority,
		models.PtrToNullString(task.Assignee), models.PtrToNullString(task.Team),
		models.PtrToNullTime(task.DueDate), models.PtrToNullString(task.ParentTaskID),
		pq.Array(task.Labels), id,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if task.Status == "done" {
		db.DB.Exec(`UPDATE tasks SET completed_at = NOW() WHERE id = $1`, id)
	}

	logActivity(getAgentFromContext(r), "task_updated", id, map[string]string{"status": task.Status})
	h.Hub.Broadcast("task_updated", task)

	respondJSON(w, http.StatusOK, task)
}

// DeleteTask handles DELETE /api/tasks/:id
func (h *TaskHandler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	if _, err := db.DB.Exec(`DELETE FROM tasks WHERE id = $1`, id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	logActivity(getAgentFromContext(r), "task_deleted", id, nil)
	h.Hub.Broadcast("task_deleted", map[string]string{"id": id})

	respondJSON(w, http.StatusOK, map[string]string{"message": "Task deleted"})
}

// AssignTask handles POST /api/tasks/:id/assign
func (h *TaskHandler) AssignTask(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var data struct {
		Assignee string `json:"assignee"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := db.DB.Exec(`UPDATE tasks SET assignee = $1 WHERE id = $2`, data.Assignee, id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Update agent's current task if they exist in DB
	db.DB.Exec(`UPDATE agents SET current_task_id = $1::uuid WHERE id = $2`, id, data.Assignee)

	logActivity(getAgentFromContext(r), "task_assigned", id, map[string]string{"assignee": data.Assignee})
	h.Hub.Broadcast("task_assigned", map[string]string{"task_id": id, "assignee": data.Assignee})

	respondJSON(w, http.StatusOK, map[string]string{"message": "Task assigned"})
}

// TransitionTask handles POST /api/tasks/:id/transition
func (h *TaskHandler) TransitionTask(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	var data struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	validTransitions := map[string][]string{
		"todo":     {"progress", "backlog"},
		"backlog":  {"todo", "next"},
		"next":     {"progress"},
		"progress": {"review", "blocked", "todo"},
		"review":   {"done", "progress"},
		"blocked":  {"todo", "progress"},
		"done":     {},
	}

	var currentStatus string
	if err := db.DB.QueryRow(`SELECT status FROM tasks WHERE id = $1`, id).Scan(&currentStatus); err != nil {
		respondError(w, http.StatusNotFound, "Task not found")
		return
	}

	valid := false
	for _, s := range validTransitions[currentStatus] {
		if s == data.Status {
			valid = true
			break
		}
	}
	if !valid && data.Status != currentStatus {
		respondError(w, http.StatusBadRequest, "Invalid status transition")
		return
	}

	if _, err := db.DB.Exec(`UPDATE tasks SET status = $1 WHERE id = $2`, data.Status, id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if data.Status == "done" {
		db.DB.Exec(`UPDATE tasks SET completed_at = NOW() WHERE id = $1`, id)
	}

	logActivity(getAgentFromContext(r), "task_transitioned", id, map[string]string{
		"from": currentStatus, "to": data.Status,
	})
	h.Hub.Broadcast("task_transitioned", map[string]string{"task_id": id, "status": data.Status})

	respondJSON(w, http.StatusOK, map[string]string{"message": "Task status updated"})
}
