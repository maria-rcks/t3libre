const cron = require('node-cron');
const { query } = require('./db');

let loopTask = null;
let clientRef = null;

function init(client) {
  clientRef = client;
  if (loopTask) return;
  loopTask = cron.schedule('0 0 * * *', () => {
    backupLoop().catch((err) => console.error('[BackupScheduler] loop error:', err));
  });
}

function stop() {
  if (loopTask) { loopTask.stop(); loopTask = null; }
}

function retentionForDate(date) {
  const d = new Date(date);
  if (d.getDate() === 1) return 'monthly';
  if (d.getDay() === 1) return 'weekly';
  return 'daily';
}

async function backupLoop() {
  const result = await query('SELECT container_id FROM vps_containers').catch(() => null);
  if (!result) return;
  const retention = retentionForDate(new Date());
  for (const row of result.rows) {
    try {
      const vpsManager = require('./vpsManager');
      const backupId = await vpsManager.createBackup(row.container_id, retention);
      if (backupId) {
        console.log(`[BackupScheduler] Auto-backup created for ${row.container_id.slice(0, 12)} (${retention})`);
      }
    } catch (err) {
      console.error(`[BackupScheduler] backup failed for ${row.container_id}:`, err.message);
    }
  }
}

async function runNow() {
  return backupLoop();
}

module.exports = { init, stop, runNow, retentionForDate };