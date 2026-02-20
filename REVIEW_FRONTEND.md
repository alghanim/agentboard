# AgentBoard Frontend — Code Review
**Reviewer:** Glass (sub-agent)  
**Date:** 2026-02-21  
**Scope:** `frontend/index.html`, `js/{api,app,utils,websocket}.js`, `pages/{dashboard,agents,kanban,org-chart,activity,reports,settings}.js`, `styles/*.css`

---

## Summary

| Severity  | Count |
|-----------|-------|
| Critical  | 2     |
| High      | 9     |
| Medium    | 13    |
| Low       | 8     |
| **Total** | **32** |

---

## 🔴 Critical

---

### C-1 · XSS: `marked.parse()` output inserted raw into innerHTML
**Files:** `pages/agents.js` (`_loadTab`, ~line 180), `pages/org-chart.js` (`_panelTab`, ~line 190)

`marked` v4+ does not sanitize HTML by default. Any `<script>`, `<img onerror=...>`, or other active content in a SOUL.md / MEMORY.md file is executed.

```js
// agents.js _loadTab
const html = marked.parse(fileData.content || '');
el.innerHTML = `<div class="markdown-body" id="mdBody_${tab}">${html}</div>...`;

// org-chart.js _panelTab
content.innerHTML = `<div class="markdown-body" ...>${marked.parse(soul.soul.content || '')}</div>`;
```

**Suggested fix:** Add DOMPurify (CDN: `dompurify.min.js`) and sanitize before insertion:
```js
const html = DOMPurify.sanitize(marked.parse(fileData.content || ''));
```

---

### C-2 · XSS: unescaped `item.type` from API inserted into innerHTML (dashboard)
**File:** `pages/dashboard.js` (`_renderActivity`, ~line 92)

```js
const typeLabel = item.type === 'command' ? `ran <code>${Utils.esc(item.toolName)}</code>`
  : item.type === 'response' ? 'sent a response'
  : item.type === 'result' ? 'got a result'
  : item.type;    // ← raw API value written to innerHTML
```

If the server (or a rogue WebSocket message) sends `item.type` as `<img src=x onerror=alert(1)>`, it executes.

**Suggested fix:**
```js
: Utils.esc(item.type ?? 'unknown');
```

---

## 🟠 High

---

### H-1 · Bug: Wrong JS-context escaping for agentId / taskId inside `onclick` attributes
**Files:** `pages/agents.js` (`_renderDetail`, `_loadTab`), `pages/kanban.js` (`_openDrawer`)

`Utils.esc()` performs HTML escaping (`'` → `&#39;`). Using it inside an inline `onclick` JS string literal is incorrect: the browser decodes `&#39;` back to `'` when parsing the event handler, causing a syntax error for any name containing a single quote (e.g. `O'Brien`).

```js
// agents.js _renderDetail (~line 108)
onclick="Pages.agents._switchTab('soul', '${Utils.esc(agentId)}')"

// agents.js _loadTab (~line 175) — even worse, NO escaping at all for agentId here:
onclick="Pages.agents._loadTab('${tab}', '${agentId}')"
```

**Suggested fix:** Use `JSON.stringify()` for JS string context:
```js
onclick="Pages.agents._switchTab('soul', ${JSON.stringify(agentId)})"
onclick="Pages.agents._loadTab(${JSON.stringify(tab)}, ${JSON.stringify(agentId)})"
```
Apply the same fix anywhere `task.id`, `agentId`, or similar user-derived values are embedded in `onclick` attributes.

---

### H-2 · Bug: Reports bar chart breaks when API returns `{agent, value}` objects
**File:** `pages/reports.js` (`_drawAgentBar`, ~line 165)

The guard uses `d.value || d.count` for the max check, but the D3 scale and bar height use only `d.count`:

```js
const maxVal = d3.max(data, d => d.value || d.count || 0);  // considers value
// ...
const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 1])  // only count!
// ...
.attr('height', d => h - y(d.count))  // only count → NaN if API returns value
```

If the analytics API returns `[{ agent: "X", value: 5 }]`, all bars are zero height.

**Suggested fix:** Normalise at load time:
```js
data = data.map(d => ({ agent: d.agent, count: d.count ?? d.value ?? 0 }));
```

---

### H-3 · Bug: Org chart slide panel stays open after page navigation
**File:** `pages/org-chart.js` (`destroy`, ~line 220)

