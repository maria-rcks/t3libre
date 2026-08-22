/**
 * @file CLI Bridge for Discord Bot
 * Replaces direct Pterodactyl API calls with `ipilot` CLI subprocess calls.
 * @example
 *   const { cli } = require('./cli-bridge');
 *   const result = cli('server list');
 *   if (result.success) {
 *     const servers = result.data;
 *   }
 */

const { execSync } = require('child_process');

/** @constant {string} */
const IPILOT_CMD = process.env.IPILOT_CMD || 'ipilot';
/** @constant {number} */
const CLI_TIMEOUT_MS = 30000;

/**
 * @typedef {Object} CliResult
 * @property {boolean} success - Whether the command succeeded
 * @property {*} data - Parsed JSON result data
 * @property {string} [error] - Error message if failed
 */

/**
 * Execute an ipilot CLI command and return parsed JSON.
 * @param {string} command - The ipilot subcommand to run (e.g. 'server list')
 * @returns {CliResult} The result object with success flag and parsed data
 * @throws {Error} If the command string is invalid
 */
function cli(command) {
  if (!command || typeof command !== 'string') {
    return { success: false, data: null, error: 'Command must be a non-empty string' };
  }

  try {
    const fullCmd = `${IPILOT_CMD} ${command} --output json`;
    const stdout = execSync(fullCmd, {
      encoding: 'utf-8',
      timeout: CLI_TIMEOUT_MS,
      windowsHide: true,
    });
    const data = JSON.parse(stdout.trim());
    return { success: true, data };
  } catch (err) {
    if (err.stdout) {
      try {
        return { success: true, data: JSON.parse(err.stdout.toString().trim()) };
      } catch (_) {
        // stdout is not valid JSON; fall through to error path
      }
    }
    return {
      success: false,
      data: null,
      error: err.stderr?.toString() || err.message || String(err),
    };
  }
}

/**
 * @namespace ipilot
 * @description Convenience wrappers for Discord bot operations.
 */
const ipilot = {
  server: {
    /** @returns {CliResult} */
    list: () => cli('server list'),
    /** @param {string} name @param {string} type @param {number} [memory] @returns {CliResult} */
    create: (name, type, memory) =>
      cli(`server create "${name}" --type "${type}"${memory ? ` --memory ${memory}` : ''}`),
    /** @param {string} serverId @returns {CliResult} */
    delete: (serverId) => cli(`server delete "${serverId}"`),
    /** @param {string} serverId @returns {CliResult} */
    status: (serverId) => cli(`server status "${serverId}"`),
  },
  backup: {
    /** @param {string} [serverId] @returns {CliResult} */
    list: (serverId) => cli(`backup list${serverId ? ` "${serverId}"` : ''}`),
    /** @param {string} serverId @returns {CliResult} */
    create: (serverId) => cli(`backup create "${serverId}"`),
  },
  health: {
    /** @returns {CliResult} */
    check: () => cli('health'),
  },
  energy: {
    /** @returns {CliResult} */
    current: () => cli('energy current'),
    /** @param {string} [period] @returns {CliResult} */
    summary: (period) => cli(`energy summary --period ${period || 'daily'}`),
  },
};

module.exports = { cli, ipilot };
