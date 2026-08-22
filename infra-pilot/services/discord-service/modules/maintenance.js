const { EmbedBuilder } = require('discord.js');
const { docker, exec } = require('./docker');

const COMMAND_SPECS = [
  {
    name: 'cleanupdryrun',
    description: 'Show what would be cleaned up',
    options: [{ name: 'vps_id', description: 'VPS ID (optional)', type: 3, required: false }],
  },
  {
    name: 'cleanuprun',
    description: 'Run resource cleanup',
    options: [{ name: 'vps_id', description: 'VPS ID (optional - cleans all if omitted)', type: 3, required: false }],
  },
  {
    name: 'updatecheck',
    description: 'Check for OS package updates on a VPS',
    options: [{ name: 'vps_id', description: 'VPS ID', type: 3, required: true }],
  },
  {
    name: 'updateapply',
    description: 'Apply OS package updates on a VPS',
    options: [{ name: 'vps_id', description: 'VPS ID', type: 3, required: true }],
  },
];

function toSpec() {
  return COMMAND_SPECS;
}

function isParsed(name) {
  return COMMAND_SPECS.some((c) => c.name === name);
}

async function collectCleanupData(vpsId = null) {
  const data = { docker_images: 0, dangling_images: 0, volumes: 0, container_logs: 0 };
  try {
    if (vpsId) {
      const out = await exec(vpsId, 'du -sh /var/log/ 2>/dev/null | cut -f1').catch(() => '');
      data.container_logs = out.trim() || 0;
    } else {
      const images = await docker(['images', '-q']);
      const dangling = await docker(['images', '-q', '-f', 'dangling=true']);
      const volumes = await docker(['volume', 'ls', '-q']);
      data.docker_images = images ? images.split('\n').length : 0;
      data.dangling_images = dangling ? dangling.split('\n').length : 0;
      data.volumes = volumes ? volumes.split('\n').length : 0;
    }
  } catch (err) {
    console.error('[Maintenance] collect data error:', err.message);
    throw err;
  }
  return data;
}

async function handle(interaction) {
  const { commandName, options } = interaction;
  await interaction.deferReply({ ephemeral: true });
  const vpsId = options.getString('vps_id');
  const vpsManager = require('./vpsManager');
  let resolved = null;
  if (vpsId) {
    resolved = await vpsManager.resolveContainerForUser(interaction.user.id, vpsId);
    if (!resolved) return interaction.editReply({ content: '❌ VPS not found for your account' });
  }

  if (commandName === 'cleanupdryrun') {
    const data = await collectCleanupData(resolved ? resolved.container_id : null);
    const embed = new EmbedBuilder()
      .setTitle('Cleanup Dry Run')
      .setColor(0x3498db)
      .setTimestamp()
      .addFields(
        { name: 'Dangling Images', value: String(data.dangling_images), inline: true },
        { name: 'Total Images', value: String(data.docker_images), inline: true },
        { name: 'Volumes', value: String(data.volumes), inline: true }
      );
    if (resolved) {
      embed.addFields({ name: 'Container Logs', value: String(data.container_logs), inline: true });
    }
    embed.addFields({ name: 'Would Clean', value: 'Dangling images, unused volumes, package cache', inline: false });
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === 'cleanuprun') {
    const results = [];
    try {
      if (resolved) {
        await exec(resolved.container_id, 'apt clean -qq 2>&1');
        results.push('Package cache: cleaned');
        await exec(resolved.container_id, 'rm -rf /var/log/*.log 2>&1');
        results.push('Logs: cleaned');
      } else {
        const pruneImages = await docker(['image', 'prune', '-f']);
        results.push(`Dangling images: ${pruneImages ? pruneImages.split('\n').length : 0} removed`);
        const pruneVolumes = await docker(['volume', 'prune', '-f']);
        results.push(`Unused volumes: ${pruneVolumes ? pruneVolumes.split('\n').length : 0} removed`);
      }
    } catch (err) {
      results.push(`Error: ${err.message}`);
    }
    const embed = new EmbedBuilder()
      .setTitle('Cleanup Complete')
      .setColor(0x28a745)
      .setTimestamp()
      .addFields({ name: 'Results', value: results.map((r) => `• ${r}`).join('\n'), inline: false });
    return interaction.editReply({ embeds: [embed] });
  }

  if (commandName === 'updatecheck') {
    try {
      const out = await exec(resolved.container_id, 'apt list --upgradable 2>/dev/null | tail -n +2');
      const lines = out.trim().split('\n').filter((l) => l.trim());
      const embed = new EmbedBuilder()
        .setTitle(`Available Updates: ${resolved.container_id.slice(0, 12)}`)
        .setColor(0x3498db)
        .setTimestamp()
        .addFields({ name: 'Updates Available', value: String(lines.length), inline: true });
      if (lines.length) {
        let updateList = lines.slice(0, 10).join('\n');
        if (lines.length > 10) updateList += `\n... and ${lines.length - 10} more`;
        embed.addFields({ name: 'Packages', value: updateList.slice(0, 1024), inline: false });
      } else {
        embed.addFields({ name: 'Packages', value: 'All packages up to date', inline: false });
      }
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }

  if (commandName === 'updateapply') {
    try {
      const out = await exec(resolved.container_id, 'apt update -qq && apt upgrade -y -qq 2>&1');
      const result = out.trim().split('\n').slice(-5).join('\n') || 'Update applied';
      const embed = new EmbedBuilder()
        .setTitle(`Updates Applied: ${resolved.container_id.slice(0, 12)}`)
        .setColor(0x28a745)
        .setTimestamp()
        .addFields({ name: 'Result', value: result.slice(0, 1024), inline: false });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ Update failed: ${err.message}` });
    }
  }
  return null;
}

module.exports = { toSpec, isParsed, handle };