`destroy()` cleans up WS handlers and timers but does NOT call `_closePanel()`. The `position:fixed` panel remains visible over the next page.

```js
destroy() {
  this._wsHandlers.forEach(([ev, fn]) => WS.off(ev, fn));
  this._wsHandlers = [];
  if (this._refreshTimer) clearInterval(this._refreshTimer);
  this._refreshTimer = null;
  // ← missing: this._closePanel()
}
```

**Suggested fix:** Add `this._closePanel();` as the first line of `destroy()`.

---

### H-4 · UX: Dashboard and Kanban silently swallow API errors — loading spinners hang forever
**Files:** `pages/dashboard.js` (`_load`), `pages/kanban.js` (`_loadTasks`)

```js
// dashboard.js
} catch (e) {
  console.error('Dashboard load error:', e);
  // no UI update — spinners remain
}

// kanban.js
} catch (e) {
  console.error('Kanban load error:', e);
  // columns stay in skeleton state
}
```

**Suggested fix:** Render an error state in each affected container, e.g.:
```js
} catch (e) {
  Utils.showEmpty(document.getElementById('statsGrid'), '⚠️', 'Failed to load data', e.message);
}
```

---

### H-5 · Bug: Agent filter on Kanban uses agent name but task assignee stores agent ID
**File:** `pages/kanban.js` (`_loadAgents`, `_applyFilters`, ~lines 100–130)

Filter dropdown:
```js
opt.value = name;  // agent.name or displayName
```
New-task agent dropdown:
```js
opt.value = a.id || name;  // agent ID
```
Filter comparison:
```js
if ((t.assignee || t.assigned_to || t.assignedTo || '') !== this._filterAgent) return false;
```

Tasks created through the UI store agent ID as assignee; the filter dropdown holds the name. They never match. The agent filter silently returns no results.

**Suggested fix:** Use the same key (`a.id || a.name`) in both dropdowns:
```js
opt.value = a.id || a.name;  // kanbanFilterAgent
```

---

### H-6 · Performance: Dashboard WS handler fires 3 API calls on every agent status update
**File:** `pages/dashboard.js` (`render`, ~line 35)

```js
const handler = () => this._load();
WS.on('agent_status_update', handler);
```

`_load()` always calls `Promise.all([getStats(), getAgents(), getStream(10)])`. If agents update every few seconds, this generates continuous request storms.

**Suggested fix:** Debounce or update status in-place without a full reload:
```js
const handler = Utils.debounce(() => this._load(), 2000);
```
(Add a simple debounce to `Utils` — none exists currently.)

---

### H-7 · Performance: Three separate WS events each trigger a full task reload on Kanban
**File:** `pages/kanban.js` (`render`, ~line 72)

```js
const taskHandler = () => this._loadTasks();
WS.on('task_updated', taskHandler);
WS.on('task_created', taskHandler);
WS.on('task_deleted', taskHandler);
```

Batch task operations trigger multiple `API.getTasks()` calls back-to-back.

**Suggested fix:** Debounce `taskHandler` and apply delta updates for `task_updated`/`task_deleted` where possible.

---

### H-8 · Bug/UX: Reports page shows randomly-generated fake throughput data when API is unavailable
**File:** `pages/reports.js` (`_drawThroughput`, ~line 130)

```js
if (!data || !Array.isArray(data) || data.length === 0) {
  // ...
  data.push({ date: ..., count: Math.floor(Math.random() * 8 + 1) });
}
```

Random numbers are displayed in a "Task Throughput" chart labelled with real dates, with no disclaimer. Users believe they are looking at real analytics.

**Suggested fix:** Show an empty/unavailable state instead:
```js
if (!data || !Array.isArray(data) || data.length === 0) {
  el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No throughput data available</div>';
  return;
}
```

---

### H-9 · Bug: `pageKey` space-replace only replaces first occurrence
**File:** `js/app.js` (`routeTo`, ~line 95)

```js
const pageKey = main.toLowerCase().replace(' ', '-');
```

`String.replace(string, ...)` replaces only the first occurrence. A URL fragment like `my report` would become `my-report` but `my big report` would become `my-big report`.

**Suggested fix:**
```js
const pageKey = main.toLowerCase().replaceAll(' ', '-');
```

---

## 🟡 Medium

---

