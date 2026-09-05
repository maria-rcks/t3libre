import { describe, expect, it } from "vite-plus/test";

import { inferImageExtension, parseBase64DataUrl } from "./imageMime.ts";

describe("imageMime", () => {
  it.each([
    ["mime type", "data:image/png;base64,SGVsbG8="],
    ["mime parameters", "data:image/png;charset=utf-8;base64,SGVsbG8="],
    ["spaces in payload", "data:image/png;base64,SGVs bG8=\n"],
    ["case-insensitive scheme and mime type", "DATA:IMAGE/PNG;BASE64,SGVsbG8="],
  ])("parses base64 data URL with %s", (_, dataUrl) => {
    expect(parseBase64DataUrl(dataUrl)).toEqual({
      mimeType: "image/png",
      base64: "SGVsbG8=",
    });
  });

  it.each([
    ["non-base64 data URL", "data:image/png;charset=utf-8,hello"],
    ["missing mime type", "data:;base64,SGVsbG8="],
    ["invalid payload character", "data:image/png;base64,SGVs!bG8="],
    ["comma in payload", "data:image/png;base64,SGVs,bG8="],
    ["interior and excess padding", "data:image/png;base64,AB=CD==="],
    ["interior padding", "data:image/png;base64,SGV=bG8="],
    ["excess padding followed by data", "data:image/png;base64,SGVsbG8=====AAA"],
    ["length not a multiple of four", "data:image/png;base64,SGVsbG8"],
    ["empty payload", "data:image/png;base64,"],
    ["whitespace-only payload", "data:image/png;base64, \r\n"],
  ])("rejects %s", (_, dataUrl) => {
    expect(parseBase64DataUrl(dataUrl)).toBeNull();
  });

  it.each(["SGVsbA==", "SGVsbG8h"])("accepts base64 payload %s", (base64) => {
    expect(parseBase64DataUrl(`data:image/png;base64,${base64}`)).toEqual({
      mimeType: "image/png",
      base64,
    });
  });

  it("parses a multi-megabyte payload from a deep call stack", () => {
    // Regression: matching the payload with a regex borrowed the JS call
    // stack, so a ~10 MB image parsed inside fiber execution threw
    // "RangeError: Maximum call stack size exceeded".
    const dataUrl = `data:image/png;base64,${"A".repeat(14_000_000)}`;
    const atDepth = (depth: number): ReturnType<typeof parseBase64DataUrl> =>
      depth === 0 ? parseBase64DataUrl(dataUrl) : atDepth(depth - 1);
    const findMaxDepth = (depth: number): number => {
      try {
        return findMaxDepth(depth + 1);
      } catch {
        return depth;
      }
    };
    const result = atDepth(Math.floor(findMaxDepth(0) * 0.85));
    expect(result?.mimeType).toBe("image/png");
    expect(result?.base64.length).toBe(14_000_000);
  });

  it("does not read inherited keys from mime extension map", () => {
    expect(inferImageExtension({ mimeType: "constructor" })).toBe(".bin");
  });
});
