import { describe, expect, it } from "vite-plus/test";

import { isDefaultThreadEnvModeSettled, resolveDefaultThreadEnvMode } from "./threadEnvMode.ts";

describe("resolveDefaultThreadEnvMode", () => {
  it.each([
    ["local", "worktree", "worktree", "local"],
    [null, "local", "worktree", "local"],
    [undefined, null, "worktree", "worktree"],
  ] as const)(
    "resolves project %s, file %s, global %s to %s",
    (projectSetting, projectFile, globalDefault, expected) => {
      expect(resolveDefaultThreadEnvMode({ projectSetting, projectFile, globalDefault })).toBe(
        expected,
      );
    },
  );
});

describe("isDefaultThreadEnvModeSettled", () => {
  it.each([
    ["local", null, true, true],
    [undefined, "worktree", true, true],
    [undefined, null, true, false],
    [undefined, null, false, true],
  ] as const)(
    "settles explicit %s, project %s, file pending %s: %s",
    (explicitMode, projectSetting, projectFilePending, expected) => {
      expect(
        isDefaultThreadEnvModeSettled({ explicitMode, projectSetting, projectFilePending }),
      ).toBe(expected);
    },
  );
});
