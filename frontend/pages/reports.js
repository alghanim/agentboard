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

        <!-- ═══ Token Usage & Cost Section ═══ -->
        <div class="token-section" id="tokenSection" style="margin-top:40px;">
          <div class="section-header">
            <span class="section-title">💰 Token Usage &amp; Cost</span>
          </div>

          <!-- Cost Summary Cards -->
          <div id="costSummaryCards" class="kpi-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 24px;">
            <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
            <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
            <div class="kpi-card"><div class="kpi-spinner"><div class="spinner"></div></div></div>
          </div>

          <!-- Token Timeline Chart -->
          <div class="chart-card" style="margin-bottom: 20px;">
            <div class="chart-card__title">Token Usage Timeline</div>
            <div id="chartTokenTimeline" class="chart-area" style="min-height:280px;"></div>
          </div>

          <!-- Bottom row: bars + donut -->
          <div class="token-bottom-grid" style="display:grid; grid-template-columns: 2fr 1fr; gap: 20px;">
            <div class="chart-card">
              <div class="chart-card__title">Cost per Agent</div>
              <div id="chartCostBars" class="chart-area" style="min-height:200px;"></div>
            </div>
            <div class="chart-card">
              <div class="chart-card__title">Tokens In / Out</div>
              <div id="chartTokenDonut" class="chart-area chart-area--donut" style="min-height:220px;"></div>
            </div>
          </div>
        </div>
      </div>`;

    // Responsive: token bottom grid stacks on narrow screens
    const mq = window.matchMedia('(max-width: 767px)');
    const applyMQ = (e) => {
      const g = document.querySelector('.token-bottom-grid');
      if (g) g.style.gridTemplateColumns = e.matches ? '1fr' : '2fr 1fr';
    };
    applyMQ(mq);
    mq.addEventListener('change', applyMQ);

    await this._loadAll();
  },

  async _loadAll() {
    await Promise.all([this._loadKPIs(), this._loadCharts(), this._loadTokenSection()]);
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

  /* ═══════════════════════════════════════════════════════
     TOKEN & COST ANALYTICS
  ═══════════════════════════════════════════════════════ */

  /* USD formatter */
  _fmtUSD(v) {
    if (v === 0) return '$0.00';
    if (v < 0.01) return '$' + v.toFixed(4);
    if (v < 1)   return '$' + v.toFixed(3);
    return '$' + v.toFixed(2);
  },

  /* Token count formatter: 1200 → "1.2K", 1200000 → "1.2M" */
  _fmtTokens(v) {
    if (v == null) return '0';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  },

  async _loadTokenSection() {
    // Load all three token endpoints in parallel
    const [tokenAgents, tokenTimeline, costSummary] = await Promise.all([
      apiFetch('/api/analytics/tokens').catch(() => null),
      apiFetch(`/api/analytics/tokens/timeline?days=${this._range}`).catch(() => null),
      apiFetch('/api/analytics/cost/summary').catch(() => null),
    ]);

    this._drawCostSummaryCards(costSummary);
    this._drawTokenTimeline(tokenTimeline);
    this._drawCostPerAgent(tokenAgents);
    this._drawTokenDonut(tokenAgents);
  },

  /* ─── Cost Summary Cards ─── */
  _drawCostSummaryCards(summary) {
    const el = document.getElementById('costSummaryCards');
    if (!el) return;

    const s = summary || {};
    const weekCost  = s.cost_this_week  ?? 0;
    const monthCost = s.cost_this_month ?? 0;
    const topAgent  = s.most_expensive_agent || '—';
    const topCost   = s.most_expensive_cost  ?? 0;

    el.innerHTML = `
      <div class="kpi-card" style="animation: fadeInKPI 200ms ease both;">
        <div class="kpi-label" style="font-size:12px;text-transform:uppercase;color:#6B7280;margin-bottom:8px;">This Week</div>
        <div class="kpi-number" style="color:#10B981;">${this._fmtUSD(weekCost)}</div>
      </div>
      <div class="kpi-card" style="animation: fadeInKPI 200ms ease 60ms both;">
        <div class="kpi-label" style="font-size:12px;text-transform:uppercase;color:#6B7280;margin-bottom:8px;">This Month</div>
        <div class="kpi-number" style="color:#10B981;">${this._fmtUSD(monthCost)}</div>
      </div>
      <div class="kpi-card" style="animation: fadeInKPI 200ms ease 120ms both;">
        <div class="kpi-label" style="font-size:12px;text-transform:uppercase;color:#6B7280;margin-bottom:8px;">Most Expensive Agent</div>
        <div class="kpi-number" style="font-size:18px;color:var(--text-primary);">🤖 ${Utils.esc(topAgent)}</div>
        <div style="color:#10B981;font-size:14px;margin-top:4px;font-weight:600;">${this._fmtUSD(topCost)}</div>
      </div>`;
  },

  /* ─── Token Usage Timeline — Stacked Area Chart ─── */
  _drawTokenTimeline(data) {
    const el = document.getElementById('chartTokenTimeline');
    if (!el) return;
    el.innerHTML = '';

    if (!data || !Array.isArray(data) || data.length === 0) {
      el.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text-tertiary)">No token data yet</div>';
      return;
    }

    const margin = { top: 20, right: 30, bottom: 30, left: 60 };
    const W = el.clientWidth || 700;
    const H = 280;
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const textSecondary = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#55556A';

    const parseDate = d3.timeParse('%Y-%m-%d');
    const parsed = data.map(d => ({
      date:      parseDate(d.date) || new Date(d.date),
      tokens_in:  +(d.tokens_in  || 0),
      tokens_out: +(d.tokens_out || 0),
      cost_usd:   +(d.cost_usd   || 0),
    }));

    // Stack: bottom = tokens_in, top = tokens_in + tokens_out
    parsed.forEach(d => { d._total = d.tokens_in + d.tokens_out; });

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const defs = svg.append('defs');

    // Gradient: tokens_in (blue)
    const gradIn = defs.append('linearGradient').attr('id', 'gradTokIn').attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');
    gradIn.append('stop').attr('offset','0%').attr('stop-color','#3B82F6').attr('stop-opacity', 0.35);
    gradIn.append('stop').attr('offset','100%').attr('stop-color','#3B82F6').attr('stop-opacity', 0.02);

    // Gradient: tokens_out (lime)
    const gradOut = defs.append('linearGradient').attr('id', 'gradTokOut').attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');
    gradOut.append('stop').attr('offset','0%').attr('stop-color','#B5CC18').attr('stop-opacity', 0.35);
    gradOut.append('stop').attr('offset','100%').attr('stop-color','#B5CC18').attr('stop-opacity', 0.02);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(parsed, d => d.date)).range([0, w]);
    const maxY = d3.max(parsed, d => d._total) * 1.15 || 100;
    const y = d3.scaleLinear().domain([0, maxY]).range([h, 0]);

    // Gridlines
    g.append('g').attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(''))
      .call(ax => { ax.select('.domain').remove(); ax.selectAll('line').attr('stroke','#1E1E2E').attr('stroke-dasharray','3,3'); });

    // Stacked area — tokens_in (bottom layer)
    const areaIn = d3.area()
      .x(d => x(d.date))
      .y0(h)
      .y1(d => y(d.tokens_in))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(parsed)
      .attr('fill', 'url(#gradTokIn)').attr('d', areaIn);
    g.append('path').datum(parsed)
      .attr('fill', 'none').attr('stroke', '#3B82F6').attr('stroke-width', 1.5)
      .attr('d', d3.line().x(d => x(d.date)).y(d => y(d.tokens_in)).curve(d3.curveMonotoneX));

    // Stacked area — tokens_out (top layer, from tokens_in upward)
    const areaOut = d3.area()
      .x(d => x(d.date))
      .y0(d => y(d.tokens_in))
      .y1(d => y(d._total))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(parsed)
      .attr('fill', 'url(#gradTokOut)').attr('d', areaOut);
    g.append('path').datum(parsed)
      .attr('fill', 'none').attr('stroke', '#B5CC18').attr('stroke-width', 1.5)
      .attr('d', d3.line().x(d => x(d.date)).y(d => y(d._total)).curve(d3.curveMonotoneX));

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(Math.min(parsed.length, 7)).tickFormat(d3.timeFormat('%b %d')))
      .call(ax => { ax.select('.domain').remove(); ax.selectAll('line').remove(); ax.selectAll('text').attr('fill', textSecondary).attr('font-size', '11px'); });

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(v => this._fmtTokens(v)))
      .call(ax => { ax.select('.domain').remove(); ax.selectAll('line').remove(); ax.selectAll('text').attr('fill', textSecondary).attr('font-size', '11px'); });

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${margin.left + w - 160}, ${margin.top})`);
    [['#3B82F6','Tokens In'],['#B5CC18','Tokens Out']].forEach(([color, label], i) => {
      const row = legend.append('g').attr('transform', `translate(${i * 100}, 0)`);
      row.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', color).attr('opacity', 0.8);
      row.append('text').attr('x', 14).attr('y', 9).attr('font-size', '11px').attr('fill', textSecondary).text(label);
    });

    // Tooltip
    const tooltip = d3.select(el).append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', '#1A1A2E')
      .style('border', '1px solid #2A2A3A')
      .style('border-radius', '12px')
      .style('padding', '12px')
      .style('font-size', '12px')
      .style('color', 'var(--text-primary)')
      .style('display', 'none')
      .style('z-index', '100');

    const crosshair = g.append('line')
      .attr('stroke', '#6B7280').attr('stroke-dasharray', '4,3').attr('stroke-width', 1)
      .attr('y1', 0).attr('y2', h).attr('display', 'none');

    // Invisible overlay for mouse events
    g.append('rect')
      .attr('width', w).attr('height', h)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event) => {
        const [mx] = d3.pointer(event);
        const bisect = d3.bisector(d => d.date).left;
        const x0 = x.invert(mx);
        const i  = bisect(parsed, x0, 1);
        const d0 = parsed[i - 1];
        const d1 = parsed[i] || d0;
        const d  = (d1 && (x0 - d0.date) > (d1.date - x0)) ? d1 : d0;
        if (!d) return;

        const px = x(d.date);
        crosshair.attr('x1', px).attr('x2', px).attr('display', null);

        const elRect = el.getBoundingClientRect();
        const svgRect = el.querySelector('svg').getBoundingClientRect();
        const tooltipX = event.clientX - elRect.left + 12;
        const tooltipY = event.clientY - elRect.top + 12;

        tooltip
          .style('left', tooltipX + 'px')
          .style('top',  tooltipY + 'px')
          .style('display', 'block')
          .html(`
            <div style="color:#9090A8;margin-bottom:6px;">${d3.timeFormat('%b %d, %Y')(d.date)}</div>
            <div>IN: &nbsp;<span style="color:#3B82F6;font-weight:600;">${d.tokens_in.toLocaleString()}</span> tokens</div>
            <div>OUT: <span style="color:#B5CC18;font-weight:600;">${d.tokens_out.toLocaleString()}</span> tokens</div>
            <div style="margin-top:4px;color:#10B981;">Cost: ${this._fmtUSD(d.cost_usd)}</div>
          `);
      })
      .on('mouseleave', () => {
        crosshair.attr('display', 'none');
        tooltip.style('display', 'none');
      });
  },

  /* ─── Cost per Agent — Horizontal Bar Chart ─── */
  _drawCostPerAgent(data) {
    const el = document.getElementById('chartCostBars');
    if (!el) return;
    el.innerHTML = '';

    if (!data || !Array.isArray(data) || data.length === 0) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No cost data yet</div>';
      return;
    }

    // Sort by cost desc, cap at 10
    const sorted = data.slice().sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0)).slice(0, 10);
    const maxCost = d3.max(sorted, d => d.cost_usd || 0);

    if (maxCost === 0) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No cost data yet</div>';
      return;
    }

    const ROW_H   = 36;
    const ROW_GAP = 8;
    const LABEL_W = 140;
    const VAL_W   = 70;
    const margin  = { top: 8, right: VAL_W + 8, bottom: 8, left: LABEL_W };
    const W       = el.clientWidth || 400;
    const H       = sorted.length * (ROW_H + ROW_GAP) + margin.top + margin.bottom;
    const barW    = W - margin.left - margin.right;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const x = d3.scaleLinear().domain([0, maxCost]).range([0, barW]);
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B5CC18';

    sorted.forEach((d, i) => {
      const rowY = margin.top + i * (ROW_H + ROW_GAP);
      const g = svg.append('g').attr('transform', `translate(0, ${rowY})`);

      // Agent name label (left)
      const displayName = (d.name || d.agent_id || 'Unknown').substring(0, 18);
      g.append('text')
        .attr('x', LABEL_W - 8).attr('y', ROW_H / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', '13px')
        .attr('fill', '#E5E7EB')
        .text(displayName);

      // Bar track (background)
      g.append('rect')
        .attr('x', LABEL_W).attr('y', 4)
        .attr('width', barW).attr('height', ROW_H - 8)
        .attr('rx', 4)
        .attr('fill', '#1E1E2E');

      // Bar fill (animated width)
      const barColor = typeof Utils !== 'undefined' && Utils.teamColor
        ? Utils.teamColor({ team: d.team || '', teamColor: d.teamColor || '' })
        : accentColor;

      const bar = g.append('rect')
        .attr('x', LABEL_W).attr('y', 4)
        .attr('width', 0).attr('height', ROW_H - 8)
        .attr('rx', 4)
        .attr('fill', barColor)
        .attr('opacity', 0.85);

      // Animate bar width
      bar.transition()
        .duration(400)
        .delay(i * 50)
        .attr('width', x(d.cost_usd || 0));

      // Cost label (right)
      g.append('text')
        .attr('x', LABEL_W + barW + 6).attr('y', ROW_H / 2 + 4)
        .attr('text-anchor', 'start')
        .attr('font-size', '13px')
        .attr('font-family', 'monospace')
        .attr('fill', '#10B981')
        .text(this._fmtUSD(d.cost_usd || 0));
    });
  },

  /* ─── Tokens In/Out Donut ─── */
  _drawTokenDonut(data) {
    const el = document.getElementById('chartTokenDonut');
    if (!el) return;
    el.innerHTML = '';

    const totalIn  = data && Array.isArray(data) ? d3.sum(data, d => d.tokens_in  || 0) : 0;
    const totalOut = data && Array.isArray(data) ? d3.sum(data, d => d.tokens_out || 0) : 0;
    const totalAll = totalIn + totalOut;

    if (totalAll === 0) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-tertiary)">No token data yet</div>';
      return;
    }

    const donutData = [
      { label: 'IN',  value: totalIn,  color: '#3B82F6' },
      { label: 'OUT', value: totalOut, color: '#B5CC18' },
    ];

    const W = el.clientWidth || 220;
    const H = 220;
    const radius    = Math.min(W, H) / 2 - 16;
    const innerRadius = radius - 30;

    const svg = d3.select(el).append('svg')
      .attr('width', '100%').attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const cx = W * 0.5;
    const cy = H * 0.5;
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    const pie = d3.pie().value(d => d.value).sort(null).padAngle(0.01);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcHover = d3.arc().innerRadius(innerRadius).outerRadius(radius * 1.04);

    // Tooltip (reuse style)
    const tooltip = d3.select(el).append('div')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', '#1A1A2E')
      .style('border', '1px solid #2A2A3A')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '12px')
      .style('color', 'var(--text-primary)')
      .style('display', 'none')
      .style('z-index', '100');

    const paths = g.selectAll('path').data(pie(donutData)).enter().append('path')
      .attr('fill', d => d.data.color)
      .attr('cursor', 'pointer');

    // Arc tween from 0
    paths.transition().duration(600).attrTween('d', function(d) {
      const i = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
      return t => arc(i(t));
    });

    paths
      .on('mouseenter', function(event, d) {
        d3.select(this).transition().duration(150).attr('d', arcHover);
        const pct = totalAll > 0 ? ((d.data.value / totalAll) * 100).toFixed(1) : 0;
        const elRect = el.getBoundingClientRect();
        tooltip
          .style('left', (event.clientX - elRect.left + 10) + 'px')
          .style('top',  (event.clientY - elRect.top  + 10) + 'px')
          .style('display', 'block')
          .html(`<span style="color:${d.data.color};font-weight:600;">${d.data.label}</span>: ${d.data.value.toLocaleString()} (${pct}%)`);
      })
      .on('mouseleave', function() {
        d3.select(this).transition().duration(150).attr('d', arc);
        tooltip.style('display', 'none');
      });

    // Center text
    const centerLabel = this._fmtTokens(totalAll);
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.15em')
      .attr('font-size', '18px').attr('font-weight', '700')
      .attr('fill', '#FFFFFF').text(centerLabel);
    g.append('text').attr('text-anchor', 'middle').attr('dy', '1.2em')
      .attr('font-size', '11px').attr('fill', '#6B7280').text('total tokens');

    // Segment labels (IN %, OUT %)
    donutData.forEach((d, i) => {
      const pct = totalAll > 0 ? ((d.value / totalAll) * 100).toFixed(0) : 0;
      const angle = (pie(donutData)[i].startAngle + pie(donutData)[i].endAngle) / 2;
      const labelR = radius + 18;
      const lx = Math.sin(angle) * labelR;
      const ly = -Math.cos(angle) * labelR;
      g.append('text').attr('x', lx).attr('y', ly)
        .attr('text-anchor', 'middle').attr('font-size', '11px').attr('fill', d.color)
        .text(`${d.label}: ${pct}%`);
    });
  },

  _exportCSV() {
    API.exportCSV();
  },

  destroy() {
    this._charts = [];
  }
};

/* Keyframe for card fade-in */
(function() {
  if (!document.getElementById('tokenAnimStyle')) {
    const s = document.createElement('style');
    s.id = 'tokenAnimStyle';
    s.textContent = `@keyframes fadeInKPI { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }`;
    document.head.appendChild(s);
  }
})();
