/**
 * DCI Scores Scraper
 * Targets: https://www.dci.org/scores
 *
 * NOTE: DCI's website may render content via JavaScript (React/Next.js).
 * If the selectors below return no results, the page likely requires a
 * headless browser (e.g. Puppeteer). The structure here supports swapping
 * the fetch layer without changing any of the parsing or DB logic.
 *
 * Selectors marked "// ADJUST" may need updating after inspecting the live page.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const DCI_BASE_URL = 'https://www.dci.org';
const DCI_SCORES_URL = 'https://www.dci.org/scores';
const DCI_EVENTS_URL = 'https://www.dci.org/events/';
const CURRENT_SEASON = 2025;

// ─── HTTP client ──────────────────────────────────────────────────────────────

const httpClient = axios.create({
    timeout: 20000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
    },
});

async function fetchPage(url) {
    const response = await httpClient.get(url);
    return cheerio.load(response.data);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseScore(text) {
    if (!text) return null;
    const num = parseFloat(String(text).replace(/[^\d.]/g, ''));
    return isNaN(num) ? null : num;
}

function parseDate(text) {
    if (!text) return null;
    const cleaned = String(text).trim();
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    // Try common DCI formats: "June 21, 2025" / "Jun 21" / "2025-06-21"
    const match = cleaned.match(/(\w+ \d{1,2},?\s*\d{4}|\d{4}-\d{2}-\d{2})/);
    if (match) {
        const d = new Date(match[1]);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }
    return null;
}

function resolveUrl(href) {
    if (!href) return null;
    if (href.startsWith('http')) return href;
    return `${DCI_BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
}

// ─── Scrape competition list from main scores page ────────────────────────────
//
// Returns: Array of { name, date, location, source_url, season }
//
async function scrapeCompetitionList() {
    const $ = await fetchPage(DCI_SCORES_URL);
    const competitions = [];

    // ADJUST: These selectors target common patterns on DCI's scores page.
    // Inspect the live page and update to match the actual HTML structure.
    const candidateSelectors = [
        '[class*="event-item"]',
        '[class*="show-item"]',
        '[class*="competition-item"]',
        '[class*="scores-event"]',
        'article[class*="event"]',
        'li[class*="event"]',
        'tr[class*="event"]',
    ];

    let rows = [];
    for (const sel of candidateSelectors) {
        rows = $(sel).toArray();
        if (rows.length > 0) break;
    }

    // Fallback: look for any anchor that links to a sub-scores page
    if (rows.length === 0) {
        $('a[href*="/scores/"]').each((_, el) => {
            const href = $(el).attr('href');
            const name = $(el).text().trim();
            if (name && href && href !== '/scores') {
                competitions.push({
                    name,
                    date: null,
                    location: null,
                    source_url: resolveUrl(href),
                    season: CURRENT_SEASON,
                });
            }
        });
        return dedupe(competitions);
    }

    for (const row of rows) {
        const el = $(row);

        // ADJUST: name, date, location selectors
        const name = el.find('[class*="name"], [class*="title"], h2, h3, h4').first().text().trim()
            || el.find('a').first().text().trim();

        const dateText = el.find('[class*="date"], time').first().text().trim()
            || el.find('[class*="date"], time').first().attr('datetime');

        const location = el.find('[class*="location"], [class*="venue"], [class*="city"], [class*="site"]').first().text().trim()
            || null;

        const href = el.find('a').first().attr('href')
            || (el.is('a') ? el.attr('href') : null);

        if (!name) continue;

        competitions.push({
            name,
            date: parseDate(dateText),
            location: location || null,
            source_url: resolveUrl(href),
            season: CURRENT_SEASON,
        });
    }

    return dedupe(competitions);
}

// ─── Scrape scores for one competition ────────────────────────────────────────
//
// Returns: Array of { corps_name, brass, percussion, guard, ge, visual, total_score }
//
async function scrapeCompetitionScores(sourceUrl) {
    if (!sourceUrl) throw new Error('No source URL stored for this competition — sync all first to discover URLs.');

    const $ = await fetchPage(sourceUrl);
    const scores = [];

    // ADJUST: Selector for individual corps score rows
    const candidateRowSelectors = [
        'tbody tr',
        '[class*="corps-row"]',
        '[class*="ensemble-row"]',
        '[class*="score-row"]',
        '[class*="result-row"]',
    ];

    let rows = [];
    for (const sel of candidateRowSelectors) {
        rows = $(sel).toArray();
        if (rows.length > 0) break;
    }

    for (const row of rows) {
        const el = $(row);
        const cells = el.find('td');

        // ADJUST: corps name and caption score column positions / class names
        const corpsName = el.find('[class*="corps"], [class*="name"], [class*="ensemble"]').first().text().trim()
            || cells.eq(0).text().trim();

        if (!corpsName || corpsName.toLowerCase().includes('corps')) continue; // skip header rows

        // Try class-based extraction first, fall back to column index
        const brass = parseScore(
            el.find('[class*="brass"]').text() || cells.eq(1).text()
        );
        const percussion = parseScore(
            el.find('[class*="perc"]').text() || cells.eq(2).text()
        );
        const guard = parseScore(
            el.find('[class*="guard"], [class*="color"]').text() || cells.eq(3).text()
        );
        const ge = parseScore(
            el.find('[class*="effect"], [class*="ge"]').text() || cells.eq(4).text()
        );
        const visual = parseScore(
            el.find('[class*="visual"]').text() || cells.eq(5).text()
        );
        const total = parseScore(
            el.find('[class*="total"], [class*="final"]').text() || cells.eq(6).text()
        ) || sumScores(brass, percussion, guard, ge, visual);

        // Skip rows where nothing parsed (likely header/footer rows)
        if (!brass && !percussion && !guard && !ge && !visual) continue;

        scores.push({
            corps_name: corpsName,
            brass: brass || 0,
            percussion: percussion || 0,
            guard: guard || 0,
            ge: ge || 0,
            visual: visual || 0,
            total_score: total || 0,
        });
    }

    return scores;
}

function sumScores(...vals) {
    const sum = vals.reduce((acc, v) => acc + (v || 0), 0);
    return sum > 0 ? Math.round(sum * 100) / 100 : null;
}

function dedupe(competitions) {
    const seen = new Set();
    return competitions.filter(c => {
        const key = c.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Detect whether a competition is a named championship event.
 * Returns 'championship' for the seven qualifying named shows,
 * 'regular' for all other competitions.
 */
