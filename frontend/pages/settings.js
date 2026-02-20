/* AgentBoard — Settings Page */

window.Pages = window.Pages || {};

Pages.settings = {
  async render(container) {
    container.innerHTML = `
      <div style="max-width:640px">
        <div class="settings-section">
          <div class="settings-section-title">Connection</div>
          <div id="settingsConnection">
            <div class="loading-state"><div class="spinner"></div><span>Checking...</span></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Branding</div>
          <div id="settingsBranding">
            <div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Agents</div>
          <div id="settingsAgents">
            <div class="loading-state"><div class="spinner"></div><span>Loading...</span></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">About</div>
          <div class="settings-row">
            <span class="settings-key">product</span>
            <span class="settings-value">AgentBoard</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">version</span>
            <span class="settings-value">2.0.0</span>
          </div>
          <div class="settings-row">
            <span class="settings-key">api_url</span>
            <span class="settings-value" style="font-family:var(--font-display);font-size:12px">${Utils.esc(window.AGENTBOARD_API || '(relative)')}</span>
          </div>
        </div>
      </div>`;

    // Run all loads in parallel
    Promise.all([
      this._loadConnection(),
      this._loadBranding(),
      this._loadAgents(),
    ]);
  },

  async _loadConnection() {
    try {
      const res = await fetch((window.AGENTBOARD_API || '') + '/health');
      const ok = res.ok;
      document.getElementById('settingsConnection').innerHTML = `
        <div class="settings-row">
          <span class="settings-key">backend</span>
          <span class="settings-value ${ok ? 'settings-value--ok' : 'settings-value--err'}">${ok ? '● Connected' : '● Error'}</span>
        </div>
        <div class="settings-row">
          <span class="settings-key">websocket</span>
          <span class="settings-value ${WS.isConnected() ? 'settings-value--ok' : 'settings-value--err'}">${WS.isConnected() ? '● Connected' : '● Disconnected'}</span>
        </div>`;
    } catch (e) {
      const el = document.getElementById('settingsConnection');
      if (el) el.innerHTML = `
        <div class="settings-row">
          <span class="settings-key">backend</span>
          <span class="settings-value settings-value--err">● Error: ${Utils.esc(e.message)}</span>
        </div>`;
    }
  },

  async _loadBranding() {
    const el = document.getElementById('settingsBranding');
    if (!el) return;
    try {
      const b = await API.getBranding();
      if (!b || Object.keys(b).length === 0) {
        el.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No branding configuration found in agents.yaml</div>`;
        return;
      }
      const rows = [
        ['team_name', b.team_name],
        ['accent_color', b.accent_color],
        ['theme', b.theme],
        ['logo_path', b.logo_path],
      ].filter(([, v]) => v !== undefined && v !== null && v !== '');

      if (rows.length === 0) {
        el.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No branding configuration set</div>`;
        return;
      }

      el.innerHTML = rows.map(([key, val]) => `
        <div class="settings-row">
          <span class="settings-key">${Utils.esc(key)}</span>
          <span class="settings-value" style="display:flex;align-items:center;gap:8px">
            ${key === 'accent_color' && val
              ? `<span style="width:14px;height:14px;border-radius:3px;background:${Utils.esc(val)};display:inline-block;flex-shrink:0"></span>`
              : ''}
            ${key === 'logo_path' && val
              ? `<img src="${Utils.esc(val)}" style="height:20px;width:auto;border-radius:3px;margin-right:4px" alt="logo">`
              : ''}
            <span style="font-family:var(--font-display);font-size:12px">${Utils.esc(String(val))}</span>
          </span>
        </div>`).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">Branding config unavailable (${Utils.esc(e.message)})</div>`;
    }
  },

  async _loadAgents() {
    try {
      const agents = await API.getAgents();
      const agentsEl = document.getElementById('settingsAgents');
      if (agentsEl) {
        if (agents.length === 0) {
          agentsEl.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No agents configured</div>`;
        } else {
          agentsEl.innerHTML = agents.map(a => `
            <div class="settings-row">
              <span class="settings-key" style="font-family:var(--font-body)">${Utils.esc(a.emoji || '🤖')} ${Utils.esc(a.name || a.id)}</span>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="settings-value" style="font-size:12px;color:var(--text-tertiary)">${Utils.esc(a.team || '')}</span>
                <span class="status-dot status-dot--${Utils.statusClass(a.status)}"></span>
              </div>
            </div>`).join('');
        }
      }
    } catch (e) {
      const el = document.getElementById('settingsAgents');
      if (el) el.innerHTML = `<div style="color:var(--status-error);font-size:13px;padding:8px 0">${Utils.esc(e.message)}</div>`;
    }
  },

  destroy() {}
};
