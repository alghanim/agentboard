package handlers

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/alghanim/agentboard/backend/config"
)

// Model pricing per 1M tokens
var modelPricing = map[string]struct{ In, Out float64 }{
	"anthropic/claude-sonnet-4-6": {3.0, 15.0},
	"anthropic/claude-opus-4-6":   {15.0, 75.0},
	"google/gemini-2.5-pro":       {1.25, 10.0},
	"google/gemini-2.5-flash":     {0.075, 0.30},
}

// tokenMessage represents a single assistant message with usage data from JSONL
type tokenMessage struct {
	Timestamp time.Time
	Model     string
	AgentID   string
	Input     int64
	Output    int64
	CacheRead int64
	CacheWrite int64
	TotalTokens int64
	CostTotal float64
}

// parseAllTokenData scans all agent JSONL session files and extracts token usage
func parseAllTokenData() []tokenMessage {
	openClawDir := config.GetOpenClawDir()
	agentsDir := filepath.Join(openClawDir, "agents")

	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		return nil
	}

	var allMessages []tokenMessage

	for _, agentEntry := range entries {
		if !agentEntry.IsDir() {
			continue
		}
		agentID := agentEntry.Name()
		sessionsDir := filepath.Join(agentsDir, agentID, "sessions")

		sessionFiles, err := os.ReadDir(sessionsDir)
		if err != nil {
			continue
		}

		for _, sf := range sessionFiles {
			if !strings.HasSuffix(sf.Name(), ".jsonl") {
				continue
			}

			msgs := parseJSONLFile(filepath.Join(sessionsDir, sf.Name()), agentID)
			allMessages = append(allMessages, msgs...)
		}
	}

	return allMessages
}

func parseJSONLFile(path, agentID string) []tokenMessage {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var messages []tokenMessage
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer

	for scanner.Scan() {
		var entry map[string]interface{}
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue
		}

		// Only assistant messages have usage data
		if entry["type"] != "message" {
			continue
		}

		// Usage is nested inside entry["message"]["usage"]
		innerMsg, _ := entry["message"].(map[string]interface{})
		if innerMsg == nil {
			continue
		}
		// Only count assistant messages (they carry usage/cost)
		if role, _ := innerMsg["role"].(string); role != "assistant" {
			continue
		}
		usage, ok := innerMsg["usage"].(map[string]interface{})
		if !ok {
			continue
		}

		var msg tokenMessage
		msg.AgentID = agentID

		// Parse timestamp (may be at top level or inside message)
		tsStr := ""
		if ts, ok := entry["timestamp"].(string); ok {
			tsStr = ts
		} else if ts, ok := innerMsg["timestamp"].(string); ok {
			tsStr = ts
		}
		if tsStr != "" {
			if t, err := time.Parse(time.RFC3339Nano, tsStr); err == nil {
				msg.Timestamp = t
			} else if t, err := time.Parse("2006-01-02T15:04:05.000Z", tsStr); err == nil {
				msg.Timestamp = t
			}
		}
		if msg.Timestamp.IsZero() {
			msg.Timestamp = time.Now()
		}

		// Parse model (inside message)
		if m, ok := innerMsg["model"].(string); ok {
			msg.Model = m
		}

		// Parse usage fields
		if v, ok := usage["input"].(float64); ok {
			msg.Input = int64(v)
		}
		if v, ok := usage["output"].(float64); ok {
			msg.Output = int64(v)
		}
		if v, ok := usage["cacheRead"].(float64); ok {
			msg.CacheRead = int64(v)
		}
		if v, ok := usage["cacheWrite"].(float64); ok {
			msg.CacheWrite = int64(v)
		}
		if v, ok := usage["totalTokens"].(float64); ok {
			msg.TotalTokens = int64(v)
		}

		// Parse cost
		if cost, ok := usage["cost"].(map[string]interface{}); ok {
			if v, ok := cost["total"].(float64); ok {
				msg.CostTotal = v
			}
		}

		// If no cost from JSONL, calculate from model pricing
		if msg.CostTotal == 0 && msg.Model != "" {
			msg.CostTotal = calcModelCost(msg.Model, msg.Input+msg.CacheRead+msg.CacheWrite, msg.Output)
		}

		messages = append(messages, msg)
	}

	return messages
}

func calcModelCost(model string, input, output int64) float64 {
	// Try exact match first
	if p, ok := modelPricing[model]; ok {
		return (float64(input)/1e6)*p.In + (float64(output)/1e6)*p.Out
	}
	// Fuzzy match
	for k, p := range modelPricing {
		if strings.Contains(model, strings.Split(k, "/")[len(strings.Split(k, "/"))-1]) {
			return (float64(input)/1e6)*p.In + (float64(output)/1e6)*p.Out
		}
	}
	// Default to sonnet pricing
	return (float64(input)/1e6)*3.0 + (float64(output)/1e6)*15.0
}

