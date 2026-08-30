import { describe, expect, it } from "vite-plus/test";

import {
  dismissedChatWarningKeysForServerRun,
  mergeDismissedChatWarningKeys,
  mergeServerRunChatWarningDismissals,
} from "./chatWarningDismissals";

describe("mergeDismissedChatWarningKeys", () => {
  it("keeps dismissals unique and ordered", () => {
    expect(mergeDismissedChatWarningKeys(["one", "two"], ["two", "three"])).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("bounds persisted warning history", () => {
    const keys = Array.from({ length: 201 }, (_, index) => `warning-${index}`);
    expect(mergeDismissedChatWarningKeys([], keys)).toEqual(keys.slice(1));
  });

  it("keeps temporary dismissals scoped to one server run", () => {
    const runs = mergeServerRunChatWarningDismissals([], "server-run-1", ["warning-1"]);

    expect(dismissedChatWarningKeysForServerRun(runs, "server-run-1")).toEqual(["warning-1"]);
    expect(dismissedChatWarningKeysForServerRun(runs, "server-run-2")).toEqual([]);
  });

  it("bounds retained server runs", () => {
    const runs = Array.from({ length: 21 }, (_, index) => ({
      serverRunId: `server-run-${index}`,
      keys: [`warning-${index}`],
    }));
    const merged = mergeServerRunChatWarningDismissals(runs, "server-run-21", ["warning-21"]);

    expect(merged).toHaveLength(20);
    expect(merged[0]?.serverRunId).toBe("server-run-2");
    expect(merged.at(-1)?.serverRunId).toBe("server-run-21");
  });
});
