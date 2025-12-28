// Avatar Generator Utility
// Generates default SVG avatars with first letter of username

/**
 * Generate a default avatar with the first letter of username
 * @param {string} username - User's username
 * @param {number} size - Size of avatar in pixels (default: 64)
 * @returns {string} - Data URL for SVG image
 */
function generateDefaultAvatar(username, size = 64) {
    if (!username || username.length === 0) {
        username = '?';
    }

    const firstLetter = username[0].toUpperCase();

    // Generate consistent color based on first letter
    const colors = [
        { bg: '#6366f1', text: '#ffffff' }, // Indigo
        { bg: '#8b5cf6', text: '#ffffff' }, // Purple
        { bg: '#ec4899', text: '#ffffff' }, // Pink
        { bg: '#f43f5e', text: '#ffffff' }, // Rose
        { bg: '#f59e0b', text: '#ffffff' }, // Amber
        { bg: '#10b981', text: '#ffffff' }, // Emerald
        { bg: '#06b6d4', text: '#ffffff' }, // Cyan
        { bg: '#3b82f6', text: '#ffffff' }, // Blue
        { bg: '#6366f1', text: '#ffffff' }, // Indigo
        { bg: '#a855f7', text: '#ffffff' }, // Purple
        { bg: '#d946ef', text: '#ffffff' }, // Fuchsia
        { bg: '#f97316', text: '#ffffff' }, // Orange
        { bg: '#84cc16', text: '#ffffff' }, // Lime
        { bg: '#14b8a6', text: '#ffffff' }, // Teal
        { bg: '#0ea5e9', text: '#ffffff' }, // Sky
        { bg: '#6366f1', text: '#ffffff' }, // Indigo
        { bg: '#8b5cf6', text: '#ffffff' }, // Violet
        { bg: '#ec4899', text: '#ffffff' }, // Pink
        { bg: '#ef4444', text: '#ffffff' }, // Red
        { bg: '#eab308', text: '#ffffff' }, // Yellow
        { bg: '#22c55e', text: '#ffffff' }, // Green
        { bg: '#06b6d4', text: '#ffffff' }, // Cyan
        { bg: '#3b82f6', text: '#ffffff' }, // Blue
        { bg: '#818cf8', text: '#ffffff' }, // Indigo
        { bg: '#a78bfa', text: '#ffffff' }, // Violet
        { bg: '#c084fc', text: '#ffffff' }  // Purple
    ];

    // Use letter's char code to pick color consistently
    const colorIndex = firstLetter.charCodeAt(0) % colors.length;
    const color = colors[colorIndex];

    // Create SVG
    const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${color.bg}" rx="${size / 2}" />
      <text
        x="50%"
        y="50%"
        dominant-baseline="middle"
        text-anchor="middle"
        fill="${color.text}"
        font-family="Inter, system-ui, -apple-system, sans-serif"
        font-size="${size * 0.5}"
        font-weight="600"
      >${firstLetter}</text>
    </svg>
  `.trim().replace(/\s+/g, ' ');

    // Convert to data URL
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Check if a URL is a default/placeholder avatar
 * @param {string} url - Avatar URL to check
 * @returns {boolean} - True if default/placeholder
 */
function isDefaultAvatar(url) {
    if (!url) return true;
    if (url === '/default-avatar.png') return true;
    if (url.startsWith('data:image/svg+xml')) return false; // Generated avatars are fine
    return false;
}