### M-1 · Bug: `_loadTab` in agents.js embeds `agentId` in onclick with NO escaping at all
**File:** `pages/agents.js` (`_loadTab`, ~line 175)

```js
<button class="content-timestamp-refresh"
  onclick="Pages.agents._loadTab('${tab}', '${agentId}')">↻</button>
```

Neither `tab` nor `agentId` are escaped. `agentId` with a single quote breaks JS; with a backtick/newline it could allow injection. (See also H-1.)

---

### M-2 · Bug: Org chart `_renderTree` computes NaN scale when hierarchy has only root node
**File:** `pages/org-chart.js` (`_renderTree`, ~line 110)

```js
let x0 = Infinity, x1 = -Infinity, ...;
root.each(d => { ... });
const scale = Math.min(W / treeW, H / treeH, 1) * 0.9;
```

If `root` has no descendants, `x0 = Infinity`, `treeW = -Infinity`, `scale = NaN`. All node positions become `NaN` and nothing renders.

**Suggested fix:** Guard before computing scale:
```js
if (root.descendants().length <= 1) {
  Utils.showEmpty(wrap, '🌳', 'Only one node', 'Add agents with hierarchy in agents.yaml');
  return;
}
```

---

### M-3 · Bug: `_openPanel` in org-chart may call `API.getAgentSoul(undefined)` for root node
**File:** `pages/org-chart.js` (`_openPanel`, ~line 178)

```js
const agentId = agent?.id || nodeData.id || name;
this._panelAgentId = agentId;
this._panelTab('soul');
```

If `nodeData` is the synthetic `{ name: 'AgentBoard', id: 'root' }` wrapper node, `agentId = 'root'`, and the soul API request `/api/agents/root/soul` returns a 404, showing an error state. There's no guard to skip the soul panel for non-agent nodes.

**Suggested fix:** Check if agent was found before offering the Soul tab; hide it if not.

---

### M-4 · UX: New task modal ESC key closes drawer but not modal
**File:** `pages/kanban.js` (`render`, ~line 68)

```js
this._escHandler = (e) => {
  if (e.key === 'Escape') this._closeDrawer();
};
```

Pressing ESC while the new task modal is open does nothing (the drawer is not open). Users expect ESC to close any open modal.

**Suggested fix:**
```js
if (e.key === 'Escape') {
  const modal = document.getElementById('taskModal');
  if (modal && modal.style.display !== 'none') {
    this._closeModal();
  } else {
    this._closeDrawer();
  }
}
```

---

### M-5 · UX: New task form doesn't reset priority/status/agent after successful creation
**File:** `pages/kanban.js` (`_submitTask`, ~line 295)

Only title and description are reset:
```js
['newTaskTitle', 'newTaskDesc'].forEach(id => { ... el.value = ''; });
```
Priority, status, and agent selects retain the previous values.

**Suggested fix:** Add:
```js
const priority = document.getElementById('newTaskPriority');
const status = document.getElementById('newTaskStatus');
const agent = document.getElementById('newTaskAgent');
if (priority) priority.selectedIndex = 0;
if (status) status.selectedIndex = 0;
if (agent) agent.selectedIndex = 0;
```

---

### M-6 · UX: No double-submit prevention on task create or drawer transition
**File:** `pages/kanban.js` (`_submitTask`, `_drawerTransition`)

Both async functions leave their trigger buttons enabled throughout the API call. Rapid clicks submit duplicates or issue multiple transition requests.

**Suggested fix:** Disable the button at the start of the call, re-enable (or close modal) on completion.

---

### M-7 · UX: Activity feed has no live updates when rendered as embedded tab
**Files:** `pages/activity.js` (`_renderFeed`), `pages/agents.js` (`_loadTab`), `pages/org-chart.js` (`_panelTab`)

When the activity feed is embedded in an agent detail tab or org-chart panel, it renders a static snapshot. WS live-event subscriptions are only installed in `Activity.render()`. Agent/org-chart consumers never subscribe.

**Suggested fix:** Expose a `renderFeedWithLive(container, agentId)` method that installs a limited WS subscription (and properly cleans up via a returned `destroy` fn), or accept a refresh-on-change callback.

---

### M-8 · CSS: Kanban rightmost column clipped — missing `padding-right`
**File:** `styles/components.css` (`.kanban-board`, ~line 342)

```css
.kanban-board {
  overflow-x: auto;
  padding-bottom: 16px;
  /* no padding-right → last column right edge is flush with scroll edge */
}
```

