const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { query } = require('./db');

const ADMIN_IDS = new Set(String(process.env.WHITELIST_IDS || '').split(',').filter(Boolean));

let clientRef = null;
const registeredTasks = new Map();
let reloadPromise = null;

const VALID_TYPES = ['restart', 'command', 'backup', 'custom'];

function init(client) {
  clientRef = client;
  return reloadTasks();
}

async function reloadTasks() {
  if (reloadPromise) return reloadPromise;
  reloadPromise = (async () => {
    stopAll();
    const result = await query('SELECT * FROM scheduled_tasks WHERE enabled = TRUE').catch(() => null);
    if (!result) return;
    for (const task of result.rows) {
      registerTask(task);
    }
    console.log(`[TaskScheduler] ${registeredTasks.size} cron tasks registered`);
  })().finally(() => {
    reloadPromise = null;
  });
  return reloadPromise;
}

function stop() {
  stopAll();
}

function stopAll() {
  for (const [, scheduled] of registeredTasks) {
    scheduled.destroy();
  }
  registeredTasks.clear();
}

async function registerTask(task) {
  try {
    const scheduled = cron.schedule(task.cron_expression, () => {
      executeTask(task.id).catch((err) => console.error(`[TaskScheduler] task ${task.id} error:`, err.message));
    }, { name: `task_${task.id}` });
    registeredTasks.set(task.id, scheduled);
  } catch (err) {
    console.error(`[TaskScheduler] invalid cron for task ${task.id}:`, err.message);
  }
}

async function executeTask(taskId) {
  const result = await query('SELECT * FROM scheduled_tasks WHERE id = $1', [taskId]).catch(() => null);
  if (!result || !result.rows.length) return;
  const task = result.rows[0];
  let status = 'success';
  let error = null;

  await query('UPDATE scheduled_tasks SET last_run_at = NOW(), last_run_status = $2 WHERE id = $1', [taskId, 'running']).catch(() => {});

  const vpsManager = require('./vpsManager');
  try {
    if (task.task_type === 'restart') {
      if (task.target_container_id) {
        await vpsManager.restartVps(task.target_container_id);
      }
    } else if (task.task_type === 'command') {
      if (task.target_container_id && task.command) {
        const res = await vpsManager.executeCommand(task.target_container_id, task.command);
        if (!res.success) { status = 'failed'; error = res.error; }
      }
    } else if (task.task_type === 'backup') {
      if (task.target_container_id) {
        await vpsManager.createBackup(task.target_container_id, 'scheduled');
      }
    } else if (task.task_type === 'custom') {
      if (task.target_container_id && task.command) {
        const res = await vpsManager.executeCommand(task.target_container_id, task.command);
        if (!res.success) { status = 'failed'; error = res.error; }
      }
    }
  } catch (err) {
    status = 'failed';
    error = err.message;
  }

  await query(
    'UPDATE scheduled_tasks SET last_run_status = $2, error_message = $3 WHERE id = $1',
    [taskId, status, error]
  ).catch(() => {});
}

function isValidCron(expression) {
  return cron.validate(expression);
}

