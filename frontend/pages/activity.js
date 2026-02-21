/* AgentBoard — Activity Feed Page */

window.Pages = window.Pages || {};

Pages.activity = {
  _wsHandlers: [],
  _refreshTimer: null,
  _eventCount: 0,
  _lastMinuteEvents: [],
  _selectedAgent: '',
  _mode: 'global', // 'global' | 'agent'

  async render(container) {
    container.innerHTML = `
      <div class="activity-feed">
        <div class="live-indicator" id="liveIndicator">
          <div class="live-indicator__dot" id="liveDot"></div>
          <span class="live-indicator__label" id="liveLabel">LIVE</span>
          <span class="live-indicator__rate" id="liveRate">Connecting...</span>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
          <button class="btn-secondary" id="btnGlobal" onclick="Pages.activity._setMode('global')"
            style="background:var(--accent-muted);color:var(--accent);border-color:var(--accent)">Global</button>
          <button class="btn-secondary" id="btnAgent" onclick="Pages.activity._setMode('agent')">Per-Agent</button>
          <select class="select" id="agentFilter" style="display:none" onchange="Pages.activity._onAgentChange(this.value)">
            <option value="">Select agent...</option>
          </select>
        </div>

        <div id="activityFeedContent">
          <div class="loading-state"><div class="spinner"></div><span>Loading activity...</span></div>
        </div>
      </div>`;

    await this._loadAgentOptions();
    await this._renderFeed(document.getElementById('activityFeedContent'), null);

    // WS for live events
    const streamHandler = (data) => {
      this._onLiveEvent(data);
    };
    const connHandler = () => {
      document.getElementById('liveDot')?.classList.remove('live-indicator__dot--error');
      document.getElementById('liveLabel')?.classList.remove('live-indicator__label--error');
      if (document.getElementById('liveLabel')) document.getElementById('liveLabel').textContent = 'LIVE';
    };
    const disconnHandler = () => {
      document.getElementById('liveDot')?.classList.add('live-indicator__dot--error');
      document.getElementById('liveLabel')?.classList.add('live-indicator__label--error');
      if (document.getElementById('liveLabel')) document.getElementById('liveLabel').textContent = 'RECONNECTING...';
      if (document.getElementById('liveRate')) document.getElementById('liveRate').textContent = '';
    };

    WS.on('_any', streamHandler);
    WS.on('_connected', connHandler);
    WS.on('_disconnected', disconnHandler);
    this._wsHandlers.push(['_any', streamHandler], ['_connected', connHandler], ['_disconnected', disconnHandler]);

    if (WS.isConnected()) connHandler();
    else disconnHandler();

    // Rate counter
    this._refreshTimer = setInterval(() => this._updateRate(), 60000);
  },

  _setMode(mode) {
    this._mode = mode;
    const btnG = document.getElementById('btnGlobal');
    const btnA = document.getElementById('btnAgent');
    const sel = document.getElementById('agentFilter');

    const accent = 'background:var(--accent-muted);color:var(--accent);border-color:var(--accent)';
    const normal = '';

    if (mode === 'global') {
      if (btnG) btnG.setAttribute('style', accent);
      if (btnA) btnA.setAttribute('style', normal);
      if (sel) sel.style.display = 'none';
      this._selectedAgent = '';
      this._renderFeed(document.getElementById('activityFeedContent'), null);
    } else {
      if (btnG) btnG.setAttribute('style', normal);
      if (btnA) btnA.setAttribute('style', accent);
      if (sel) sel.style.display = '';
      if (this._selectedAgent) {
        this._renderFeed(document.getElementById('activityFeedContent'), this._selectedAgent);
      }
    }
  },

  _onAgentChange(val) {
    this._selectedAgent = val;
    if (val) this._renderFeed(document.getElementById('activityFeedContent'), val);
  },

  async _loadAgentOptions() {
    try {
      const agents = await API.getAgents();
      const sel = document.getElementById('agentFilter');
      if (!sel) return;
      agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id || a.name;
        opt.textContent = `${a.emoji || '🤖'} ${a.name || a.id}`;
        sel.appendChild(opt);
      });
    } catch (_) {}
  },

  // Render feed — can be called standalone for agent detail tab
  async _renderFeed(container, agentId) {
    if (!container) return;
    Utils.showLoading(container, 'Loading activity...');

    try {
      // Use openclaw stream for both global and per-agent (stream has richer data)
      let items;
      if (!agentId) {
        const stream = await API.getStream(50);
        items = stream.map(s => this._streamToItem(s));
      } else {
        // Use stream filtered by agent_id for per-agent view
        const stream = await API.getStreamFiltered(agentId, 50);
        items = stream.map(s => this._streamToItem(s));
      }

      if (items.length === 0) {
        Utils.showEmpty(container, '📡', 'No activity yet', 'Events will appear here as agents work');
        return;
      }

      container.innerHTML = items.map(item => this._itemHTML(item)).join('');
    } catch (e) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Failed to load activity</div><div class="empty-state-desc">${Utils.esc(e.message)}</div></div>`;
    }
  },

  _streamToItem(s) {
    return {
      emoji: s.emoji || '🤖',
      agentName: s.agent,
      type: s.type,
      content: s.content,
      toolName: s.toolName,
      timeStr: s.timeStr || Utils.relTime(s.timestamp ? new Date(s.timestamp).toISOString() : null),
      teamColor: s.teamColor
    };
  },

  _activityToItem(a) {
    return {
      emoji: '🤖',
      agentName: a.agent_id || a.agentId || 'system',
      type: a.action,
      content: a.details || a.action,
      timeStr: Utils.relTime(a.created_at || a.createdAt),
      teamColor: null
    };
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

  _itemHTML(item) {
    const typeLabel = this._typeLabel(item.type, item.toolName);
    const cleanContent = this._stripMarkdown(item.content);
    return `
      <div class="activity-item">
        <div class="activity-item__avatar">${Utils.esc(item.emoji)}</div>
        <div class="activity-item__body">
          <div class="activity-item__header">
            <span class="agent-name">${Utils.esc(item.agentName)}</span> ${typeLabel}
          </div>
          <div class="activity-item__detail">${Utils.esc(Utils.truncate(cleanContent, 120))}</div>
        </div>
        <div class="activity-item__time">${Utils.esc(item.timeStr || '')}</div>
      </div>`;
  },

  _typeLabel(type, toolName) {
    switch (type) {
      case 'command': return `ran <code style="font-family:var(--font-display);font-size:11px;background:var(--bg-tertiary);padding:1px 5px;border-radius:3px">${Utils.esc(toolName || 'tool')}</code>`;
      case 'response': return 'sent a response';
      case 'result': return 'received result';
      case 'prompt': return 'received prompt';
      case 'status_changed': return 'changed status';
      default: return type ? Utils.esc(type) : 'did something';
    }
  },

  _onLiveEvent(data) {
    // Track event rate
    this._lastMinuteEvents.push(Date.now());
    this._lastMinuteEvents = this._lastMinuteEvents.filter(t => Date.now() - t < 60000);

    const rate = this._lastMinuteEvents.length;
    const rateEl = document.getElementById('liveRate');
    if (rateEl) rateEl.textContent = `${rate} event${rate !== 1 ? 's' : ''}/min`;

    // Live prepend if global mode
    if (this._mode === 'global' && data.type && data.type !== '_connected' && data.type !== '_disconnected') {
      const feedEl = document.getElementById('activityFeedContent');
      if (!feedEl || feedEl.querySelector('.loading-state')) return;

      const item = this._streamToItem(data);
      const html = this._itemHTML(item);
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const node = tmp.firstElementChild;
      if (node) {
        feedEl.insertBefore(node, feedEl.firstChild);
        // Keep max 100 items
        const items = feedEl.querySelectorAll('.activity-item');
        if (items.length > 100) items[items.length - 1].remove();
      }
    }
  },

  _updateRate() {
    this._lastMinuteEvents = this._lastMinuteEvents.filter(t => Date.now() - t < 60000);
  },

  destroy() {
    this._wsHandlers.forEach(([ev, fn]) => WS.off(ev, fn));
    this._wsHandlers = [];
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }
};
