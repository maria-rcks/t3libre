const { EmbedBuilder } = require('discord.js');
const { query } = require('./db');
const { execArgv } = require('./docker');

const CHECK_TYPES = ['ping', 'port', 'process', 'api'];
const DEFAULT_PING_TARGET = '8.8.8.8';
const DEFAULT_PORT_CHECK = 'localhost:22';
const DEFAULT_PROCESS = 'sshd';
const DEFAULT_HEALTH_URL = 'http://localhost:80/health';
const INTERVAL_SECONDS = parseInt(process.env.HEALTH_CHECK_INTERVAL_SECONDS, 10) || 60;

let clientRef = null;
let loopTask = null;
let loopRunning = false;

function init(client) {
  clientRef = client;
  ensureTables().catch((err) => console.error('[HealthChecks] table setup failed:', err.message));
  if (loopTask) return;
  const intervalMs = Math.max(10, INTERVAL_SECONDS) * 1000;
  loopTask = setInterval(() => {
    runLoop().catch((err) => console.error('[HealthChecks] loop error:', err));
  }, intervalMs);
}

function stop() {
  if (loopTask) { clearInterval(loopTask); loopTask = null; }
}

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id SERIAL PRIMARY KEY,
      container_id VARCHAR(255) NOT NULL,
      check_type VARCHAR(20) NOT NULL,
      target VARCHAR(500),
      interval_seconds INT DEFAULT 60,
      last_check TIMESTAMP,
      last_status VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS health_check_results (
      id SERIAL PRIMARY KEY,
      check_id INT REFERENCES health_checks(id),
      status VARCHAR(20),
      response_time_ms INT,
      error_message TEXT,
      checked_at TIMESTAMP
    )
  `);
}

async function runLoop() {
  if (loopRunning) return;
  loopRunning = true;
  try {
    const result = await query('SELECT * FROM health_checks').catch(() => null);
    if (!result) return;
    for (const check of result.rows) {
      const r = await runHealthCheck(check.container_id, check.check_type, check.target);
      await updateCheckStatus(check.id, r.status);
      if (r.status === 'failed') await notifyFailure(check, r);
    }
  } finally {
    loopRunning = false;
  }
}

function isValidPingTarget(value) {
  return /^[a-zA-Z0-9.:-]{1,255}$/.test(value);
}

function isValidHostPort(value) {
  const [host, port] = value.split(':');
  if (!host || !/^[a-zA-Z0-9.:-]{1,255}$/.test(host)) return false;
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function isValidProcessName(value) {
  return /^[a-zA-Z0-9_-]{1,63}$/.test(value);
}

function isValidUrl(value) {
  return /^https?:\/\/[^\s]{1,250}$/.test(value);
}

async function runHealthCheck(containerId, checkType, target = null) {
  const result = { status: 'unknown', response_time_ms: 0, error: null };
  const start = Date.now();
  try {
    if (checkType === 'ping') {
      const pingTarget = target || DEFAULT_PING_TARGET;
      if (!isValidPingTarget(pingTarget)) {
        result.status = 'failed';
        result.error = 'Invalid ping target';
      } else {
        const ok = await execArgv(containerId, ['ping', '-c', '1', '-W', '2', pingTarget]).then(() => true).catch(() => false);
        result.status = ok ? 'passed' : 'failed';
      }
    } else if (checkType === 'port') {
      const [host, port] = (target || DEFAULT_PORT_CHECK).split(':');
      if (!isValidHostPort(`${host}:${port}`)) {
        result.status = 'failed';
        result.error = 'Invalid host:port';
      } else {
        const ok = await execArgv(containerId, ['bash', '-c', `echo >/dev/tcp/${host}/${port}`])
          .then(() => true)
          .catch(() => false);
        result.status = ok ? 'passed' : 'failed';
      }
    } else if (checkType === 'process') {
      const process = target || DEFAULT_PROCESS;
      if (!isValidProcessName(process)) {
        result.status = 'failed';
        result.error = 'Invalid process name';
      } else {
        const ok = await execArgv(containerId, ['pgrep', '-x', process]).then(() => true).catch(() => false);
        result.status = ok ? 'passed' : 'failed';
      }
    } else if (checkType === 'api') {
      const url = target || DEFAULT_HEALTH_URL;
      if (!isValidUrl(url)) {
        result.status = 'failed';
        result.error = 'Invalid URL';
      } else {
        const out = await execArgv(containerId, ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', url])
          .catch(() => '');
        result.status = ['200', '201', '204'].includes(out.trim()) ? 'passed' : 'failed';
      }
    } else {
      result.status = 'unknown';
      result.error = `Unknown check type: ${checkType}`;
    }
  } catch (err) {
    result.status = 'failed';
    result.error = err.message;
  }
  result.response_time_ms = Date.now() - start;
  const checkId = await ensureCheck(containerId, checkType);
  await recordResult(checkId, result);
  return result;
}

async function ensureCheck(containerId, checkType) {
  const found = await query(
    'SELECT id FROM health_checks WHERE container_id = $1 AND check_type = $2 ORDER BY created_at DESC LIMIT 1',
    [containerId, checkType]
  ).catch(() => ({ rows: [] }));
  if (found.rows.length) return found.rows[0].id;
  const inserted = await query(
    `INSERT INTO health_checks (container_id, check_type, interval_seconds)
     VALUES ($1, $2, $3) RETURNING id`,
    [containerId, checkType, INTERVAL_SECONDS]
  ).catch(() => ({ rows: [] }));
  return inserted.rows.length ? inserted.rows[0].id : null;
}

async function updateCheckStatus(checkId, status) {
  await query(
    'UPDATE health_checks SET last_check = NOW(), last_status = $2 WHERE id = $1',
    [checkId, status]
  ).catch((err) => console.error('[HealthChecks] status update failed:', err.message));
}

async function recordResult(checkId, result) {
  if (!checkId) return;
  await query(
    `INSERT INTO health_check_results
     (check_id, status, response_time_ms, error_message, checked_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [checkId, result.status, result.response_time_ms, result.error]
  ).catch(() => {});
}

