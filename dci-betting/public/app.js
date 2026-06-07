// ===== APPLICATION STATE =====
const state = {
    currentUser: null,
    currentUserId: null,
    draftInProgress: false,
    currentDraftPick: 0,

    // All available captions (sections) from different corps — 18 corps × 8 captions = 144
    allCaptions: [
        // Blue Devils
        { id: 'bd-brass',               corps: 'Blue Devils', section: 'Brass',              score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-music-analysis',      corps: 'Blue Devils', section: 'Music Analysis',     score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-percussion',          corps: 'Blue Devils', section: 'Percussion',         score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-color-guard',         corps: 'Blue Devils', section: 'Color Guard',        score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-ge1',                 corps: 'Blue Devils', section: 'General Effect 1',   score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-ge2',                 corps: 'Blue Devils', section: 'General Effect 2',   score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-visual-proficiency',  corps: 'Blue Devils', section: 'Visual Proficiency', score: 0, owner: null, color: '#1e40af' },
        { id: 'bd-visual-analysis',     corps: 'Blue Devils', section: 'Visual Analysis',    score: 0, owner: null, color: '#1e40af' },
        // Santa Clara Vanguard
        { id: 'scv-brass',               corps: 'Santa Clara Vanguard', section: 'Brass',              score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-music-analysis',      corps: 'Santa Clara Vanguard', section: 'Music Analysis',     score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-percussion',          corps: 'Santa Clara Vanguard', section: 'Percussion',         score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-color-guard',         corps: 'Santa Clara Vanguard', section: 'Color Guard',        score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-ge1',                 corps: 'Santa Clara Vanguard', section: 'General Effect 1',   score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-ge2',                 corps: 'Santa Clara Vanguard', section: 'General Effect 2',   score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-visual-proficiency',  corps: 'Santa Clara Vanguard', section: 'Visual Proficiency', score: 0, owner: null, color: '#dc2626' },
        { id: 'scv-visual-analysis',     corps: 'Santa Clara Vanguard', section: 'Visual Analysis',    score: 0, owner: null, color: '#dc2626' },
        // Bluecoats
        { id: 'bloo-brass',               corps: 'Bluecoats', section: 'Brass',              score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-music-analysis',      corps: 'Bluecoats', section: 'Music Analysis',     score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-percussion',          corps: 'Bluecoats', section: 'Percussion',         score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-color-guard',         corps: 'Bluecoats', section: 'Color Guard',        score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-ge1',                 corps: 'Bluecoats', section: 'General Effect 1',   score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-ge2',                 corps: 'Bluecoats', section: 'General Effect 2',   score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-visual-proficiency',  corps: 'Bluecoats', section: 'Visual Proficiency', score: 0, owner: null, color: '#0891b2' },
        { id: 'bloo-visual-analysis',     corps: 'Bluecoats', section: 'Visual Analysis',    score: 0, owner: null, color: '#0891b2' },
        // Carolina Crown
        { id: 'crown-brass',               corps: 'Carolina Crown', section: 'Brass',              score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-music-analysis',      corps: 'Carolina Crown', section: 'Music Analysis',     score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-percussion',          corps: 'Carolina Crown', section: 'Percussion',         score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-color-guard',         corps: 'Carolina Crown', section: 'Color Guard',        score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-ge1',                 corps: 'Carolina Crown', section: 'General Effect 1',   score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-ge2',                 corps: 'Carolina Crown', section: 'General Effect 2',   score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-visual-proficiency',  corps: 'Carolina Crown', section: 'Visual Proficiency', score: 0, owner: null, color: '#7c3aed' },
        { id: 'crown-visual-analysis',     corps: 'Carolina Crown', section: 'Visual Analysis',    score: 0, owner: null, color: '#7c3aed' },
        // The Cavaliers
        { id: 'cavs-brass',               corps: 'The Cavaliers', section: 'Brass',              score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-music-analysis',      corps: 'The Cavaliers', section: 'Music Analysis',     score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-percussion',          corps: 'The Cavaliers', section: 'Percussion',         score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-color-guard',         corps: 'The Cavaliers', section: 'Color Guard',        score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-ge1',                 corps: 'The Cavaliers', section: 'General Effect 1',   score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-ge2',                 corps: 'The Cavaliers', section: 'General Effect 2',   score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-visual-proficiency',  corps: 'The Cavaliers', section: 'Visual Proficiency', score: 0, owner: null, color: '#ea580c' },
        { id: 'cavs-visual-analysis',     corps: 'The Cavaliers', section: 'Visual Analysis',    score: 0, owner: null, color: '#ea580c' },
        // Boston Crusaders
        { id: 'bac-brass',               corps: 'Boston Crusaders', section: 'Brass',              score: 0, owner: null, color: '#be123c' },
        { id: 'bac-music-analysis',      corps: 'Boston Crusaders', section: 'Music Analysis',     score: 0, owner: null, color: '#be123c' },
        { id: 'bac-percussion',          corps: 'Boston Crusaders', section: 'Percussion',         score: 0, owner: null, color: '#be123c' },
        { id: 'bac-color-guard',         corps: 'Boston Crusaders', section: 'Color Guard',        score: 0, owner: null, color: '#be123c' },
        { id: 'bac-ge1',                 corps: 'Boston Crusaders', section: 'General Effect 1',   score: 0, owner: null, color: '#be123c' },
        { id: 'bac-ge2',                 corps: 'Boston Crusaders', section: 'General Effect 2',   score: 0, owner: null, color: '#be123c' },
        { id: 'bac-visual-proficiency',  corps: 'Boston Crusaders', section: 'Visual Proficiency', score: 0, owner: null, color: '#be123c' },
        { id: 'bac-visual-analysis',     corps: 'Boston Crusaders', section: 'Visual Analysis',    score: 0, owner: null, color: '#be123c' },
        // Phantom Regiment
        { id: 'pr-brass',               corps: 'Phantom Regiment', section: 'Brass',              score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-music-analysis',      corps: 'Phantom Regiment', section: 'Music Analysis',     score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-percussion',          corps: 'Phantom Regiment', section: 'Percussion',         score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-color-guard',         corps: 'Phantom Regiment', section: 'Color Guard',        score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-ge1',                 corps: 'Phantom Regiment', section: 'General Effect 1',   score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-ge2',                 corps: 'Phantom Regiment', section: 'General Effect 2',   score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-visual-proficiency',  corps: 'Phantom Regiment', section: 'Visual Proficiency', score: 0, owner: null, color: '#991b1b' },
        { id: 'pr-visual-analysis',     corps: 'Phantom Regiment', section: 'Visual Analysis',    score: 0, owner: null, color: '#991b1b' },
        // Blue Stars
        { id: 'bs-brass',               corps: 'Blue Stars', section: 'Brass',              score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-music-analysis',      corps: 'Blue Stars', section: 'Music Analysis',     score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-percussion',          corps: 'Blue Stars', section: 'Percussion',         score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-color-guard',         corps: 'Blue Stars', section: 'Color Guard',        score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-ge1',                 corps: 'Blue Stars', section: 'General Effect 1',   score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-ge2',                 corps: 'Blue Stars', section: 'General Effect 2',   score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-visual-proficiency',  corps: 'Blue Stars', section: 'Visual Proficiency', score: 0, owner: null, color: '#1d4ed8' },
        { id: 'bs-visual-analysis',     corps: 'Blue Stars', section: 'Visual Analysis',    score: 0, owner: null, color: '#1d4ed8' },
        // Madison Scouts
        { id: 'scouts-brass',               corps: 'Madison Scouts', section: 'Brass',              score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-music-analysis',      corps: 'Madison Scouts', section: 'Music Analysis',     score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-percussion',          corps: 'Madison Scouts', section: 'Percussion',         score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-color-guard',         corps: 'Madison Scouts', section: 'Color Guard',        score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-ge1',                 corps: 'Madison Scouts', section: 'General Effect 1',   score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-ge2',                 corps: 'Madison Scouts', section: 'General Effect 2',   score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-visual-proficiency',  corps: 'Madison Scouts', section: 'Visual Proficiency', score: 0, owner: null, color: '#92400e' },
        { id: 'scouts-visual-analysis',     corps: 'Madison Scouts', section: 'Visual Analysis',    score: 0, owner: null, color: '#92400e' },
        // Blue Knights
        { id: 'bk-brass',               corps: 'Blue Knights', section: 'Brass',              score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-music-analysis',      corps: 'Blue Knights', section: 'Music Analysis',     score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-percussion',          corps: 'Blue Knights', section: 'Percussion',         score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-color-guard',         corps: 'Blue Knights', section: 'Color Guard',        score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-ge1',                 corps: 'Blue Knights', section: 'General Effect 1',   score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-ge2',                 corps: 'Blue Knights', section: 'General Effect 2',   score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-visual-proficiency',  corps: 'Blue Knights', section: 'Visual Proficiency', score: 0, owner: null, color: '#1e3a5f' },
        { id: 'bk-visual-analysis',     corps: 'Blue Knights', section: 'Visual Analysis',    score: 0, owner: null, color: '#1e3a5f' },
        // Crossmen
        { id: 'cross-brass',               corps: 'Crossmen', section: 'Brass',              score: 0, owner: null, color: '#15803d' },
        { id: 'cross-music-analysis',      corps: 'Crossmen', section: 'Music Analysis',     score: 0, owner: null, color: '#15803d' },
        { id: 'cross-percussion',          corps: 'Crossmen', section: 'Percussion',         score: 0, owner: null, color: '#15803d' },
        { id: 'cross-color-guard',         corps: 'Crossmen', section: 'Color Guard',        score: 0, owner: null, color: '#15803d' },
        { id: 'cross-ge1',                 corps: 'Crossmen', section: 'General Effect 1',   score: 0, owner: null, color: '#15803d' },
        { id: 'cross-ge2',                 corps: 'Crossmen', section: 'General Effect 2',   score: 0, owner: null, color: '#15803d' },
        { id: 'cross-visual-proficiency',  corps: 'Crossmen', section: 'Visual Proficiency', score: 0, owner: null, color: '#15803d' },
        { id: 'cross-visual-analysis',     corps: 'Crossmen', section: 'Visual Analysis',    score: 0, owner: null, color: '#15803d' },
        // Spirit of Atlanta
        { id: 'soa-brass',               corps: 'Spirit of Atlanta', section: 'Brass',              score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-music-analysis',      corps: 'Spirit of Atlanta', section: 'Music Analysis',     score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-percussion',          corps: 'Spirit of Atlanta', section: 'Percussion',         score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-color-guard',         corps: 'Spirit of Atlanta', section: 'Color Guard',        score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-ge1',                 corps: 'Spirit of Atlanta', section: 'General Effect 1',   score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-ge2',                 corps: 'Spirit of Atlanta', section: 'General Effect 2',   score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-visual-proficiency',  corps: 'Spirit of Atlanta', section: 'Visual Proficiency', score: 0, owner: null, color: '#9d174d' },
        { id: 'soa-visual-analysis',     corps: 'Spirit of Atlanta', section: 'Visual Analysis',    score: 0, owner: null, color: '#9d174d' },
        // Pacific Crest
        { id: 'pc-brass',               corps: 'Pacific Crest', section: 'Brass',              score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-music-analysis',      corps: 'Pacific Crest', section: 'Music Analysis',     score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-percussion',          corps: 'Pacific Crest', section: 'Percussion',         score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-color-guard',         corps: 'Pacific Crest', section: 'Color Guard',        score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-ge1',                 corps: 'Pacific Crest', section: 'General Effect 1',   score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-ge2',                 corps: 'Pacific Crest', section: 'General Effect 2',   score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-visual-proficiency',  corps: 'Pacific Crest', section: 'Visual Proficiency', score: 0, owner: null, color: '#0f766e' },
        { id: 'pc-visual-analysis',     corps: 'Pacific Crest', section: 'Visual Analysis',    score: 0, owner: null, color: '#0f766e' },
        // Music City
        { id: 'mc-brass',               corps: 'Music City', section: 'Brass',              score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-music-analysis',      corps: 'Music City', section: 'Music Analysis',     score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-percussion',          corps: 'Music City', section: 'Percussion',         score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-color-guard',         corps: 'Music City', section: 'Color Guard',        score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-ge1',                 corps: 'Music City', section: 'General Effect 1',   score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-ge2',                 corps: 'Music City', section: 'General Effect 2',   score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-visual-proficiency',  corps: 'Music City', section: 'Visual Proficiency', score: 0, owner: null, color: '#4338ca' },
        { id: 'mc-visual-analysis',     corps: 'Music City', section: 'Visual Analysis',    score: 0, owner: null, color: '#4338ca' },
        // The Academy
        { id: 'acad-brass',               corps: 'The Academy', section: 'Brass',              score: 0, owner: null, color: '#b45309' },
        { id: 'acad-music-analysis',      corps: 'The Academy', section: 'Music Analysis',     score: 0, owner: null, color: '#b45309' },
        { id: 'acad-percussion',          corps: 'The Academy', section: 'Percussion',         score: 0, owner: null, color: '#b45309' },
        { id: 'acad-color-guard',         corps: 'The Academy', section: 'Color Guard',        score: 0, owner: null, color: '#b45309' },
        { id: 'acad-ge1',                 corps: 'The Academy', section: 'General Effect 1',   score: 0, owner: null, color: '#b45309' },
        { id: 'acad-ge2',                 corps: 'The Academy', section: 'General Effect 2',   score: 0, owner: null, color: '#b45309' },
        { id: 'acad-visual-proficiency',  corps: 'The Academy', section: 'Visual Proficiency', score: 0, owner: null, color: '#b45309' },
        { id: 'acad-visual-analysis',     corps: 'The Academy', section: 'Visual Analysis',    score: 0, owner: null, color: '#b45309' },
        // Troopers
        { id: 'troop-brass',               corps: 'Troopers', section: 'Brass',              score: 0, owner: null, color: '#374151' },
        { id: 'troop-music-analysis',      corps: 'Troopers', section: 'Music Analysis',     score: 0, owner: null, color: '#374151' },
        { id: 'troop-percussion',          corps: 'Troopers', section: 'Percussion',         score: 0, owner: null, color: '#374151' },
        { id: 'troop-color-guard',         corps: 'Troopers', section: 'Color Guard',        score: 0, owner: null, color: '#374151' },
        { id: 'troop-ge1',                 corps: 'Troopers', section: 'General Effect 1',   score: 0, owner: null, color: '#374151' },
        { id: 'troop-ge2',                 corps: 'Troopers', section: 'General Effect 2',   score: 0, owner: null, color: '#374151' },
        { id: 'troop-visual-proficiency',  corps: 'Troopers', section: 'Visual Proficiency', score: 0, owner: null, color: '#374151' },
        { id: 'troop-visual-analysis',     corps: 'Troopers', section: 'Visual Analysis',    score: 0, owner: null, color: '#374151' },
        // Colts
        { id: 'colts-brass',               corps: 'Colts', section: 'Brass',              score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-music-analysis',      corps: 'Colts', section: 'Music Analysis',     score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-percussion',          corps: 'Colts', section: 'Percussion',         score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-color-guard',         corps: 'Colts', section: 'Color Guard',        score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-ge1',                 corps: 'Colts', section: 'General Effect 1',   score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-ge2',                 corps: 'Colts', section: 'General Effect 2',   score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-visual-proficiency',  corps: 'Colts', section: 'Visual Proficiency', score: 0, owner: null, color: '#134e4a' },
        { id: 'colts-visual-analysis',     corps: 'Colts', section: 'Visual Analysis',    score: 0, owner: null, color: '#134e4a' },
        // Spartans
        { id: 'sparts-brass',               corps: 'Spartans', section: 'Brass',              score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-music-analysis',      corps: 'Spartans', section: 'Music Analysis',     score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-percussion',          corps: 'Spartans', section: 'Percussion',         score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-color-guard',         corps: 'Spartans', section: 'Color Guard',        score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-ge1',                 corps: 'Spartans', section: 'General Effect 1',   score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-ge2',                 corps: 'Spartans', section: 'General Effect 2',   score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-visual-proficiency',  corps: 'Spartans', section: 'Visual Proficiency', score: 0, owner: null, color: '#312e81' },
        { id: 'sparts-visual-analysis',     corps: 'Spartans', section: 'Visual Analysis',    score: 0, owner: null, color: '#312e81' },
    ],

    // League info
    league: {
        id: null,
        name: '',
        maxPlayers: 12,
        minPlayers: 4,
        created: false,
        inviteToken: null
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
    createLeagueBtn: document.getElementById('createLeagueBtn'),
    leagueInfo: document.getElementById('leagueInfo'),

    // League info panel
    leagueInfoPanel: document.getElementById('leagueInfoPanel'),
    leagueName: document.getElementById('leagueName'),
    leagueStatus: document.getElementById('leagueStatus'),
    inviteLink: document.getElementById('inviteLink'),
    copyInviteBtn: document.getElementById('copyInviteBtn'),
    playerCount: document.getElementById('playerCount'),
    rosterGrid: document.getElementById('rosterGrid'),

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

    // Sync global nav injected by nav.js
    if (typeof syncGlobalNav === 'function') syncGlobalNav(viewName);

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

// ===== LEAGUE UI FUNCTIONS =====
function updateLeagueInfoPanel() {
    if (!state.league.created) return;

    // Show the panel
    if (elements.leagueInfoPanel) {
        elements.leagueInfoPanel.style.display = 'block';
    }

    // Update league name
    if (elements.leagueName) {
        elements.leagueName.textContent = state.league.name;
    }

    // Update status
    const currentMembers = state.teams.length;
    const spotsRemaining = state.league.maxPlayers - currentMembers;
    if (elements.leagueStatus) {
        if (spotsRemaining > 0) {
            elements.leagueStatus.textContent = `Waiting for ${spotsRemaining} more player${spotsRemaining !== 1 ? 's' : ''}...`;
            elements.leagueStatus.className = 'league-status waiting';
        } else {
            elements.leagueStatus.textContent = 'League Full - Ready to Draft!';
            elements.leagueStatus.className = 'league-status ready';
        }
    }

    // Update invite link
    if (elements.inviteLink && state.league.inviteToken) {
        const inviteUrl = `${window.location.origin}/invite/${state.league.inviteToken}`;
        elements.inviteLink.value = inviteUrl;
    }

    // Update player count
    if (elements.playerCount) {
        elements.playerCount.textContent = `${currentMembers}/${state.league.maxPlayers}`;
    }

    // Update roster grid
    if (elements.rosterGrid) {
        const rosterHTML = [];

        // Add current players only
        state.teams.forEach((team, index) => {
            rosterHTML.push(`
                <div class="player-card filled">
                    <div class="player-info">
                        <div class="player-number">#${index + 1}</div>
                        <div class="player-name">${team.name}</div>
                    </div>
                    <div class="player-status">✓ Joined</div>
                </div>
            `);
        });

        elements.rosterGrid.innerHTML = rosterHTML.join('');
    }
}

// ===== LEAGUE FUNCTIONS =====
async function createLeague(leagueName) {
    if (!leagueName || leagueName.trim() === '') {
        alert('Please enter a league name');
        return false;
    }

    try {
        // Create league via backend API (no player count needed - defaults to max 12, min 4)
        const response = await api.request('/leagues', {
            method: 'POST',
            body: JSON.stringify({
                name: leagueName
            })
        });

        // Store league info in state
        state.league.name = response.league.name;
        state.league.maxPlayers = response.league.maxPlayers || 12;
        state.league.minPlayers = response.league.minPlayers || 4;
        state.league.id = response.league.id;
        state.league.created = true;

        // Generate invite link
        const inviteResponse = await api.request(`/leagues/${response.league.id}/invite`, {
            method: 'POST'
        });

        state.league.inviteToken = inviteResponse.token;

        // User is automatically added as first member by backend
        // Load league data
        await loadMyLeagueData();

        // Update UI to show invite and roster
        updateLeagueInfoPanel();

        return true;
    } catch (error) {
        alert('Failed to create league: ' + error.message);
        return false;
    }
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
    // Check if league has enough players (4-12)
    const currentMembers = state.teams.length;
    if (currentMembers < 4) {
        alert(`Cannot start draft yet! Need at least 4 players to start.\n\nCurrently have ${currentMembers} player(s). Share your invite link!`);
        return;
    }

    if (currentMembers > 12) {
        alert('League has too many players (max 12)');
        return;
    }

    state.draftInProgress = true;
    state.currentDraftPick = 0;
    renderDraftView();
}

async function draftCaption(captionId) {
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

    try {
        // Save draft pick to backend
        await api.request('/draft/pick', {
            method: 'POST',
            body: JSON.stringify({
                leagueId: state.league.id,
                captionId: captionId,
                sectionType: caption.section,
                pickNumber: state.currentDraftPick
            })
        });

        // Update local state
        caption.owner = currentTeamId;
        team.roster[sectionKey] = captionId;
        state.currentDraftPick++;

        // Auto-draft for other players (when multiplayer is implemented)
        if (state.currentDraftPick < state.draftOrder.length) {
            const nextTeamId = getCurrentDraftTeam();
            if (nextTeamId !== state.currentUserId) {
                // For now, just wait for next player's turn
                // In future, implement real-time multiplayer or AI opponents
            }
        } else {
            state.draftInProgress = false;
            alert('Draft complete! Check out your team and the standings!');
        }

        closeCaptionModal();
        renderDraftView();
    } catch (error) {
        alert('Failed to save draft pick: ' + error.message);
    }
}

function autoDraft(teamId) {
    const team = getTeam(teamId);
    if (!team) return;

    // Find first empty roster slot
    const emptySlot = Object.keys(team.roster).find(slot => team.roster[slot] === null);
    if (!emptySlot) return;

    // Find available captions for that slot type
    const sectionTypes = {
        'brass': 'Brass',
        'percussion': 'Percussion',
        'colorGuard': 'Color Guard',
        'generalEffect': 'General Effect',
        'visualPerformance': 'Visual Performance'
    };
    const sectionType = sectionTypes[emptySlot];

    const availableForSlot = state.allCaptions.filter(c =>
        c.owner === null && c.section === sectionType
    );

    if (availableForSlot.length > 0) {
        // Pick highest scoring caption
        availableForSlot.sort((a, b) => b.score - a.score);
        const pick = availableForSlot[0];

        // Update local state only (CPU teams don't save to backend)
        pick.owner = teamId;
        team.roster[emptySlot] = pick.id;
        state.currentDraftPick++;

        // Continue draft
        if (state.currentDraftPick < state.draftOrder.length) {
            const nextTeamId = getCurrentDraftTeam();
            const nextTeam = getTeam(nextTeamId);
            if (nextTeam && !nextTeam.isReal) {
                setTimeout(() => autoDraft(nextTeamId), 300);
            }
        } else {
            state.draftInProgress = false;
        }

        renderDraftView();
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
            const isYourTurn = currentTeamId === state.currentUserId;
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
    const canDraft = state.draftInProgress && currentTeamId === state.currentUserId && caption.owner === null;

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
    elements.createLeagueBtn.addEventListener('click', async () => {
        const leagueName = elements.leagueNameInput?.value;

        if (await createLeague(leagueName)) {
            // League created successfully, UI will update via loadMyLeagueData
            // Update league info display
            if (elements.leagueInfo) {
                elements.leagueInfo.innerHTML = `
          <div class="league-badge">
            <span class="league-name">${state.league.name}</span>
            <span class="league-players">${state.teams.length}/12 Players</span>
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

// Copy invite link button
if (elements.copyInviteBtn) {
    elements.copyInviteBtn.addEventListener('click', async () => {
        const inviteInput = elements.inviteLink;
        if (inviteInput && inviteInput.value) {
            try {
                await navigator.clipboard.writeText(inviteInput.value);
                elements.copyInviteBtn.textContent = '✓ Copied!';
                setTimeout(() => {
                    elements.copyInviteBtn.textContent = '📋 Copy Link';
                }, 2000);
            } catch (error) {
                // Fallback for browsers that don't support clipboard API
                inviteInput.select();
                document.execCommand('copy');
                elements.copyInviteBtn.textContent = '✓ Copied!';
                setTimeout(() => {
                    elements.copyInviteBtn.textContent = '📋 Copy Link';
                }, 2000);
            }
        }
    });
}

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

// ===== DATA LOADING FUNCTIONS =====
async function loadMyLeagueData() {
    try {
        // Get current user info
        const currentUser = await api.verifySession();
        if (!currentUser) {
            window.location.href = '/auth';
            return false;
        }

        state.currentUser = currentUser;
        state.currentUserId = `user${currentUser.userId}`;

        // Get user's leagues
        const leaguesResponse = await api.request('/leagues/my');

        if (leaguesResponse.leagues && leaguesResponse.leagues.length > 0) {
            // Use first league for now (TODO: add league selector)
            const userLeague = leaguesResponse.leagues[0];

            state.league.id = userLeague.id;
            state.league.name = userLeague.name;
            state.league.maxPlayers = userLeague.max_players || 12;
            state.league.minPlayers = userLeague.min_players || 4;
            state.league.created = true;

            // Get or generate invite token
            try {
                const inviteResponse = await api.request(`/leagues/${userLeague.id}/invite`, {
                    method: 'POST'
                });
                state.league.inviteToken = inviteResponse.token;
            } catch (error) {
                console.error('Failed to get invite token:', error);
            }

            // Load league members
            const membersResponse = await api.request(`/leagues/${userLeague.id}/members`);
            if (membersResponse.members) {
                // Generate teams from members
                state.teams = membersResponse.members.map(member => ({
                    id: `user${member.user_id}`,
                    name: member.team_name,
                    isReal: true,
                    roster: {
                        brass: null,
                        percussion: null,
                        colorGuard: null,
                        generalEffect: null,
                        visualPerformance: null
                    }
                }));

                // Generate draft order based on actual members
                generateDraftOrder(membersResponse.members.length);
            }

            // Load draft picks
            const picksResponse = await api.request(`/draft/${userLeague.id}/picks`);
            if (picksResponse.picks && picksResponse.picks.length > 0) {
                // Apply draft picks to local state
                picksResponse.picks.forEach(pick => {
                    const caption = getCaption(pick.caption_id);
                    if (caption) {
                        caption.owner = `user${pick.user_id}`;
                        const team = state.teams.find(t => t.id === `user${pick.user_id}`);
                        if (team) {
                            const sectionKey = getSectionKey(pick.section_type);
                            team.roster[sectionKey] = pick.caption_id;
                        }
                    }
                });

                state.currentDraftPick = picksResponse.picks.length;
                state.draftInProgress = state.currentDraftPick < (state.league.playerCount * 5);
            } else {
                // No picks yet, draft hasn't started
                state.currentDraftPick = 0;
                state.draftInProgress = false;
            }

            // Update UI to show invite and roster
            updateLeagueInfoPanel();

            return true;
        }

        return false;
    } catch (error) {
        console.error('Error loading league data:', error);
        return false;
    }
}

// ===== INITIALIZATION =====

// Load live caption scores from the DB and update state.allCaptions
async function loadCaptionScores() {
    try {
        const data = await api.request('/stats/corps');
        const sectionMap = {
            'Brass':              'avg_brass',
            'Music Analysis':     'avg_music_analysis',
            'Percussion':         'avg_percussion',
            'Color Guard':        'avg_color_guard',
            'General Effect 1':   'avg_ge1',
            'General Effect 2':   'avg_ge2',
            'Visual Proficiency': 'avg_visual_proficiency',
            'Visual Analysis':    'avg_visual_analysis'
        };
        data.corps.forEach(c => {
            state.allCaptions.forEach(cap => {
                if (cap.corps === c.corps_name) {
                    const field = sectionMap[cap.section];
                    if (field && c[field] != null) {
                        cap.score = parseFloat(c[field]) || 0;
                    }
                }
            });
        });
    } catch (e) {
        // Fall back to hardcoded scores silently
        console.warn('Could not load live caption scores:', e.message);
    }
}

async function init() {
    // Load live scores from DB (falls back to hardcoded if unavailable)
    await loadCaptionScores();

    // Try to load existing league data
    const hasLeague = await loadMyLeagueData();

    if (hasLeague) {
        const urlView = new URLSearchParams(window.location.search).get('view');
        switchView(urlView || 'draft');
        if (state.draftInProgress) {
            renderDraftView();
        }
    } else {
        // No league, show setup
        switchView('leagueSetup');
    }
}

// Start the application
init();
