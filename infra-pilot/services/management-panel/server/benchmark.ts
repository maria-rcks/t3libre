/**
 * @file Benchmark: real performance measurements.
 * Samples CPU usage over a duration, measures disk write throughput and
 * memory pressure, and produces a repeatable score.
 */

import os from 'os';
import path from 'path';
import { promises as fsp } from 'fs';
import { randomBytes } from 'crypto';

export interface CpuSample {
  idleMs: number;
  totalMs: number;
}

export interface Sampler {
  now(): number;
  cpuTimes(): CpuSample[];
  randomBytes(size: number): Buffer;
  writeFile(path: string, data: Buffer): Promise<void>;
  unlink(path: string): Promise<void>;
  resolve(hostname: string): Promise<unknown>;
}

export const defaultSampler: Sampler = {
  now: () => Date.now(),
  cpuTimes: () =>
    os.cpus().map((cpu) => ({
      idleMs: cpu.times.idle,
      totalMs:
        cpu.times.idle + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq,
    })),
  randomBytes: (size: number) => randomBytes(size),
  writeFile: (p, data) => fsp.writeFile(p, data),
  unlink: (p) => fsp.unlink(p),
  resolve: (hostname: string) => import('dns/promises').then((m) => m.resolve(hostname)),
};

export interface BenchmarkMeasurement {
  name: string;
  value: number;
  unit: string;
  detail?: string;
}

export interface BenchmarkResult {
  duration_seconds: number;
  cpu_avg_pct: number;
  cpu_peak_pct: number;
  memory_used_pct: number;
  disk_write_mbps: number;
  load_1m: number;
  measurements: BenchmarkMeasurement[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Measure average and peak CPU utilization by sampling `os.cpus()` times
 * every 100ms for `durationMs` milliseconds.
 */
export async function measureCpuUsage(
  durationMs: number,
  sampler: Sampler = defaultSampler,
): Promise<{ avgPct: number; peakPct: number }> {
  const samples: number[] = [];
  let prev = sampler.cpuTimes();
  const start = sampler.now();
  while (sampler.now() - start < durationMs) {
    await sleep(100);
    const cur = sampler.cpuTimes();
    let idleDelta = 0;
    let totalDelta = 0;
    for (let i = 0; i < Math.min(prev.length, cur.length); i++) {
      idleDelta += Math.max(0, cur[i].idleMs - prev[i].idleMs);
      totalDelta += Math.max(0, cur[i].totalMs - prev[i].totalMs);
    }
    if (totalDelta > 0) {
      samples.push(((totalDelta - idleDelta) / totalDelta) * 100);
    }
    prev = cur;
  }
  if (samples.length === 0) return { avgPct: 0, peakPct: 0 };
  const avgPct = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { avgPct: Number(avgPct.toFixed(1)), peakPct: Number(Math.max(...samples).toFixed(1)) };
}

/**
 * Write `sizeMb` MiB of random data to a temp file and report throughput.
 */
export async function measureDiskWriteMbps(
  sizeMb = 64,
  tmpDir: string = os.tmpdir(),
  sampler: Sampler = defaultSampler,
): Promise<{ writeMbps: number; bytesWritten: number }> {
  const filePath = path.join(tmpDir, `.infra-pilot-bench-${process.pid}-${sampler.now()}.tmp`);
  const data = sampler.randomBytes(sizeMb * 1024 * 1024);
  const start = sampler.now();
  try {
    await sampler.writeFile(filePath, data);
  } finally {
    await sampler.unlink(filePath).catch(() => undefined);
  }
  const elapsedSec = (sampler.now() - start) / 1000;
  const writeMbps = elapsedSec > 0 ? Number((data.length / 1024 / 1024 / elapsedSec).toFixed(2)) : 0;
  return { writeMbps, bytesWritten: data.length };
}

/**
 * Run the full local benchmark.
 */
export async function runBenchmark(
  durationSeconds = 10,
  sampler: Sampler = defaultSampler,
): Promise<BenchmarkResult> {
  const durationMs = Math.max(1, durationSeconds) * 1000;
  const [cpu, disk, memInfo] = await Promise.all([
    measureCpuUsage(durationMs, sampler),
    measureDiskWriteMbps(64, os.tmpdir(), sampler),
    Promise.resolve({
      usedPct: Number(((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)),
      totalGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
      freeGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(2)),
    }),
  ]);
  const load1m = os.loadavg()[0] ?? 0;
  return {
    duration_seconds: durationSeconds,
    cpu_avg_pct: cpu.avgPct,
    cpu_peak_pct: cpu.peakPct,
    memory_used_pct: memInfo.usedPct,
    disk_write_mbps: disk.writeMbps,
    load_1m: Number(load1m.toFixed(2)),
    measurements: [
      { name: 'cpu_avg', value: cpu.avgPct, unit: '%' },
      { name: 'cpu_peak', value: cpu.peakPct, unit: '%' },
      { name: 'memory_used', value: memInfo.usedPct, unit: '%' },
      { name: 'disk_write', value: disk.writeMbps, unit: 'MiB/s' },
      { name: 'load_1m', value: load1m, unit: '' },
    ],
  };
}