async function notifyFailure(check, result) {
  try {
    const owner = await query(
      'SELECT user_id FROM vps_containers WHERE container_id = $1',
      [check.container_id]
    );
    if (!owner.rows.length) return;
    const user = await clientRef.users.fetch(owner.rows[0].user_id).catch(() => null);
    if (!user) return;
    const embed = new EmbedBuilder()
      .setTitle('Health Check Failed')
      .setColor(0xff0000)
      .addFields(
        { name: 'Container', value: check.container_id.slice(0, 12), inline: true },
        { name: 'Check Type', value: check.check_type, inline: true },
        { name: 'Response', value: `${result.response_time_ms}ms`, inline: true },
        { name: 'Error', value: result.error || 'Unknown', inline: false }
      );
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error('[HealthChecks] failure notify error:', err.message);
  }
}

async function listForUser(userId) {
  try {
    const result = await query(
      `SELECT hc.* FROM health_checks hc
       JOIN vps_containers vc ON vc.container_id = hc.container_id
       WHERE vc.user_id = $1
       ORDER BY hc.created_at DESC`,
      [userId]
    );
    return result.rows;
  } catch (err) {
    console.error('[HealthChecks] list failed:', err.message);
    return [];
  }
}

const COMMAND_SPECS = [
  {
    name: 'health',
    description: 'Run health check on a VPS',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'healthcreate',
    description: 'Create a health check for a VPS',
    options: [
      { name: 'container_id', description: 'Container ID or name', type: 3, required: true },
      { name: 'check_type', description: 'ping/port/process/api', type: 3, required: true },
      { name: 'target', description: 'Target (host:port, process name, URL)', type: 3, required: false },
    ],
  },
  { name: 'healthlist', description: 'List active health checks', type: 1 },
];

function toSpec() {
  return COMMAND_SPECS;
}

function isParsed(name) {
  return COMMAND_SPECS.some((c) => c.name === name);
}

async function handle(interaction) {
  const { commandName, options } = interaction;
  try {
    await ensureTables();
  } catch (err) {
    console.error('[HealthChecks] table setup failed:', err.message);
  }
  if (commandName === 'health') {
    await interaction.deferReply({ ephemeral: true });
    const input = options.getString('container_id');
    const vpsManager = require('./vpsManager');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
    if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
    const embed = new EmbedBuilder()
      .setTitle(`Health Check: ${owned.container_id.slice(0, 12)}`)
      .setColor(0x3498db)
      .setTimestamp();
    for (const checkType of CHECK_TYPES) {
      const r = await runHealthCheck(owned.container_id, checkType);
      const emoji = r.status === 'passed' ? '✅' : '❌';
      embed.addFields({ name: checkType, value: `${emoji} ${r.status} (${r.response_time_ms}ms)`, inline: true });
    }
    return interaction.editReply({ embeds: [embed] });
  }
  if (commandName === 'healthcreate') {
    await interaction.deferReply({ ephemeral: true });
    const input = options.getString('container_id');
    const checkType = options.getString('check_type').toLowerCase();
    const target = options.getString('target');
    const vpsManager = require('./vpsManager');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
    if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
    if (!CHECK_TYPES.includes(checkType)) {
      return interaction.editReply({ content: `❌ Invalid type. Options: ${CHECK_TYPES.join(', ')}` });
    }
    try {
      await query(
        `INSERT INTO health_checks (container_id, check_type, target, interval_seconds)
         VALUES ($1, $2, $3, $4)`,
        [owned.container_id, checkType, target, INTERVAL_SECONDS]
      );
      return interaction.editReply({
        content: `✅ Health check created: ${checkType} on \`${owned.container_id.slice(0, 12)}\``,
      });
    } catch (err) {
      return interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }
  if (commandName === 'healthlist') {
    await interaction.deferReply({ ephemeral: true });
    const checks = await listForUser(interaction.user.id);
    if (!checks.length) {
      return interaction.editReply({ content: 'No health checks configured.' });
    }
    const embed = new EmbedBuilder().setTitle('Health Checks').setColor(0x3498db);
    for (const c of checks) {
      embed.addFields({
        name: `${c.check_type} - ${c.container_id.slice(0, 12)}`,
        value: `Status: ${c.last_status || 'pending'}\nTarget: ${c.target || 'N/A'}\nInterval: ${c.interval_seconds}s`,
        inline: false,
      });
    }
    return interaction.editReply({ embeds: [embed] });
  }
  return null;
}

module.exports = { init, stop, toSpec, isParsed, handle, runHealthCheck };