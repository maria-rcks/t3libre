const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} = require('discord.js');
const vpsManager = require('./vpsManager');
const { docker } = require('./docker');

const COMMAND_SPECS = [
  {
    name: 'createvps',
    description: 'Create a new VPS instance',
    options: [
      { name: 'cpu', description: 'CPU cores (0.5-4)', type: 10, required: true },
      { name: 'memory', description: 'Memory in MB (512-8192)', type: 4, required: true },
      { name: 'image', description: 'Docker image (default ubuntu:latest)', type: 3, required: false },
    ],
  },
  { name: 'listvps', description: 'List all your VPS instances', type: 1 },
  {
    name: 'startvps',
    description: 'Start a VPS instance',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'stopvps',
    description: 'Stop a VPS instance',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'restartvps',
    description: 'Restart a VPS instance',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'deletevps',
    description: 'Delete a VPS instance',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'vpsstats',
    description: 'Get live statistics for a VPS instance',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'backup',
    description: 'Create a backup of a VPS instance',
    options: [
      { name: 'container_id', description: 'Container ID or name', type: 3, required: true },
      { name: 'retention', description: 'daily/weekly/monthly', type: 3, required: false },
    ],
  },
  {
    name: 'backuplist',
    description: 'List backups of a VPS instance',
    options: [{ name: 'container_id', description: 'Container ID or name', type: 3, required: true }],
  },
  {
    name: 'restore',
    description: 'Restore a VPS from a backup',
    options: [
      { name: 'container_id', description: 'Container ID or name', type: 3, required: true },
      { name: 'backup_id', description: 'Backup ID', type: 3, required: true },
    ],
  },
  {
    name: 'vpsupdate',
    description: 'Update CPU and memory limits of a VPS',
    options: [
      { name: 'container_id', description: 'Container ID or name', type: 3, required: true },
      { name: 'cpu', description: 'New CPU cores (0.5-4)', type: 10, required: false },
      { name: 'memory', description: 'New memory in MB (512-8192)', type: 4, required: false },
    ],
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
  await interaction.deferReply({ ephemeral: true });
  switch (commandName) {
    case 'createvps': {
      const cpu = options.getNumber('cpu');
      const memory = options.getInteger('memory');
      const image = options.getString('image') || 'ubuntu:latest';
      const result = await vpsManager.createVps(interaction.user.id, { cpu, memory, image });
      if (!result) return interaction.editReply({ content: '❌ Failed to create VPS instance' });
      if (result.error) return interaction.editReply({ content: `❌ ${result.error}` });
      const embed = new EmbedBuilder()
        .setTitle('VPS Created Successfully')
        .setColor(0x28a745)
        .addFields(
          { name: 'Container ID', value: `\`${result.containerId.slice(0, 12)}\``, inline: true },
          { name: 'CPU Cores', value: String(cpu), inline: true },
          { name: 'Memory', value: `${memory}MB`, inline: true },
          { name: 'Image', value: image, inline: true }
        );
      return interaction.editReply({ embeds: [embed] });
    }
    case 'listvps': {
      const instances = (await vpsManager.listUserInstances(interaction.user.id)).slice(0, 10);
      if (!instances.length) return interaction.editReply({ content: "You don't have any VPS instances" });
      const embed = new EmbedBuilder().setTitle('Your VPS Instances').setColor(0x3498db);
      for (const instance of instances) {
        const status = instance.stats ? instance.stats.status : instance.info.status;
        const emoji = status === 'running' ? '🟢' : '🔴';
        embed.addFields({
          name: `Instance ${instance.container_name}`,
          value:
            `Status: ${emoji} ${status}\n` +
            `CPU: ${instance.stats ? instance.stats.cpu_usage : '-'}% | RAM: ${instance.stats ? instance.stats.memory_usage : '-'}%\n` +
            `Created: ${String(instance.info.created_at).slice(0, 19)}\n` +
            `ID: \`${instance.container_id.slice(0, 12)}\``,
          inline: false,
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }
    case 'startvps':
    case 'stopvps':
    case 'restartvps': {
      const input = options.getString('container_id');
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      const ok = await vpsManager[`${commandName.replace('vps', '')}Vps`](owned.container_id);
      return interaction.editReply({ content: ok ? '✅ VPS operation successful' : '❌ Failed to run operation' });
    }
    case 'deletevps': {
      const input = options.getString('container_id');
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      const confirm = new ButtonBuilder()
        .setCustomId('vps_delete_confirm')
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Danger);
      const cancel = new ButtonBuilder()
        .setCustomId('vps_delete_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);
      const row = new ActionRowBuilder().addComponents(confirm, cancel);
      const reply = await interaction.editReply({
        content: `Are you sure you want to delete VPS \`${owned.container_id.slice(0, 12)}\`? This action cannot be undone.`,
        components: [row],
      });
      try {
        const confirmation = await reply.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          componentType: ComponentType.Button,
          time: 30000,
        });
        if (confirmation.customId === 'vps_delete_cancel') {
          return confirmation.update({ content: 'Operation cancelled', components: [] });
        }
        const ok = await vpsManager.deleteVps(owned.container_id);
        return confirmation.update({
          content: ok ? '✅ VPS deleted successfully' : '❌ Failed to delete VPS',
          components: [],
        });
      } catch (err) {
        return interaction.editReply({ content: '❌ Confirmation timed out', components: [] });
      }
    }
    case 'vpsstats': {
      const input = options.getString('container_id');
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      const stats = await vpsManager.getVpsStats(owned.container_id);
      if (!stats) return interaction.editReply({ content: '❌ Failed to get VPS statistics' });
      const embed = new EmbedBuilder()
        .setTitle('VPS Statistics')
        .setColor(0x3498db)
        .addFields(
          { name: 'Status', value: stats.status || 'unknown', inline: true },
          { name: 'CPU Usage', value: `${stats.cpu_usage}%`, inline: true },
          { name: 'Memory Usage', value: `${stats.memory_usage}%`, inline: true },
          { name: 'Network', value: stats.network && stats.network.raw ? stats.network.raw : 'N/A', inline: true }
        );
      return interaction.editReply({ embeds: [embed] });
    }
    case 'backup': {
      const input = options.getString('container_id');
      const retention = options.getString('retention') || 'daily';
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      if (!['daily', 'weekly', 'monthly'].includes(retention)) {
        return interaction.editReply({ content: '❌ Retention must be daily/weekly/monthly' });
      }
      const backupId = await vpsManager.createBackup(owned.container_id, retention);
      if (!backupId) return interaction.editReply({ content: '❌ Failed to create backup' });
      const embed = new EmbedBuilder()
        .setTitle('Backup Created')
        .setDescription(`Backup: \`${backupId}\``)
        .setColor(0x28a745);
      return interaction.editReply({ embeds: [embed] });
    }
    case 'backuplist': {
      const input = options.getString('container_id');
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      const backups = await vpsManager.listBackups(owned.container_id);
      if (!backups.length) return interaction.editReply({ content: 'No backups found for this VPS' });
      const embed = new EmbedBuilder().setTitle(`Backups for ${owned.container_name}`).setColor(0x3498db);
      for (const backup of backups.slice(0, 10)) {
        embed.addFields({
          name: backup.name,
          value: `${backup.retention_type} · ${String(backup.created_at).slice(0, 19)} · ID ${backup.id}`,
          inline: false,
        });
      }
      return interaction.editReply({ embeds: [embed] });
    }
    case 'restore': {
      const input = options.getString('container_id');
      const backupId = options.getString('backup_id');
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      const ok = await vpsManager.restoreBackup(owned.container_id, backupId);
      return interaction.editReply({ content: ok ? '✅ VPS restored successfully' : '❌ Failed to restore VPS' });
    }
    case 'vpsupdate': {
      const input = options.getString('container_id');
      const owned = await vpsManager.resolveContainerForUser(interaction.user.id, input);
      if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
      const cpu = options.getNumber('cpu');
      const memory = options.getInteger('memory');
      if (cpu === null && memory === null) {
        return interaction.editReply({ content: '❌ Provide cpu and/or memory to update' });
      }
      if (cpu !== null && (cpu < 0.5 || cpu > 4)) {
        return interaction.editReply({ content: '❌ CPU cores must be between 0.5 and 4' });
      }
      if (memory !== null && (memory < 512 || memory > 8192)) {
        return interaction.editReply({ content: '❌ Memory must be between 512MB and 8192MB' });
      }
      try {
        const updateArgs = ['update'];
        if (cpu !== null) updateArgs.push('--cpu-period', '100000', '--cpu-quota', String(Math.round(cpu * 100000)));
        if (memory !== null) updateArgs.push('--memory', `${memory}m`);
        updateArgs.push(owned.container_id);
        await docker(updateArgs, { timeout: 60000 });
        await docker(['restart', owned.container_id], { timeout: 60000 });
        return interaction.editReply({ content: '✅ VPS updated successfully' });
      } catch (err) {
        console.error('[VPSCommands] vpsupdate failed:', err.message);
        return interaction.editReply({ content: '❌ Failed to update VPS' });
      }
    }
    default:
      return null;
  }
}

module.exports = { handle, toSpec, isParsed };