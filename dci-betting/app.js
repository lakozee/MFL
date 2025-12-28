// ===== APPLICATION STATE =====
const state = {
    currentUser: 'user1',
    draftInProgress: false,
    currentDraftPick: 0,

    // All available captions (sections) from different corps
    allCaptions: [
        // Blue Devils
        { id: 'bd-brass', corps: 'Blue Devils', section: 'Brass', score: 19.8, owner: null, color: '#1e40af' },
        { id: 'bd-percussion', corps: 'Blue Devils', section: 'Percussion', score: 19.7, owner: null, color: '#1e40af' },
        { id: 'bd-guard', corps: 'Blue Devils', section: 'Color Guard', score: 19.6, owner: null, color: '#1e40af' },
        { id: 'bd-ge', corps: 'Blue Devils', section: 'General Effect', score: 19.9, owner: null, color: '#1e40af' },
        { id: 'bd-visual', corps: 'Blue Devils', section: 'Visual Performance', score: 19.7, owner: null, color: '#1e40af' },

        // Santa Clara Vanguard
        { id: 'scv-brass', corps: 'Santa Clara Vanguard', section: 'Brass', score: 19.6, owner: null, color: '#dc2626' },
        { id: 'scv-percussion', corps: 'Santa Clara Vanguard', section: 'Percussion', score: 19.8, owner: null, color: '#dc2626' },
        { id: 'scv-guard', corps: 'Santa Clara Vanguard', section: 'Color Guard', score: 19.5, owner: null, color: '#dc2626' },
        { id: 'scv-ge', corps: 'Santa Clara Vanguard', section: 'General Effect', score: 19.7, owner: null, color: '#dc2626' },
        { id: 'scv-visual', corps: 'Santa Clara Vanguard', section: 'Visual Performance', score: 19.6, owner: null, color: '#dc2626' },

        // Bluecoats
        { id: 'bloo-brass', corps: 'Bluecoats', section: 'Brass', score: 19.5, owner: null, color: '#0891b2' },
        { id: 'bloo-percussion', corps: 'Bluecoats', section: 'Percussion', score: 19.6, owner: null, color: '#0891b2' },
        { id: 'bloo-guard', corps: 'Bluecoats', section: 'Color Guard', score: 19.8, owner: null, color: '#0891b2' },
        { id: 'bloo-ge', corps: 'Bluecoats', section: 'General Effect', score: 19.6, owner: null, color: '#0891b2' },
        { id: 'bloo-visual', corps: 'Bluecoats', section: 'Visual Performance', score: 19.5, owner: null, color: '#0891b2' },

        // Carolina Crown
        { id: 'crown-brass', corps: 'Carolina Crown', section: 'Brass', score: 19.7, owner: null, color: '#7c3aed' },
        { id: 'crown-percussion', corps: 'Carolina Crown', section: 'Percussion', score: 19.5, owner: null, color: '#7c3aed' },
        { id: 'crown-guard', corps: 'Carolina Crown', section: 'Color Guard', score: 19.4, owner: null, color: '#7c3aed' },
        { id: 'crown-ge', corps: 'Carolina Crown', section: 'General Effect', score: 19.6, owner: null, color: '#7c3aed' },
        { id: 'crown-visual', corps: 'Carolina Crown', section: 'Visual Performance', score: 19.7, owner: null, color: '#7c3aed' },

        // The Cavaliers
        { id: 'cavs-brass', corps: 'The Cavaliers', section: 'Brass', score: 19.4, owner: null, color: '#ea580c' },
        { id: 'cavs-percussion', corps: 'The Cavaliers', section: 'Percussion', score: 19.4, owner: null, color: '#ea580c' },
        { id: 'cavs-guard', corps: 'The Cavaliers', section: 'Color Guard', score: 19.3, owner: null, color: '#ea580c' },
        { id: 'cavs-ge', corps: 'The Cavaliers', section: 'General Effect', score: 19.5, owner: null, color: '#ea580c' },
        { id: 'cavs-visual', corps: 'The Cavaliers', section: 'Visual Performance', score: 19.6, owner: null, color: '#ea580c' },

        // Boston Crusaders
        { id: 'bac-brass', corps: 'Boston Crusaders', section: 'Brass', score: 19.3, owner: null, color: '#be123c' },
        { id: 'bac-percussion', corps: 'Boston Crusaders', section: 'Percussion', score: 19.7, owner: null, color: '#be123c' },
        { id: 'bac-guard', corps: 'Boston Crusaders', section: 'Color Guard', score: 19.2, owner: null, color: '#be123c' },
        { id: 'bac-ge', corps: 'Boston Crusaders', section: 'General Effect', score: 19.4, owner: null, color: '#be123c' },
        { id: 'bac-visual', corps: 'Boston Crusaders', section: 'Visual Performance', score: 19.3, owner: null, color: '#be123c' },
    ],

    // League info
    league: {
        name: '',
        playerCount: 0,
        minPlayers: 5,
        maxPlayers: 6,
        created: false
    },

    // League teams (will be populated based on player count)
    teams: [],

    // Draft order (will be generated based on player count)
    draftOrder: [],

    // Trade proposals
    trades: [],

    // Selected caption for viewing details
    selectedCaption: null,

    // Active view
    activeView: 'draft', // draft, myTeam, trade, standings

    // Draft filters
    filters: {
        corps: 'all',
        section: 'all'
    }
};

