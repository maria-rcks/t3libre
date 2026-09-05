import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";

import { getTerminalLabel, nextTerminalId, resolveTerminalSessionLabel } from "./terminalLabels.ts";

describe("getTerminalLabel", () => {
  it("uses the numeric suffix for term-* ids", () => {
    expect(getTerminalLabel(DEFAULT_TERMINAL_ID)).toBe("Terminal 1");
    expect(getTerminalLabel("term-2")).toBe("Terminal 2");
    expect(getTerminalLabel("term-12")).toBe("Terminal 12");
    expect(getTerminalLabel("terminal-3")).toBe("Terminal 3");
  });

  it("falls back to the raw id for unknown shapes", () => {
    expect(getTerminalLabel("custom-session")).toBe("custom-session");
  });
});

describe("resolveTerminalSessionLabel", () => {
  it("prefers a non-empty summary label", () => {
    expect(resolveTerminalSessionLabel("term-1", { label: "  bun  " })).toBe("bun");
  });

  it("falls back to getTerminalLabel when summary is missing or blank", () => {
    expect(resolveTerminalSessionLabel(DEFAULT_TERMINAL_ID, { label: "   " })).toBe("Terminal 1");
    expect(resolveTerminalSessionLabel(DEFAULT_TERMINAL_ID, null)).toBe("Terminal 1");
    expect(resolveTerminalSessionLabel("term-2", undefined)).toBe("Terminal 2");
  });
});

describe("nextTerminalId", () => {
  it.each([
    [[], DEFAULT_TERMINAL_ID],
    [[DEFAULT_TERMINAL_ID], "term-2"],
    [[DEFAULT_TERMINAL_ID, "term-2", "term-3"], "term-4"],
    [[DEFAULT_TERMINAL_ID, "term-3"], "term-2"],
    [["term-2", "term-3"], "term-1"],
    [["", "  ", DEFAULT_TERMINAL_ID], "term-2"],
    [["", "  "], "term-1"],
  ])("allocates the lowest unused id for %j: %s", (existingIds, expected) => {
    expect(nextTerminalId(existingIds)).toBe(expected);
  });
});
