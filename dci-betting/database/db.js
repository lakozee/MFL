const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
    console.log('[db] Connected to PostgreSQL');
});

// Log pool errors but do NOT exit — let Express keep running and return 500s
pool.on('error', (err) => {
    console.error('[db] Unexpected pool error:', err.message);
});

const query = async (text, params) => {
    try {
        return await pool.query(text, params);
    } catch (error) {
        console.error('[db] Query error:', error.message, '|', text.slice(0, 120));
        throw error;
    }
};

const transaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

module.exports = { query, transaction, pool };
