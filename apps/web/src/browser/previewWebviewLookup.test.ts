import { describe, expect, it } from "vite-plus/test";

import { ACTIVE_PREVIEW_WEBVIEW_SELECTOR, findActivePreviewWebview } from "./previewWebviewLookup";

interface TestWebview {
  readonly attributes: Readonly<Record<string, string>>;
  getAttribute(name: string): string | null;
}

const webview = (attributes: Readonly<Record<string, string>>): TestWebview => ({
  attributes,
  getAttribute: (name) => attributes[name] ?? null,
});

describe("findActivePreviewWebview", () => {
  it("selects the live guest when a retired capture guest has the same tab id", () => {
    const retired = webview({
      "data-preview-tab": "tab-1",
      "data-preview-capture-retired": "true",
    });
    const live = webview({ "data-preview-tab": "tab-1" });
    const root = {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe(ACTIVE_PREVIEW_WEBVIEW_SELECTOR);
        return [retired, live];
      },
    };

    expect(
      findActivePreviewWebview<TestWebview & Element>(root as unknown as ParentNode, "tab-1"),
    ).toBe(live);
  });
});
