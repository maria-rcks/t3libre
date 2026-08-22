import { Client } from 'pg';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadSeeds() {
  if (process.env.SEED_CUSTOMERS) {
    try {
      return JSON.parse(process.env.SEED_CUSTOMERS);
    } catch {
      console.error('SEED_CUSTOMERS environment variable is not valid JSON');
      process.exit(1);
    }
  }
  const seedsPath = path.resolve(__dirname, '../seeds/customers.sample.json');
  try {
    const data = await fs.readFile(seedsPath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Could not load seed file at', seedsPath, e);
    return [];
  }
}

async function main() {
  // Build connection string from env vars or fallback defaults
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || '5432';
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || 'postgres';
  const database = process.env.PGDATABASE || process.env.PGDATABASE || 'postgres';
  const connectionString = process.env.PG_CONNECTION_STRING || `postgres://${user}:${password}@${host}:${port}/${database}`;

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const seeds = await loadSeeds();
    if (!seeds || seeds.length === 0) {
      console.log('[seed] No customers to seed. Exiting.');
      return;
    }
    for (const s of seeds) {
      const owner = s.owner_user_id;
      const name = s.name;
      const email = s.email || null;
      await client.query(
        'INSERT INTO customers (owner_user_id, name, email, created_at) VALUES ($1, $2, $3, NOW())',
        [owner, name, email]
      );
      console.log(`[seed] Created customer ${name} for owner ${owner}`);
    }
    console.log('[seed] Done.');
  } catch (err) {
    console.error('[seed] Error:', err);
  } finally {
    await client.end();
  }
}

main();