**Suggested fix:**
```css
.kanban-board {
  padding: 0 16px 16px 0;
}
```
Or simply add `padding-right: 16px`.

---

### M-9 · CSS: Light theme missing `--accent-muted`, `--accent-hover`, `--status-*` overrides
**File:** `styles/variables.css`

`body.theme-light` overrides background, border, and text variables but inherits dark-theme values for:
- `--accent-muted: rgba(181,204,24,0.12)` — chartreuse tint on white has low contrast
- `--status-online/busy/offline` — colours chosen for dark backgrounds
- `--accent-hover` — the hover state for buttons

**Suggested fix:** Add to `body.theme-light`:
```css
--accent-muted: rgba(100, 130, 10, 0.10);
--accent-hover: #9db015;
```

---

### M-10 · CSS: Org chart D3 link colours don't update on theme toggle
**File:** `pages/org-chart.js` (`_renderTree`, ~line 145)

D3 sets stroke as an SVG attribute (not a CSS property):
```js
.attr('stroke', 'var(--border-subtle)')
```

SVG attributes that contain `var()` references are not re-evaluated when the theme class changes. The link strokes stay dark on a now-light background.

**Suggested fix:** Add an `orgChart.rerenderOnThemeChange()` hook, or use a CSS class on paths and style them from CSS rather than from a `stroke` attribute.

---

### M-11 · CSS: `Branding.apply()` sets `--accent-hover` to same value as `--accent`
**File:** `js/app.js` (`Branding.apply`, ~line 75)

```js
document.documentElement.style.setProperty('--accent-hover', b.accent_color);
// comment: "derive hover (+10% lightness) — todo"
```

Hover and default accent look identical. This was deferred but affects all interactive elements.

**Suggested fix:** Compute a lighter variant. If the color is hex:
```js
function lightenHex(hex, amount = 20) { /* ... HSL math */ }
document.documentElement.style.setProperty('--accent-hover', lightenHex(b.accent_color));
```
Or document the limitation clearly and accept it as a known limitation.

---

### M-12 · Performance: D3 chart widths captured before layout (`clientWidth = 0`)
**File:** `pages/reports.js` (`_drawThroughput`, `_drawAgentBar`, `_drawDonut`)

```js
const W = el.clientWidth || 600;
```

On first render, if `#content` hasn't fully laid out yet (e.g. on a slow device or behind a CSS transition), `el.clientWidth` is `0` and all charts render at fixed 600px width, ignoring the actual container.

**Suggested fix:** Use a `ResizeObserver` or defer chart drawing with `requestAnimationFrame`:
```js
requestAnimationFrame(() => this._drawThroughput(throughputData));
```

---

### M-13 · Bug: `Utils.showEmpty` and `Utils.showLoading` insert `icon`/`title`/`desc` into innerHTML without escaping
**File:** `js/utils.js` (`showEmpty`, `showLoading`)

```js
showEmpty(container, icon, title, desc = '') {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <div class="empty-state-title">${title}</div>
      ${desc ? `<div class="empty-state-desc">${desc}</div>` : ''}
    </div>`;
},
```

All three parameters are unescaped. Most callers use string literals, but several pass `e.message` directly from caught errors, which could contain `<` or `>` in stack traces or API responses.

**Suggested fix:** Escape all three params inside the template:
```js
<div class="empty-state-icon">${Utils.esc(String(icon))}</div>
<div class="empty-state-title">${Utils.esc(String(title))}</div>
${desc ? `<div class="empty-state-desc">${Utils.esc(String(desc))}</div>` : ''}
```

---

## 🔵 Low

---

### L-1 · CSS injection: `accent_color` from branding API used in `style` attribute without CSS-value sanitisation
**File:** `pages/settings.js` (`_loadBranding`, ~line 55)

```js
`<span style="...background:${Utils.esc(val)}...">` // for accent_color
```

`Utils.esc()` encodes HTML special chars but not CSS injection (semicolons, url()). A value like `red; display:none` would hide subsequent sibling elements. Not a JS XSS, but a CSS injection.

**Suggested fix:** Validate that `accent_color` matches `/^#[0-9a-fA-F]{3,8}$|^rgb/` before rendering.

---

### L-2 · UX: Org chart `_updateNodeStatuses` rebuilds DOM queries on every WS event
**File:** `pages/org-chart.js` (`_updateNodeStatuses`)

