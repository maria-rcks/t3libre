/**
 * @file Doctor: real system diagnostics.
 * Replaces hardcoded/canned responses with actual measurements.
 */

import os from 'os';
import fs from 'fs';
import dns from 'dns/promises';

export interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  value?: string;
  detail?: string;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime_hours: number;
  cpus: { cores: number; model: string; speed_mhz: number };
  memory: { total_gb: string; free_gb: string; used_pct: string };
  load: { '1m': string; '5m': string; '15m': string };
}

export function collectSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime_hours: Number((os.uptime() / 3600).toFixed(1)),
    cpus: {
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown',
      speed_mhz: cpus[0]?.speed || 0,
    },
    memory: {
      total_gb: (totalMem / 1024 / 1024 / 1024).toFixed(2),
      free_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2),
      used_pct: ((1 - freeMem / totalMem) * 100).toFixed(1),
    },
    load: {
      '1m': loadAvg[0]?.toFixed(2) ?? '0.00',
      '5m': loadAvg[1]?.toFixed(2) ?? '0.00',
      '15m': loadAvg[2]?.toFixed(2) ?? '0.00',
    },
  };
}

export function checkMemory(): DiagnosticCheck {
  const info = collectSystemInfo();
  const usedPct = Number(info.memory.used_pct);
  return {
    name: 'Memory',
    status: usedPct > 90 ? 'fail' : usedPct > 75 ? 'warn' : 'ok',
    value: `${info.memory.used_pct}% used`,
    detail: `${info.memory.free_gb} GB free of ${info.memory.total_gb} GB`,
  };
}

export function checkCpu(): DiagnosticCheck {
  const cpus = os.cpus();
  if (cpus.length === 0) {
    return { name: 'CPU', status: 'warn', value: 'unavailable', detail: 'no CPU info' };
  }
  const totalIdle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
  const totalAll = cpus.reduce(
    (sum, cpu) =>
      sum + cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq,
    0,
  );
  const idlePct = totalAll > 0 ? (totalIdle / totalAll) * 100 : 0;
  const busyPct = Number((100 - idlePct).toFixed(1));
  return {
    name: 'CPU',
    status: busyPct > 95 ? 'warn' : 'ok',
    value: `${busyPct}% busy (lifetime average)`,
    detail: `${cpus.length} cores`,
  };
}

export function checkDisk(target = '/'): DiagnosticCheck {
  try {
    const s = fs.statfsSync(target);
    if (!s.bavail || !s.blocks) {
      return { name: 'Disk', status: 'warn', value: 'unavailable', detail: `no stats for ${target}` };
    }
    const usedPct = Number((100 - (s.bavail / s.blocks) * 100).toFixed(1));
    return {
      name: 'Disk',
      status: usedPct > 90 ? 'fail' : usedPct > 80 ? 'warn' : 'ok',
      value: `${usedPct}% used`,
      detail: `${target} (${(s.blocks * s.bsize / 1024 / 1024 / 1024).toFixed(1)} GB total)`,
    };
  } catch (err) {
    return {
      name: 'Disk',
      status: 'warn',
      value: 'unknown',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Resolve a hostname; callback makes the check testable without network. */
export async function checkDns(
  hostname = 'api.github.com',
  resolver: (name: string) => Promise<unknown> = (n) => dns.resolve(n),
): Promise<DiagnosticCheck> {
  try {
    const addresses = await resolver(hostname);
    const count = Array.isArray(addresses) ? addresses.length : 1;
    return {
      name: 'DNS Resolution',
      status: 'ok',
      value: `${hostname}`,
      detail: `${count} address(es) resolved`,
    };
  } catch (err) {
    return {
      name: 'DNS Resolution',
      status: 'fail',
      value: `${hostname}`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Ping the local API health endpoint; callback makes it testable. */
export async function checkLocalApi(
  baseUrl: string,
  ping: (url: string) => Promise<{ ok: boolean }> = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { ok: res.status < 500 };
  },
): Promise<DiagnosticCheck> {
  try {
    const { ok } = await ping(`${baseUrl}/health`);
    return { name: 'API Connection', status: ok ? 'ok' : 'warn', value: baseUrl, detail: ok ? 'healthy' : 'unhealthy' };
  } catch (err) {
    return {
      name: 'API Connection',
      status: 'fail',
      value: baseUrl,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}