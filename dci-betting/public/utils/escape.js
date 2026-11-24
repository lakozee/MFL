// Shared HTML-escaping helpers.
// Use escHtml() on any user-controlled value (usernames, team names, league
// names, anything from the server) before putting it into innerHTML or an
// HTML attribute inside a template string.

function escHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Returns the URL only if it is safe to use as an <img src>: http(s),
// a same-site relative path, or an image data: URL. Anything else
// (javascript:, other data: types, etc.) returns ''. The result still
// needs escHtml() when placed inside an HTML attribute.
function safeImageUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^\/(?!\/)/.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(trimmed)) return trimmed;
    return '';
}
