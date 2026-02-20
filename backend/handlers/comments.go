package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/alghanim/agentboard/backend/db"
	"github.com/alghanim/agentboard/backend/models"
	"github.com/alghanim/agentboard/backend/websocket"

	"github.com/gorilla/mux"
)

type CommentHandler struct {
	Hub *websocket.Hub
}

// GetComments handles GET /api/tasks/:task_id/comments
func (h *CommentHandler) GetComments(w http.ResponseWriter, r *http.Request) {
	taskID := mux.Vars(r)["task_id"]

	rows, err := db.DB.Query(
		`SELECT id, task_id, author, content, created_at
		 FROM comments WHERE task_id = $1 ORDER BY created_at ASC`, taskID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	comments := []models.Comment{}
	for rows.Next() {
		var c models.Comment
		if err := rows.Scan(&c.ID, &c.TaskID, &c.Author, &c.Content, &c.CreatedAt); err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		comments = append(comments, c)
	}

	respondJSON(w, http.StatusOK, comments)
}

// CreateComment handles POST /api/tasks/:task_id/comments
func (h *CommentHandler) CreateComment(w http.ResponseWriter, r *http.Request) {
	taskID := mux.Vars(r)["task_id"]

	var comment models.Comment
	if err := json.NewDecoder(r.Body).Decode(&comment); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	comment.TaskID = taskID

	err := db.DB.QueryRow(
		`INSERT INTO comments (task_id, author, content) VALUES ($1, $2, $3)
		 RETURNING id, created_at`,
		comment.TaskID, comment.Author, comment.Content,
	).Scan(&comment.ID, &comment.CreatedAt)

	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	logActivity(comment.Author, "comment_added", taskID, map[string]string{"comment_id": comment.ID})
	h.Hub.Broadcast("comment_added", comment)

	respondJSON(w, http.StatusCreated, comment)
}

// DeleteComment handles DELETE /api/comments/:id
func (h *CommentHandler) DeleteComment(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	if _, err := db.DB.Exec(`DELETE FROM comments WHERE id = $1`, id); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	logActivity(getAgentFromContext(r), "comment_deleted", "", map[string]string{"comment_id": id})
	h.Hub.Broadcast("comment_deleted", map[string]string{"id": id})

	respondJSON(w, http.StatusOK, map[string]string{"message": "Comment deleted"})
}
