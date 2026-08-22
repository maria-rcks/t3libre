const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const { docker, inspect, execArgv } = require('./docker');
const { query } = require('./db');

const COMMAND_SPECS = [
  {
    name: 'database',
    description: 'Database management commands',
    options: [
      { name: 'create', description: 'Create a MySQL database', type: 1, options: [
        { name: 'name', description: 'Database name', type: 3, required: true },
        { name: 'app_id', description: 'Optional app id', type: 3, required: false },
      ] },
      { name: 'list', description: 'List your databases', type: 1 },
      { name: 'delete', description: 'Delete a database', type: 1, options: [
        { name: 'db_id', description: 'Database id', type: 3, required: true },
      ] },
      { name: 'info', description: 'Get database connection info (DM)', type: 1, options: [
        { name: 'db_id', description: 'Database id', type: 3, required: true },
      ] },
    ],
  },
];

function toSpec() {
  return COMMAND_SPECS;
}

function isParsed(name) {
  return COMMAND_SPECS.some((c) => c.name === name);
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS managed_databases (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      container_name VARCHAR(255),
      container_id VARCHAR(255),
      host VARCHAR(255),
      port INT,
      username VARCHAR(255),
      password VARCHAR(255),
      connection_string TEXT,
      user_id VARCHAR(255) NOT NULL,
      app_id VARCHAR(255),
      status VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query('ALTER TABLE managed_databases DROP COLUMN IF EXISTS root_password');
}

function generatePassword(length = 24) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  return Array.from({ length }, () => chars[crypto.randomInt(0, chars.length)]).join('');
}

function isValidDbName(dbName) {
  if (typeof dbName !== 'string' || !dbName.length) return false;
  if (dbName.length > 64) return false;
  if (/[/\\\.]/.test(dbName)) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(dbName);
}

