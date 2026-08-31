import { act } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("./hooks/useSettings", () => ({
  useClientSettings: (
    selector: (settings: {
      panelAnimationsEnabled: boolean;
      panelAnimationDurationMs: number;
    }) => unknown,
  ) => selector({ panelAnimationsEnabled: true, panelAnimationDurationMs: 200 }),
}));

import { PANEL_ANIMATION_DURATION_MS, usePanelPresence } from "./panelAnimations";

type HarnessProps = {
  readonly open: boolean;
  readonly value: string | null;
  readonly animated: boolean;
  readonly scopeKey: string;
  readonly durationMs?: number;
};

let latestPresence: ReturnType<typeof usePanelPresence<string>>;

function Harness(props: HarnessProps) {
  latestPresence = usePanelPresence(
    props.open,
    props.value,
    props.animated,
    props.scopeKey,
    props.durationMs,
  );
  return null;
}

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

async function installHarness() {
  vi.useFakeTimers();
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => globalThis.clearTimeout(id),
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.createElement("div") as unknown as Element);
  const render = (props: HarnessProps) => act(() => root.render(<Harness {...props} />));
  const cleanup = async () => {
    await act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  };
  return { cleanup, render };
}

describe("usePanelPresence", () => {
  it("retains closing content for the animation duration", async () => {
    const harness = await installHarness();
    try {
      await harness.render({ open: true, value: "diff", animated: true, scopeKey: "thread-a" });
      await harness.render({ open: false, value: null, animated: true, scopeKey: "thread-a" });
      expect(latestPresence).toEqual({ present: true, value: "diff" });

      await act(() => vi.advanceTimersByTimeAsync(PANEL_ANIMATION_DURATION_MS - 1));
      expect(latestPresence).toEqual({ present: true, value: "diff" });

      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(latestPresence).toEqual({ present: false, value: null });
    } finally {
      await harness.cleanup();
    }
  });

  it("shows an empty open panel and closes it immediately without animation", async () => {
    const harness = await installHarness();
    try {
      await harness.render({ open: true, value: null, animated: false, scopeKey: "thread-a" });
      expect(latestPresence).toEqual({ present: true, value: null });

      await harness.render({ open: false, value: null, animated: false, scopeKey: "thread-a" });
      expect(latestPresence).toEqual({ present: false, value: null });
    } finally {
      await harness.cleanup();
    }
  });

  it("uses the configured animation duration before unmounting", async () => {
    const harness = await installHarness();
    try {
      await harness.render({
        open: true,
        value: "diff",
        animated: true,
        scopeKey: "thread-a",
        durationMs: 350,
      });
      await harness.render({
        open: false,
        value: null,
        animated: true,
        scopeKey: "thread-a",
        durationMs: 350,
      });

      await act(() => vi.advanceTimersByTimeAsync(349));
      expect(latestPresence).toEqual({ present: true, value: "diff" });
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(latestPresence).toEqual({ present: false, value: null });
    } finally {
      await harness.cleanup();
    }
  });

  it("cancels a pending unmount when reopened", async () => {
    const harness = await installHarness();
    try {
      await harness.render({ open: true, value: "files", animated: true, scopeKey: "thread-a" });
      await harness.render({ open: false, value: null, animated: true, scopeKey: "thread-a" });
      await act(() => vi.advanceTimersByTimeAsync(PANEL_ANIMATION_DURATION_MS / 2));
      await harness.render({ open: true, value: "files", animated: true, scopeKey: "thread-a" });
      await act(() => vi.advanceTimersByTimeAsync(PANEL_ANIMATION_DURATION_MS));
      expect(latestPresence).toEqual({ present: true, value: "files" });
    } finally {
      await harness.cleanup();
    }
  });

  it("does not carry closing content across scopes", async () => {
    const harness = await installHarness();
    try {
      await harness.render({ open: true, value: "terminal", animated: true, scopeKey: "thread-a" });
      await harness.render({ open: false, value: null, animated: true, scopeKey: "thread-b" });
      expect(latestPresence).toEqual({ present: false, value: null });
    } finally {
      await harness.cleanup();
    }
  });
});