// ===== DOM ELEMENTS =====
const elements = {
    // Navigation
    navDraft: document.getElementById('navDraft'),
    navMyTeam: document.getElementById('navMyTeam'),
    navTrade: document.getElementById('navTrade'),
    navStandings: document.getElementById('navStandings'),

    // Views
    leagueSetupView: document.getElementById('leagueSetupView'),
    draftView: document.getElementById('draftView'),
    myTeamView: document.getElementById('myTeamView'),
    tradeView: document.getElementById('tradeView'),
    standingsView: document.getElementById('standingsView'),

    // League setup elements
    leagueNameInput: document.getElementById('leagueNameInput'),
    playerCountSelect: document.getElementById('playerCountSelect'),
    createLeagueBtn: document.getElementById('createLeagueBtn'),
    leagueInfo: document.getElementById('leagueInfo'),

    // Draft elements
    draftStatus: document.getElementById('draftStatus'),
    captionsGrid: document.getElementById('captionsGrid'),
    startDraftBtn: document.getElementById('startDraftBtn'),
    corpsFilter: document.getElementById('corpsFilter'),
    sectionFilter: document.getElementById('sectionFilter'),

    // My Team elements
    myRoster: document.getElementById('myRoster'),
    teamScore: document.getElementById('teamScore'),

    // Trade elements
    tradeList: document.getElementById('tradeList'),

    // Standings elements
    standingsTable: document.getElementById('standingsTable'),

    // Modals
    captionModal: document.getElementById('captionModal'),
    modalCorpsName: document.getElementById('modalCorpsName'),
    modalSection: document.getElementById('modalSection'),
    modalScore: document.getElementById('modalScore'),
    modalOwner: document.getElementById('modalOwner'),
    draftCaptionBtn: document.getElementById('draftCaptionBtn'),
    closeModalBtn: document.getElementById('closeModalBtn')
};

// ===== UTILITY FUNCTIONS =====
function getCaption(id) {
    return state.allCaptions.find(c => c.id === id);
}

function getTeam(id) {
    return state.teams.find(t => t.id === id);
}

function calculateTeamScore(team) {
    let total = 0;
    let count = 0;

    Object.values(team.roster).forEach(captionId => {
        if (captionId) {
            const caption = getCaption(captionId);
            if (caption) {
                total += caption.score;
                count++;
            }
        }
    });

    return count > 0 ? total : 0;
}

