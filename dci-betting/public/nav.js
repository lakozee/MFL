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
    this.renderNavigation();

    // Set up event listeners
    this.setupEventListeners();
  }

  renderNavigation() {
    const header = document.querySelector('.header');
    if (!header) return;

    const headerContent = header.querySelector('.header-content');
    if (!headerContent) return;

    // Remove existing auth buttons if present
    const existingAuth = header.querySelector('.auth-section');
    if (existingAuth) existingAuth.remove();

    // Create auth section
    const authSection = document.createElement('div');
    authSection.className = 'auth-section';

    if (this.currentUser) {
      // Always inject the same nav for logged-in users
      const isAppPage = window.location.pathname === '/app';
      const isScoresPage = window.location.pathname === '/scores';
      const appNav = document.createElement('nav');
      appNav.className = 'main-nav global-nav';

      if (isAppPage) {
        appNav.innerHTML = `
          <button class="nav-item active" id="gNavDraft" onclick="globalNavClick(this,'draft')">Draft</button>
          <button class="nav-item" id="gNavMyTeam" onclick="globalNavClick(this,'myTeam')">My Team</button>
          <button class="nav-item" id="gNavTrade" onclick="globalNavClick(this,'trade')">Trade</button>
          <button class="nav-item" id="gNavStandings" onclick="globalNavClick(this,'standings')">Standings</button>
          <a href="/scores" class="nav-item">Scores</a>
        `;
      } else {
        const isHowToPlay = window.location.pathname === '/how-to-play';
        const isContact = window.location.pathname === '/contact';
        appNav.innerHTML = `
          <a href="/app" class="nav-item">Draft</a>
          <a href="/app?view=myTeam" class="nav-item">My Team</a>
          <a href="/app?view=trade" class="nav-item">Trade</a>
          <a href="/app?view=standings" class="nav-item">Standings</a>
          <a href="/scores" class="nav-item${isScoresPage ? ' active' : ''}">Scores</a>
          <a href="/how-to-play" class="nav-item${isHowToPlay ? ' active' : ''}">How To Play</a>
          <a href="/contact" class="nav-item${isContact ? ' active' : ''}">Contact Us</a>
        `;
      }
      headerContent.appendChild(appNav);

      // Generate avatar if no custom picture
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
      `;
    } else {
      // User not logged in - show contact link + login button
      const isContact = window.location.pathname === '/contact';
      const guestNav = document.createElement('nav');
      guestNav.className = 'main-nav global-nav';
      guestNav.innerHTML = `<a href="/contact" class="nav-item${isContact ? ' active' : ''}">Contact Us</a>`;
      headerContent.appendChild(guestNav);
      authSection.innerHTML = `
        <a href="/auth" class="btn btn-primary">Login</a>
      `;
    }

    headerContent.appendChild(authSection);
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

      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        profileDropdown.classList.remove('show');
      });
    }

    // Logout button
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
