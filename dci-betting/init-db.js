/**
 * Database initializer — runs before the server starts.
 * Executes database/schema.sql against the DATABASE_URL.
 * Safe to run multiple times (all statements are idempotent).
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function initDb() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('[init-db] ERROR: DATABASE_URL is not set. Cannot initialize database.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 10000,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('[init-db] Connecting to database...');
        const client = await pool.connect();
        console.log('[init-db] Connected. Running schema...');

        const schemaPath = path.join(__dirname, 'database', 'schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');

        await client.query(sql);
        client.release();

        console.log('[init-db] Schema applied successfully.');
    } catch (err) {
        console.error('[init-db] ERROR: Failed to initialize database:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

initDb();