function getSectionKey(section) {
    const map = {
        'Brass': 'brass',
        'Percussion': 'percussion',
        'Color Guard': 'colorGuard',
        'General Effect': 'generalEffect',
        'Visual Performance': 'visualPerformance'
    };
    return map[section];
}

function isRosterComplete(team) {
    return Object.values(team.roster).every(slot => slot !== null);
}

function getAvailableCaptions() {
    let available = state.allCaptions.filter(c => c.owner === null);

    // Apply corps filter
    if (state.filters.corps !== 'all') {
        available = available.filter(c => c.corps === state.filters.corps);
    }

    // Apply section filter
    if (state.filters.section !== 'all') {
        available = available.filter(c => c.section === state.filters.section);
    }

    return available;
}

function getCurrentDraftTeam() {
    if (state.currentDraftPick >= state.draftOrder.length) {
        return null;
    }
    return state.draftOrder[state.currentDraftPick];
}

// ===== NAVIGATION =====
function switchView(viewName) {
    // Don't allow navigation if league not created (except to league setup)
    if (!state.league.created && viewName !== 'leagueSetup') {
        return;
    }

    state.activeView = viewName;

    // Hide all views
    const allViews = [elements.leagueSetupView, elements.draftView, elements.myTeamView, elements.tradeView, elements.standingsView];
    allViews.forEach(view => {
        if (view) view.style.display = 'none';
    });

    // Remove active class from all nav items
    [elements.navDraft, elements.navMyTeam, elements.navTrade, elements.navStandings].forEach(nav => {
        if (nav) nav.classList.remove('active');
    });

    // Show selected view and activate nav
    switch (viewName) {
        case 'leagueSetup':
            if (elements.leagueSetupView) elements.leagueSetupView.style.display = 'block';
            break;
        case 'draft':
            if (elements.draftView) elements.draftView.style.display = 'block';
            if (elements.navDraft) elements.navDraft.classList.add('active');
            renderDraftView();
            break;
        case 'myTeam':
            if (elements.myTeamView) elements.myTeamView.style.display = 'block';
            if (elements.navMyTeam) elements.navMyTeam.classList.add('active');
            renderMyTeam();
            break;
        case 'trade':
            if (elements.tradeView) elements.tradeView.style.display = 'block';
            if (elements.navTrade) elements.navTrade.classList.add('active');
            renderTradeView();
            break;
        case 'standings':
            if (elements.standingsView) elements.standingsView.style.display = 'block';
            if (elements.navStandings) elements.navStandings.classList.add('active');
            renderStandings();
            break;
    }
}

// ===== LEAGUE FUNCTIONS =====
function createLeague(leagueName, playerCount) {
    if (!leagueName || leagueName.trim() === '') {
        alert('Please enter a league name');
        return false;
    }

    if (playerCount < state.league.minPlayers || playerCount > state.league.maxPlayers) {
        alert(`League must have between ${state.league.minPlayers} and ${state.league.maxPlayers} players`);
        return false;
    }

    state.league.name = leagueName;
    state.league.playerCount = playerCount;
    state.league.created = true;

    // Generate teams
    generateTeams(playerCount);

    // Generate draft order
    generateDraftOrder(playerCount);

    return true;
}

function generateTeams(playerCount) {
    const teamNames = [
        'My Team',
        'The Brass Tacks',
        'Guard Squad',
        'Drum Line Dreams',
        'Percussion Power',
        'Visual Vibes'
    ];

    state.teams = [];
    for (let i = 0; i < playerCount; i++) {
        state.teams.push({
            id: `user${i + 1}`,
            name: i === 0 ? 'My Team' : teamNames[i],
            roster: {
                brass: null,
                percussion: null,
                colorGuard: null,
                generalEffect: null,
                visualPerformance: null
            }
        });
    }
}

