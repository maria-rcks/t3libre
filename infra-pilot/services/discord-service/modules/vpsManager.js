const { query } = require('./db');
const { docker, inspect, stats, execArgv } = require('./docker');

async function ensureTables() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS vps_containers (
        container_id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        container_name VARCHAR(255),
        ssh_command TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await query(
      "ALTER TABLE vps_containers ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;"
    );
    await query(
      "ALTER TABLE vps_containers ADD COLUMN IF NOT EXISTS image VARCHAR(255);"
    );
    await query(
      "ALTER TABLE vps_containers ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'running';"
    );
    await query(`
      CREATE TABLE IF NOT EXISTS backup_rotation (
        id SERIAL PRIMARY KEY,
        container_id VARCHAR(255) NOT NULL,
        image_id VARCHAR(255),
        name VARCHAR(255),
        retention_type VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('[VPSManager] table setup failed:', err.message);
  }
}

function now() {
  return new Date().toISOString();
}

async function addToDatabase(userId, containerId, name, sshCommand = '', image = '') {
  try {
    await query(
      `INSERT INTO vps_containers
       (container_id, user_id, container_name, ssh_command, status, image)
       VALUES ($1, $2, $3, $4, 'running', $5)
       ON CONFLICT (container_id) DO NOTHING`,
      [containerId, userId, name, sshCommand, image]
    );
  } catch (err) {
    console.error('[VPSManager] addToDatabase failed:', err.message);
  }
}

async function removeFromDatabase(containerId) {
  try {
    await query('DELETE FROM vps_containers WHERE container_id = $1', [containerId]);
  } catch (err) {
    console.error('[VPSManager] removeFromDatabase failed:', err.message);
  }
}

async function getContainersForUser(userId) {
  try {
    const result = await query(
      'SELECT container_id, container_name, ssh_command, status, image, created_at FROM vps_containers WHERE user_id = $1',
      [userId]
    );
    return result.rows;
  } catch (err) {
    console.error('[VPSManager] getContainersForUser failed:', err.message);
    return [];
  }
}

async function resolveContainerForUser(userId, input) {
  const rows = await getContainersForUser(userId);
  for (const row of rows) {
    if (
      row.container_name === input ||
      row.container_id === input ||
      row.container_id.startsWith(input)
    ) {
      return row;
    }
  }
  return null;
}

const APPROVED_IMAGES = String(process.env.APPROVED_IMAGES || 'ubuntu:latest,ubuntu:22.04,debian:latest')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function createVps(userId, { cpu, memory, image }) {
  try {
    if (!image || !APPROVED_IMAGES.includes(image)) {
      return { error: `Image not approved: ${image}. Allowed: ${APPROVED_IMAGES.join(', ')}` };
    }
    if (cpu < 0.5 || cpu > 4) {
      return { error: 'CPU cores must be between 0.5 and 4' };
    }
    if (memory < 512 || memory > 8192) {
      return { error: 'Memory must be between 512MB and 8192MB' };
    }
    const serverLimit = parseInt(process.env.SERVER_LIMIT, 10) || 5;
    const owned = await getContainersForUser(userId);
    if (owned.length >= serverLimit) {
      return { error: `Instance limit reached (${serverLimit})` };
    }
    const name = `vps_${Date.now().toString(36)}`;
    const args = [
      'run', '-d', '--name', name,
      '--cpu-period', '100000',
      '--cpu-quota', String(Math.round(cpu * 100000)),
      '--memory', `${memory}m`,
      '--restart', 'unless-stopped',
      '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
      image,
    ];
    await docker(args, { timeout: 120000 });
    const info = await inspect(name);
    const containerId = info.Id;
    await addToDatabase(userId, containerId, name, '', image);
    return { containerId, name };
  } catch (err) {
    console.error('[VPSManager] createVps failed:', err.message);
    return null;
  }
}

async function deleteVps(containerId) {
  try {
    await docker(['rm', '-f', containerId], { timeout: 60000 });
    await removeFromDatabase(containerId);
    return true;
  } catch (err) {
    console.error('[VPSManager] deleteVps failed:', err.message);
    return false;
  }
}

async function setStatus(containerId, status) {
  try {
    await query(
      'UPDATE vps_containers SET status = $2 WHERE container_id = $1',
      [containerId, status]
    );
  } catch (err) {
    console.error('[VPSManager] setStatus failed:', err.message);
  }
}

async function startVps(containerId) {
  try {
    await docker(['start', containerId], { timeout: 60000 });
    await setStatus(containerId, 'running');
    return true;
  } catch (err) {
    console.error('[VPSManager] startVps failed:', err.message);
    return false;
  }
}

async function stopVps(containerId) {
  try {
    await docker(['stop', containerId], { timeout: 60000 });
    await setStatus(containerId, 'stopped');
    return true;
  } catch (err) {
    console.error('[VPSManager] stopVps failed:', err.message);
    return false;
  }
}

async function restartVps(containerId) {
  try {
    await docker(['restart', containerId], { timeout: 60000 });
    await setStatus(containerId, 'running');
    return true;
  } catch (err) {
    console.error('[VPSManager] restartVps failed:', err.message);
    return false;
  }
}

async function getVpsStats(containerId) {
  try {
    const info = await inspect(containerId);
    const raw = await stats(containerId);
    const memMatch = raw.memUsage.match(/^([\d.]+)\s*([kKMGTP]?i?B)/);
    const memLimitMatch = raw.memUsage.match(/\/\s*([\d.]+)\s*([kKMGTP]?i?B)/);
    const memUnits = {
      B: 1,
      kB: 1024, KB: 1024, KiB: 1024,
      MB: 1024 ** 2, MiB: 1024 ** 2,
      GB: 1024 ** 3, GiB: 1024 ** 3,
      TB: 1024 ** 4, TiB: 1024 ** 4,
      PB: 1024 ** 5, PiB: 1024 ** 5,
    };
    const toMiB = (bytes) => Math.round(bytes / (1024 ** 2));
    const memBytes = (match) => (match ? parseFloat(match[1]) * (memUnits[match[2]] || 1) : 0);
    return {
      status: info.State && info.State.Status,
      cpu_usage: parseFloat(raw.cpu.replace('%', '')) || 0,
      memory_usage: parseFloat(raw.memPerc.replace('%', '')) || 0,
      memory: {
        usage: toMiB(memBytes(memMatch)),
        limit: toMiB(memBytes(memLimitMatch)),
      },
      network: { raw: raw.netIO },
    };
  } catch (err) {
    console.error('[VPSManager] getVpsStats failed:', err.message);
    return null;
  }
}

async function listUserInstances(userId) {
  const rows = await getContainersForUser(userId);
  const statsResults = await Promise.all(
    rows.map((row) => getVpsStats(row.container_id).catch(() => null))
  );
  return rows.map((row, i) => ({
    container_id: row.container_id,
    container_name: row.container_name,
    info: {
      created_at: row.created_at,
      status: statsResults[i] ? statsResults[i].status : row.status,
      config: { image: row.image || 'unknown' },
    },
    stats: statsResults[i],
  }));
}

async function createBackup(containerId, retentionType = 'daily') {
  try {
    const info = await inspect(containerId);
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupName = `${info.Name.replace(/^\//, '')}_backup_${timestamp}`;
    await docker(['commit', containerId, backupName], { timeout: 300000 });
    try {
      await query(
        `INSERT INTO backup_rotation (container_id, image_id, name, retention_type)
         VALUES ($1, $2, $3, $4)`,
        [containerId, backupName, backupName, retentionType]
      );
    } catch (err) {
      console.error('[VPSManager] backup record failed:', err.message);
    }
    await applyRetention(containerId);
    return backupName;
  } catch (err) {
    console.error('[VPSManager] createBackup failed:', err.message);
    return null;
  }
}

async function applyRetention(containerId) {
  try {
    const retention = JSON.parse(process.env.BACKUP_RETENTION || '{"daily": 7, "weekly": 4, "monthly": 6}');
    for (const [type, maxCount] of Object.entries(retention)) {
      const result = await query(
        'SELECT id, image_id FROM backup_rotation WHERE container_id = $1 AND retention_type = $2 ORDER BY created_at DESC',
        [containerId, type]
      );
      if (result.rows.length > maxCount) {
        const expired = result.rows.slice(maxCount);
        for (const row of expired) {
          if (row.image_id) {
            try {
              await docker(['rmi', row.image_id], { timeout: 60000 });
            } catch (err) {
              console.error('[VPSManager] retention image cleanup failed:', err.message);
              continue;
            }
          }
          await query('DELETE FROM backup_rotation WHERE id = $1', [row.id]);
        }
      }
    }
  } catch (err) {
    console.error('[VPSManager] applyRetention failed:', err.message);
  }
}

async function listBackups(containerId) {
  try {
    const result = await query(
      'SELECT * FROM backup_rotation WHERE container_id = $1 ORDER BY created_at DESC',
      [containerId]
    );
    return result.rows.map((r) => ({
      id: r.id,
      image_id: r.image_id,
      name: r.name,
      retention_type: r.retention_type,
      created_at: r.created_at,
    }));
  } catch (err) {
    console.error('[VPSManager] listBackups failed:', err.message);
    return [];
  }
}

async function restoreBackup(containerId, backupId) {
  try {
    let imageRef = backupId;
    if (!/^[a-f0-9]{12,64}$/.test(backupId)) {
      const result = await query(
        'SELECT image_id FROM backup_rotation WHERE container_id = $1 AND id = $2',
        [containerId, backupId]
      );
      if (!result.rows.length) return false;
      imageRef = result.rows[0].image_id;
    }
    const info = await inspect(imageRef).catch(() => null);
    if (!info) return false;
    await docker(['stop', containerId], { timeout: 30000 }).catch(() => {});
    await docker(['rm', containerId], { timeout: 60000 }).catch(() => {});
    const args = ['run', '-d', '--name', containerId, '--restart', 'unless-stopped'];
    const cfg = info.Config;
    if (cfg && cfg.Env) {
      for (const env of cfg.Env) args.push('-e', env);
    }
    if (cfg && cfg.ExposedPorts && Object.keys(cfg.ExposedPorts).length) {
      args.push('-P');
    }
    args.push(imageRef);
    await docker(args, { timeout: 120000 });
    return true;
  } catch (err) {
    console.error('[VPSManager] restoreBackup failed:', err.message);
    return false;
  }
}

async function execInContainer(containerId, command) {
  return execArgv(containerId, ['sh', '-c', command]);
}

async function executeCommand(containerId, command) {
  try {
    await execArgv(containerId, ['sh', '-c', command]);
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  ensureTables,
  createVps,
  deleteVps,
  startVps,
  stopVps,
  restartVps,
  getVpsStats,
  listUserInstances,
  createBackup,
  applyRetention,
  listBackups,
  restoreBackup,
  resolveContainerForUser,
  getContainersForUser,
  execInContainer,
  executeCommand,
  addToDatabase,
};