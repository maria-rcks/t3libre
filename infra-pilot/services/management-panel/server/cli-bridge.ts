/**
 * @file CLI Bridge for the Management Panel.
 * Invokes `ipilot` CLI commands via subprocess and returns parsed JSON,
 * avoiding duplication of business logic in Express route handlers.
 *
 * Usage: import { cli } from './cli-bridge.js';
 *   const servers = cli('server list --output json');
 */

import { execSync } from 'child_process';

/** @constant {string} */
const IPILOT_CMD = process.env.IPILOT_CMD || 'ipilot';
/** @constant {number} */
const CLI_TIMEOUT_MS = 30000;

/**
 * Result of a CLI command execution.
 */
export interface CliResult {
  success: boolean;
  data: any;
  error?: string;
}

/**
 * Execute an ipilot CLI command and return parsed JSON.
 * The command string should NOT include --output json (it is added automatically).
 * @param command - The ipilot subcommand to run (e.g. 'server list')
 * @returns Parsed result with success flag
 */
export function cli(command: string): CliResult {
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
    return { success: true, data: JSON.parse(stdout.trim()) };
  } catch (err: any) {
    const message = err.stderr?.toString() || err.message || String(err);
    if (err.stdout) {
      try {
        return { success: true, data: JSON.parse(err.stdout.toString().trim()) };
      } catch {
        // stdout is not valid JSON; fall through to error path
      }
    }
    return { success: false, data: null, error: message };
  }
}

/**
 * Convenience wrappers for common ipilot operations.
 */
export const ipilot = {
  server: {
    /** @returns {CliResult} */
    list: () => cli('server list'),
    /** @param name @param type @param [memory] @returns {CliResult} */
    create: (name: string, type: string, memory?: number) =>
      cli(`server create "${name}" --type "${type}"${memory ? ` --memory ${memory}` : ''}`),
    /** @param serverId @returns {CliResult} */
    delete: (serverId: string) => cli(`server delete "${serverId}"`),
    /** @param serverId @returns {CliResult} */
    status: (serverId: string) => cli(`server status "${serverId}"`),
  },
  backup: {
    /** @param [serverId] @returns {CliResult} */
    list: (serverId?: string) => cli(`backup list${serverId ? ` "${serverId}"` : ''}`),
    /** @param serverId @returns {CliResult} */
    create: (serverId: string) => cli(`backup create "${serverId}"`),
  },
  logs: {
    /** @param serverId @param [lines] @returns {CliResult} */
    fetch: (serverId: string, lines?: number) =>
      cli(`logs fetch "${serverId}"${lines ? ` --lines ${lines}` : ''}`),
  },
  edge: {
    /** @returns {CliResult} */
    list: () => cli('edge list'),
    /** @param name @param type @param hardwareId @returns {CliResult} */
    register: (name: string, type: string, hardwareId: string) =>
      cli(`edge register "${name}" "${type}" "${hardwareId}"`),
    /** @param deviceId @returns {CliResult} */
    status: (deviceId: string) => cli(`edge status "${deviceId}"`),
  },
  health: {
    /** @returns {CliResult} */
    check: () => cli('health'),
  },
  config: {
    /** @param [key] @returns {CliResult} */
    get: (key?: string) => cli(`config get${key ? ` ${key}` : ''}`),
    /** @param key @param value @returns {CliResult} */
    set: (key: string, value: string) => cli(`config set ${key} "${value}"`),
  },
};
