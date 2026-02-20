# AgentBoard Product Meeting — Muse (Product & Design Lead)
**Date:** 2026-02-21

---

## 1. White Labeling UX

### Where team name/logo appears
- **Sidebar header:** Replace the 🤖 emoji + "AgentBoard" text with a custom logo image + team name. The `sidebar-logo` span becomes an `<img>` when a logo URL is configured, falling back to emoji.
- **Favicon:** Dynamically set via `<link rel="icon">` from the branding config. Provide a sensible default (current robot emoji as SVG favicon).
- **Browser tab title:** `{TeamName} — AgentBoard` pattern. Update `<title>` on config load.

### Color theme configuration
- **Single accent color** is the high-leverage play. The current `--accent: #B5CC18` drives the entire brand feel. Let users pick one color; we derive `--accent-hover` (lighten 10%) and `--accent-muted` (12% opacity) automatically via CSS `color-mix()` or a tiny JS utility.
- **No full theme editor.** One accent color + logo is enough for v1. Avoids complexity explosion.

### Settings page for branding
**Yes — add a "Branding" section to the existing Settings page.** Layout:
1. **Team Name** — text input
2. **Logo** — file upload (show preview, max 200×60px display, accept SVG/PNG)
3. **Accent Color** — color picker input (`<input type="color">`) with hex preview
4. **Preview strip** — live mini-preview showing sidebar header + a sample button with the chosen accent

Store in a new `/api/settings/branding` endpoint. Persist to DB. Load on app init and inject as CSS custom properties.

### Dark/light mode toggle
- **Not for v1.** The current dark theme is the brand identity. A light mode doubles CSS surface area and testing burden.
- **v2 consideration:** If white-label customers demand it, implement via a `.light` class on `<body>` that overrides `--bg-*` and `--text-*` variables. The accent color system stays the same.

---

## 2. Analytics Dashboard UX

### Layout: Dedicated "Reports" page
**Full dedicated page** — not embedded. Add a new nav item between Activity and Settings:
```
📊 Reports
```
Reason: Analytics needs space. Cramming charts into existing pages clutters the clean layout we have.

### Page structure (top → bottom)
1. **Date range picker** (top-right) — presets: 7d, 30d, 90d, custom range
2. **KPI summary cards** (row of 4):
   - Tasks completed (count + % change vs prior period)
   - Avg completion time (hours)
   - Active agents (count)
   - Tasks in progress (count)
3. **Charts section** (2-column grid on desktop, stacked on mobile):

| Metric | Chart Type | Why |
|--------|-----------|-----|
| Tasks completed over time | **Area chart** | Shows volume trends, filled area feels substantial |
| Tasks by status | **Horizontal bar** | Easy comparison across 5 statuses |
| Tasks by agent | **Stacked bar** | Shows workload distribution per agent |
| Completion time distribution | **Box plot or histogram** | Reveals bottlenecks |
| Agent activity timeline | **Heatmap calendar** (GitHub-style) | At-a-glance engagement |
| Priority breakdown | **Donut chart** | Simple proportional view |

Use D3.js (already loaded) for all charts. Keep the dark theme palette — chart colors map to existing team colors (`--team-command`, `--team-engineering`, etc.) plus the accent.

### Export options UX
- **CSV:** Small download icon button next to each chart/table. One click = instant download. No modal.
- **PDF:** Single "Export Report" button at page top-right. Generates a full-page PDF with all visible charts. Use a lightweight client-side lib (html2canvas + jsPDF) to avoid backend complexity.
- **No email scheduling for v1.** Keep it manual.

---

## 3. Agent Kanban UX Improvements

### Active task visual indicator
When an agent is actively working a task (status: `progress` + agent assigned), the card should show:
- **Pulsing green dot** next to the agent name (reuse `--status-online` color)
- **Subtle animated border** — a thin `2px` left-border with a slow pulse animation (CSS `@keyframes`):
  ```css
  .task-card--active {
    border-left: 3px solid var(--status-online);
    animation: pulse-border 2s ease-in-out infinite;
  }
  ```
- This is driven by real-time WebSocket — when an agent's status is "busy" and matches the task assignee, the card gets the `--active` class.

### "Assigned to agent" badge
Current implementation already shows `emoji + name` in `.task-card__meta`. Improvements:
- **Make it a proper pill badge:** Rounded background using the agent's team color at low opacity:
  ```css
  .task-card__assignee {
    background: var(--team-color, var(--bg-tertiary));
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
  }
  ```
- **"Unassigned" state:** Show a dashed-outline ghost badge "Unassigned" in `--text-tertiary` to make it obvious the task needs pickup.

### Agent avatar in task cards
- Use the agent's emoji as the avatar (already available in data).
- Display as a **small circle (24×24)** in the bottom-right of the card.
- On hover, show the agent name as a tooltip.
- When multiple agents are involved (future), stack avatars with overlap (like GitHub).

---

## 4. Polish & Delight Improvements

### Quick wins (high impact, low effort)
1. **Task card click → detail drawer.** Currently cards have no interaction beyond drag. Add a slide-in drawer from the right showing full description, history, comments, and an edit form. This is the #1 missing interaction.

2. **Keyboard shortcuts.** `N` for new task, `/` to focus search, `1-5` to filter by column. Show a `?` shortcut overlay. Power users will love this.

3. **Empty states with personality.** Replace "No tasks" with illustrations or witty copy. E.g., backlog empty = "🎉 Backlog zero. Enjoy the calm." Done column = "✅ {count} tasks crushed this week."

4. **Toast notifications.** When a task moves via WebSocket (another agent completed something), show a brief toast: "✅ Forge completed 'Add branding endpoint'". Currently changes happen silently.

5. **Agent status indicators in sidebar.** Small colored dots next to "Agents" nav showing how many are online. Gives life to the UI.

### Medium effort, high value
6. **Activity feed filtering.** The current activity page likely shows everything. Add agent/type filters and a "just my team" toggle.

7. **Org chart improvements.** Add click-to-expand agent detail cards in the D3 chart. Show current task, status, and recent activity inline.

8. **Dashboard sparklines.** On the main dashboard, show tiny inline sparkline charts (7-day trend) next to each KPI number. Makes the dashboard feel alive without a full reports page.

9. **Drag-and-drop task reordering within columns.** Currently only cross-column drag works. Intra-column ordering (priority sort) would be useful.

10. **Command palette (Cmd+K).** A universal search/action bar: jump to any agent, task, or page. Modern SaaS standard.

---

## Summary

The biggest UX gaps are:
1. **No task detail view** (click does nothing) — this is the top priority
2. **No branding/white-label settings** — add to existing Settings page
3. **No analytics/reports page** — new dedicated page with D3 charts
4. **Kanban cards need more visual life** — active indicators, proper badges, avatars

Design philosophy: AgentBoard already has a strong dark aesthetic. Don't fight it. Enhance with micro-interactions, real-time visual feedback, and information density improvements. Keep the monospace + Inter font pairing — it's distinctive.
