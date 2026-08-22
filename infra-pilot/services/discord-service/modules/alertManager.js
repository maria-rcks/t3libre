const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { query } = require('./db');

const ALERT_TYPES = ['cpu_usage', 'memory_usage', 'disk_usage'];

let clientRef = null;
let loopTask = null;

function init(client) {
  clientRef = client;
  if (loopTask) return;
  loopTask = cron.schedule('*/2 * * * *', () => {
    alertCheckLoop().catch((err) => console.error('[AlertManager] loop error:', err));
  });
}

function stop() {
  if (loopTask) { loopTask.stop(); loopTask = null; }
}

async function alertCheckLoop() {
  const result = await query('SELECT * FROM alerts WHERE enabled = TRUE').catch(() => null);
  if (!result) return;
  for (const alert of result.rows) {
    await evaluateAlert(alert);
  }
}

async function evaluateAlert(alert) {
  if (!alert.container_id) return;
  const vpsManager = require('./vpsManager');
  const stats = await vpsManager.getVpsStats(alert.container_id);
  if (!stats) return;
  const currentValue = Number(stats[alert.alert_type]) || 0;
  if (currentValue > Number(alert.threshold)) {
    await sendAlert(alert, currentValue);
  }
}

async function sendAlert(alert, currentValue) {
  try {
    const user = await clientRef.users.fetch(alert.user_id).catch(() => null);
    if (!user) return;
    const embed = new EmbedBuilder()
      .setTitle(`Alert: ${alert.alert_type.toUpperCase()}`)
      .setColor(0xff0000)
      .setTimestamp()
      .addFields(
        { name: 'Container', value: alert.container_id.slice(0, 12), inline: true },
        { name: 'Metric', value: alert.alert_type, inline: true },
        { name: 'Current Value', value: `${Number(currentValue).toFixed(1)}`, inline: true },
        { name: 'Threshold', value: String(alert.threshold), inline: true },
        { name: 'Channel', value: alert.channel || 'dm', inline: true }
      );
    await user.send({ embeds: [embed] });
  } catch (err) {
    console.error('[AlertManager] send failed:', err.message);
  }
}

const COMMAND_SPECS = [
  {
    name: 'alertcreate',
    description: 'Create a resource usage alert',
    options: [
      { name: 'threshold', description: 'Threshold percentage', type: 10, required: true },
      { name: 'alert_type', description: 'cpu_usage/memory_usage/disk_usage', type: 3, required: false },
      { name: 'vps_id', description: 'VPS ID or name (optional)', type: 3, required: false },
      { name: 'channel', description: 'dm/webhook', type: 3, required: false },
    ],
  },
  { name: 'alertlist', description: 'List your alerts', type: 1 },
  {
    name: 'alertdelete',
    description: 'Delete one of your alerts',
    options: [{ name: 'alert_id', description: 'Alert ID', type: 3, required: true }],
  },
];

function toSpec() {
  return COMMAND_SPECS;
}

function isParsed(name) {
  return COMMAND_SPECS.some((c) => c.name === name);
}

async function handle(interaction) {
  const { commandName, options } = interaction;
  if (commandName === 'alertcreate') {
    const threshold = options.getNumber('threshold');
    const alertType = (options.getString('alert_type') || 'cpu_usage').toLowerCase();
    const vpsInput = options.getString('vps_id');
    const channel = options.getString('channel') || 'dm';
    if (!ALERT_TYPES.includes(alertType)) {
      return interaction.reply({ content: `❌ Type must be ${ALERT_TYPES.join('/')}`, ephemeral: true });
    }
    if (channel !== 'dm') {
      return interaction.reply({ content: '❌ Only dm delivery is supported.', ephemeral: true });
    }
    if (!vpsInput) {
      return interaction.reply({ content: '❌ Provide a vps_id to alert on.', ephemeral: true });
    }
    const vpsManager = require('./vpsManager');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, vpsInput);
    if (!owned) return interaction.reply({ content: '❌ VPS not found for your account', ephemeral: true });
    const containerId = owned.container_id;
    try {
      const result = await query(
        `INSERT INTO alerts (user_id, container_id, alert_type, threshold, channel)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [interaction.user.id, containerId, alertType, threshold, channel]
      );
      return interaction.reply({
        content: `✅ Alert created (id ${result.rows[0].id}): ${alertType} > ${threshold}%`,
        ephemeral: true,
      });
    } catch (err) {
      return interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
    }
  }
  if (commandName === 'alertlist') {
    const result = await query(
      'SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC',
      [interaction.user.id]
    ).catch(() => null);
    const alerts = result ? result.rows : [];
    if (!alerts.length) return interaction.reply({ content: 'No alerts configured.', ephemeral: true });
    const embed = new EmbedBuilder().setTitle('Your Alerts').setColor(0x3498db);
    for (const a of alerts) {
      embed.addFields({
        name: `${a.enabled ? 'Enabled' : 'Disabled'} - ${a.alert_type} (id ${a.id})`,
        value: `Threshold: ${a.threshold}%\nContainer: ${a.container_id ? a.container_id.slice(0, 12) : 'all'}\nChannel: ${a.channel || 'dm'}`,
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  if (commandName === 'alertdelete') {
    const alertId = options.getString('alert_id');
    const result = await query(
      'DELETE FROM alerts WHERE id = $1 AND user_id = $2 RETURNING id',
      [alertId, interaction.user.id]
    ).catch(() => null);
    if (!result || !result.rows.length) {
      return interaction.reply({ content: '❌ Alert not found for your account', ephemeral: true });
    }
    return interaction.reply({ content: '✅ Alert deleted', ephemeral: true });
  }
  return null;
}

module.exports = { init, stop, toSpec, isParsed, handle };