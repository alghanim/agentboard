/* AgentBoard — Global Search (Cmd+K) Modal */

window.Search = (function () {
  let _modal = null;
  let _input = null;
  let _results = null;
  let _debounceTimer = null;
  let _items = [];        // flat list of all result items for keyboard nav
  let _selectedIdx = -1;

  /* ─── Build DOM (once) ─── */
  function _build() {
    if (document.getElementById('searchModal')) return;

    const modal = document.createElement('div');
    modal.id = 'searchModal';
    modal.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'background:rgba(0,0,0,0.72)',
      'align-items:flex-start',
      'justify-content:center',
      'padding-top:80px',
    ].join(';');

    modal.innerHTML = `
      <div id="searchBox" style="
        background:var(--bg-secondary);
        border:1px solid var(--border-primary);
        border-radius:12px;
        width:600px;
        max-width:90vw;
        max-height:70vh;
        overflow:hidden;
        display:flex;
        flex-direction:column;
        box-shadow:0 24px 64px rgba(0,0,0,0.5);
      ">
        <div style="display:flex;align-items:center;padding:0 16px;border-bottom:1px solid var(--border-primary);">
          <span style="font-size:18px;margin-right:8px;opacity:0.5;">🔍</span>
          <input id="searchInput"
            placeholder="Search tasks, agents, comments…"
            autocomplete="off"
            spellcheck="false"
            style="
              flex:1;
              padding:16px 4px;
              font-size:16px;
              border:none;
              background:transparent;
              color:var(--text-primary);
              outline:none;
            ">
          <kbd style="
            font-size:11px;
            padding:2px 6px;
            border:1px solid var(--border-primary);
            border-radius:4px;
            color:var(--text-muted);
            background:var(--bg-tertiary,#0d0d1a);
            font-family:inherit;
          ">Esc</kbd>
        </div>
        <div id="searchResults" style="overflow-y:auto;padding:8px 0;flex:1;"></div>
        <div style="
          padding:8px 16px;
          font-size:11px;
          color:var(--text-muted);
          border-top:1px solid var(--border-subtle,var(--border-primary));
          display:flex;
          gap:16px;
          user-select:none;
        ">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Esc close</span>
          <span>⌘K toggle</span>
        </div>
      </div>`;

    document.body.appendChild(modal);

    _modal   = modal;
    _input   = document.getElementById('searchInput');
    _results = document.getElementById('searchResults');

    /* Close on backdrop click */
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    /* Input → debounced search */
    _input.addEventListener('input', () => {
      clearTimeout(_debounceTimer);
      const q = _input.value.trim();
      if (!q) { _renderEmpty(); return; }
      _debounceTimer = setTimeout(() => _doSearch(q), 300);
    });

    /* Keyboard navigation inside modal */
    _input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _move(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (_selectedIdx >= 0 && _items[_selectedIdx]) {
          _items[_selectedIdx].action();
          close();
        }
      }
    });

    _renderEmpty();
  }

  /* ─── Render States ─── */
  function _renderEmpty() {
    _items = [];
    _selectedIdx = -1;
    _results.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:14px;">
        Type to search tasks, agents, and comments…
      </div>`;
  }

  function _renderNoResults() {
    _items = [];
    _selectedIdx = -1;
    _results.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:14px;">
        No results found
      </div>`;
  }

  function _renderLoading() {
    _results.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:14px;">
        <div class="spinner" style="display:inline-block;margin-right:8px;"></div>Searching…
      </div>`;
  }

  /* ─── Search call ─── */
  async function _doSearch(q) {
    _renderLoading();
    try {
      const data = await API.search(q);
      _renderResults(data, q);
    } catch (err) {
      _results.innerHTML = `<div style="padding:20px;color:var(--status-error,#ef4444);">Search failed: ${Utils.esc(err.message)}</div>`;
    }
  }

  /* ─── Render grouped results ─── */
  function _renderResults(data, q) {
    const tasks    = (data.tasks    || []).slice(0, 10);
    const agents   = (data.agents   || []).slice(0, 6);
    const comments = (data.comments || []).slice(0, 6);

    const total = tasks.length + agents.length + comments.length;
    if (total === 0) { _renderNoResults(); return; }

    _items = [];
    _selectedIdx = -1;

    let html = '';

    /* ── Tasks section ── */
    if (tasks.length > 0) {
      html += _sectionHeader('Tasks', tasks.length);
      tasks.forEach(t => {
        const idx = _items.length;
        _items.push({ action: () => _openTask(t) });
        const status = t.meta || t.status || 'todo';
        const statusColor = {
          done: '#22C55E', 'in-progress': '#F59E0B', progress: '#F59E0B',
          todo: '#3B82F6', backlog: '#6B7280', review: '#8B5CF6',
        }[status] || '#6B7280';

        html += `<div class="search-item" data-idx="${idx}" onclick="Search._clickItem(${idx})" style="
          display:flex;align-items:center;gap:10px;
          padding:10px 16px;cursor:pointer;
          border-left:3px solid transparent;
          transition:background 100ms;
        ">
          <span style="font-size:16px;">📋</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${_highlight(Utils.esc(t.title || '(untitled)'), q)}
            </div>
            ${t.assignee ? `<div style="font-size:12px;color:var(--text-secondary);">Assigned to: ${Utils.esc(t.assignee)}</div>` : ''}
          </div>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${statusColor}22;color:${statusColor};white-space:nowrap;font-weight:600;">
            ${Utils.esc(status)}
          </span>
        </div>`;
      });
    }

    /* ── Agents section ── */
    if (agents.length > 0) {
      html += _sectionHeader('Agents', agents.length);
      agents.forEach(a => {
        const idx = _items.length;
        _items.push({ action: () => _openAgent(a) });
        const emoji = a.emoji || '🤖';
        const role  = a.role  || a.display_role || '';

        html += `<div class="search-item" data-idx="${idx}" onclick="Search._clickItem(${idx})" style="
          display:flex;align-items:center;gap:10px;
          padding:10px 16px;cursor:pointer;
          border-left:3px solid transparent;
          transition:background 100ms;
        ">
          <span style="font-size:20px;">${Utils.esc(emoji)}</span>
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:500;color:var(--text-primary);">
              ${_highlight(Utils.esc(a.name || a.id || ''), q)}
            </div>
            ${role ? `<div style="font-size:12px;color:var(--text-secondary);">${Utils.esc(role)}</div>` : ''}
          </div>
          <span style="font-size:11px;color:var(--text-muted);">Agent</span>
        </div>`;
      });
    }

    /* ── Comments section ── */
    if (comments.length > 0) {
      html += _sectionHeader('Comments', comments.length);
      comments.forEach(c => {
        const idx = _items.length;
        _items.push({ action: () => _openComment(c) });
        const excerpt = (c.content || c.text || '').substring(0, 120);
        const taskTitle = c.task_title || c.taskTitle || '';

        html += `<div class="search-item" data-idx="${idx}" onclick="Search._clickItem(${idx})" style="
          display:flex;align-items:flex-start;gap:10px;
          padding:10px 16px;cursor:pointer;
          border-left:3px solid transparent;
          transition:background 100ms;
        ">
          <span style="font-size:16px;margin-top:1px;">💬</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;color:var(--text-primary);line-height:1.4;word-break:break-word;">
              ${_highlight(Utils.esc(excerpt), q)}${excerpt.length >= 120 ? '…' : ''}
            </div>
            ${taskTitle ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">on: ${Utils.esc(taskTitle)}</div>` : ''}
          </div>
        </div>`;
      });
    }

    _results.innerHTML = html;
    _applySelection();
  }

  /* ─── Section header ─── */
  function _sectionHeader(label, count) {
    return `<div style="
      padding:6px 16px 4px;
      font-size:11px;
      font-weight:700;
      letter-spacing:0.08em;
      text-transform:uppercase;
      color:var(--text-muted);
      display:flex;
      justify-content:space-between;
    ">
      <span>${label}</span>
      <span style="font-weight:400;">${count}</span>
    </div>`;
  }

  /* ─── Highlight query match ─── */
  function _highlight(escaped, q) {
    if (!q) return escaped;
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(
      new RegExp(`(${safe})`, 'gi'),
      '<mark style="background:var(--accent,#B5CC18);color:#000;border-radius:2px;padding:0 1px;">$1</mark>'
    );
  }

  /* ─── Keyboard navigation ─── */
  function _move(dir) {
    const newIdx = Math.max(-1, Math.min(_items.length - 1, _selectedIdx + dir));
    _selectedIdx = newIdx;
    _applySelection();
    // scroll selected item into view
    const el = _results.querySelector(`[data-idx="${_selectedIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function _applySelection() {
    _results.querySelectorAll('.search-item').forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      const active = idx === _selectedIdx;
      el.style.background = active ? 'var(--accent-muted,rgba(181,204,24,0.12))' : '';
      el.style.borderLeftColor = active ? 'var(--accent,#B5CC18)' : 'transparent';
    });
  }

  /* ─── Item click (exposed globally for inline onclick) ─── */
  function _clickItem(idx) {
    if (_items[idx]) {
      _items[idx].action();
      close();
    }
  }

  /* ─── Navigation actions ─── */
  function _openTask(t) {
    // Navigate to kanban and open the task drawer
    App.navigate('kanban');
    // Give kanban a moment to render, then try to open drawer
    setTimeout(() => {
      if (window.Pages && Pages.kanban && Pages.kanban.openTask) {
        Pages.kanban.openTask(t.id || t.task_id);
      }
    }, 300);
  }

  function _openAgent(a) {
    const agentId = a.id || a.agent_id;
    App.navigate('agents');
    setTimeout(() => {
      if (window.Pages && Pages.agents && Pages.agents.openDetail) {
        Pages.agents.openDetail(agentId);
      }
    }, 300);
  }

  function _openComment(c) {
    const taskId = c.task_id || c.taskId;
    App.navigate('kanban');
    setTimeout(() => {
      if (taskId && window.Pages && Pages.kanban && Pages.kanban.openTask) {
        Pages.kanban.openTask(taskId);
      }
    }, 300);
  }

  /* ─── Public API ─── */
  function open() {
    _build();
    _modal.style.display = 'flex';
    _input.value = '';
    _renderEmpty();
    _input.focus();
  }

  function close() {
    if (_modal) _modal.style.display = 'none';
    clearTimeout(_debounceTimer);
  }

  function toggle() {
    if (!_modal || _modal.style.display === 'none') {
      open();
    } else {
      close();
    }
  }

  /* ─── Global Esc handler ─── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _modal && _modal.style.display !== 'none') {
      close();
    }
  });

  /* expose _clickItem for inline onclick */
  return { open, close, toggle, _clickItem };
})();
