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

        // Execute each statement individually so one failure cannot block
        // the rest (e.g. a redundant ALTER TABLE won't abort the seed INSERT).
        const statements = sql
            .replace(/--[^\n]*/g, '')   // strip line comments
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        let warnings = 0;
        for (const stmt of statements) {
            try {
                await client.query(stmt);
            } catch (err) {
                console.warn(`[init-db] warning: ${err.message.split('\n')[0]}`);
                warnings++;
            }
        }

        // One-time migration: clear all leagues when moving to v2 caption system
        try {
            const migCheck = await client.query(
                "SELECT 1 FROM schema_migrations WHERE migration_name = 'clear_leagues_v2_captions' LIMIT 1"
            );
            if (migCheck.rows.length === 0) {
                await client.query('DELETE FROM draft_picks');
                await client.query('DELETE FROM draft_sessions');
                await client.query('DELETE FROM league_members');
                await client.query('DELETE FROM leagues');
                await client.query(
                    "INSERT INTO schema_migrations (migration_name) VALUES ('clear_leagues_v2_captions')"
                );
                console.log('[init-db] Migration: cleared all leagues for v2 caption system');
            }
        } catch (err) {
            console.warn('[init-db] Migration warning:', err.message.split('\n')[0]);
        }

        client.release();

        console.log(`[init-db] Schema applied — ${warnings} warning(s).`);
    } catch (err) {
        console.error('[init-db] ERROR: Failed to initialize database:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

initDb();
