# AgentBoard

A real-time dashboard backend for monitoring and managing AI agent teams.
Config-driven agent discovery — no hardcoding required.

## Features

- 📋 **Kanban / Task board** — full CRUD, status transitions, comments
- 🌳 **Config-driven agent hierarchy** — define your team in `agents.yaml`
- 🔍 **Live agent status** — reads OpenClaw session data in real time
- 📖 **Soul viewer** — reads `SOUL.md`, `AGENTS.md`, `MEMORY.md` from agent workspaces
- 🔌 **WebSocket streaming** — push updates to clients on task/agent changes
- 🗄️ **Auto-migration** — schema embedded in binary, no external migration tool

## Quick Start

```bash
# 1. Copy example files
cp agents.yaml.example agents.yaml
cp .env.example .env

# 2. Set your OpenClaw directory in .env  ← REQUIRED
#    This is how AgentBoard reads your agent souls, memory, and live activity
echo "OPENCLAW_DIR=$HOME/.openclaw" >> .env

# 3. Edit agents.yaml to define your team structure
#    Match the agent IDs to your workspace-{id} folder names under ~/.openclaw/

# 4. Run with Docker Compose
docker compose up --build

# Dashboard is now live at http://localhost:8891
```

> **Important:** `OPENCLAW_DIR` must point to your OpenClaw data directory (default: `~/.openclaw`).
> Without it, the Soul Viewer and live activity feed won't load agent data.

## Configuration

### agents.yaml

Defines your agent hierarchy. Nested `children` entries automatically become child nodes in the tree.

```yaml
name: "My Team"
openclaw_dir: "/data/openclaw"  # override with OPENCLAW_DIR env var

agents:
  - id: titan
    name: titan
    emoji: "⚡"
    role: Orchestrator
    team: Command
    team_color: "#FFD700"
    children:
      - id: forge
        name: forge
        emoji: "🔨"
        role: Backend
        team: Engineering
        team_color: "#4A90D9"
```

Hot-reload without restart: `kill -HUP <pid>`

### Environment Variables

See `.env.example` for the full list. Key vars:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8891` | API listen port |
| `AGENTS_CONFIG` | `/app/agents.yaml` | Path to agents.yaml |
| `OPENCLAW_DIR` | `~/.openclaw` | Path to OpenClaw data dir |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PASSWORD` | `agentboard` | PostgreSQL password |

## API Reference

### Tasks (Kanban)
| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks` | List tasks (filter: status, assignee, priority, team) |
| POST | `/api/tasks` | Create task |
| GET | `/api/tasks/:id` | Get task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/assign` | Assign task to agent |
| POST | `/api/tasks/:id/transition` | Transition task status |
| GET | `/api/tasks/:id/comments` | List comments |
| POST | `/api/tasks/:id/comments` | Add comment |

### Agents
| Method | Path | Description |
|---|---|---|
| GET | `/api/agents` | List agents (from DB) |
| GET | `/api/agents/:id` | Get agent |
| GET | `/api/agents/:id/soul` | Read SOUL.md, AGENTS.md, MEMORY.md |
| GET | `/api/agents/:id/activity` | Recent activity |
| GET | `/api/agents/:id/metrics` | 30-day metrics |
| PUT | `/api/agents/:id/status` | Update status |

### Structure & Live Data
| Method | Path | Description |
|---|---|---|
| GET | `/api/structure` | Full agent hierarchy from config |
| GET | `/api/openclaw/agents` | Live agent status from session data |
| GET | `/api/openclaw/agents/:name` | Live agent detail |
| GET | `/api/openclaw/stream` | Recent activity stream |
| GET | `/api/openclaw/stats` | Aggregated stats |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/stats` | Overview stats |
| GET | `/api/dashboard/teams` | Per-team stats |

### WebSocket
Connect to `ws://localhost:8891/ws/stream` to receive real-time events:
- `task_created`, `task_updated`, `task_deleted`, `task_assigned`, `task_transitioned`
- `comment_added`, `comment_deleted`
- `agent_status_update`

## Soul Endpoint Response

```json
{
  "agent_id": "forge",
  "soul":   { "content": "...", "modified": "2026-02-20T12:00:00Z" },
  "agents": { "content": "...", "modified": "2026-02-20T12:00:00Z" },
  "memory": { "content": "...", "modified": "2026-02-20T12:00:00Z" }
}
```

## Development

```bash
cd backend
go mod tidy
go build -o agentboard .
AGENTS_CONFIG=../agents.yaml ./agentboard
```

## License

MIT
