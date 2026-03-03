import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'tb_station',
  user: process.env.POSTGRES_USER || 'tbuser',
  password: process.env.POSTGRES_PASSWORD || 'tbpassword',
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      console.log(`  Running ${file}...`);
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    }

    console.log(`\nAll ${files.length} migration(s) completed successfully.`);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
