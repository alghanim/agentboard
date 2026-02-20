// Package config provides config-driven agent discovery for AgentBoard.
// It reads agents.yaml from path in env var AGENTS_CONFIG (default: /app/agents.yaml)
// and supports hot-reload on SIGHUP.
package config

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"

	"gopkg.in/yaml.v3"
)

// AgentNode is a node in the YAML hierarchy (supports nested children).
type AgentNode struct {
	ID        string       `yaml:"id"`
	Name      string       `yaml:"name"`
	Emoji     string       `yaml:"emoji"`
	Role      string       `yaml:"role"`
	Team      string       `yaml:"team"`
	TeamColor string       `yaml:"team_color"`
	IsLead    bool         `yaml:"is_lead"`
	Children  []*AgentNode `yaml:"children,omitempty"`

	// Set during flattening — not in YAML
	Parent string `yaml:"-"`
}

// Branding holds the branding configuration from agents.yaml.
type Branding struct {
	TeamName    string `yaml:"team_name" json:"team_name"`
	LogoPath    string `yaml:"logo_path" json:"logo_path"`
	AccentColor string `yaml:"accent_color" json:"accent_color"`
	Theme       string `yaml:"theme" json:"theme"`
}

// AgentsFile is the top-level YAML structure.
type AgentsFile struct {
	Name        string       `yaml:"name"`
	OpenClawDir string       `yaml:"openclaw_dir"`
	Agents      []*AgentNode `yaml:"agents"`
	LegacyDirs  map[string][]string `yaml:"legacy_dirs"`
	Branding    Branding     `yaml:"branding"`
}

// Agent is a flat agent record (after hierarchy flattening).
type Agent struct {
	ID        string
	Name      string
	Emoji     string
	Role      string
	Team      string
	TeamColor string
	IsLead    bool
	Parent    string
}

// HierarchyNode is a node in the agent hierarchy tree (for /api/structure).
type HierarchyNode struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Emoji     string           `json:"emoji"`
	Role      string           `json:"role"`
	Team      string           `json:"team"`
	TeamColor string           `json:"teamColor"`
	IsLead    bool             `json:"isLead"`
	Parent    string           `json:"parent,omitempty"`
	Children  []*HierarchyNode `json:"children,omitempty"`
}

// registry holds the loaded config.
type registry struct {
	mu          sync.RWMutex
	teamName    string
	openClawDir string
	agents      []Agent
	agentByName map[string]*Agent
	agentByID   map[string]*Agent
	legacyDirs  map[string][]string
	hierarchy   []*HierarchyNode
	branding    Branding
}

var global = &registry{}

func init() {
	if err := global.load(); err != nil {
		log.Printf("[config] WARNING: failed to load agents config: %v", err)
	}
	go global.watchSIGHUP()
}