function generateDraftOrder(playerCount) {
    state.draftOrder = [];

    // 5 rounds (one for each caption type)
    for (let round = 0; round < 5; round++) {
        if (round % 2 === 0) {
            // Forward order (1, 2, 3, 4, 5, 6)
            for (let i = 0; i < playerCount; i++) {
                state.draftOrder.push(`user${i + 1}`);
            }
        } else {
            // Reverse order (6, 5, 4, 3, 2, 1)
            for (let i = playerCount - 1; i >= 0; i--) {
                state.draftOrder.push(`user${i + 1}`);
            }
        }
    }
}

// ===== DRAFT FUNCTIONS =====
function startDraft() {
    state.draftInProgress = true;
    state.currentDraftPick = 0;
    renderDraftView();
}

function draftCaption(captionId) {
    const currentTeamId = getCurrentDraftTeam();
    if (!currentTeamId) {
        alert('Draft is complete!');
        return;
    }

    const caption = getCaption(captionId);
    const team = getTeam(currentTeamId);

    if (!caption || caption.owner !== null) {
        alert('This caption is not available');
        return;
    }

    const sectionKey = getSectionKey(caption.section);

    // Check if team already has this section filled
    if (team.roster[sectionKey] !== null) {
        alert(`${team.name} already has a ${caption.section} caption`);
        return;
    }

    // Assign caption to team
    caption.owner = currentTeamId;
    team.roster[sectionKey] = captionId;

    // Move to next pick
    state.currentDraftPick++;

    // Auto-draft for CPU teams
    if (state.currentDraftPick < state.draftOrder.length) {
        const nextTeamId = getCurrentDraftTeam();
        if (nextTeamId !== 'user1') {
            setTimeout(() => autoDraft(nextTeamId), 300);
        }
    } else {
        state.draftInProgress = false;
        alert('Draft complete! Check out your team and the standings!');
    }

    closeCaptionModal();
    renderDraftView();
}

function autoDraft(teamId) {
    const team = getTeam(teamId);
    const available = getAvailableCaptions();

    // Find sections team still needs
    const neededSections = Object.entries(team.roster)
        .filter(([key, value]) => value === null)
        .map(([key]) => {
            const sectionMap = {
                'brass': 'Brass',
                'percussion': 'Percussion',
                'colorGuard': 'Color Guard',
                'generalEffect': 'General Effect',
                'visualPerformance': 'Visual Performance'
            };
            return sectionMap[key];
        });

    // Filter available captions for needed sections
    const validPicks = available.filter(c => neededSections.includes(c.section));

    if (validPicks.length > 0) {
        // Pick highest scoring available caption
        validPicks.sort((a, b) => b.score - a.score);
        const pick = validPicks[0];

        pick.owner = teamId;
        const sectionKey = getSectionKey(pick.section);
        team.roster[sectionKey] = pick.id;

        state.currentDraftPick++;

        // Continue auto-drafting if next pick is also CPU
        if (state.currentDraftPick < state.draftOrder.length) {
            const nextTeamId = getCurrentDraftTeam();
            if (nextTeamId !== 'user1') {
                setTimeout(() => autoDraft(nextTeamId), 300);
            } else {
                renderDraftView();
            }
        } else {
            state.draftInProgress = false;
            renderDraftView();
        }
    }
}