const COMMAND_SPECS = [
  {
    name: 'cron',
    description: 'Manage scheduled tasks',
    options: [
      { name: 'action', description: 'create/list/delete/toggle', type: 3, required: true },
      { name: 'name', description: 'Task name (for create/delete/toggle)', type: 3, required: false },
      { name: 'task_type', description: 'restart/command/backup/custom', type: 3, required: false },
      { name: 'target', description: 'Container ID (for create)', type: 3, required: false },
      { name: 'cron_expr', description: 'Cron expression (for create)', type: 3, required: false },
      { name: 'command', description: 'Shell command (for command/custom)', type: 3, required: false },
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
  const { options } = interaction;
  await interaction.deferReply({ ephemeral: true });
  const action = options.getString('action').toLowerCase();
  const name = options.getString('name');
  const taskType = options.getString('task_type');
  const target = options.getString('target');
  const cronExpr = options.getString('cron_expr');
  const command = options.getString('command');

  if (action === 'create') {
    if (!ADMIN_IDS.has(interaction.user.id)) {
      return interaction.editReply({ content: '❌ Admin only.' });
    }
    if (!name || !taskType || !cronExpr) {
      return interaction.editReply({ content: '❌ Missing required fields: name, task_type, cron_expr' });
    }
    if (!VALID_TYPES.includes(taskType)) {
      return interaction.editReply({ content: `❌ task_type must be ${VALID_TYPES.join(', ')}` });
    }
    if (!isValidCron(cronExpr)) {
      return interaction.editReply({ content: '❌ Invalid cron expression' });
    }
    if (['restart', 'command', 'backup', 'custom'].includes(taskType) && !target) {
      return interaction.editReply({ content: '❌ target is required for this task type' });
    }
    if (['command', 'custom'].includes(taskType) && !command) {
      return interaction.editReply({ content: '❌ command is required for command tasks' });
    }
    const vpsManager = require('./vpsManager');
    const owned = await vpsManager.resolveContainerForUser(interaction.user.id, target);
    if (!owned) return interaction.editReply({ content: '❌ VPS not found for your account' });
    try {
      const result = await query(
        `INSERT INTO scheduled_tasks (name, task_type, target_container_id, cron_expression, command, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [name, taskType, owned.container_id, cronExpr, command, interaction.user.id]
      );
      await reloadTasks();
      return interaction.editReply({ content: `✅ Scheduled task '${name}' created (id ${result.rows[0].id})` });
    } catch (err) {
      return interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }
  if (action === 'list') {
    const isAdmin = ADMIN_IDS.has(interaction.user.id);
    const result = isAdmin
      ? await query('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').catch(() => null)
      : await query('SELECT * FROM scheduled_tasks WHERE created_by = $1 ORDER BY created_at DESC', [interaction.user.id]).catch(() => null);
    const tasks = result ? result.rows : [];
    if (!tasks.length) return interaction.editReply({ content: 'No scheduled tasks configured.' });
    const embed = new EmbedBuilder().setTitle('Scheduled Tasks').setColor(0x3498db);
    for (const t of tasks) {
      const statusEmoji = t.enabled ? '✅' : '⏸️';
      embed.addFields({
        name: `${statusEmoji} ${t.name}`,
        value:
          `Type: ${t.task_type} | Cron: \`${t.cron_expression}\`\n` +
          `Container: ${t.target_container_id ? String(t.target_container_id).slice(0, 16) : 'N/A'}\n` +
          `Last: ${t.last_run_status || 'never'} | ID: \`${t.id}\``,
        inline: false,
      });
    }
    return interaction.editReply({ embeds: [embed] });
  }
  if (action === 'delete') {
    if (!name) return interaction.editReply({ content: '❌ Provide task name or ID to delete' });
    try {
      const isAdmin = ADMIN_IDS.has(interaction.user.id);
      const result = isAdmin
        ? await query('DELETE FROM scheduled_tasks WHERE name = $1 OR id = $1', [name])
        : await query('DELETE FROM scheduled_tasks WHERE created_by = $2 AND (name = $1 OR id = $1)', [name, interaction.user.id]);
      await reloadTasks();
      return interaction.editReply({ content: result.rowCount ? `✅ Deleted ${result.rowCount} task(s)` : '⚠️ Task not found' });
    } catch (err) {
      return interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }
  if (action === 'toggle') {
    if (!name) return interaction.editReply({ content: '❌ Provide task name or ID to toggle' });
    try {
      const isAdmin = ADMIN_IDS.has(interaction.user.id);
      const result = isAdmin
        ? await query('UPDATE scheduled_tasks SET enabled = NOT enabled WHERE name = $1 OR id = $1', [name])
        : await query('UPDATE scheduled_tasks SET enabled = NOT enabled WHERE created_by = $2 AND (name = $1 OR id = $1)', [name, interaction.user.id]);
      await reloadTasks();
      return interaction.editReply({ content: result.rowCount ? `✅ Task '${name}' toggled` : '⚠️ Task not found' });
    } catch (err) {
      return interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  }
  return interaction.editReply({ content: '❌ Action must be: create, list, delete, toggle' });
}

module.exports = { init, stop, toSpec, isParsed, handle, executeTask };