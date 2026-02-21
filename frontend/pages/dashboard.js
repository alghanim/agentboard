/* AgentBoard — Dashboard Page */

window.Pages = window.Pages || {};

Pages.dashboard = {
  _wsHandlers: [],
  _refreshTimer: null,

  async render(container) {
    container.innerHTML = `
      <div class="stats-grid" id="statsGrid">
        ${[...Array(4)].map(() => `<div class="stat-card"><div class="stat-number">—</div><div class="stat-label">Loading</div></div>`).join('')}
      </div>
      <div class="dashboard-grid">
        <div class="card">
          <div class="section-header">
            <div class="section-title">Recent Activity</div>
            <button class="section-link" onclick="App.navigate('activity')">View all →</button>
          </div>
          <div class="activity-feed" id="dashActivityFeed">
            <div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>
          </div>
        </div>
        <div class="card">
          <div class="section-header">
            <div class="section-title">Agents by Status</div>
            <button class="section-link" onclick="App.navigate('agents')">View all →</button>
          </div>
          <div id="dashAgentList">
            <div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>
          </div>
        </div>
      </div>`;

    await this._load();

    // Real-time update via WS
    const handler = () => this._load();
    WS.on('agent_status_update', handler);
    this._wsHandlers.push(['agent_status_update', handler]);

    // Auto-refresh every 30s
    this._refreshTimer = setInterval(() => this._load(), 30000);
  },

  async _load() {
    try {
      const [stats, agents, stream, stuckTasks] = await Promise.all([
        API.getStats(),
        API.getAgents(),
        API.getStream(10),
        API.getStuckTasks().catch(() => []),
      ]);
      this._renderStats(stats, agents, stuckTasks);
      this._renderAgents(agents);
      this._renderActivity(stream);
    } catch (e) {
      console.error('Dashboard load error:', e);
    }
  },

  _renderStats(stats, agents, stuckTasks) {
    const grid = document.getElementById('statsGrid');
    if (!grid) return;

    const activeCount = agents.filter(a => a.status === 'active').length;
    const stuckCount = Array.isArray(stuckTasks) ? stuckTasks.length : 0;

    const items = [
      { num: stats.totalAgents || agents.length, label: 'Agents', style: '' },
      { num: activeCount, label: 'Online Now', style: '' },
      { num: stats.idleAgents || 0, label: 'Idle', style: '' },
      { num: stats.offlineAgents || 0, label: 'Offline', style: '' },
    ];

    const stuckCard = stuckCount > 0
      ? `<div class="stat-card" style="border-color:#F59E0B">
          <div class="stat-number" style="color:#F59E0B">⚠️ ${stuckCount}</div>
          <div class="stat-label" style="color:#F59E0B">Stuck Tasks</div>
        </div>`
      : `<div class="stat-card" style="opacity:0.5">
          <div class="stat-number" style="color:var(--text-tertiary)">✓</div>
          <div class="stat-label" style="color:var(--text-tertiary)">All Clear</div>
        </div>`;

    grid.innerHTML = items.map(({ num, label }) => `
      <div class="stat-card">
        <div class="stat-number">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`).join('') + stuckCard;
  },

  _renderAgents(agents) {
    const el = document.getElementById('dashAgentList');
    if (!el) return;

    if (!agents || agents.length === 0) {
      el.innerHTML = '<div class="empty-state-desc" style="padding:16px;color:var(--text-tertiary)">No agents configured</div>';
      return;
    }

    const sorted = [...agents].sort((a, b) => {
      const order = { active: 0, idle: 1, offline: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });

    el.innerHTML = `<div class="mini-agent-list">
      ${sorted.slice(0, 12).map(a => `
        <div class="mini-agent-item" style="cursor:pointer" onclick="App.navigate('agents/${Utils.esc(a.id || a.name)}')">
          <span class="mini-agent-emoji">${Utils.esc(a.emoji || '🤖')}</span>
          <span class="mini-agent-name">${Utils.esc(a.name || a.displayName || a.id)}</span>
          <span class="mini-agent-status-label">${Utils.statusLabel(a.status)}</span>
          <span class="status-dot status-dot--${Utils.statusClass(a.status)}"></span>
        </div>`).join('')}
    </div>`;
  },

  _stripMarkdown(text) {
    return (text || '')
      .replace(/#{1,6}\s*/g, '')
      .replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1')
      .replace(/_{1,3}([^_]*)_{1,3}/g, '$1')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  _renderActivity(stream) {
    const el = document.getElementById('dashActivityFeed');
    if (!el) return;

    if (!stream || stream.length === 0) {
      el.innerHTML = '<div class="empty-state-desc" style="padding:16px;color:var(--text-tertiary)">No recent activity</div>';
      return;
    }

    el.innerHTML = stream.slice(0, 10).map(item => {
      const typeLabel = item.type === 'command' ? `ran <code>${Utils.esc(item.toolName)}</code>`
        : item.type === 'response' ? 'sent a response'
        : item.type === 'result' ? 'got a result'
        : Utils.esc(item.type ?? 'unknown');
      const cleanContent = this._stripMarkdown(item.content);
      return `
        <div class="activity-item activity-item--compact">
          <div class="activity-item__avatar">${Utils.esc(item.emoji || '🤖')}</div>
          <div class="activity-item__body">
            <div class="activity-item__header">
              <span class="agent-name">${Utils.esc(item.agent)}</span> ${typeLabel}
            </div>
            <div class="activity-item__detail">${Utils.esc(Utils.truncate(cleanContent, 80))}</div>
          </div>
          <div class="activity-item__time">${Utils.esc(item.timeStr || Utils.relTime(item.timestamp))}</div>
        </div>`;
    }).join('');
  },

  destroy() {
    this._wsHandlers.forEach(([ev, fn]) => WS.off(ev, fn));
    this._wsHandlers = [];
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }
};