// ===== RENDER FUNCTIONS =====
function renderDraftView() {
    if (!state.draftInProgress) {
        if (elements.draftStatus) {
            elements.draftStatus.innerHTML = '<h3>Ready to Draft?</h3><p>Click Start Draft to begin building your team!</p>';
        }
        if (elements.startDraftBtn) {
            elements.startDraftBtn.style.display = 'block';
        }
        if (elements.captionsGrid) {
            elements.captionsGrid.innerHTML = '';
        }
        return;
    }

    if (elements.startDraftBtn) {
        elements.startDraftBtn.style.display = 'none';
    }

    const currentTeamId = getCurrentDraftTeam();
    const currentTeam = currentTeamId ? getTeam(currentTeamId) : null;

    if (elements.draftStatus) {
        if (currentTeam) {
            const pickNumber = state.currentDraftPick + 1;
            const isYourTurn = currentTeamId === 'user1';
            elements.draftStatus.innerHTML = `
        <h3>Pick ${pickNumber} of ${state.draftOrder.length}</h3>
        <p class="draft-turn ${isYourTurn ? 'your-turn' : ''}">${isYourTurn ? "🎯 YOUR TURN!" : `${currentTeam.name} is picking...`}</p>
      `;
        } else {
            elements.draftStatus.innerHTML = '<h3>Draft Complete!</h3><p>All teams have filled their rosters.</p>';
        }
    }

    // Render available captions
    const available = getAvailableCaptions();

    // Get section color
    const getSectionColor = (section) => {
        const colors = {
            'Brass': '#f59e0b',
            'Percussion': '#10b981',
            'Color Guard': '#8b5cf6',
            'General Effect': '#06b6d4',
            'Visual Performance': '#ec4899'
        };
        return colors[section] || '#64748b';
    };

    if (elements.captionsGrid) {
        elements.captionsGrid.innerHTML = available.map(caption => `
      <div class="caption-card" onclick="openCaptionModal('${caption.id}')" 
           style="border: 2px solid ${caption.color}; background: linear-gradient(135deg, ${caption.color}15 0%, ${caption.color}05 100%);">
        <div class="caption-header">
          <h4 class="caption-corps" style="color: ${caption.color}">${caption.corps}</h4>
          <span class="caption-score">${caption.score.toFixed(1)}</span>
        </div>
        <div class="caption-section-row">
          <span class="caption-section-badge" style="background: ${getSectionColor(caption.section)}; color: white; border: none;">
            ${caption.section}
          </span>
        </div>
      </div>
    `).join('');
    }
}

function renderMyTeam() {
    const myTeam = getTeam('user1');
    const totalScore = calculateTeamScore(myTeam);

    if (elements.teamScore) {
        elements.teamScore.textContent = totalScore.toFixed(1);
    }

    const sections = [
        { key: 'brass', name: 'Brass', icon: '🎺' },
        { key: 'percussion', name: 'Percussion', icon: '🥁' },
        { key: 'colorGuard', name: 'Color Guard', icon: '🎭' },
        { key: 'generalEffect', name: 'General Effect', icon: '✨' },
        { key: 'visualPerformance', name: 'Visual Performance', icon: '💫' }
    ];

    if (elements.myRoster) {
        elements.myRoster.innerHTML = sections.map(section => {
            const captionId = myTeam.roster[section.key];
            const caption = captionId ? getCaption(captionId) : null;

            return `
        <div class="roster-slot ${caption ? 'filled' : 'empty'}">
          <div class="slot-header">
            <span class="slot-icon">${section.icon}</span>
            <span class="slot-name">${section.name}</span>
          </div>
          ${caption ? `
            <div class="slot-caption" style="border-left: 4px solid ${caption.color}">
              <div class="slot-corps">${caption.corps}</div>
              <div class="slot-score">${caption.score.toFixed(1)}</div>
            </div>
          ` : `
            <div class="slot-empty-state">Not drafted yet</div>
          `}
        </div>
      `;
        }).join('');
    }
}

function renderTradeView() {
    if (elements.tradeList) {
        elements.tradeList.innerHTML = `
      <div class="trade-placeholder">
        <h3>Trading Coming Soon!</h3>
        <p>Trade captions with other teams in your league.</p>
        <p class="text-muted">This feature will be available after the draft is complete.</p>
      </div>
    `;
    }
}

