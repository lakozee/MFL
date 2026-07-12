// API Client for Fantasy DCI Backend

const API_BASE = window.location.origin;

class APIClient {
    /**
     * Make an authenticated API request
     */
    async request(endpoint, options = {}) {
        const url = `${API_BASE}/api${endpoint}`;

        // The auth endpoints (login/register/logout) legitimately return 401 to
        // signal "invalid email or password" — those must NOT trigger the
        // session-expiry redirect below; their real message has to reach the form.
        const isAuthEndpoint = endpoint.startsWith('/auth/');

        const config = {
            ...options,
            credentials: 'include', // Send cookies
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);

            // A 401 on a protected endpoint means the session expired —
            // bounce to login. Auth endpoints fall through so their own
            // error message ("Invalid email or password") is surfaced.
            if (response.status === 401 && !isAuthEndpoint) {
                window.location.href = '/auth';
                throw new Error('Authentication required');
            }

            // Handle rate limiting gracefully
            if (response.status === 429) {
                throw new Error('Too many requests. Please wait a moment and try again.');
            }

            // Parse JSON safely — non-JSON responses (e.g. server errors) shouldn't crash the app
            let data;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                throw new Error(text || 'Request failed');
            }

            if (!response.ok) {
                throw new Error(data.error || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    /**
     * Authentication methods
     */
    async register(email, password, username) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password, username })
        });
    }

    async login(email, password) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
    }

    async logout() {
        return this.request('/auth/logout', {
            method: 'POST'
        });
    }

    async verifySession() {
        try {
            // Don't redirect on 401 for session verification
            const url = `${API_BASE}/api/auth/verify`;
            const response = await fetch(url, {
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                return data.authenticated ? data.user : null;
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * User profile methods
     */
    async updateProfilePicture(url) {
        return this.request('/user/profile-picture', {
            method: 'PUT',
            body: JSON.stringify({ profile_picture_url: url })
        });
    }
}

// Export singleton instance
const api = new APIClient();
