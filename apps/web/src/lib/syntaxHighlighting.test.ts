import type { DiffsHighlighter } from "@pierre/diffs";
import { expect, it, vi } from "vite-plus/test";

const { getSharedHighlighter } = vi.hoisted(() => ({
  getSharedHighlighter: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter,
}));

import { getSyntaxHighlighterPromise } from "./syntaxHighlighting";

it("caches the recovered text highlighter for unsupported languages", async () => {
  const textHighlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockImplementation(({ langs }: { langs: string[] }) =>
    langs[0] === "text"
      ? Promise.resolve(textHighlighter)
      : Promise.reject(new Error("unsupported language")),
  );

  const first = getSyntaxHighlighterPromise("unsupported-test-language");
  await expect(first).resolves.toBe(textHighlighter);
  const second = getSyntaxHighlighterPromise("unsupported-test-language");

  expect(second).toBe(first);
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);
});

it("retries a language whose load and text fallback both failed", async () => {
  vi.resetModules();
  const { getSyntaxHighlighterPromise: load } = await import("./syntaxHighlighting");
  const highlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockRejectedValue(new Error("chunk failed"));
  await expect(load("typescript")).rejects.toThrow("chunk failed");

  getSharedHighlighter.mockResolvedValue(highlighter);
  await expect(load("typescript")).resolves.toBe(highlighter);
});