// configPath returns the path to agents.yaml.
func configPath() string {
	if p := os.Getenv("AGENTS_CONFIG"); p != "" {
		return p
	}
	candidates := []string{
		"/app/agents.yaml",
		"./agents.yaml",
		"../agents.yaml",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "./agents.yaml"
}

// flattenNode recursively flattens a node tree into a list of Agents.
func flattenNode(node *AgentNode, parent string, out *[]Agent) {
	node.Parent = parent
	*out = append(*out, Agent{
		ID:        node.ID,
		Name:      node.Name,
		Emoji:     node.Emoji,
		Role:      node.Role,
		Team:      node.Team,
		TeamColor: node.TeamColor,
		IsLead:    node.IsLead,
		Parent:    parent,
	})
	for _, child := range node.Children {
		flattenNode(child, node.Name, out)
	}
}

// buildHierarchyNode converts an AgentNode tree to HierarchyNode tree.
func buildHierarchyNode(node *AgentNode, parent string) *HierarchyNode {
	h := &HierarchyNode{
		ID:        node.ID,
		Name:      node.Name,
		Emoji:     node.Emoji,
		Role:      node.Role,
		Team:      node.Team,
		TeamColor: node.TeamColor,
		IsLead:    node.IsLead,
		Parent:    parent,
	}
	for _, child := range node.Children {
		h.Children = append(h.Children, buildHierarchyNode(child, node.Name))
	}
	return h
}

// load reads and parses the YAML config file.
func (r *registry) load() error {
	path := configPath()
	abs, _ := filepath.Abs(path)

	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var af AgentsFile
	if err := yaml.Unmarshal(data, &af); err != nil {
		return err
	}

	// Determine openclaw dir
	openClawDir := af.OpenClawDir
	if d := os.Getenv("OPENCLAW_DIR"); d != "" {
		openClawDir = d
	}
	if openClawDir == "" {
		home := os.Getenv("HOME")
		openClawDir = filepath.Join(home, ".openclaw")
	}

	// Flatten agents from hierarchy
	var flat []Agent
	var hierarchy []*HierarchyNode
	for _, root := range af.Agents {
		flattenNode(root, "", &flat)
		hierarchy = append(hierarchy, buildHierarchyNode(root, ""))
	}

	byName := make(map[string]*Agent, len(flat))
	byID := make(map[string]*Agent, len(flat))
	for i := range flat {
		a := &flat[i]
		byName[a.Name] = a
		byID[a.ID] = a
	}

	// Resolve branding defaults
	branding := af.Branding
	if branding.TeamName == "" {
		branding.TeamName = af.Name
	}
	if branding.Theme == "" {
		branding.Theme = "dark"
	}

	r.mu.Lock()
	r.teamName = af.Name
	r.openClawDir = openClawDir
	r.agents = flat
	r.agentByName = byName
	r.agentByID = byID
	r.legacyDirs = af.LegacyDirs
	r.hierarchy = hierarchy
	r.branding = branding
	r.mu.Unlock()

	log.Printf("[config] Loaded %d agents from %s (openclaw_dir=%s)", len(flat), abs, openClawDir)
	return nil
}

// watchSIGHUP listens for SIGHUP and reloads config.
func (r *registry) watchSIGHUP() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGHUP)
	for range ch {
		log.Println("[config] SIGHUP received — reloading agents config...")
		if err := r.load(); err != nil {
			log.Printf("[config] Reload failed: %v", err)
		}
	}
}

// --- Public API ---

// GetTeamName returns the configured team name.
func GetTeamName() string {
	global.mu.RLock()
	defer global.mu.RUnlock()
	return global.teamName
}

// GetOpenClawDir returns the configured openclaw directory.
func GetOpenClawDir() string {
	global.mu.RLock()
	defer global.mu.RUnlock()
	return global.openClawDir
}

// GetAgents returns a snapshot of all configured agents (flat list).
func GetAgents() []Agent {
	global.mu.RLock()
	defer global.mu.RUnlock()
	cp := make([]Agent, len(global.agents))
	copy(cp, global.agents)
	return cp
}

// GetAgent returns the agent with the given name (or nil).
func GetAgent(name string) *Agent {
	global.mu.RLock()
	defer global.mu.RUnlock()
	if a, ok := global.agentByName[name]; ok {
		cp := *a
		return &cp
	}
	return nil
}

// GetAgentByID returns the agent with the given ID (or nil).
func GetAgentByID(id string) *Agent {
	global.mu.RLock()
	defer global.mu.RUnlock()
	if a, ok := global.agentByID[id]; ok {
		cp := *a
		return &cp
	}
	return nil
}

// GetLegacyDirs returns the legacy directory alias map.
func GetLegacyDirs() map[string][]string {
	global.mu.RLock()
	defer global.mu.RUnlock()
	cp := make(map[string][]string, len(global.legacyDirs))
	for k, v := range global.legacyDirs {
		vs := make([]string, len(v))
		copy(vs, v)
		cp[k] = vs
	}
	return cp
}

// GetBranding returns the branding configuration.
func GetBranding() Branding {
	global.mu.RLock()
	defer global.mu.RUnlock()
	return global.branding
}

// GetHierarchy returns the full agent hierarchy tree.
func GetHierarchy() []*HierarchyNode {
	global.mu.RLock()
	defer global.mu.RUnlock()
	// Return a copy of the slice (nodes themselves are read-only)
	cp := make([]*HierarchyNode, len(global.hierarchy))
	copy(cp, global.hierarchy)
	return cp
}