function detectCompetitionType(name) {
    const n = name.toLowerCase();
    if (
        n.includes('san antonio') ||
        n.includes('southeastern') ||
        n.includes('midwestern') ||
        n.includes('allentown') ||
        n.includes('prelim') ||
        n.includes('semi') ||
        (n.includes('finals') && !n.includes('semi') && !n.includes('prelim'))
    ) {
        return 'championship';
    }
    return 'regular';
}

// ─── Scrape events from dci.org/events/ ──────────────────────────────────────
//
// Returns: Array of { name, date, location, source_url, season }
//
async function scrapeEvents() {
    const $ = await fetchPage(DCI_EVENTS_URL);
    const events = [];

    // ADJUST: Try common event listing selectors
    const candidateSelectors = [
        '[class*="event-item"]',
        '[class*="event-card"]',
        '[class*="event-listing"]',
        'article[class*="event"]',
        'li[class*="event"]',
        '[class*="show-item"]',
    ];

    let rows = [];
    for (const sel of candidateSelectors) {
        rows = $(sel).toArray();
        if (rows.length > 0) break;
    }

    // Fallback: any anchor linking to /events/ sub-pages
    if (rows.length === 0) {
        $('a[href*="/events/"]').each((_, el) => {
            const href = $(el).attr('href');
            const name = $(el).text().trim();
            if (name && href && href !== '/events/' && href !== '/events') {
                events.push({
                    name,
                    date: null,
                    location: null,
                    source_url: resolveUrl(href),
                    season: CURRENT_SEASON,
                });
            }
        });
        return dedupe(events);
    }

    for (const row of rows) {
        const el = $(row);

        const name = el.find('[class*="name"], [class*="title"], h2, h3, h4').first().text().trim()
            || el.find('a').first().text().trim();

        const dateText = el.find('[class*="date"], time').first().text().trim()
            || el.find('time').first().attr('datetime');

        const location = el.find('[class*="location"], [class*="venue"], [class*="city"]').first().text().trim()
            || null;

        const href = el.find('a').first().attr('href')
            || (el.is('a') ? el.attr('href') : null);

        if (!name) continue;

        events.push({
            name,
            date: parseDate(dateText),
            location: location || null,
            source_url: resolveUrl(href),
            season: CURRENT_SEASON,
        });
    }

    return dedupe(events);
}

module.exports = {
    scrapeCompetitionList,
    scrapeCompetitionScores,
    scrapeEvents,
    detectCompetitionType,
    DCI_SCORES_URL,
    DCI_EVENTS_URL,
};