// GetTokens handles GET /api/analytics/tokens — per-agent token usage
func (h *AnalyticsHandler) GetTokens(w http.ResponseWriter, r *http.Request) {
	allMsgs := parseAllTokenData()

	// Aggregate per agent
	type agentUsage struct {
		AgentID     string  `json:"agent_id"`
		Name        string  `json:"name"`
		TokensIn    int64   `json:"tokens_in"`
		TokensOut   int64   `json:"tokens_out"`
		TotalTokens int64   `json:"total_tokens"`
		CostUSD     float64 `json:"cost_usd"`
	}

	agentMap := make(map[string]*agentUsage)
	for _, msg := range allMsgs {
		au, ok := agentMap[msg.AgentID]
		if !ok {
			au = &agentUsage{AgentID: msg.AgentID, Name: msg.AgentID}
			agentMap[msg.AgentID] = au
		}
		au.TokensIn += msg.Input + msg.CacheRead + msg.CacheWrite
		au.TokensOut += msg.Output
		au.TotalTokens += msg.TotalTokens
		au.CostUSD += msg.CostTotal
	}

	// Resolve display names from config
	for _, ca := range config.GetAgents() {
		if au, ok := agentMap[ca.ID]; ok {
			au.Name = ca.Name
		}
	}

	results := make([]agentUsage, 0, len(agentMap))
	for _, au := range agentMap {
		results = append(results, *au)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].CostUSD > results[j].CostUSD
	})

	respondJSON(w, http.StatusOK, results)
}

// GetTokensTimeline handles GET /api/analytics/tokens/timeline — daily token usage
func (h *AnalyticsHandler) GetTokensTimeline(w http.ResponseWriter, r *http.Request) {
	daysStr := r.URL.Query().Get("days")
	days := 30
	if daysStr != "" {
		if v, err := strconv.Atoi(daysStr); err == nil && v > 0 && v <= 365 {
			days = v
		}
	}

	agentFilter := r.URL.Query().Get("agent")

	allMsgs := parseAllTokenData()
	cutoff := time.Now().AddDate(0, 0, -days)

	type dailyUsage struct {
		Date     string  `json:"date"`
		TokensIn int64   `json:"tokens_in"`
		TokensOut int64  `json:"tokens_out"`
		CostUSD  float64 `json:"cost_usd"`
	}

	dayMap := make(map[string]*dailyUsage)

	for _, msg := range allMsgs {
		if msg.Timestamp.Before(cutoff) {
			continue
		}
		if agentFilter != "" && msg.AgentID != agentFilter {
			continue
		}
		dateStr := msg.Timestamp.Format("2006-01-02")
		du, ok := dayMap[dateStr]
		if !ok {
			du = &dailyUsage{Date: dateStr}
			dayMap[dateStr] = du
		}
		du.TokensIn += msg.Input + msg.CacheRead + msg.CacheWrite
		du.TokensOut += msg.Output
		du.CostUSD += msg.CostTotal
	}

	// Fill in missing days
	results := make([]dailyUsage, 0, days)
	for d := 0; d < days; d++ {
		date := time.Now().AddDate(0, 0, -days+1+d).Format("2006-01-02")
		if du, ok := dayMap[date]; ok {
			results = append(results, *du)
		} else {
			results = append(results, dailyUsage{Date: date})
		}
	}

	respondJSON(w, http.StatusOK, results)
}

// GetCostSummary handles GET /api/analytics/cost/summary
func (h *AnalyticsHandler) GetCostSummary(w http.ResponseWriter, r *http.Request) {
	allMsgs := parseAllTokenData()

	now := time.Now()
	weekStart := now.AddDate(0, 0, -int(now.Weekday()))
	weekStart = time.Date(weekStart.Year(), weekStart.Month(), weekStart.Day(), 0, 0, 0, 0, now.Location())
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	var costThisWeek, costThisMonth, costAllTime float64
	var tokensAllTime int64
	agentCosts := make(map[string]float64)

	for _, msg := range allMsgs {
		costAllTime += msg.CostTotal
		tokensAllTime += msg.TotalTokens
		agentCosts[msg.AgentID] += msg.CostTotal

		if !msg.Timestamp.Before(weekStart) {
			costThisWeek += msg.CostTotal
		}
		if !msg.Timestamp.Before(monthStart) {
			costThisMonth += msg.CostTotal
		}
	}

	// Find most expensive agent
	var mostExpensiveAgent string
	var mostExpensiveCost float64
	for agentID, cost := range agentCosts {
		if cost > mostExpensiveCost {
			mostExpensiveCost = cost
			mostExpensiveAgent = agentID
		}
	}

	// Resolve display name
	for _, ca := range config.GetAgents() {
		if ca.ID == mostExpensiveAgent {
			mostExpensiveAgent = ca.Name
			break
		}
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"cost_this_week":       costThisWeek,
		"cost_this_month":      costThisMonth,
		"cost_all_time":        costAllTime,
		"tokens_all_time":      tokensAllTime,
		"most_expensive_agent": mostExpensiveAgent,
		"most_expensive_cost":  mostExpensiveCost,
	})
}
