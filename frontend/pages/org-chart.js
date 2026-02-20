/* AgentBoard — Org Chart Page (D3.js tree) */

window.Pages = window.Pages || {};

Pages.orgChart = {
  _wsHandlers: [],
  _agents: [],
  _hierarchy: null,
  _svg: null,
  _simulation: null,
  _hiddenTeams: new Set(),
  _slidePanel: null,
  _refreshTimer: null,

  async render(container) {
    container.innerHTML = `
      <div id="orgLegend" class="org-legend"></div>
      <div class="org-chart-container" id="orgChartSvgWrap"></div>

      <!-- Slide-in panel -->
      <div class="slide-panel" id="orgSlidePanel">
        <div class="slide-panel-header">
          <div id="orgPanelAgent"></div>
          <button class="slide-panel-close" onclick="Pages.orgChart._closePanel()">×</button>
        </div>
        <div class="tab-bar">
          <button class="tab active" data-tab="soul" onclick="Pages.orgChart._panelTab('soul')">Soul</button>
          <button class="tab" data-tab="activity" onclick="Pages.orgChart._panelTab('activity')">Activity</button>
        </div>
        <div id="orgPanelContent"></div>
      </div>
      <div id="orgPanelOverlay" style="display:none;position:fixed;inset:0;z-index:99"
        onclick="Pages.orgChart._closePanel()"></div>`;

    this._slidePanel = document.getElementById('orgSlidePanel');

    try {
      const [hierarchy, agents] = await Promise.all([
        API.getStructure(),
        API.getAgents()
      ]);
      this._hierarchy = hierarchy;
      this._agents = agents;
      this._buildLegend();
      this._renderTree();
    } catch (e) {
      document.getElementById('orgChartSvgWrap').innerHTML =
        `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load hierarchy</div><div class="empty-state-desc">${Utils.esc(e.message)}</div></div>`;
    }

    // Live status updates
    const handler = (agentList) => {
      if (Array.isArray(agentList)) {
        agentList.forEach(u => {
          const idx = this._agents.findIndex(a => a.id === u.id || a.name === u.name);
          if (idx >= 0) Object.assign(this._agents[idx], u);
        });
        this._updateNodeStatuses();
      }
    };
    WS.on('agent_status_update', handler);
    this._wsHandlers.push(['agent_status_update', handler]);

    this._refreshTimer = setInterval(async () => {
      try { this._agents = await API.getAgents(); this._updateNodeStatuses(); } catch (_) {}
    }, 30000);
  },

  _getAgentByNode(nodeData) {
    if (!nodeData) return null;
    const n = nodeData.name || nodeData.id;
    return this._agents.find(a => a.id === n || a.name === n || a.id === nodeData.id);
  },

  _buildLegend() {
    const legend = document.getElementById('orgLegend');
    if (!legend) return;

    const teams = new Map();
    this._agents.forEach(a => {
      if (a.team && !teams.has(a.team)) {
        teams.set(a.team, Utils.teamColor(a));
      }
    });

    legend.innerHTML = [...teams.entries()].map(([name, color]) => `
      <div class="org-legend-item" data-team="${Utils.esc(name)}" onclick="Pages.orgChart._toggleTeam('${Utils.esc(name)}')">
        <div class="org-legend-dot" style="background:${Utils.esc(color)}"></div>
        <span>${Utils.esc(name)}</span>
      </div>`).join('');
  },

  _toggleTeam(teamName) {
    if (this._hiddenTeams.has(teamName)) {
      this._hiddenTeams.delete(teamName);
    } else {
      this._hiddenTeams.add(teamName);
    }

    // Update legend dim state
    document.querySelectorAll('.org-legend-item').forEach(el => {
      el.classList.toggle('dimmed', this._hiddenTeams.has(el.dataset.team));
    });

    // Dim/show nodes
    if (this._svg) {
      this._svg.selectAll('.org-node-wrap').each(function (d) {
        const nodeData = d.data || d;
        const name = nodeData.name || nodeData.id || '';
        const agent = window.Pages.orgChart._agents.find(a => a.id === name || a.name === name);
        const team = agent?.team || nodeData.team || '';
        const dim = window.Pages.orgChart._hiddenTeams.has(team);
        d3.select(this).style('opacity', dim ? 0.25 : 1);
      });
    }
  },

  _renderTree() {
    if (!window.d3) {
      document.getElementById('orgChartSvgWrap').innerHTML =
        `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">D3.js not loaded</div><div class="empty-state-desc">Check CDN connectivity</div></div>`;
      return;
    }

    const wrap = document.getElementById('orgChartSvgWrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    const { width, height } = wrap.getBoundingClientRect();
    const W = width || 800;
    const H = height || 500;

    // Build d3 hierarchy from structure
    let rootData = this._hierarchy;
    if (!rootData) {
      Utils.showEmpty(wrap, '🌳', 'No hierarchy data', 'Check agents.yaml configuration');
      return;
    }

    // If the API returns an array, wrap it
    if (Array.isArray(rootData)) {
      rootData = { name: 'AgentBoard', id: 'root', children: rootData };
    } else if (!rootData.children && !rootData.name) {
      // Try to interpret object format
      rootData = { name: 'AgentBoard', id: 'root', children: Object.values(rootData) };
    }

    const root = d3.hierarchy(rootData);
    const treeLayout = d3.tree().nodeSize([200, 110]);
    treeLayout(root);

    // Extents
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    root.each(d => {
      if (d.x < x0) x0 = d.x;
      if (d.x > x1) x1 = d.x;
      if (d.y < y0) y0 = d.y;
      if (d.y > y1) y1 = d.y;
    });

    const svgEl = d3.select(wrap)
      .append('svg')
      .attr('width', W)
      .attr('height', H)
      .style('background', 'var(--bg-primary)');

    // Zoom + pan
    const g = svgEl.append('g');
    const zoom = d3.zoom()
      .scaleExtent([0.3, 2.0])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svgEl.call(zoom);

    // Initial centering
    const treeW = x1 - x0 + 200;
    const treeH = y1 - y0 + 110;
    const scale = Math.min(W / treeW, H / treeH, 1) * 0.9;
    const tx = W / 2 - ((x0 + x1) / 2) * scale;
    const ty = H / 2 - ((y0 + y1) / 2) * scale;
    svgEl.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    // Draw links
    g.selectAll('.org-link')
      .data(root.links())
      .enter()
      .append('path')
      .attr('class', 'org-link')
      .attr('fill', 'none')
      .attr('stroke', 'var(--border-subtle)')
      .attr('stroke-width', 1.5)
      .attr('d', d3.linkVertical().x(d => d.x).y(d => d.y));

    // Draw nodes via foreignObject
    const NODE_W = 180;
    const NODE_H = 72;

    const nodeGroup = g.selectAll('.org-node-wrap')
      .data(root.descendants())
      .enter()
      .append('foreignObject')
      .attr('class', 'org-node-wrap')
      .attr('x', d => d.x - NODE_W / 2)
      .attr('y', d => d.y - NODE_H / 2)
      .attr('width', NODE_W)
      .attr('height', NODE_H + 20)
      .style('overflow', 'visible');

    nodeGroup.append('xhtml:div')
      .attr('class', 'org-node')
      .style('width', NODE_W + 'px')
      .style('min-height', NODE_H + 'px')
      .html(d => this._nodeHTML(d.data))
      .on('click', (event, d) => {
        event.stopPropagation();
        this._openPanel(d.data);
      });

    this._svg = g;
    this._svgRoot = svgEl;

    // Animated link draw
    g.selectAll('.org-link').each(function () {
      const length = this.getTotalLength ? this.getTotalLength() : 100;
      d3.select(this)
        .attr('stroke-dasharray', length + ' ' + length)
        .attr('stroke-dashoffset', length)
        .transition()
        .duration(600)
        .ease(d3.easeLinear)
        .attr('stroke-dashoffset', 0);
    });
  },

  _nodeHTML(nodeData) {
    const agent = this._getAgentByNode(nodeData);
    const name = agent ? (agent.name || agent.displayName || nodeData.name) : (nodeData.name || nodeData.id || '?');
    const emoji = agent?.emoji || nodeData.emoji || '🤖';
    const role = agent?.role || nodeData.role || '';
    const model = agent?.currentModel || nodeData.model || '';
    const status = agent?.status || 'offline';
    const statusCls = Utils.statusClass(status);
    const teamColor = agent ? Utils.teamColor(agent) : (nodeData.teamColor || '#55556A');

    return `
      <div style="width:180px;min-height:64px;background:var(--bg-secondary);border:1.5px solid ${teamColor}40;border-left:3px solid ${teamColor};border-radius:10px;padding:10px 12px;cursor:pointer;position:relative;box-sizing:border-box;transition:border-color 0.15s,box-shadow 0.15s"
        onmouseover="this.style.borderColor='${teamColor}';this.style.boxShadow='0 0 16px rgba(181,204,24,0.15)'"
        onmouseout="this.style.borderColor='${teamColor}40';this.style.boxShadow='none';this.style.borderLeftColor='${teamColor}'">
        <div class="org-node-status-dot" style="position:absolute;top:10px;right:10px;width:8px;height:8px;border-radius:50%;background:var(--status-${statusCls})"></div>
        <div style="font:600 14px/18px var(--font-body);color:var(--text-primary);padding-right:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${Utils.esc(emoji)} ${Utils.esc(name)}
        </div>
        ${role ? `<div style="font:400 12px/16px var(--font-body);color:var(--text-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.esc(role)}</div>` : ''}
        ${model ? `<div style="font:400 11px/14px var(--font-display);color:var(--text-tertiary);margin-top:4px">${Utils.esc(Utils.truncate(model, 20))}</div>` : ''}
      </div>`;
  },

  _updateNodeStatuses() {
    // Update status dots only — simple DOM manipulation
    if (!this._svg) return;
    const self = this;
    this._svg.selectAll('.org-node-wrap').each(function (d) {
      if (!d || !d.data) return;
      const agent = self._getAgentByNode(d.data);
      if (!agent) return;
      const statusCls = Utils.statusClass(agent.status);
      const dotEl = this.querySelector('.org-node-status-dot');
      if (dotEl) {
        dotEl.style.background = `var(--status-${statusCls})`;
      }
    });
  },

  _openPanel(nodeData) {
    const agent = this._getAgentByNode(nodeData);
    const name = agent?.name || nodeData.name || nodeData.id || '?';
    const emoji = agent?.emoji || nodeData.emoji || '🤖';
    const role = agent?.role || nodeData.role || '';
    const status = agent?.status || 'offline';
    const statusCls = Utils.statusClass(status);
    const agentId = agent?.id || nodeData.id || name;

    const headerEl = document.getElementById('orgPanelAgent');
    if (headerEl) {
      headerEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:24px">${Utils.esc(emoji)}</span>
          <div>
            <div style="font:600 var(--text-lg)/24px var(--font-body);color:var(--text-primary)">${Utils.esc(name)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              <span class="status-dot status-dot--${statusCls}"></span>
              <span style="font:400 var(--text-sm)/18px var(--font-body);color:var(--text-secondary)">${Utils.esc(role)}</span>
            </div>
          </div>
        </div>`;
    }

    // Store current agent for tab switching
    this._panelAgentId = agentId;
    this._panelTab('soul');

    this._slidePanel.classList.add('open');
    const overlay = document.getElementById('orgPanelOverlay');
    if (overlay) overlay.style.display = 'block';
  },

  async _panelTab(tab) {
    document.querySelectorAll('#orgSlidePanel .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    const content = document.getElementById('orgPanelContent');
    if (!content) return;

    if (tab === 'activity') {
      Pages.activity._renderFeed(content, this._panelAgentId);
      return;
    }

    // Soul tab
    Utils.showLoading(content, 'Loading...');
    try {
      const soul = await API.getAgentSoul(this._panelAgentId);
      if (soul.soul) {
        content.innerHTML = `<div class="markdown-body" style="font-size:13px">${DOMPurify.sanitize(marked.parse(soul.soul.content || ''))}</div>`;
      } else {
        const err = soul.errors?.['SOUL.md'] || 'File not found';
        Utils.showEmpty(content, '📄', 'Soul not available', err);
      }
    } catch (e) {
      Utils.showEmpty(content, '⚠️', 'Error', e.message);
    }
  },

  _closePanel() {
    this._slidePanel.classList.remove('open');
    const overlay = document.getElementById('orgPanelOverlay');
    if (overlay) overlay.style.display = 'none';
  },

  destroy() {
    if (this._slidePanel) this._closePanel();
    this._wsHandlers.forEach(([ev, fn]) => WS.off(ev, fn));
    this._wsHandlers = [];
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }
};
