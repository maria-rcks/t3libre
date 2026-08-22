const { Pool } = require('pg');

let _dbPool = null;

function getDbPool() {
  if (!_dbPool) {
    _dbPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER || 'infra_pilot',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'infra_pilot',
      max: 5,
      connectionTimeoutMillis: 10000,
    });
    _dbPool.on('error', (err) => {
      console.error('[DB] idle client error:', err.message);
    });
  }
  return _dbPool;
}

async function query(text, params) {
  return getDbPool().query(text, params);
}

module.exports = { getDbPool, query };