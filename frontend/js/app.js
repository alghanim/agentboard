/* AgentBoard — Main App Controller */

/* ═══════════════════════════
   THEME MODULE
═══════════════════════════ */
window.Theme = (function () {
  const LS_KEY = 'agentboard-theme';

  function apply(theme) {
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  }

  function current() {
    return document.body.classList.contains('theme-light') ? 'light' : 'dark';
  }

  function toggle() {
    const next = current() === 'light' ? 'dark' : 'light';
    localStorage.setItem(LS_KEY, next);
    apply(next);
  }

  async function init() {
    // 1. localStorage takes priority
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      apply(stored);
      return;
    }
    // 2. fallback: server branding
    try {
      const branding = await API.getBranding();
      apply(branding.theme === 'light' ? 'light' : 'dark');
    } catch (_) {
      apply('dark'); // default dark
    }
  }

  return { init, apply, toggle, current };
})();

/* ═══════════════════════════
   BRANDING MODULE
═══════════════════════════ */
window.Branding = (function () {
  let _data = null;

  async function init() {
    try {
      _data = await API.getBranding();
      apply(_data);
    } catch (_) {
      // non-fatal: keep defaults
    }
  }

  function apply(b) {
    if (!b) return;
    // Document title
    if (b.team_name) document.title = b.team_name;
    // Sidebar title
    const titleEl = document.getElementById('sidebarTitle');
    if (titleEl && b.team_name) titleEl.textContent = b.team_name;
    // Sidebar logo
    const logoEl = document.getElementById('sidebarLogo');
    if (logoEl && b.logo_path) {
      logoEl.innerHTML = `<img src="${Utils.esc(b.logo_path)}" alt="logo"
        style="width:28px;height:28px;object-fit:contain;border-radius:4px">`;
    }
    // Accent color
    if (b.accent_color) {
      document.documentElement.style.setProperty('--accent', b.accent_color);
      // derive hover (+10% lightness) and muted (12% opacity) automatically
      document.documentElement.style.setProperty('--accent-hover', b.accent_color);
      document.documentElement.style.setProperty('--accent-muted', b.accent_color + '1F');
    }
  }

  function getData() { return _data; }

  return { init, getData };
})();

/* ═══════════════════════════
   MAIN APP
═══════════════════════════ */
(function () {
  let currentPage = null;
  let currentView = null;

  const PAGE_TITLES = {
    dashboard:  { title: '◉ Dashboard', icon: '◉' },
    agents:     { title: '👥 Agents', icon: '👥' },
    'org-chart': { title: '🗺️ Org Chart', icon: '🗺️' },
    kanban:     { title: '📋 Kanban', icon: '📋' },
    activity:   { title: '📡 Activity', icon: '📡' },
    reports:    { title: '📊 Reports', icon: '📊' },
    settings:   { title: '⚙️ Settings', icon: '⚙️' },
  };

  async function init() {
    // Init theme & branding in parallel
    await Promise.all([Theme.init(), Branding.init()]);

    // Sidebar toggle
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        // On mobile
        sidebar.classList.toggle('mobile-open');
        const overlay = document.getElementById('mobileOverlay');
        if (overlay) {
          overlay.classList.toggle('visible', sidebar.classList.contains('mobile-open'));
        }
      });
    }

    // Mobile overlay click to close
    const overlay = document.getElementById('mobileOverlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar?.classList.remove('mobile-open');
        overlay.classList.remove('visible');
      });
    }

    // Nav clicks
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(el.dataset.nav);
      });
    });

    // Hash-based routing
    window.addEventListener('hashchange', () => {
      const hash = location.hash.slice(1) || 'dashboard';
      routeTo(hash, false);
    });

    // Initial route
    const hash = location.hash.slice(1) || 'dashboard';
    routeTo(hash, false);
  }

  function navigate(path, updateHash = true) {
    if (updateHash) {
      location.hash = path;
    } else {
      routeTo(path, false);
    }
  }

  function routeTo(path, updateHash = true) {
    const [main, ...subParts] = path.split('/');
    const sub = subParts.join('/');

    if (updateHash) {
      history.replaceState(null, '', '#' + path);
    }

    const pageKey = main.toLowerCase().replace(' ', '-');

    // Update nav active state
    document.querySelectorAll('[data-nav]').forEach(el => {
      const navKey = el.dataset.nav.split('/')[0];
      el.classList.toggle('active', navKey === pageKey);
    });

    // Update header title
    const info = PAGE_TITLES[pageKey] || { title: pageKey };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = info.title;

    const breadEl = document.getElementById('pageBreadcrumb');
    if (breadEl) {
      if (sub) {
        breadEl.innerHTML = `<a onclick="App.navigate('${Utils.esc(pageKey)}')">${info.title}</a> <span>/</span> <span>${Utils.esc(sub)}</span>`;
        breadEl.style.display = '';
      } else {
        breadEl.innerHTML = '';
        breadEl.style.display = 'none';
      }
    }

    // Close mobile sidebar
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobileOverlay');
    if (sidebar && window.innerWidth <= 959) {
      sidebar.classList.remove('mobile-open');
      mobileOverlay?.classList.remove('visible');
    }

    renderPage(pageKey, sub);
    currentView = path;
  }

  async function renderPage(pageKey, sub) {
    const content = document.getElementById('content');
    if (!content) return;

    // Destroy previous page
    if (currentPage && currentPage.destroy) {
      try { currentPage.destroy(); } catch (_) {}
    }
    currentPage = null;

    let page = null;

    switch (pageKey) {
      case 'dashboard':  page = Pages.dashboard; break;
      case 'agents':     page = Pages.agents; break;
      case 'org-chart':  page = Pages.orgChart; break;
      case 'kanban':     page = Pages.kanban; break;
      case 'activity':   page = Pages.activity; break;
      case 'reports':    page = Pages.reports; break;
      case 'settings':   page = Pages.settings; break;
      default:
        content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">Page not found: ${Utils.esc(pageKey)}</div></div>`;
        return;
    }

    currentPage = page;
    content.innerHTML = '';

    try {
      await page.render(content, sub);
    } catch (e) {
      console.error('Page render error:', e);
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Error loading page</div><div class="empty-state-desc">${Utils.esc(e.message)}</div></div>`;
    }
  }

  // Expose globally
  window.App = { navigate, init };

  document.addEventListener('DOMContentLoaded', init);
})();