function renderStandings() {
    const standings = state.teams.map(team => ({
        ...team,
        score: calculateTeamScore(team),
        complete: isRosterComplete(team)
    })).sort((a, b) => b.score - a.score);

    if (elements.standingsTable) {
        elements.standingsTable.innerHTML = `
      <table class="standings-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Team</th>
            <th>Total Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${standings.map((team, index) => `
            <tr class="${team.id === 'user1' ? 'my-team-row' : ''}">
              <td class="rank-cell">#${index + 1}</td>
              <td>${team.name}</td>
              <td class="score-cell">${team.score.toFixed(1)}</td>
              <td>
                <span class="status-badge ${team.complete ? 'complete' : 'incomplete'}">
                  ${team.complete ? '✓ Complete' : 'Drafting...'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    }
}

// ===== MODAL FUNCTIONS =====
function openCaptionModal(captionId) {
    const caption = getCaption(captionId);
    if (!caption) return;

    state.selectedCaption = captionId;

    if (elements.modalCorpsName) elements.modalCorpsName.textContent = caption.corps;
    if (elements.modalSection) elements.modalSection.textContent = caption.section;
    if (elements.modalScore) elements.modalScore.textContent = caption.score.toFixed(1);
    if (elements.modalOwner) {
        elements.modalOwner.textContent = caption.owner ? getTeam(caption.owner).name : 'Available';
    }

    // Show/hide draft button based on context
    const currentTeamId = getCurrentDraftTeam();
    const canDraft = state.draftInProgress && currentTeamId === 'user1' && caption.owner === null;

    if (elements.draftCaptionBtn) {
        elements.draftCaptionBtn.style.display = canDraft ? 'block' : 'none';
    }

    if (elements.captionModal) {
        elements.captionModal.classList.add('active');
    }
}

function closeCaptionModal() {
    state.selectedCaption = null;
    if (elements.captionModal) {
        elements.captionModal.classList.remove('active');
    }
}

function handleDraftClick() {
    if (state.selectedCaption) {
        draftCaption(state.selectedCaption);
    }
}

// ===== EVENT LISTENERS =====
if (elements.createLeagueBtn) {
    elements.createLeagueBtn.addEventListener('click', () => {
        const leagueName = elements.leagueNameInput ? elements.leagueNameInput.value : '';
        const playerCount = elements.playerCountSelect ? parseInt(elements.playerCountSelect.value) : 5;

        if (createLeague(leagueName, playerCount)) {
            // Update league info display
            if (elements.leagueInfo) {
                elements.leagueInfo.innerHTML = `
          <div class="league-badge">
            <span class="league-name">${state.league.name}</span>
            <span class="league-players">${state.league.playerCount} Players</span>
          </div>
        `;
            }
            switchView('draft');
        }
    });
}

if (elements.navDraft) elements.navDraft.addEventListener('click', () => switchView('draft'));
if (elements.navMyTeam) elements.navMyTeam.addEventListener('click', () => switchView('myTeam'));
if (elements.navTrade) elements.navTrade.addEventListener('click', () => switchView('trade'));
if (elements.navStandings) elements.navStandings.addEventListener('click', () => switchView('standings'));

if (elements.startDraftBtn) elements.startDraftBtn.addEventListener('click', startDraft);

// Filter change handlers
if (elements.corpsFilter) {
    elements.corpsFilter.addEventListener('change', (e) => {
        state.filters.corps = e.target.value;
        renderDraftView();
    });
}

if (elements.sectionFilter) {
    elements.sectionFilter.addEventListener('change', (e) => {
        state.filters.section = e.target.value;
        renderDraftView();
    });
}
if (elements.draftCaptionBtn) elements.draftCaptionBtn.addEventListener('click', handleDraftClick);
if (elements.closeModalBtn) elements.closeModalBtn.addEventListener('click', closeCaptionModal);

// Close modal when clicking outside
if (elements.captionModal) {
    elements.captionModal.addEventListener('click', (e) => {
        if (e.target === elements.captionModal) {
            closeCaptionModal();
        }
    });
}

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elements.captionModal && elements.captionModal.classList.contains('active')) {
        closeCaptionModal();
    }
});

// ===== INITIALIZATION =====
function init() {
    switchView('leagueSetup');
}

// Start the application
init();
