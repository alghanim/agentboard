package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/alghanim/agentboard/backend/db"
)

// SearchHandler handles global search requests
type SearchHandler struct{}

// SearchResult represents a unified search result
type SearchResult struct {
	Type    string      `json:"type"`    // "task" | "agent" | "comment"
	ID      string      `json:"id"`
	Title   string      `json:"title"`
	Excerpt string      `json:"excerpt"` // 120 chars max, matched text
	AgentID string      `json:"agent_id,omitempty"`
	Meta    interface{} `json:"meta,omitempty"` // status for tasks, role for agents
}

// truncateExcerpt returns at most maxLen characters of s
func truncateExcerpt(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}

// Search handles GET /api/search?q=<query>&limit=20
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"tasks":    []SearchResult{},
			"agents":   []SearchResult{},
			"comments": []SearchResult{},
		})
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}

	pattern := "%" + query + "%"
	var results []SearchResult

	// --- Tasks ---
	taskRows, err := db.DB.Query(`
		SELECT id::text, title, COALESCE(description,''), COALESCE(status,''), COALESCE(assignee,'')
		FROM tasks
		WHERE title ILIKE $1 OR description ILIKE $1
		LIMIT $2
	`, pattern, limit)
	if err == nil {
		defer taskRows.Close()
		for taskRows.Next() {
			var id, title, description, status, assignee string
			if err := taskRows.Scan(&id, &title, &description, &status, &assignee); err != nil {
				continue
			}
			excerpt := truncateExcerpt(description, 120)
			if excerpt == "" {
				excerpt = truncateExcerpt(title, 120)
			}
			results = append(results, SearchResult{
				Type:    "task",
				ID:      id,
				Title:   title,
				Excerpt: excerpt,
				AgentID: assignee,
				Meta:    status,
			})
		}
	}

	// --- Agents ---
	agentRows, err := db.DB.Query(`
		SELECT id::text, name, COALESCE(role,''), COALESCE(team,'')
		FROM agents
		WHERE name ILIKE $1 OR role ILIKE $1
		LIMIT $2
	`, pattern, limit)
	if err == nil {
		defer agentRows.Close()
		for agentRows.Next() {
			var id, name, role, team string
			if err := agentRows.Scan(&id, &name, &role, &team); err != nil {
				continue
			}
			results = append(results, SearchResult{
				Type:    "agent",
				ID:      id,
				Title:   name,
				Excerpt: truncate(role, 120),
				Meta:    map[string]string{"role": role, "team": team},
			})
		}
	}

	// --- Comments ---
	commentRows, err := db.DB.Query(`
		SELECT c.id::text, c.content, c.task_id::text, t.title as task_title
		FROM task_comments c
		JOIN tasks t ON c.task_id = t.id
		WHERE c.content ILIKE $1
		LIMIT $2
	`, pattern, limit)
	if err == nil {
		defer commentRows.Close()
		for commentRows.Next() {
			var id, content, taskID, taskTitle string
			if err := commentRows.Scan(&id, &content, &taskID, &taskTitle); err != nil {
				continue
			}
			results = append(results, SearchResult{
				Type:    "comment",
				ID:      id,
				Title:   taskTitle,
				Excerpt: truncate(content, 120),
				Meta:    map[string]string{"task_id": taskID},
			})
		}
	}

	// Limit total results to 20
	if len(results) > limit {
		results = results[:limit]
	}

	// Group by type for the response
	tasks := []SearchResult{}
	agents := []SearchResult{}
	comments := []SearchResult{}
	for _, r := range results {
		switch r.Type {
		case "task":
			tasks = append(tasks, r)
		case "agent":
			agents = append(agents, r)
		case "comment":
			comments = append(comments, r)
		}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"tasks":    tasks,
		"agents":   agents,
		"comments": comments,
	})
}
