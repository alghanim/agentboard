/* AgentBoard — Kanban Board Page */

window.Pages = window.Pages || {};

Pages.kanban = {
  _tasks: {},
  _agents: [],
  _draggedTask: null,
  _draggedFrom: null,
  _filterAgent: '',
  _filterPriority: '',
  _filterTeam: '',
  _searchQuery: '',
  _wsHandlers: [],
  _escHandler: null,
  _drawerOpen: false,
  _currentDrawerTaskId: null,

  COLUMNS: [
    { id: 'backlog',  label: 'Backlog' },
    { id: 'todo',     label: 'To Do' },
    { id: 'progress', label: 'In Progress' },
    { id: 'review',   label: 'Review' },
    { id: 'done',     label: 'Done' },
  ],

  async render(container) {
    container.innerHTML = `
      <div class="kanban-filters">
        <div class="search-wrapper">
          <span class="search-icon">🔍</span>
          <input class="input" type="text" placeholder="Search tasks..." id="kanbanSearch"
            oninput="Pages.kanban._onSearch(this.value)">
        </div>
        <select class="select" id="kanbanFilterAgent" onchange="Pages.kanban._onFilter('agent', this.value)">
          <option value="">Agent ▾</option>
        </select>
        <select class="select" id="kanbanFilterPriority" onchange="Pages.kanban._onFilter('priority', this.value)">
          <option value="">Priority ▾</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select class="select" id="kanbanFilterTeam" onchange="Pages.kanban._onFilter('team', this.value)">
          <option value="">Team ▾</option>
        </select>
        <button class="btn-primary" onclick="Pages.kanban._newTask()" style="margin-left:auto">+ New Task</button>
      </div>

      <div class="kanban-board" id="kanbanBoard">
        ${this.COLUMNS.map(col => `
          <div class="kanban-column" id="col-${col.id}" data-status="${col.id}">
            <div class="kanban-column__header">
              <span class="kanban-column__title">${col.label}</span>
              <span class="kanban-column__count" id="count-${col.id}">0</span>
            </div>
            <div class="kanban-column__body" id="tasks-${col.id}"
              ondragover="Pages.kanban._onDragOver(event, '${col.id}')"
              ondragleave="Pages.kanban._onDragLeave(event)"
              ondrop="Pages.kanban._onDrop(event, '${col.id}')">
              <div class="loading-state"><div class="spinner"></div></div>
            </div>
          </div>`).join('')}
      </div>

      <!-- New Task Modal -->
      <div id="taskModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:300;align-items:center;justify-content:center">
        <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:12px;padding:24px;width:480px;max-width:95vw;max-height:85vh;overflow-y:auto">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <span style="font:600 var(--text-lg)/24px var(--font-body);color:var(--text-primary)">New Task</span>
            <button class="btn-icon" onclick="Pages.kanban._closeModal()">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div>
              <label style="font:500 var(--text-sm)/18px var(--font-body);color:var(--text-secondary);display:block;margin-bottom:6px">Title</label>
              <input class="input" id="newTaskTitle" placeholder="Task title..." style="width:100%">
            </div>
            <div>
              <label style="font:500 var(--text-sm)/18px var(--font-body);color:var(--text-secondary);display:block;margin-bottom:6px">Description</label>
              <textarea class="input" id="newTaskDesc" rows="3" placeholder="Description..."
                style="width:100%;height:auto;padding-top:8px;resize:vertical"></textarea>
              <span style="font-size:11px;color:var(--text-tertiary);margin-top:4px;display:block">Markdown supported</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="font:500 var(--text-sm)/18px var(--font-body);color:var(--text-secondary);display:block;margin-bottom:6px">Priority</label>
                <select class="select" id="newTaskPriority" style="width:100%">
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label style="font:500 var(--text-sm)/18px var(--font-body);color:var(--text-secondary);display:block;margin-bottom:6px">Status</label>
                <select class="select" id="newTaskStatus" style="width:100%">
                  ${this.COLUMNS.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
                </select>
              </div>
            </div>
            <div>
              <label style="font:500 var(--text-sm)/18px var(--font-body);color:var(--text-secondary);display:block;margin-bottom:6px">Assign to</label>
              <select class="select" id="newTaskAgent" style="width:100%">
                <option value="">Unassigned</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
              <button class="btn-secondary" onclick="Pages.kanban._closeModal()">Cancel</button>
              <button class="btn-primary" onclick="Pages.kanban._submitTask()">Create Task</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Task Detail Drawer -->
      <div id="taskDrawerOverlay" class="task-drawer-overlay" onclick="Pages.kanban._closeDrawer()"></div>
      <div id="taskDrawer" class="slide-panel task-drawer" role="dialog" aria-label="Task Detail">
        <div id="taskDrawerContent" class="task-drawer__content">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      </div>`;

    // ESC key to close drawer
    this._escHandler = (e) => {
      if (e.key === 'Escape') this._closeDrawer();
    };
    document.addEventListener('keydown', this._escHandler);

    await this._loadAll();

    // WS updates
    const taskHandler = () => this._loadTasks();
    WS.on('task_updated', taskHandler);
    WS.on('task_created', taskHandler);
    WS.on('task_deleted', taskHandler);
    this._wsHandlers.push(['task_updated', taskHandler], ['task_created', taskHandler], ['task_deleted', taskHandler]);
  },

  async _loadAll() {
    await Promise.all([this._loadAgents(), this._loadTasks()]);
  },

  async _loadAgents() {
    try {
      this._agents = await API.getAgents();
      const agentSel = document.getElementById('kanbanFilterAgent');
      const newTaskAgent = document.getElementById('newTaskAgent');
      const teamSel = document.getElementById('kanbanFilterTeam');

      const teams = new Set();

      this._agents.forEach(a => {
        const name = a.name || a.displayName || a.id;
        if (agentSel) {
          const opt = document.createElement('option');
          opt.value = a.id || name;
          opt.textContent = `${a.emoji || '🤖'} ${name}`;
          agentSel.appendChild(opt);
        }
        if (newTaskAgent) {
          const opt = document.createElement('option');
          opt.value = a.id || name;
          opt.textContent = `${a.emoji || '🤖'} ${name}`;
          newTaskAgent.appendChild(opt);
        }
        if (a.team) teams.add(a.team);
      });

      if (teamSel) {
        teams.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t;
          teamSel.appendChild(opt);
        });
      }
    } catch (_) {}
  },

  async _loadTasks() {
    try {
      const tasks = await API.getTasks();
      this._tasks = {};
      this.COLUMNS.forEach(c => { this._tasks[c.id] = []; });

      tasks.forEach(t => {
        const col = t.status || 'backlog';
        if (!this._tasks[col]) this._tasks[col] = [];
        this._tasks[col].push(t);
      });

      this._renderAll();
    } catch (e) {
      console.error('Kanban load error:', e);
    }
  },

  _renderAll() {
    this.COLUMNS.forEach(col => {
      this._renderColumn(col.id);
    });
  },

  _renderColumn(colId) {
    const body = document.getElementById(`tasks-${colId}`);
    const countEl = document.getElementById(`count-${colId}`);
    if (!body) return;

    let tasks = this._tasks[colId] || [];
    tasks = this._applyFilters(tasks);

    if (countEl) countEl.textContent = tasks.length;

    if (tasks.length === 0) {
      body.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-tertiary);font-size:12px">No tasks</div>`;
      return;
    }

    body.innerHTML = tasks.map(t => this._taskCardHTML(t)).join('');

    // Setup draggable + click
    body.querySelectorAll('.task-card').forEach(card => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => this._onDragStart(e, card.dataset.taskId, colId));
      card.addEventListener('dragend', () => this._onDragEnd());
      card.addEventListener('click', (e) => {
        // Don't open drawer if drag just happened
        if (!this._justDragged) {
          this._openDrawer(card.dataset.taskId);
        }
      });
    });
  },

  _applyFilters(tasks) {
    return tasks.filter(t => {
      if (this._searchQuery) {
        const q = this._searchQuery.toLowerCase();
        if (!(t.title || '').toLowerCase().includes(q) &&
            !(t.description || '').toLowerCase().includes(q)) return false;
      }
      if (this._filterAgent) {
        if ((t.assignee || t.assigned_to || t.assignedTo || '') !== this._filterAgent) return false;
      }
      if (this._filterPriority) {
        if ((t.priority || '').toLowerCase() !== this._filterPriority) return false;
      }
      // team filter: direct task.team or via assignee agent lookup
      if (this._filterTeam) {
        const taskTeam = (t.team || '').toLowerCase();
        if (taskTeam === this._filterTeam.toLowerCase()) return true;
        const assignee = t.assignee || t.assigned_to || t.assignedTo || '';
        const agent = this._agents.find(a => (a.id === assignee || a.name === assignee));
        if (!agent || (agent.team || '').toLowerCase() !== this._filterTeam.toLowerCase()) return false;
      }
      return true;
    });
  },

  _isInProgress(status) {
    return status === 'progress' || status === 'in-progress';
  },

  _taskCardHTML(t) {
    const priority = (t.priority || 'medium').toLowerCase();
    const assignee = t.assignee || t.assigned_to || t.assignedTo || '';
    const agent = this._agents.find(a => a.id === assignee || a.name === assignee);
    const emoji = agent ? (agent.emoji || '🤖') : null;
    const tags = t.labels ? (Array.isArray(t.labels) ? t.labels : [t.labels]) : [];
    const inProgress = this._isInProgress(t.status);

    const assigneeHTML = assignee
      ? `<span class="task-card__avatar" title="${Utils.esc(agent?.name || assignee)}">${Utils.esc(emoji || '👤')}</span><span>${Utils.esc(agent?.name || assignee)}</span>`
      : `<span class="task-card__unassigned">Unassigned</span>`;

    return `
      <div class="task-card" data-task-id="${Utils.esc(t.id)}" draggable="true">
        <div class="task-card__header-row">
          ${inProgress ? '<span class="task-card__progress-dot" title="In Progress"></span>' : ''}
          <div class="task-card__title">${Utils.esc(t.title || 'Untitled')}</div>
        </div>
        <div class="task-card__meta">
          ${assigneeHTML}
          ${priority ? `<span class="${Utils.priorityClass(priority)}">${Utils.capitalize(priority)}</span>` : ''}
          ${t.estimate ? `<span>⏱ ${Utils.esc(t.estimate)}</span>` : ''}
        </div>
        ${tags.length ? `<div class="task-card__tags">${tags.map(tag => `<span class="task-card__tag">#${Utils.esc(tag)}</span>`).join('')}</div>` : ''}
      </div>`;
  },

  /* ─── Task Detail Drawer ─── */
  async _openDrawer(taskId) {
    this._currentDrawerTaskId = taskId;
    this._drawerOpen = true;

    const drawer = document.getElementById('taskDrawer');
    const overlay = document.getElementById('taskDrawerOverlay');
    const content = document.getElementById('taskDrawerContent');

    if (!drawer) return;
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('visible');
    if (content) content.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>';

    // Find task in local state first
    let task = null;
    for (const col of this.COLUMNS) {
      const found = (this._tasks[col.id] || []).find(t => String(t.id) === String(taskId));
      if (found) { task = found; break; }
    }

    // Try to fetch full task with comments
    let comments = [];
    try {
      if (!task) task = await API.getTask(taskId);
    } catch (_) {}
    try {
      comments = await API.getComments(taskId);
    } catch (_) { comments = task?.comments || []; }

    if (!task) {
      if (content) content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Task not found</div></div>';
      return;
    }

    const assignee = task.assignee || task.assigned_to || task.assignedTo || '';
    const agent = this._agents.find(a => a.id === assignee || a.name === assignee);
    const colLabel = this.COLUMNS.find(c => c.id === task.status)?.label || task.status || '';
    const priority = (task.priority || 'medium').toLowerCase();

    if (content) {
      content.innerHTML = `
        <div class="slide-panel-header">
          <div style="flex:1;min-width:0">
            <div style="font:700 var(--text-xl)/28px var(--font-body);color:var(--text-primary);margin-bottom:4px">${Utils.esc(task.title || 'Untitled')}</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="badge badge--accent">${Utils.esc(colLabel)}</span>
              <span class="${Utils.priorityClass(priority)}" style="font-size:12px">${Utils.capitalize(priority)}</span>
            </div>
          </div>
          <button class="slide-panel-close" onclick="Pages.kanban._closeDrawer()">✕</button>
        </div>

        <!-- Meta -->
        <div class="drawer-meta">
          <div class="drawer-meta__row">
            <span class="drawer-meta__key">Assignee</span>
            <span class="drawer-meta__val">
              ${assignee
                ? `${Utils.esc(agent?.emoji || '👤')} ${Utils.esc(agent?.name || assignee)}`
                : '<span class="task-card__unassigned">Unassigned</span>'}
            </span>
          </div>
          ${task.team ? `<div class="drawer-meta__row"><span class="drawer-meta__key">Team</span><span class="drawer-meta__val">${Utils.esc(task.team)}</span></div>` : ''}
          ${task.created_at ? `<div class="drawer-meta__row"><span class="drawer-meta__key">Created</span><span class="drawer-meta__val">${Utils.absTime(task.created_at)}</span></div>` : ''}
          ${task.updated_at ? `<div class="drawer-meta__row"><span class="drawer-meta__key">Updated</span><span class="drawer-meta__val">${Utils.relTime(task.updated_at)}</span></div>` : ''}
        </div>

        <!-- Description -->
        ${task.description ? `
        <div class="drawer-section">
          <div class="drawer-section__title">Description</div>
          <div class="markdown-body" style="color:var(--text-secondary);font-size:var(--text-sm);line-height:20px">${DOMPurify.sanitize(marked.parse(task.description))}</div>
        </div>` : ''}

        <!-- Transition Status -->
        <div class="drawer-section">
          <div class="drawer-section__title">Move to</div>
          <div class="drawer-transitions">
            ${this.COLUMNS
              .filter(c => c.id !== task.status)
              .map(c => `<button class="btn-secondary drawer-transition-btn" onclick="Pages.kanban._drawerTransition(${JSON.stringify(String(task.id))}, ${JSON.stringify(c.id)})">${c.label}</button>`)
              .join('')}
          </div>
        </div>

        <!-- Comments -->
        <div class="drawer-section">
          <div class="drawer-section__title">Comments (${comments.length})</div>
          <div id="drawerComments">
            ${comments.length === 0
              ? '<div style="color:var(--text-tertiary);font-size:13px">No comments yet</div>'
              : comments.map(c => `
                <div class="drawer-comment">
                  <div class="drawer-comment__author">${Utils.esc(c.author || c.user || 'Unknown')}</div>
                  <div class="drawer-comment__text markdown-body">${DOMPurify.sanitize(marked.parse(c.text || c.body || c.content || ''))}</div>
                  <div class="drawer-comment__time">${Utils.relTime(c.created_at || c.timestamp)}</div>
                </div>`).join('')}
          </div>
          <!-- Add comment -->
          <div class="drawer-add-comment">
            <textarea class="input" id="drawerCommentInput" placeholder="Add a comment..." rows="2"
              style="width:100%;height:auto;padding-top:8px;resize:vertical;margin-bottom:8px"></textarea>
            <button class="btn-primary" onclick="Pages.kanban._submitComment(${JSON.stringify(String(task.id))})">Post Comment</button>
          </div>
        </div>`;
    }
  },

  _closeDrawer() {
    this._drawerOpen = false;
    this._currentDrawerTaskId = null;
    const drawer = document.getElementById('taskDrawer');
    const overlay = document.getElementById('taskDrawerOverlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  },

  async _drawerTransition(taskId, newStatus) {
    try {
      await API.transitionTask(taskId, newStatus);
      // Update local state
      for (const col of this.COLUMNS) {
        const idx = (this._tasks[col.id] || []).findIndex(t => String(t.id) === String(taskId));
        if (idx !== -1) {
          const [task] = this._tasks[col.id].splice(idx, 1);
          task.status = newStatus;
          if (!this._tasks[newStatus]) this._tasks[newStatus] = [];
          this._tasks[newStatus].push(task);
          break;
        }
      }
      this._renderAll();
      // Re-open drawer with updated task
      await this._openDrawer(taskId);
    } catch (e) {
      alert('Transition failed: ' + e.message);
    }
  },

  async _submitComment(taskId) {
    const input = document.getElementById('drawerCommentInput');
    const text = input?.value?.trim();
    if (!text) return;

    try {
      await API.addComment(taskId, text);
      if (input) input.value = '';
      await this._openDrawer(taskId);
    } catch (e) {
      alert('Failed to add comment: ' + e.message);
    }
  },

  /* ─── Drag & Drop ─── */
  _onDragStart(e, taskId, fromCol) {
    this._draggedTask = taskId;
    this._draggedFrom = fromCol;
    this._justDragged = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    setTimeout(() => e.target.classList.add('dragging'), 0);
  },

  _onDragEnd() {
    this._justDragged = true;
    setTimeout(() => { this._justDragged = false; }, 200);
    document.querySelectorAll('.task-card.dragging').forEach(c => c.classList.remove('dragging'));
    document.querySelectorAll('.kanban-column__body.drag-over').forEach(c => c.classList.remove('drag-over'));
    this._draggedTask = null;
    this._draggedFrom = null;
  },

  _onDragOver(e, colId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const body = document.getElementById(`tasks-${colId}`);
    if (body) body.classList.add('drag-over');
  },

  _onDragLeave(e) {
    const body = e.currentTarget;
    if (body) body.classList.remove('drag-over');
  },

  async _onDrop(e, toCol) {
    e.preventDefault();
    const body = document.getElementById(`tasks-${toCol}`);
    if (body) body.classList.remove('drag-over');

    const taskId = this._draggedTask;
    const fromCol = this._draggedFrom;
    if (!taskId || fromCol === toCol) return;

    try {
      // Optimistic update
      const fromList = this._tasks[fromCol] || [];
      const taskIdx = fromList.findIndex(t => String(t.id) === String(taskId));
      if (taskIdx === -1) return;

      const [task] = fromList.splice(taskIdx, 1);
      task.status = toCol;
      if (!this._tasks[toCol]) this._tasks[toCol] = [];
      this._tasks[toCol].push(task);
      this._renderAll();

      // API call
      await API.transitionTask(taskId, toCol);
    } catch (e) {
      console.error('Task transition failed:', e);
      await this._loadTasks(); // Revert
    }
  },

  /* ─── Filters ─── */
  _onSearch(val) {
    this._searchQuery = val;
    this._renderAll();
  },

  _onFilter(type, val) {
    if (type === 'agent') this._filterAgent = val;
    if (type === 'priority') this._filterPriority = val;
    if (type === 'team') this._filterTeam = val;
    this._renderAll();
  },

  /* ─── New Task Modal ─── */
  _newTask() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.style.display = 'flex';
  },

  _closeModal() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.style.display = 'none';
  },

  async _submitTask() {
    const title = document.getElementById('newTaskTitle')?.value?.trim();
    if (!title) { alert('Title is required'); return; }

    const data = {
      title,
      description: document.getElementById('newTaskDesc')?.value || '',
      priority: document.getElementById('newTaskPriority')?.value || 'medium',
      status: document.getElementById('newTaskStatus')?.value || 'todo',
      assignee: document.getElementById('newTaskAgent')?.value || null,
    };

    try {
      await API.createTask(data);
      this._closeModal();
      await this._loadTasks();

      // Reset form
      ['newTaskTitle', 'newTaskDesc'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    } catch (e) {
      alert('Failed to create task: ' + e.message);
    }
  },

  destroy() {
    this._wsHandlers.forEach(([ev, fn]) => WS.off(ev, fn));
    this._wsHandlers = [];
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    this._closeDrawer();
  }
};
