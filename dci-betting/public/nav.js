// Global Navigation Component
// Handles authentication state and UI across all pages

class NavigationManager {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  async init() {
    // Check if user is logged in
    this.currentUser = await api.verifySession();

    // If logged in, fetch their leagues to build the correct draft link
    if (this.currentUser) {
      try {
        const data = await fetch('/api/leagues/my', { credentials: 'include' }).then(r => r.json());
        this.userLeagueId = (data.leagues && data.leagues.length > 0) ? data.leagues[0].id : null;
      } catch (_) {
        this.userLeagueId = null;
      }
    }

    this.injectPortraitOverlay();
    this.renderNavigation();
    this.setupEventListeners();
  }

  // Inject portrait-lock overlay once per page load
  injectPortraitOverlay() {
    if (document.getElementById('rotateOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'rotateOverlay';
    overlay.className = 'rotate-overlay';
    overlay.innerHTML = `
      <span class="rotate-overlay-icon">↺</span>
      <p>Please rotate your device to portrait mode for the best experience.</p>
    `;
    document.body.appendChild(overlay);
  }

  renderNavigation() {
    const header = document.querySelector('.header');
    if (!header) return;

    const headerContent = header.querySelector('.header-content');
    if (!headerContent) return;

    // Remove existing auth section if present (re-render case)
    const existingAuth = header.querySelector('.auth-section');
    if (existingAuth) existingAuth.remove();

    const authSection = document.createElement('div');
    authSection.className = 'auth-section';

    const leagueHref = this.userLeagueId ? `/league/${this.userLeagueId}` : '/app';
    const isAppPage = window.location.pathname === '/app';
    const isScoresPage = window.location.pathname === '/scores';
    const isHowToPlay = window.location.pathname === '/how-to-play';
    const isContact = window.location.pathname === '/contact';
    const isDraftPage = window.location.pathname.startsWith('/league/');

    if (this.currentUser) {
      // Desktop nav
      const appNav = document.createElement('nav');
      appNav.className = 'main-nav global-nav';

      if (isAppPage) {
        appNav.innerHTML = `
          <button class="nav-item active" id="gNavDraft" onclick="globalNavClick(this,'draft')">Draft</button>
          <button class="nav-item" id="gNavMyTeam" onclick="globalNavClick(this,'myTeam')">My Team</button>
          <button class="nav-item" id="gNavTrade" onclick="globalNavClick(this,'trade')">Trade</button>
          <button class="nav-item" id="gNavStandings" onclick="globalNavClick(this,'standings')">Standings</button>
          <a href="/scores" class="nav-item">Scores</a>
          <a href="/how-to-play" class="nav-item">How To Play</a>
          <a href="/contact" class="nav-item">Contact Us</a>
        `;
      } else {
        appNav.innerHTML = `
          <a href="${leagueHref}" class="nav-item${isDraftPage ? ' active' : ''}">My League</a>
          <a href="/app?view=myTeam" class="nav-item">My Team</a>
          <a href="/app?view=trade" class="nav-item">Trade</a>
          <a href="/app?view=standings" class="nav-item">Standings</a>
          <a href="/scores" class="nav-item${isScoresPage ? ' active' : ''}">Scores</a>
          <a href="/how-to-play" class="nav-item${isHowToPlay ? ' active' : ''}">How To Play</a>
          <a href="/contact" class="nav-item${isContact ? ' active' : ''}">Contact Us</a>
        `;
      }
      headerContent.appendChild(appNav);

      // Avatar
      const avatarUrl = (this.currentUser.profile_picture_url && this.currentUser.profile_picture_url !== '/default-avatar.png')
        ? this.currentUser.profile_picture_url
        : generateDefaultAvatar(this.currentUser.username, 64);

      authSection.innerHTML = `
        <div class="user-profile-dropdown">
          <button class="profile-toggle" id="profileToggle">
            <img src="${avatarUrl}" alt="Profile" class="profile-avatar">
            <span class="profile-email">${this.currentUser.username}</span>
            <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
          <div class="profile-dropdown-menu" id="profileDropdown">
            ${this.currentUser.is_admin ? `
            <a href="/admin" class="dropdown-item dropdown-item--admin">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
              </svg>
              Admin Panel
            </a>
            ` : ''}
            <a href="/settings" class="dropdown-item">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
                <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z"/>
              </svg>
              Account Settings
            </a>
            <button class="dropdown-item" id="logoutBtn">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0v2z"/>
                <path fill-rule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"/>
              </svg>
              Logout
            </button>
          </div>
        </div>
        <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
      `;

      // Mobile drawer — always use plain links (works on all pages)
      this._buildMobileDrawer(`
        <a href="${leagueHref}" class="nav-item${isDraftPage ? ' active' : ''}">My League</a>
        <a href="/app?view=myTeam" class="nav-item">My Team</a>
        <a href="/app?view=trade" class="nav-item">Trade</a>
        <a href="/app?view=standings" class="nav-item">Standings</a>
        <a href="/scores" class="nav-item${isScoresPage ? ' active' : ''}">Scores</a>
        <a href="/how-to-play" class="nav-item${isHowToPlay ? ' active' : ''}">How To Play</a>
        <a href="/contact" class="nav-item${isContact ? ' active' : ''}">Contact Us</a>
        <div class="mobile-nav-drawer-divider"></div>
        <a href="/settings" class="nav-item">Account Settings</a>
        <button class="nav-item" id="mobileLogoutBtn" style="text-align:left;background:none;border:none;font-family:inherit;cursor:pointer;width:100%;color:inherit;">Logout</button>
      `);

    } else {
      // Guest nav
      const guestNav = document.createElement('nav');
      guestNav.className = 'main-nav global-nav';
      guestNav.innerHTML = `<a href="/contact" class="nav-item${isContact ? ' active' : ''}">Contact Us</a>`;
      headerContent.appendChild(guestNav);

      authSection.innerHTML = `
        <a href="/auth" class="btn btn-primary">Login</a>
        <button class="hamburger-btn" id="hamburgerBtn" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
      `;

      this._buildMobileDrawer(`
        <a href="/contact" class="nav-item${isContact ? ' active' : ''}">Contact Us</a>
        <div class="mobile-nav-drawer-divider"></div>
        <a href="/auth" class="nav-item">Login</a>
        <a href="/auth?mode=register" class="nav-item">Sign Up</a>
      `);
    }

    headerContent.appendChild(authSection);
  }

  _buildMobileDrawer(linksHTML) {
    let drawer = document.getElementById('mobileNavDrawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'mobileNavDrawer';
      drawer.className = 'mobile-nav-drawer';
      document.body.appendChild(drawer);
    }
    drawer.innerHTML = `
      <button class="mobile-nav-close" id="mobileNavClose" aria-label="Close menu">&#x2715;</button>
      ${linksHTML}
    `;
  }

  _closeDrawer() {
    const drawer = document.getElementById('mobileNavDrawer');
    const hamburger = document.getElementById('hamburgerBtn');
    if (drawer) drawer.classList.remove('open');
    if (hamburger) hamburger.classList.remove('open');
    document.body.style.overflow = '';
  }

  setupEventListeners() {
    // Profile dropdown toggle
    const profileToggle = document.getElementById('profileToggle');
    const profileDropdown = document.getElementById('profileDropdown');

    if (profileToggle && profileDropdown) {
      profileToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('show');
      });

      document.addEventListener('click', () => {
        profileDropdown.classList.remove('show');
      });
    }

    // Desktop logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await api.logout();
          window.location.href = '/';
        } catch (error) {
          console.error('Logout failed:', error);
        }
      });
    }

    // Hamburger open
    const hamburger = document.getElementById('hamburgerBtn');
    const drawer = document.getElementById('mobileNavDrawer');
    if (hamburger && drawer) {
      hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = drawer.classList.toggle('open');
        hamburger.classList.toggle('open', isOpen);
        document.body.style.overflow = isOpen ? 'hidden' : '';
      });
    }

    // Drawer close button
    const mobileClose = document.getElementById('mobileNavClose');
    if (mobileClose) {
      mobileClose.addEventListener('click', () => this._closeDrawer());
    }

    // Mobile logout
    const mobileLogout = document.getElementById('mobileLogoutBtn');
    if (mobileLogout) {
      mobileLogout.addEventListener('click', async () => {
        this._closeDrawer();
        try {
          await api.logout();
          window.location.href = '/';
        } catch (error) {
          console.error('Mobile logout failed:', error);
        }
      });
    }
  }

  async refreshUser() {
    this.currentUser = await api.verifySession();
    this.renderNavigation();
    this.setupEventListeners();
  }
}

// Initialize navigation on page load
let nav;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    nav = new NavigationManager();
  });
} else {
  nav = new NavigationManager();
}

// Called by nav buttons on /app to switch view + update active state
window.globalNavClick = function(btn, viewName) {
  if (typeof switchView === 'function') switchView(viewName);
};

// Called by app.js switchView to keep global nav in sync
window.syncGlobalNav = function(viewName) {
  const map = { draft: 'gNavDraft', myTeam: 'gNavMyTeam', trade: 'gNavTrade', standings: 'gNavStandings' };
  document.querySelectorAll('.global-nav .nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById(map[viewName]);
  if (el) el.classList.add('active');
};
