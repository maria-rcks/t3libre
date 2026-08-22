import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultSampler,
  measureCpuUsage,
  measureDiskWriteMbps,
  runBenchmark,
} from '../../server/benchmark.ts';

let fakeTime = 0;
const fakeSampler = {
  now: () => {
    fakeTime += 1000;
    return fakeTime;
  },
  cpuTimes: () => [{ idleMs: 10, totalMs: 100 }],
  randomBytes: (size: number) => Buffer.alloc(size, 0x61),
  writeFile: async () => undefined,
  unlink: async () => undefined,
  resolve: async () => ['1.2.3.4'],
};

describe('benchmark module', () => {
  it('measures cpu usage from time samples', async () => {
    const result = await measureCpuUsage(100, defaultSampler);
    assert.ok(result.avgPct >= 0 && result.avgPct <= 100, `avgPct ${result.avgPct}`);
    assert.ok(result.peakPct >= result.avgPct);
  });

  it('measures disk write throughput', async () => {
    const result = await measureDiskWriteMbps(1, __dirname, fakeSampler);
    assert.ok(result.bytesWritten > 0);
    assert.ok(result.writeMbps > 0);
  });

  it('produces a complete benchmark result', async () => {
    const result = await runBenchmark(1, fakeSampler);
    assert.equal(result.duration_seconds, 1);
    assert.ok(result.cpu_avg_pct >= 0);
    assert.ok(result.memory_used_pct >= 0 && result.memory_used_pct <= 100);
    assert.ok(result.disk_write_mbps > 0);
    assert.equal(result.measurements.length, 5);
  });
});