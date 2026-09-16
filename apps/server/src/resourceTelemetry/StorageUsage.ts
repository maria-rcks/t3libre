// @effect-diagnostics nodeBuiltinImport:off - streamed directory entries, lstat and statfs form the filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { StorageUsageInput, StorageUsageSnapshot } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

export class StorageUsage extends Context.Service<
  StorageUsage,
  { readonly read: (input: StorageUsageInput) => Effect.Effect<StorageUsageSnapshot> }
>()("t3/resourceTelemetry/StorageUsage") {}

const CACHE_MS = 30_000;
const MAX_ENTRIES = 500_000;
const SCAN_MS = 15_000;
const STAT_CONCURRENCY = 16;

export const make = Effect.fn("makeStorageUsage")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const semaphore = Semaphore.makeUnsafe(1);
  let cached: StorageUsageSnapshot | undefined;

  const sample = Effect.fn("StorageUsage.sample")(function* () {
    const usage = yield* Effect.promise(async (signal) => {
      const deadline = performance.now() + SCAN_MS;
      let entries = 0;
      const withinBudget = () =>
        !signal.aborted && entries < MAX_ENTRIES && performance.now() < deadline;
      const categoryRoots = await Promise.all(
        [
          config.worktreesDir,
          config.browserArtifactsDir,
          config.logsDir,
          config.attachmentsDir,
        ].map((root) => NodeFSP.realpath(root).catch(() => NodePath.resolve(root))),
      );
      const scan = async (roots: readonly string[], excluded = new Set<string>()) => {
        const result = { bytes: 0, fileCount: 0, partial: false };
        const initialRoots = new Set(roots.map((root) => NodePath.resolve(root)));
        const directories = [...initialRoots];
        while (directories.length > 0) {
          if (!withinBudget()) {
            result.partial = true;
            break;
          }
          let directory = directories.pop()!;
          try {
            // Resolve platform aliases in ancestors, never a replaced root itself.
            if (initialRoots.has(directory)) {
              directory = NodePath.join(
                await NodeFSP.realpath(NodePath.dirname(directory)),
                NodePath.basename(directory),
              );
            }
            const stat = await NodeFSP.lstat(directory);
            // A configured root or a directory renamed during the scan may be a link.
            if (!stat.isDirectory()) {
              result.partial = true;
              continue;
            }
            const realPath = await NodeFSP.realpath(directory);
            if (realPath !== directory) {
              result.partial = true;
              continue;
            }
            const handle = await NodeFSP.opendir(directory, { bufferSize: 64 });
            // A rename between validation and opening must not change the category.
            try {
              const opened = await NodeFSP.lstat(directory);
              if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
                result.partial = true;
                await handle.close();
                continue;
              }
            } catch (error) {
              result.partial = true;
              await handle.close();
              throw error;
            }
            let files: string[] = [];
            const countFiles = async () => {
              await Promise.all(
                files.map(async (file) => {
                  try {
                    const info = await NodeFSP.lstat(file);
                    if (info.isFile()) {
                      result.bytes += info.size;
                      result.fileCount++;
                    }
                  } catch {
                    result.partial = true;
                  }
                }),
              );
              files = [];
            };
            for await (const entry of handle) {
              if (!withinBudget()) {
                result.partial = true;
                break;
              }
              entries++;
              const target = NodePath.join(directory, entry.name);
              if (excluded.has(target)) continue;
              if (entry.isDirectory()) directories.push(target);
              else if (entry.isFile()) files.push(target);
              if (files.length >= STAT_CONCURRENCY) await countFiles();
            }
            await countFiles();
          } catch (error) {
            // A category that has never been used is an empty directory, not an error.
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
              result.partial = true;
          }
        }
        return result;
      };

      // Small categories get measured before dependency-heavy worktrees use the scan budget.
      const browserArtifacts = await scan([config.browserArtifactsDir]);
      const logs = await scan([config.logsDir]);
      const attachments = await scan([config.attachmentsDir]);
      const other = await scan(
        [config.stateDir, config.providerStatusCacheDir],
        new Set(categoryRoots),
      );
      const worktrees = await scan([config.worktreesDir]);
      const categories = { worktrees, browserArtifacts, logs, attachments, other };
      const disk = signal.aborted
        ? null
        : await NodeFSP.statfs(config.baseDir).then(
            (stat) => {
              const totalBytes = stat.blocks * stat.bsize;
              const availableBytes = stat.bavail * stat.bsize;
              return Number.isSafeInteger(totalBytes) &&
                totalBytes >= 0 &&
                Number.isSafeInteger(availableBytes) &&
                availableBytes >= 0
                ? { totalBytes, availableBytes: Math.min(totalBytes, availableBytes) }
                : null;
            },
            () => null,
          );
      return {
        totalBytes: Object.values(categories).reduce(
          (total, category) => total + category.bytes,
          0,
        ),
        partial: Object.values(categories).some((category) => category.partial),
        categories,
        disk,
      };
    });
    return { ...usage, sampledAt: DateTime.toEpochMillis(yield* DateTime.now) };
  });

  const read = Effect.fn("StorageUsage.read")(function* (input: StorageUsageInput) {
    const previous = cached;
    return yield* semaphore.withPermit(
      Effect.gen(function* () {
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        // Concurrent refreshes share the sample completed while they awaited the permit.
        if (
          cached &&
          (cached !== previous || (!input.refresh && now - cached.sampledAt < CACHE_MS))
        )
          return cached;
        const sampled = yield* sample().pipe(Effect.timeoutOption(SCAN_MS));
        if (Option.isSome(sampled)) {
          cached = sampled.value;
        } else {
          // Node filesystem promises cannot all be cancelled. Interrupting the
          // Effect releases this permit; its AbortSignal stops further traversal.
          const partial = (category?: StorageUsageSnapshot["categories"]["other"]) => ({
            bytes: category?.bytes ?? 0,
            fileCount: category?.fileCount ?? 0,
            partial: true,
          });
          cached = {
            sampledAt: DateTime.toEpochMillis(yield* DateTime.now),
            totalBytes: cached?.totalBytes ?? 0,
            partial: true,
            disk: cached?.disk ?? null,
            categories: {
              worktrees: partial(cached?.categories.worktrees),
              browserArtifacts: partial(cached?.categories.browserArtifacts),
              logs: partial(cached?.categories.logs),
              attachments: partial(cached?.categories.attachments),
              other: partial(cached?.categories.other),
            },
          };
        }
        return cached;
      }),
    );
  });
  return StorageUsage.of({ read });
});

export const layer = Layer.effect(StorageUsage, make());
