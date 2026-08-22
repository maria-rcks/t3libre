const cron = require('node-cron');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const QuickChart = require('quickchart-js');
const { query } = require('./db');
const { containers, inspect, stats, exec } = require('./docker');

const DEFAULT_ALERT_THRESHOLDS = { cpu: 80, memory: 80, disk: 80 };

let clientRef = null;
const statsCache = new Map();
const alertThresholds = { ...DEFAULT_ALERT_THRESHOLDS };
let collectorTask = null;
let presenceTask = null;

function init(client) {
  clientRef = client;
  if (collectorTask) return;
  collectorTask = cron.schedule('* * * * *', () => collectLoop().catch((err) => {
    console.error('[Monitoring] collect loop error:', err);
  }));
  presenceTask = cron.schedule('*/5 * * * *', () => updatePresence().catch(() => {}));
}

function stop() {
  if (collectorTask) { collectorTask.stop(); collectorTask = null; }
  if (presenceTask) { presenceTask.stop(); presenceTask = null; }
}

async function collectLoop() {
  const list = await containers();
  for (const c of list) {
    const collected = await collectContainerStats(c);
    if (!collected) continue;
    statsCache.set(c.Id, collected);
    await checkAlerts(c.Id, collected);
    await updateDbStats(c.Id, collected);
  }
}

async function collectContainerStats(c) {
  try {
    const raw = await stats(c.Id);
    const diskPercent = await diskUsage(c.Id);
    const info = await inspect(c.Id);
    return {
      timestamp: new Date().toISOString(),
      container_id: c.Id,
      name: c.Name,
      status: info.State && info.State.Status,
      cpu_usage: parseFloat(raw.cpu.replace('%', '')) || 0,
      memory_usage: parseFloat(raw.memPerc.replace('%', '')) || 0,
      memory_used: parseRawBytes(raw.memUsage.split('/')[0]),
      memory_total: parseRawBytes(raw.memUsage.split('/')[1]),
      network: parseNetIO(raw.netIO),
      disk_usage: diskPercent,
    };
  } catch (err) {
    return null;
  }
}

function parseRawBytes(value) {
  const match = String(value).trim().match(/^([\d.]+)\s*([kKMGTP]?i?B)$/);
  if (!match) return 0;
  const units = {
    B: 1,
    kB: 1024, KB: 1024, KiB: 1024,
    MB: 1024 ** 2, MiB: 1024 ** 2,
    GB: 1024 ** 3, GiB: 1024 ** 3,
    TB: 1024 ** 4, TiB: 1024 ** 4,
    PB: 1024 ** 5, PiB: 1024 ** 5,
  };
  return Math.round(parseFloat(match[1]) * (units[match[2]] || 1));
}

function parseNetIO(value) {
  if (!value) return { rx: 0, tx: 0 };
  const [rxRaw, txRaw] = String(value).split('/');
  return { rx: parseRawBytes(rxRaw), tx: parseRawBytes(txRaw) };
}

async function diskUsage(containerId) {
  try {
    const out = await exec(containerId, 'df -h /');
    const lines = out.split('\n');
    if (lines.length < 2) return 0;
    const parts = lines[1].split(/\s+/);
    return parseFloat(String(parts[4]).replace('%', '')) || 0;
  } catch (err) {
    return 0;
  }
}

async function updateDbStats(containerId, s) {
  try {
    await query(
      `INSERT INTO vps_statistics
       (container_id, cpu_usage, memory_usage, memory_used, memory_total, network_rx, network_tx, disk_usage, status, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        containerId,
        s.cpu_usage,
        s.memory_usage,
        s.memory_used,
        s.memory_total,
        s.network.rx || 0,
        s.network.tx || 0,
        s.disk_usage,
        s.status,
        s.timestamp,
      ]
    );
    await query(
      `INSERT INTO vps_peak_statistics (container_id, peak_cpu, peak_memory, peak_network)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (container_id) DO UPDATE SET
         peak_cpu = GREATEST(vps_peak_statistics.peak_cpu, EXCLUDED.peak_cpu),
         peak_memory = GREATEST(vps_peak_statistics.peak_memory, EXCLUDED.peak_memory),
         peak_network = GREATEST(vps_peak_statistics.peak_network, EXCLUDED.peak_network),
         last_updated = NOW()`,
      [containerId, s.cpu_usage, s.memory_usage, Math.max(s.network.rx || 0, s.network.tx || 0)]
    );
  } catch (err) {
    console.error('[Monitoring] DB stats update failed:', err.message);
  }
}

const alertState = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

async function checkAlerts(containerId, s) {
  const candidates = [];
  if (s.cpu_usage > alertThresholds.cpu) candidates.push(['cpu', `High CPU: ${s.cpu_usage}%`]);
  if (s.memory_usage > alertThresholds.memory) candidates.push(['memory', `High Memory: ${s.memory_usage}%`]);
  if (s.disk_usage > alertThresholds.disk) candidates.push(['disk', `High Disk: ${s.disk_usage}%`]);
  const now = Date.now();
  const alerts = [];
  for (const [metric, message] of candidates) {
    const key = `${containerId}:${metric}`;
    const lastNotified = alertState.get(key) || 0;
    if (now - lastNotified >= ALERT_COOLDOWN_MS) {
      alertState.set(key, now);
      alerts.push(message);
    }
  }
  if (alerts.length) await sendAlert(containerId, alerts);
}

async function sendAlert(containerId, alerts) {
  try {
    const result = await query(
      'SELECT user_id FROM vps_containers WHERE container_id = $1',
      [containerId]
    );
    if (!result.rows.length) return;
    const user = await clientRef.users.fetch(result.rows[0].user_id).catch(() => null);
    if (!user) return;
    const embed = new EmbedBuilder()
      .setTitle('VPS Resource Alert')
      .setDescription(`Container: \`${containerId.slice(0, 12)}\``)
      .setColor(0xff0000)
      .addFields({ name: 'Alerts', value: alerts.join('\n'), inline: false });
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Monitoring] alert send failed:', err.message);
  }
}

