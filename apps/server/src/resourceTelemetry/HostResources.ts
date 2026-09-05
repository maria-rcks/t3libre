import * as NodeOS from "node:os";
import * as NodeTimersPromises from "node:timers/promises";
import type { HostResourcesSnapshot } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const CACHE_MS = 5_000;

// All sockets share the sample. Idle servers do no polling or process scans.
let latest: HostResourcesSnapshot | undefined;
let pending: Promise<HostResourcesSnapshot> | undefined;

function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

async function sample(
  sampledAt: number,
  platform: NodeJS.Platform,
  readMeminfo: () => Promise<string>,
): Promise<HostResourcesSnapshot> {
  const previousCpu = readCpu();
  // CPU counters need two readings; a bounded demand-only sample also works on Windows.
  await NodeTimersPromises.setTimeout(200);
  const cpu = readCpu();
  const totalDelta = cpu.total - previousCpu.total;
  const idleDelta = cpu.idle - previousCpu.idle;
  const cpuUtilization =
    previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
      ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
      : null;
  const totalMemoryBytes = NodeOS.totalmem();
  let availableMemoryBytes = NodeOS.freemem();
  if (platform === "linux") {
    const meminfo = await readMeminfo();
    const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
    if (available) availableMemoryBytes = Number(available) * 1024;
  }
  latest = {
    sampledAt,
    cpuUtilization,
    cpuCount: cpu.count,
    availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
    totalMemoryBytes,
  };
  return latest;
}

export const readHostResources = Effect.fn("HostResources.read")(function* () {
  const sampledAt = DateTime.toEpochMillis(yield* DateTime.now);
  if (latest && sampledAt >= latest.sampledAt && sampledAt - latest.sampledAt < CACHE_MS) {
    return latest;
  }
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  return yield* Effect.promise(() => {
    pending ??= sample(sampledAt, platform, () =>
      Effect.runPromise(
        fs.readFileString("/proc/meminfo").pipe(Effect.catch(() => Effect.succeed(""))),
      ),
    ).finally(() => {
      pending = undefined;
    });
    return pending;
  });
});
