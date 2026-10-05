import {
  EnvironmentId,
  UsageDay,
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
} from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useUsage, type EnvironmentUsageStatus, type UsageView } from "./usage";

const testState = vi.hoisted(() => ({ environments: [] as EnvironmentUsageStatus[] }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => testState.environments,
}));

const input = {
  sinceDay: UsageDay.make("2026-09-04"),
  untilDay: UsageDay.make("2026-09-04"),
  timeZone: "UTC",
};

function environment(id: string, cost: number | null, hostId = id): EnvironmentUsageStatus {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    isPending: cost === null,
    error: null,
    needsCursorKeychainAccess: false,
    summary:
      cost === null
        ? null
        : {
            ...input,
            contractVersion: USAGE_CONTRACT_VERSION,
            readAt: "2026-09-04T12:00:00Z",
            buckets: [
              {
                day: input.sinceDay,
                provider: "codex",
                model: id,
                totals: {
                  uncachedInputTokens: 100,
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 50,
                  reasoningTokens: 0,
                },
                costUsd: cost,
                cacheSavingsUsd: 0,
                costSource: "modelPriced",
                records: 1,
                unpricedRecords: 0,
                sessions: 1,
              },
            ],
            sources: [
              {
                fingerprint: {
                  hostId,
                  provider: "codex",
                  resolvedHomePath: "/sessions",
                  volumeId: hostId,
                },
                status: "ok",
                scannedFiles: 1,
                skippedFiles: 0,
                malformedRecords: 0,
                distinctSessions: 1,
                message: null,
              },
            ],
            pricing: { status: "fresh", source: "test", fetchedAt: null, knownModels: 1 },
            scanDurationMs: 1,
          },
  };
}

let renderer: ReactTestRenderer | undefined;
let latest: UsageView;

function Probe({
  selected,
  provider = null,
}: {
  selected: ReadonlySet<EnvironmentId> | null;
  provider?: UsageProviderKind | null;
}) {
  const usage = useUsage(input, selected, provider);
  useLayoutEffect(() => {
    latest = usage;
  }, [usage]);
  return null;
}

async function select(...ids: string[]) {
  await act(() => {
    renderer?.update(<Probe selected={new Set(ids.map((id) => EnvironmentId.make(id)))} />);
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  testState.environments = [environment("a", 10), environment("b", 20), environment("slow", null)];
  await act(() => {
    renderer = create(<Probe selected={null} />);
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("usage environment selection", () => {
  it("starts with all environments and adds results as they arrive", async () => {
    expect(latest.merged.costUsd).toBe(30);
    expect(latest.isPending).toBe(false);
    expect(latest.isPartial).toBe(true);

    testState.environments = [...testState.environments.slice(0, 2), environment("slow", 40)];
    await act(() => renderer?.update(<Probe selected={null} />));
    expect(latest.merged.costUsd).toBe(70);
    expect(latest.isPartial).toBe(false);
  });

  it("excludes unselected usage and pending environments, then restores all", async () => {
    await select("b");
    expect(latest.merged.costUsd).toBe(20);
    expect(latest.merged.models.map((model) => model.model)).toEqual(["b"]);
    expect(latest.isPending).toBe(false);
    expect(latest.isPartial).toBe(false);
    expect(latest.environments).toHaveLength(3);

    await act(() => renderer?.update(<Probe selected={null} />));
    expect(latest.merged.costUsd).toBe(30);
    expect(latest.isPartial).toBe(true);
  });

  it("distinguishes a pending selection from an empty or failed selection", async () => {
    await select("slow");
    expect(latest.isPending).toBe(true);
    expect(latest.merged.costUsd).toBe(0);

    await select();
    expect(latest.selectedEnvironments).toHaveLength(0);
    expect(latest.isPending).toBe(false);
    expect(latest.isPartial).toBe(false);

    testState.environments = [{ ...environment("slow", null), isPending: false, error: "Offline" }];
    await select("slow");
    expect(latest.isPending).toBe(false);
    expect(latest.isPartial).toBe(false);
  });

  it("deduplicates within the selection so an excluded owner cannot hide usage", async () => {
    testState.environments = [environment("a", 10, "shared"), environment("b", 20, "shared")];
    await act(() => renderer?.update(<Probe selected={null} />));
    expect(latest.merged.costUsd).toBe(10);

    await select("b");
    expect(latest.merged.costUsd).toBe(20);
    expect(latest.merged.duplicateSources).toEqual([]);
  });

  it("filters tokens, prices, sessions and charts without changing the original summaries", async () => {
    const original = environment("mixed", 10);
    const summary = original.summary!;
    const opencode = {
      ...summary.buckets[0]!,
      provider: "opencode" as const,
      model: "opencode-model",
      hourStart: "2026-09-04T12:00:00Z",
      totals: {
        uncachedInputTokens: 20,
        cachedInputTokens: 30,
        cacheCreationTokens: 10,
        outputTokens: 40,
        reasoningTokens: 15,
      },
      categoryCostUsd: { input: 1, cacheRead: 0.5, cacheWrite: 0.5, output: 1 },
      costUsd: 3,
    };
    testState.environments = [
      {
        ...original,
        summary: {
          ...summary,
          buckets: [...summary.buckets, opencode],
          sources: [
            ...summary.sources,
            {
              ...summary.sources[0]!,
              fingerprint: { ...summary.sources[0]!.fingerprint, provider: "opencode" },
              distinctSessions: 8,
            },
          ],
        },
      },
    ];
    const before = structuredClone(testState.environments);
    await act(() => renderer?.update(<Probe selected={null} provider="opencode" />));
    expect(latest.merged.totalTokens).toBe(100);
    expect(latest.merged.outputTokens).toBe(40);
    expect(latest.merged.reasoningTokens).toBe(15);
    expect(latest.merged.costUsd).toBe(3);
    expect(latest.merged.categoryCost).toMatchObject({ input: 1, output: 1 });
    expect(latest.merged.sessions).toBe(8);
    expect(latest.merged.models.map((model) => model.model)).toEqual(["opencode-model"]);
    expect(latest.merged.providers.map((provider) => provider.provider)).toEqual(["opencode"]);
    for (const totals of [latest.merged.daily[0]!, latest.merged.hourly[0]!]) {
      expect(totals).toMatchObject({ totalTokens: 100, costUsd: 3 });
      expect([...totals.byProvider.keys()]).toEqual(["opencode"]);
      expect(totals.byProvider.get("opencode")).toEqual({
        totalTokens: 100,
        costUsd: 3,
        reasoningTokens: 15,
      });
    }
    expect(testState.environments).toEqual(before);

    await act(() => renderer?.update(<Probe selected={null} provider="claude" />));
    expect(latest.merged.totalTokens).toBe(0);
    expect(latest.merged.sessions).toBe(0);

    await act(() => renderer?.update(<Probe selected={null} />));
    expect(latest.merged.totalTokens).toBe(250);
    expect(latest.merged.costUsd).toBe(13);
    expect(latest.merged.sessions).toBe(9);
    expect(latest.merged.models).toHaveLength(2);
    expect(testState.environments).toEqual(before);
  });

  it("keeps selected cached results visible during a refresh", async () => {
    testState.environments = [
      { ...environment("a", 10), isPending: true },
      environment("slow", null),
    ];
    await select("a");
    expect(latest.merged.costUsd).toBe(10);
    expect(latest.isPending).toBe(false);
    expect(latest.isPartial).toBe(false);
  });
});