async function updatePresence() {
  if (!clientRef) return;
  const count = (await containers()).length;
  clientRef.user.setActivity(`VPS: ${count} containers`);
}

async function getUsageHistory(containerId, periodHours = 24) {
  try {
    const result = await query(
      `SELECT cpu_usage, memory_usage, disk_usage, timestamp
       FROM vps_statistics
       WHERE container_id = $1 AND timestamp > NOW() - ($2 * INTERVAL '1 hour')
       ORDER BY timestamp ASC`,
      [containerId, periodHours]
    );
    return result.rows;
  } catch (err) {
    console.error('[Monitoring] history query failed:', err.message);
    return [];
  }
}

async function renderGraph(containerId, metric, periodHours) {
  const history = await getUsageHistory(containerId, periodHours);
  if (!history.length) return null;
  const column = { cpu: 'cpu_usage', memory: 'memory_usage', disk: 'disk_usage' }[metric] || 'cpu_usage';
  const chart = new QuickChart();
  chart.setWidth(800);
  chart.setHeight(320);
  chart.setConfig({
    type: 'line',
    data: {
      labels: history.map((r) => String(r.timestamp).slice(11, 16)),
      datasets: [{
        label: `${metric.toUpperCase()} %`,
        data: history.map((r) => Number(r[column]) || 0),
        borderColor: '#00d2ff',
        backgroundColor: 'rgba(0, 210, 255, 0.1)',
        fill: true,
        tension: 0.2,
      }],
    },
    options: {
      title: { display: true, text: `${metric.toUpperCase()} Usage - Last ${periodHours}h`, fontColor: '#000' },
      legend: { display: false },
      scales: {
        x: { ticks: { color: '#666' }, grid: { color: 'rgba(0,0,0,0.08)' } },
        y: { ticks: { color: '#666' }, grid: { color: 'rgba(0,0,0,0.08)' } },
      },
    },
  });
  const buffer = await chart.toBinary();
  return new AttachmentBuilder(buffer, { name: `${metric}_graph.png` });
}

const COMMAND_SPECS = [
  {
    name: 'vpsgraph',
    description: 'Generate resource usage graph',
    options: [
      { name: 'container_id', description: 'Container ID or name', type: 3, required: true },
      { name: 'metric', description: 'cpu/memory/disk', type: 3, required: false },
      { name: 'period', description: 'Period in hours (default 24)', type: 4, required: false },
    ],
  },
  {
    name: 'setalertthreshold',
    description: 'Set alert threshold (Admin)',
    options: [
      { name: 'resource', description: 'cpu/memory/disk', type: 3, required: true },
      { name: 'threshold', description: 'Threshold percentage (0-100)', type: 10, required: true },
    ],
  },
];

function toSpec() {
  return COMMAND_SPECS;
}

function isParsed(name) {
  return COMMAND_SPECS.some((c) => c.name === name);
}

const ADMIN_IDS = new Set(String(process.env.WHITELIST_IDS || '').split(',').filter(Boolean));

async function handle(interaction) {
  const { commandName, options } = interaction;
  if (commandName === 'vpsgraph') {
    await interaction.deferReply({ ephemeral: true });
    const containerId = options.getString('container_id');
    const metric = (options.getString('metric') || 'cpu').toLowerCase();
    const period = options.getInteger('period') || 24;
    const vpsManager = require('./vpsManager');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, containerId);
    if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
    const file = await renderGraph(owned.container_id, metric, period);
    if (!file) return interaction.editReply({ content: '❌ No data available for this VPS yet' });
    return interaction.editReply({ files: [file] });
  }
  if (commandName === 'setalertthreshold') {
    if (!ADMIN_IDS.has(interaction.user.id)) {
      return interaction.reply({ content: '❌ Admin only.', ephemeral: true });
    }
    const resource = options.getString('resource').toLowerCase();
    const threshold = options.getNumber('threshold');
    if (!(resource in DEFAULT_ALERT_THRESHOLDS) || threshold < 0 || threshold > 100) {
      return interaction.reply({ content: '❌ Invalid resource or threshold.', ephemeral: true });
    }
    alertThresholds[resource] = threshold;
    return interaction.reply({ content: `✅ Threshold for ${resource} set to ${threshold}%`, ephemeral: true });
  }
  return null;
}

module.exports = { init, stop, toSpec, isParsed, handle, getUsageHistory, getStatsCache: statsCache };