async function waitForReady(containerName, rootPassword, maxWaitMs = 60000) {
  const interval = 2000;
  const attempts = Math.max(1, Math.floor(maxWaitMs / interval));
  for (let i = 0; i < attempts; i++) {
    try {
      const out = await execArgv(containerName, [
        'mysqladmin', 'ping', '-h', '127.0.0.1', '-uroot', `-p${rootPassword}`, '--silent',
      ]);
      if (out.includes('alive')) return true;
    } catch (err) {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

async function createDatabase(dbName, userId, appId = null) {
  if (!isValidDbName(dbName)) {
    return { error: 'Invalid database name: use letters, digits, _ or - (max 64 chars, no /, \\ or .)' };
  }
  const dbPassword = generatePassword();
  const rootPassword = generatePassword();
  const containerName = `mysql-${dbName}-${userId.slice(0, 8)}`;
  try {
    const existing = await inspect(containerName).catch(() => null);
    if (existing) return { error: `Container ${containerName} already exists` };
  } catch (err) {
    /* not found */
  }

  try {
    await docker([
      'run', '-d', '--name', containerName,
      '-e', `MYSQL_ROOT_PASSWORD=${rootPassword}`,
      '-e', `MYSQL_DATABASE=${dbName}`,
      '-e', `MYSQL_USER=${dbName}`,
      '-e', `MYSQL_PASSWORD=${dbPassword}`,
      '-P',
      '--restart', 'always',
      '-l', 'managed_by=infra-pilot',
      '-l', `db_name=${dbName}`,
      '-l', `user_id=${userId}`,
      'mysql:8.0',
    ], { timeout: 120000 });
    const ready = await waitForReady(containerName, rootPassword);
    const info = await inspect(containerName);
    const port = info.NetworkSettings && info.NetworkSettings.Ports
      && info.NetworkSettings.Ports['3306/tcp']
      && info.NetworkSettings.Ports['3306/tcp'][0]
      ? info.NetworkSettings.Ports['3306/tcp'][0].HostPort
      : '3306';
    const host = process.env.HOST_IP || '127.0.0.1';
    const dbId = `db_${Date.now().toString(36)}`;
    const status = ready ? 'running' : 'not_ready';
    const record = {
      id: dbId,
      name: dbName,
      container_name: containerName,
      container_id: info.Id,
      host,
      port: parseInt(port, 10),
      username: dbName,
      password: dbPassword,
      connection_string: `mysql://${dbName}:${dbPassword}@${host}:${port}/${dbName}`,
      user_id: userId,
      app_id: appId,
      status,
    };
    await query(
      `INSERT INTO managed_databases
       (id, name, container_name, container_id, host, port, username, password, connection_string, user_id, app_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [dbId, dbName, containerName, info.Id, host, record.port, dbName, dbPassword, record.connection_string, userId, appId, status]
    );
    return record;
  } catch (err) {
    return { error: err.message };
  }
}

async function deleteDatabase(dbId, userId) {
  const result = await query(
    'SELECT * FROM managed_databases WHERE id = $1 AND user_id = $2',
    [dbId, userId]
  ).catch(() => ({ rows: [] }));
  if (!result.rows.length) return false;
  const db = result.rows[0];
  await docker(['rm', '-f', db.container_id], { timeout: 60000 });
  await query('DELETE FROM managed_databases WHERE id = $1', [dbId]);
  return true;
}

async function getDatabasesForUser(userId) {
  const result = await query(
    'SELECT id, name, port, status FROM managed_databases WHERE user_id = $1 ORDER BY created_at',
    [userId]
  ).catch(() => ({ rows: [] }));
  return result.rows;
}

async function getDatabase(dbId, userId) {
  const result = await query(
    'SELECT * FROM managed_databases WHERE id = $1 AND user_id = $2',
    [dbId, userId]
  ).catch(() => ({ rows: [] }));
  return result.rows[0] || null;
}

async function handle(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    await ensureTable();
  } catch (err) {
    console.error('[DbManager] table setup failed:', err.message);
  }
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') {
    const name = interaction.options.getString('name');
    const appId = interaction.options.getString('app_id');
    const result = await createDatabase(name, interaction.user.id, appId);
    if (result.error) return interaction.editReply({ content: `❌ Failed to create database: ${result.error}` });
    await interaction.user.send(
      `**✅ Database Created: ${name}**\n\n` +
      '```\n' +
      `Host: ${result.host}\nPort: ${result.port}\nDatabase: ${result.name}\nUsername: ${result.username}\nPassword: ${result.password}\nConnection String: ${result.connection_string}\n` +
      '```\n⚠️ Save these credentials securely!'
    ).catch(() => {});
    return interaction.editReply({ content: `✅ Database **${name}** created! Check your DMs for credentials.` });
  }
  if (sub === 'list') {
    const databases = await getDatabasesForUser(interaction.user.id);
    if (!databases.length) return interaction.editReply({ content: 'No databases created yet.' });
    const embed = new EmbedBuilder()
      .setTitle('Your Databases')
      .setColor(0x28a745)
      .addFields(databases.map((db) => ({
        name: db.name,
        value: `Port: ${db.port} — Status: ${db.status} — ID: \`${db.id}\``,
        inline: false,
      })));
    return interaction.editReply({ embeds: [embed] });
  }
  if (sub === 'delete') {
    const dbId = interaction.options.getString('db_id');
    try {
      const ok = await deleteDatabase(dbId, interaction.user.id);
      return interaction.editReply({ content: ok ? '🗑️ Database deleted successfully.' : '❌ Database not found or access denied.' });
    } catch (err) {
      console.error('[DbManager] delete failed:', err.message);
      return interaction.editReply({ content: `❌ Failed to delete database: ${err.message}` });
    }
  }
  if (sub === 'info') {
    const dbId = interaction.options.getString('db_id');
    const db = await getDatabase(dbId, interaction.user.id);
    if (!db) return interaction.editReply({ content: '❌ Database not found or access denied.' });
    await interaction.user.send(
      `**Database: ${db.name}**\n\n` +
      '```\n' +
      `Host: ${db.host}\nPort: ${db.port}\nDatabase: ${db.name}\nUsername: ${db.username}\nPassword: ${db.password}\n` +
      '```'
    ).then(() => interaction.editReply({ content: '✅ Database info sent via DM.' }))
      .catch(() => interaction.editReply({ content: '❌ Could not DM you. Please check your privacy settings.' }));
    return;
  }
  return null;
}

module.exports = { toSpec, isParsed, handle, ensureTable, createDatabase, deleteDatabase };