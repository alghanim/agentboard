/* AgentBoard — Reports / Analytics Page */

window.Pages = window.Pages || {};

Pages.reports = {
  _range: 7,
  _charts: [],

  async render(container) {
    container.innerHTML = `
      <div class="reports-page">
        <!-- Range Picker -->
        <div class="reports-toolbar">
          <div class="range-picker">
            <button class="range-btn active" data-days="7"  onclick="Pages.reports._setRange(7,this)">Last 7d</button>
            <button class="range-btn"        data-days="30" onclick="Pages.reports._setRange(30,this)">Last 30d</button>
            <button class="range-btn"        data-days="90" onclick="Pages.reports._setRange(90,this)">Last 90d</button>
          </div>
          <button class="btn-secondary" onclick="Pages.reports._exportCSV()">
            ↓ Export CSV
          </button>
        </div>

        <!-- KPI Cards -->
        <div class="kpi-grid" id="kpiGrid">
          <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
          <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
          <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
          <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
        </div>

        <!-- Charts -->
        <div class="charts-grid">
          <div class="chart-card chart-card--wide">
            <div class="chart-card__title">Task Throughput</div>
            <div id="chartThroughput" class="chart-area"></div>
          </div>
          <div class="chart-card">
            <div class="chart-card__title">Tasks per Agent</div>
            <div id="chartAgents" class="chart-area"></div>
          </div>
          <div class="chart-card">
            <div class="chart-card__title">Status Distribution</div>
            <div id="chartDonut" class="chart-area chart-area--donut"></div>
          </div>
        </div>
      </div>`;

    await this._loadAll();
  },

  async _loadAll() {
    await Promise.all([this._loadKPIs(), this._loadCharts()]);
  },

  async _setRange(days, btn) {
    this._range = days;
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    await this._loadAll();
  },

  /* ─── KPIs ─── */
  async _loadKPIs() {
    const grid = document.getElementById('kpiGrid');
    if (!grid) return;

    try {
      // Try analytics stats endpoint, fall back to tasks
      let stats = null;
      try {
        const params = { days: this._range };
        const qs = new URLSearchParams(params).toString();
        stats = await apiFetch('/api/analytics/overview?' + qs);
      } catch (_) {
        // fallback: compute from tasks
        const tasks = await API.getTasks();
        const now = Date.now();
        const weekMs = 7 * 24 * 3600 * 1000;
        const completed = tasks.filter(t =>
          t.status === 'done' &&
          t.updated_at && (now - new Date(t.updated_at).getTime()) < weekMs
        );
        const inProgress = tasks.filter(t => t.status === 'progress' || t.status === 'in-progress');
        const agents = await API.getAgents();
        const activeAgents = agents.filter(a => a.status === 'active' || a.status === 'online');

        // Avg completion time: dummy estimate
        let avgTime = 'N/A';
        if (completed.length > 0) {
          const totalMs = completed.reduce((sum, t) => {
            if (t.created_at && t.updated_at) {
              return sum + (new Date(t.updated_at) - new Date(t.created_at));
            }
            return sum;
          }, 0);
          const avgMs = totalMs / completed.length;
          const avgH = Math.round(avgMs / 3600000);
          avgTime = avgH < 24 ? `${avgH}h` : `${Math.round(avgH / 24)}d`;
        }

        stats = {
          total_tasks: tasks.length,
          completed_this_week: completed.length,
          avg_completion_time: avgTime,
          active_agents_today: activeAgents.length,
        };
      }

      grid.innerHTML = `
        <div class="kpi-card">
          <div class="kpi-number">${stats.total_tasks ?? '—'}</div>
          <div class="kpi-label">Total Tasks</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-number">${stats.completed_this_week ?? '—'}</div>
          <div class="kpi-label">Completed This Week</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-number">${stats.avg_completion_time ?? (stats.avg_completion_hours != null ? stats.avg_completion_hours + 'h' : '—')}</div>
          <div class="kpi-label">Avg Completion Time</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-number">${stats.active_agents_today ?? stats.agents_active_today ?? '—'}</div>
          <div class="kpi-label">Active Agents Today</div>
        </div>`;
    } catch (e) {
      grid.innerHTML = `<div style="color:var(--status-error);padding:16px;grid-column:1/-1">Failed to load KPIs: ${Utils.esc(e.message)}</div>`;
    }
  },

  /* ─── Charts ─── */
  async _loadCharts() {
    // Clear old charts
    this._charts = [];
    ['chartThroughput', 'chartAgents', 'chartDonut'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    });

    // Load all data in parallel, with graceful fallback
    const [throughputData, agentData, tasks] = await Promise.all([
      API.getAnalyticsThroughput({ days: this._range }).catch(() => null),
      API.getAnalyticsAgents({ days: this._range }).catch(() => null),
      API.getTasks().catch(() => []),
    ]);

    this._drawThroughput(throughputData);
    this._drawAgentBar(agentData, tasks);
    this._drawDonut(tasks);
  },

  /* ─── Throughput Line/Area Chart ─── */
  _drawThroughput(data) {
    const el = document.getElementById('chartThroughput');
    if (!el) return;
    el.innerHTML = '';

    // Show empty state if no data available
    if (!data || !Array.isArray(data) || data.length === 0) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No throughput data available</div>';
      return;
    }

    const margin = { top: 16, right: 16, bottom: 32, left: 40 };
    const W = el.clientWidth || 600;
    const H = 200;
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%')
      .attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const parseDate = d3.timeParse('%Y-%m-%d');
    const parsed = data.map(d => ({ date: parseDate(d.date) || new Date(d.date), count: +d.count }));

    const x = d3.scaleTime().domain(d3.extent(parsed, d => d.date)).range([0, w]);
    const y = d3.scaleLinear().domain([0, d3.max(parsed, d => d.count) * 1.2 || 10]).range([h, 0]);

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B5CC18';
    const textSecondary = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#55556A';

    // Gradient
    const gradId = 'throughputGrad';
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1', '0').attr('y1', '0').attr('x2', '0').attr('y2', '1');
    grad.append('stop').attr('offset', '0%').attr('stop-color', accentColor).attr('stop-opacity', 0.3);
    grad.append('stop').attr('offset', '100%').attr('stop-color', accentColor).attr('stop-opacity', 0.02);

    // Area
    const area = d3.area().x(d => x(d.date)).y0(h).y1(d => y(d.count)).curve(d3.curveMonotoneX);
    g.append('path').datum(parsed).attr('fill', `url(#${gradId})`).attr('d', area);

    // Line
    const line = d3.line().x(d => x(d.date)).y(d => y(d.count)).curve(d3.curveMonotoneX);
    g.append('path').datum(parsed).attr('fill', 'none').attr('stroke', accentColor)
      .attr('stroke-width', 2).attr('d', line);

    // Dots
    g.selectAll('circle').data(parsed).enter().append('circle')
      .attr('cx', d => x(d.date)).attr('cy', d => y(d.count))
      .attr('r', 3).attr('fill', accentColor);

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(Math.min(parsed.length, 7)).tickFormat(d3.timeFormat('%b %d')))
      .call(ax => { ax.select('.domain').remove(); ax.selectAll('line').remove(); ax.selectAll('text').attr('fill', textSecondary).attr('font-size', '11px'); });

    g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')))
      .call(ax => { ax.select('.domain').remove(); ax.selectAll('line').remove(); ax.selectAll('text').attr('fill', textSecondary).attr('font-size', '11px'); });
  },

  /* ─── Tasks per Agent Bar Chart ─── */
  _drawAgentBar(data, tasks) {
    const el = document.getElementById('chartAgents');
    if (!el) return;
    el.innerHTML = '';

    // Normalize API response: map all known shapes to {agent, count}
    if (Array.isArray(data) && data.length > 0) {
      data = data.map(d => ({
        agent: d.agent || d.display_name || d.id || 'Unknown',
        count: d.count ?? d.tasks_completed ?? d.value ?? 0,
      }));
    }

    // Compute from tasks if API data missing
    if (!data || !Array.isArray(data) || data.length === 0) {
      const counts = {};
      (tasks || []).forEach(t => {
        const a = t.assignee || t.assigned_to || t.assignedTo || 'Unassigned';
        counts[a] = (counts[a] || 0) + 1;
      });
      data = Object.entries(counts).map(([agent, count]) => ({ agent, count }));
      if (data.length === 0) data = [{ agent: 'No data', count: 0 }];
    }

    data = data.slice(0, 10); // max 10 bars

    // Guard: if all values are 0, show empty state instead of a collapsed/NaN chart
    const maxVal = d3.max(data, d => d.count || 0);
    if (maxVal === 0) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No data yet</div>';
      return;
    }

    const margin = { top: 16, right: 16, bottom: 64, left: 40 };
    const W = el.clientWidth || 320;
    const H = 220;
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B5CC18';
    const textSecondary = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#55556A';

    const x = d3.scaleBand().domain(data.map(d => d.agent)).range([0, w]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 1]).range([h, 0]);

    g.selectAll('rect').data(data).enter().append('rect')
      .attr('x', d => x(d.agent)).attr('y', d => y(d.count))
      .attr('width', x.bandwidth()).attr('height', d => h - y(d.count))
      .attr('fill', accentColor).attr('rx', 4).attr('opacity', 0.85);

    g.append('g').attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x))
      .call(ax => {
        ax.select('.domain').remove();
        ax.selectAll('line').remove();
        ax.selectAll('text')
          .attr('fill', textSecondary).attr('font-size', '11px')
          .attr('transform', 'rotate(-35)').style('text-anchor', 'end');
      });

    g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')))
      .call(ax => { ax.select('.domain').remove(); ax.selectAll('line').remove(); ax.selectAll('text').attr('fill', textSecondary).attr('font-size', '11px'); });
  },

  /* ─── Status Donut Chart ─── */
  _drawDonut(tasks) {
    const el = document.getElementById('chartDonut');
    if (!el) return;
    el.innerHTML = '';

    // Count by status
    const counts = {};
    (tasks || []).forEach(t => {
      const s = t.status || 'backlog';
      counts[s] = (counts[s] || 0) + 1;
    });
    const data = Object.entries(counts).map(([label, value]) => ({ label, value }));
    if (data.length === 0) { el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No tasks</div>'; return; }

    const STATUS_COLORS = {
      backlog: '#55556A', todo: '#3B82F6', progress: '#F59E0B',
      'in-progress': '#F59E0B', review: '#8B5CF6', done: '#22C55E',
    };

    const W = el.clientWidth || 280;
    const H = 220;
    const radius = Math.min(W, H) / 2 - 20;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g').attr('transform', `translate(${W * 0.45},${H / 2})`);

    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);

    const arcs = g.selectAll('path').data(pie(data)).enter().append('path')
      .attr('d', arc)
      .attr('fill', d => STATUS_COLORS[d.data.label] || '#8888A0')
      .attr('stroke', 'var(--bg-secondary)').attr('stroke-width', 2);

    // Center label
    const total = d3.sum(data, d => d.value);
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.1em')
      .attr('font-size', '22px').attr('font-weight', '700')
      .attr('fill', 'var(--text-primary)').text(total);
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.2em')
      .attr('font-size', '11px').attr('fill', 'var(--text-secondary)').text('total');

    // Legend (right side)
    const legend = svg.append('g').attr('transform', `translate(${W * 0.72}, ${H / 2 - data.length * 11})`);
    data.forEach((d, i) => {
      const row = legend.append('g').attr('transform', `translate(0, ${i * 22})`);
      row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2)
        .attr('y', 0).attr('fill', STATUS_COLORS[d.label] || '#8888A0');
      row.append('text').attr('x', 14).attr('y', 9)
        .attr('font-size', '11px').attr('fill', 'var(--text-secondary)')
        .text(`${d.label} (${d.value})`);
    });
  },

  _exportCSV() {
    API.exportCSV();
  },

  destroy() {
    this._charts = [];
  }
};
