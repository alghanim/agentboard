package main

import (
	_ "embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/alghanim/agentboard/backend/config"
	"github.com/alghanim/agentboard/backend/db"
	"github.com/alghanim/agentboard/backend/handlers"
	"github.com/alghanim/agentboard/backend/websocket"

	"github.com/gorilla/mux"
	ws "github.com/gorilla/websocket"
	"github.com/rs/cors"
)

//go:embed schema.sql
var schemaSQL string

var upgrader = ws.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func main() {
	// Database configuration
	dbConfig := db.Config{
		Host:     getEnv("DB_HOST", "localhost"),
		Port:     getEnvInt("DB_PORT", 5432),
		User:     getEnv("DB_USER", "agentboard"),
		Password: getEnv("DB_PASSWORD", "agentboard"),
		DBName:   getEnv("DB_NAME", "agentboard"),
	}

	if err := db.Connect(dbConfig, schemaSQL); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Seed agents from config into DB (upsert — preserves existing status)
	if err := db.UpsertAgentsFromConfig(config.GetAgents()); err != nil {
		log.Printf("⚠️  Failed to seed agents from config: %v", err)
	}

	// WebSocket hub
	hub := websocket.NewHub()
	go hub.Run()

	// Handlers
	taskHandler := &handlers.TaskHandler{Hub: hub}
	agentHandler := &handlers.AgentHandler{}
	commentHandler := &handlers.CommentHandler{Hub: hub}
	activityHandler := &handlers.ActivityHandler{}
	dashboardHandler := &handlers.DashboardHandler{}
	openclawHandler := &handlers.OpenClawHandler{}
	analyticsHandler := &handlers.AnalyticsHandler{}
	brandingHandler := &handlers.BrandingHandler{}

	// Agent status poller
	go handlers.StartAgentStatusPoller(hub)

	// Router
	router := mux.NewRouter()
	api := router.PathPrefix("/api").Subrouter()

	// Task routes  — static route MUST come before parameterised {id} route
	api.HandleFunc("/tasks", taskHandler.GetTasks).Methods("GET")
	api.HandleFunc("/tasks", taskHandler.CreateTask).Methods("POST")
	api.HandleFunc("/tasks/mine", taskHandler.GetMyTasks).Methods("GET")
	api.HandleFunc("/tasks/{id}", taskHandler.GetTask).Methods("GET")
	api.HandleFunc("/tasks/{id}", taskHandler.UpdateTask).Methods("PUT")
	api.HandleFunc("/tasks/{id}", taskHandler.DeleteTask).Methods("DELETE")
	api.HandleFunc("/tasks/{id}/assign", taskHandler.AssignTask).Methods("POST")
	api.HandleFunc("/tasks/{id}/transition", taskHandler.TransitionTask).Methods("POST")

	// Comment routes
	api.HandleFunc("/tasks/{task_id}/comments", commentHandler.GetComments).Methods("GET")
	api.HandleFunc("/tasks/{task_id}/comments", commentHandler.CreateComment).Methods("POST")
	api.HandleFunc("/comments/{id}", commentHandler.DeleteComment).Methods("DELETE")

	// Agent DB routes
	api.HandleFunc("/agents", agentHandler.GetAgents).Methods("GET")
	api.HandleFunc("/agents/{id}", agentHandler.GetAgent).Methods("GET")
	api.HandleFunc("/agents/{id}/activity", agentHandler.GetAgentActivity).Methods("GET")
	api.HandleFunc("/agents/{id}/metrics", agentHandler.GetAgentMetrics).Methods("GET")
	api.HandleFunc("/agents/{id}/status", agentHandler.UpdateAgentStatus).Methods("PUT")

	// Soul endpoint — reads live workspace files
	api.HandleFunc("/agents/{id}/soul", openclawHandler.GetAgentSoul).Methods("GET")

	// Activity
	api.HandleFunc("/activity", activityHandler.GetActivity).Methods("GET")

	// Dashboard
	api.HandleFunc("/dashboard/stats", dashboardHandler.GetStats).Methods("GET")
	api.HandleFunc("/dashboard/teams", dashboardHandler.GetTeamStats).Methods("GET")

	// OpenClaw live data
	api.HandleFunc("/openclaw/agents", openclawHandler.GetAgents).Methods("GET")
	api.HandleFunc("/openclaw/agents/{name}", openclawHandler.GetAgent).Methods("GET")
	api.HandleFunc("/openclaw/stream", openclawHandler.GetStream).Methods("GET")
	api.HandleFunc("/openclaw/stats", openclawHandler.GetStats).Methods("GET")

	// Branding
	api.HandleFunc("/branding", brandingHandler.GetBranding).Methods("GET")

	// Analytics
	api.HandleFunc("/analytics/overview", analyticsHandler.GetOverview).Methods("GET")
	api.HandleFunc("/analytics/agents", analyticsHandler.GetAgentAnalytics).Methods("GET")
	api.HandleFunc("/analytics/throughput", analyticsHandler.GetThroughput).Methods("GET")
	api.HandleFunc("/analytics/team", analyticsHandler.GetTeamAnalytics).Methods("GET")
	api.HandleFunc("/analytics/export/csv", analyticsHandler.ExportCSV).Methods("GET")

	// Structure (hierarchy from config)
	api.HandleFunc("/structure", openclawHandler.GetStructure).Methods("GET")

	// WebSocket
	router.HandleFunc("/ws/stream", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WebSocket upgrade error: %v", err)
			return
		}
		client := &websocket.Client{
			ID:            fmt.Sprintf("client-%d", time.Now().UnixNano()),
			Hub:           hub,
			Conn:          conn,
			Send:          make(chan []byte, 256),
			Subscriptions: make(map[string]bool),
		}
		hub.RegisterClient(client)
		go client.WritePump()
		go client.ReadPump()
	})

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}).Methods("GET")

	// Static frontend
	frontendDir := getEnv("FRONTEND_DIR", "../frontend")
	router.PathPrefix("/").Handler(http.FileServer(http.Dir(frontendDir)))

	// CORS
	corsHandler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	})

	port := getEnv("PORT", "8891")
	addr := fmt.Sprintf(":%s", port)

	log.Printf("🚀 AgentBoard API starting on http://localhost:%s", port)
	log.Printf("📊 Dashboard:  http://localhost:%s/api/dashboard/stats", port)
	log.Printf("🌳 Structure:  http://localhost:%s/api/structure", port)
	log.Printf("🔌 WebSocket:  ws://localhost:%s/ws/stream", port)

	server := &http.Server{
		Addr:         addr,
		Handler:      corsHandler.Handler(router),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if v, err := strconv.Atoi(value); err == nil {
			return v
		}
	}
	return defaultValue
}
