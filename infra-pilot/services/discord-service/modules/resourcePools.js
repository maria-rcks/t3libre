const { EmbedBuilder } = require('discord.js');
const { query } = require('./db');

const COMMAND_SPECS = [
  {
    name: 'resourcepoolcreate',
    description: 'Create a resource pool',
    options: [
      { name: 'name', description: 'Pool name', type: 3, required: true },
      { name: 'cpu_ratio', description: 'CPU oversubscription ratio', type: 10, required: false },
      { name: 'mem_ratio', description: 'Memory oversubscription ratio', type: 10, required: false },
    ],
  },
  {
    name: 'resourcepooldelete',
    description: 'Delete a resource pool',
    options: [{ name: 'name', description: 'Pool name', type: 3, required: true }],
  },
  { name: 'resourcepoollist', description: 'List resource pools', type: 1 },
  {
    name: 'resourcepooladd',
    description: 'Add VPS to a pool',
    options: [
      { name: 'pool_name', description: 'Pool name', type: 3, required: true },
      { name: 'vps_id', description: 'VPS ID', type: 3, required: true },
    ],
  },
  {
    name: 'resourcepoolremove',
    description: 'Remove VPS from a pool',
    options: [
      { name: 'pool_name', description: 'Pool name', type: 3, required: true },
      { name: 'vps_id', description: 'VPS ID', type: 3, required: true },
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
    CREATE TABLE IF NOT EXISTS resource_pools (
      name VARCHAR(255) PRIMARY KEY,
      cpu_ratio DOUBLE PRECISION DEFAULT 4.0,
      mem_ratio DOUBLE PRECISION DEFAULT 2.0,
      members JSONB DEFAULT '[]'::jsonb,
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function listPools() {
  const result = await query('SELECT * FROM resource_pools ORDER BY created_at');
  return result.rows.map((r) => ({
    ...r,
    members: typeof r.members === 'string' ? JSON.parse(r.members || '[]') : (r.members || []),
  }));
}

async function getPool(name) {
  const result = await query('SELECT * FROM resource_pools WHERE name = $1', [name]);
  if (!result.rows.length) return null;
  const r = result.rows[0];
  return { ...r, members: typeof r.members === 'string' ? JSON.parse(r.members || '[]') : (r.members || []) };
}

async function mutateMembers(poolName, userId, mutate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await query(
      'SELECT * FROM resource_pools WHERE name = $1 AND created_by = $2',
      [poolName, userId]
    ).catch(() => null);
    if (!result || !result.rows.length) return { status: 'not_found' };
    const current = typeof result.rows[0].members === 'string'
      ? JSON.parse(result.rows[0].members || '[]')
      : (result.rows[0].members || []);
    const next = mutate(current);
    if (next && next.status) return next;
    const write = await query(
      'UPDATE resource_pools SET members = $2::jsonb WHERE name = $1 AND created_by = $3 AND members = $4::jsonb',
      [poolName, JSON.stringify(next), userId, JSON.stringify(current)]
    ).catch(() => null);
    if (write && write.rowCount === 1) return { status: 'ok', members: next };
  }
  return { status: 'conflict' };
}

async function handle(interaction) {
  const { commandName, options } = interaction;
  const vpsManager = require('./vpsManager');
  try {
    await ensureTable();
  } catch (err) {
    console.error('[ResourcePools] table setup failed:', err.message);
  }

  if (commandName === 'resourcepoolcreate') {
    const name = options.getString('name');
    const cpuRatio = options.getNumber('cpu_ratio') ?? 4.0;
    const memRatio = options.getNumber('mem_ratio') ?? 2.0;
    try {
      await query(
        'INSERT INTO resource_pools (name, cpu_ratio, mem_ratio, created_by) VALUES ($1, $2, $3, $4)',
        [name, cpuRatio, memRatio, interaction.user.id]
      );
      return interaction.reply({ content: `✅ Pool '${name}' created (CPU ratio: ${cpuRatio}x, Mem ratio: ${memRatio}x)`, ephemeral: true });
    } catch (err) {
      return interaction.reply({ content: '❌ Pool already exists.', ephemeral: true });
    }
  }
  if (commandName === 'resourcepooldelete') {
    const name = options.getString('name');
    const result = await query(
      'DELETE FROM resource_pools WHERE name = $1 AND created_by = $2 RETURNING name',
      [name, interaction.user.id]
    ).catch(() => null);
    if (!result || !result.rows.length) return interaction.reply({ content: '❌ Pool not found.', ephemeral: true });
    return interaction.reply({ content: `✅ Pool '${name}' deleted.`, ephemeral: true });
  }
  if (commandName === 'resourcepoollist') {
    const pools = await listPools().catch(() => []);
    if (!pools.length) return interaction.reply({ content: 'No resource pools.', ephemeral: true });
    const embed = new EmbedBuilder().setTitle('Resource Pools').setColor(0x3498db);
    for (const pool of pools) {
      embed.addFields({
        name: pool.name,
        value:
          `Members: ${pool.members.length}\n` +
          `CPU ratio: ${pool.cpu_ratio}x\nMem ratio: ${pool.mem_ratio}x`,
        inline: false,
      });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  if (commandName === 'resourcepooladd') {
    const poolName = options.getString('pool_name');
    const vpsInput = options.getString('vps_id');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, vpsInput);
    if (!owned) return interaction.reply({ content: '❌ VPS not found for your account.', ephemeral: true });
    const res = await mutateMembers(poolName, interaction.user.id, (members) => {
      if (members.includes(owned.container_id)) return { status: 'duplicate' };
      members.push(owned.container_id);
      return members;
    });
    if (res.status === 'not_found') return interaction.reply({ content: '❌ Pool not found.', ephemeral: true });
    if (res.status === 'duplicate') return interaction.reply({ content: '⚠️ Already in pool.', ephemeral: true });
    if (res.status === 'conflict') return interaction.reply({ content: '❌ Pool changed concurrently, try again.', ephemeral: true });
    return interaction.reply({ content: `✅ VPS \`${owned.container_id.slice(0, 12)}\` added to pool '${poolName}'.`, ephemeral: true });
  }
  if (commandName === 'resourcepoolremove') {
    const poolName = options.getString('pool_name');
    const vpsInput = options.getString('vps_id');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, vpsInput);
    if (!owned) return interaction.reply({ content: '❌ VPS not found for your account.', ephemeral: true });
    const res = await mutateMembers(poolName, interaction.user.id, (members) => {
      const idx = members.indexOf(owned.container_id);
      if (idx === -1) return { status: 'missing' };
      members.splice(idx, 1);
      return members;
    });
    if (res.status === 'not_found') return interaction.reply({ content: '❌ Pool not found.', ephemeral: true });
    if (res.status === 'missing') return interaction.reply({ content: '⚠️ Not in pool.', ephemeral: true });
    if (res.status === 'conflict') return interaction.reply({ content: '❌ Pool changed concurrently, try again.', ephemeral: true });
    return interaction.reply({ content: `✅ VPS \`${owned.container_id.slice(0, 12)}\` removed from pool '${poolName}'.`, ephemeral: true });
  }
  return null;
}

module.exports = { toSpec, isParsed, handle };