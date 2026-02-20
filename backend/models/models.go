package models

import (
	"database/sql"
	"time"

	"github.com/lib/pq"
)

// Task represents a task in the system.
type Task struct {
	ID           string         `json:"id"`
	Title        string         `json:"title"`
	Description  *string        `json:"description,omitempty"`
	Status       string         `json:"status"`
	Priority     string         `json:"priority"`
	Assignee     *string        `json:"assignee,omitempty"`
	Team         *string        `json:"team,omitempty"`
	DueDate      *time.Time     `json:"due_date,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	CompletedAt  *time.Time     `json:"completed_at,omitempty"`
	ParentTaskID *string        `json:"parent_task_id,omitempty"`
	Labels       pq.StringArray `json:"labels,omitempty"`
}

// Comment represents a comment on a task.
type Comment struct {
	ID        string    `json:"id"`
	TaskID    string    `json:"task_id"`
	Author    string    `json:"author"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// Agent represents an agent record in the DB.
type Agent struct {
	ID            string     `json:"id"`
	DisplayName   *string    `json:"display_name,omitempty"`
	Emoji         *string    `json:"emoji,omitempty"`
	Role          *string    `json:"role,omitempty"`
	Team          *string    `json:"team,omitempty"`
	Model         *string    `json:"model,omitempty"`
	Status        string     `json:"status"`
	CurrentTaskID *string    `json:"current_task_id,omitempty"`
	LastActive    *time.Time `json:"last_active,omitempty"`
	WorkspacePath *string    `json:"workspace_path,omitempty"`
	IsLead        bool       `json:"is_lead"`
}

// ActivityLog represents an activity log entry.
type ActivityLog struct {
	ID        string    `json:"id"`
	AgentID   *string   `json:"agent_id,omitempty"`
	Action    string    `json:"action"`
	TaskID    *string   `json:"task_id,omitempty"`
	Details   *string   `json:"details,omitempty"` // JSONB stored as string
	CreatedAt time.Time `json:"created_at"`
}

// AgentMetrics represents daily metrics for an agent.
type AgentMetrics struct {
	ID                       string    `json:"id"`
	AgentID                  string    `json:"agent_id"`
	Date                     time.Time `json:"date"`
	TasksCompleted           int       `json:"tasks_completed"`
	TasksFailed              int       `json:"tasks_failed"`
	AvgCompletionTimeSeconds int       `json:"avg_completion_time_seconds"`
	TokensUsed               int64     `json:"tokens_used"`
	TotalCost                float64   `json:"total_cost"`
}

// DashboardStats represents summary statistics.
type DashboardStats struct {
	TotalAgents    int     `json:"total_agents"`
	OnlineAgents   int     `json:"online_agents"`
	ActiveTasks    int     `json:"active_tasks"`
	CompletedTasks int     `json:"completed_tasks"`
	CompletionRate float64 `json:"completion_rate"`
}

// --- SQL null helpers ---

func NullStringToPtr(ns sql.NullString) *string {
	if ns.Valid {
		return &ns.String
	}
	return nil
}

func PtrToNullString(s *string) sql.NullString {
	if s != nil {
		return sql.NullString{String: *s, Valid: true}
	}
	return sql.NullString{}
}

func NullTimeToPtr(nt sql.NullTime) *time.Time {
	if nt.Valid {
		return &nt.Time
	}
	return nil
}

func PtrToNullTime(t *time.Time) sql.NullTime {
	if t != nil {
		return sql.NullTime{Time: *t, Valid: true}
	}
	return sql.NullTime{}
}