`this._svg.selectAll('.org-node-wrap').each(...)` is O(n nodes) per event. For large installations (100+ agents) this may cause jank on frequent status updates.

**Suggested fix:** Index nodes by agent ID at render time and update only the changed node's dot.

---

### L-3 · UX: Breadcrumb `info.title` not HTML-escaped
**File:** `js/app.js` (`routeTo`, ~line 110)

```js
breadEl.innerHTML = `<a onclick="App.navigate('${Utils.esc(pageKey)}')">${info.title}</a> ...`;
```

`info.title` values come from `PAGE_TITLES` (hardcoded, safe today), but if these become dynamic, they would be unescaped.

**Suggested fix:** Use `Utils.esc(info.title)`.

---

### L-4 · Bug: `navigate()` in app.js passes sub-path to hash but double-routing can occur
**File:** `js/app.js` (`navigate`, ~line 100)

When `updateHash = true` (default), setting `location.hash` fires `hashchange`, which calls `routeTo` again. When `updateHash = false`, `routeTo` is called directly. This double-routing is safe currently but fragile — adding any logic to `navigate()` between the hash assignment and the hashchange could cause ordering issues.

---

### L-5 · Code quality: `_justDragged` is not declared in object literal
**File:** `pages/kanban.js` (top of `Pages.kanban` object)

`_justDragged` is first written in `_onDragStart` but never declared alongside other state properties. Works in JS but breaks IDE type inference and is confusing.

**Suggested fix:** Add `_justDragged: false,` to the top-level property declarations.

---

### L-6 · UX: Agent WS status updates not applied when in agent detail view
**File:** `pages/agents.js` (`_renderDetail`)

WS `agent_status_update` handler is only installed in `_renderGrid`. In the detail view, the status dot never updates unless the user navigates away and back.

---

### L-7 · Performance: `_renderAll()` re-renders all 5 Kanban columns on every filter keystroke
**File:** `pages/kanban.js` (`_onSearch`, `_onFilter`, `_renderAll`)

Each keystroke in the search box calls `_renderAll()` → 5× `_renderColumn()`. For boards with many tasks, this is noticeable. Debouncing the search input would help.

**Suggested fix:**
```js
_onSearch: Utils.debounce(function(val) {
  this._searchQuery = val;
  this._renderAll();
}.bind(Pages.kanban), 200),
```

---

### L-8 · CSS: `.kanban-filters` "+ New Task" button loses `margin-left: auto` alignment when wrapping
**File:** `styles/components.css` (`.kanban-filters`)

On narrow screens, flex-wrap causes the "+ New Task" button to wrap to a new line. `margin-left: auto` works on the same row but has no effect once the button is on its own row — it just left-aligns.

**Suggested fix:** Wrap the button in a flex container or add `flex-basis: 100%` logic:
```css
.kanban-filters .btn-primary {
  margin-left: auto;
}
@media (max-width: 600px) {
  .kanban-filters .btn-primary { width: 100%; }
}
```

---

## Quick-Fix Checklist

| # | File | Issue | Fix complexity |
|---|------|-------|----------------|
| C-1 | agents.js, org-chart.js | Unsanitised marked.parse() → XSS | Add DOMPurify |
| C-2 | dashboard.js | Raw item.type in innerHTML | `Utils.esc()` |
| H-1 | agents.js, kanban.js | HTML-escape in JS onclick context | `JSON.stringify()` |
| H-2 | reports.js | Bar chart `value` vs `count` key mismatch | Normalise field name |
| H-3 | org-chart.js | Panel not closed on navigate | `destroy()` fix |
| H-4 | dashboard.js, kanban.js | Silently hanging spinners on error | Add error UI |
| H-5 | kanban.js | Agent filter key mismatch | Use same ID key |
| H-6 | dashboard.js | WS triggers 3 API calls each time | Debounce |
| H-7 | kanban.js | 3 WS events each cause full reload | Debounce + delta |
| H-8 | reports.js | Fake random chart data shown | Empty state instead |
| H-9 | app.js | `replace(' ', '-')` only first space | `replaceAll()` |
| M-8 | components.css | Kanban last column clipped | `padding-right: 16px` |
| M-9 | variables.css | Light theme missing accent overrides | Add CSS vars |

---

*Do not commit this file.*
