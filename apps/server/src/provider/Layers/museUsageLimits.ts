import type { Connection } from "@muse-code/sdk";
import { NonNegativeInt, PositiveInt, type ServerProviderUsageLimits } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../providerUsageLimits.ts";

const EpochMillis = NonNegativeInt.check(Schema.isLessThanOrEqualTo(8_640_000_000_000_000));
const UsageWindow = Schema.Struct({
  resetsAtMs: EpochMillis,
  usedPercent: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
});
export const MuseSubscriptionUsage = Schema.Struct({
  observedAtMs: EpochMillis,
  tier: Schema.String,
  weekly: UsageWindow,
  window: Schema.Struct({
    ...UsageWindow.fields,
    windowDurationMins: PositiveInt,
  }),
});
const UsageReadResult = Schema.Struct({ usage: Schema.optional(MuseSubscriptionUsage) });
const isoFromMillis = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

export function museSubscriptionUsageToLimits(
  usage: typeof MuseSubscriptionUsage.Type,
): ServerProviderUsageLimits {
  return makeUsageLimits({
    checkedAt: isoFromMillis(usage.observedAtMs),
    windows: [
      {
        id: "window",
        kind: "session",
        label: "Session",
        usedPercent: clampPercent(usage.window.usedPercent),
        resetsAt: isoFromMillis(usage.window.resetsAtMs),
        windowDurationMins: usage.window.windowDurationMins,
      },
      {
        id: "weekly",
        kind: "weekly",
        label: "Weekly",
        usedPercent: clampPercent(usage.weekly.usedPercent),
        resetsAt: isoFromMillis(usage.weekly.resetsAtMs),
      },
    ],
  });
}

export const readMuseUsageLimits = Effect.fn("readMuseUsageLimits")(function* (
  connection: Pick<Connection, "request">,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  return yield* Effect.tryPromise(() => connection.request("usage/read", {})).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(UsageReadResult)),
    Effect.map(({ usage }) =>
      usage
        ? museSubscriptionUsageToLimits(usage)
        : makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: "Muse Code has not observed subscription usage yet.",
          }),
    ),
    Effect.timeout("4 seconds"),
    Effect.catch(() =>
      Effect.succeed(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: "probeFailed",
          message: "Muse Code could not read subscription usage.",
        }),
      ),
    ),
  );
});
