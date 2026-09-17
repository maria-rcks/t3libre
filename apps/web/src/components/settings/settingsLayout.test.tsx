import { DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  scrollToSettingsTarget,
  SettingsRow,
  SettingsSearchTargetProvider,
  SettingsUnavailableGroup,
} from "./settingsLayout";

const searchState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  environments: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: ({
    select,
  }: {
    select: (location: { search: Record<string, unknown> }) => unknown;
  }) => select({ search: searchState.search }),
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: searchState.environments,
  usePrimaryEnvironmentId: () => "primary",
  usePrimaryEnvironment: () => null,
}));
vi.mock("./useSettingsProjectGroups", () => ({ useSettingsProjectGroups: () => [] }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({}) }));
vi.mock("../../environments/primary", () => ({ usePrimarySessionState: () => ({}) }));
vi.stubGlobal("window", { desktopBridge: { getLocalEnvironmentEnabled: () => true } });

import { useAvailableSettingsSearchItems } from "./useAvailableSettingsSearchItems";
import { searchSettings } from "./settingsSearch";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("searches the selected environment outside the settings scope provider", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  searchState.environments.mockReturnValue({
    environments: ["primary", "selected"].map((id) => ({
      environmentId: EnvironmentId.make(id),
      label: id,
      connection: { phase: "connected" },
      serverConfig: {
        settings: DEFAULT_SERVER_SETTINGS,
        environment: { capabilities: {} },
        keybindings: compileResolvedKeybindingsConfig([
          { command: `script.${id}.run`, key: id === "primary" ? "alt+p" : "alt+s" },
        ]),
      },
    })),
  });
  function SearchResults() {
    const items = useAvailableSettingsSearchItems();
    return (
      <output>
        {searchSettings("run script", items)
          .map((item) => item.title)
          .join(", ")}
      </output>
    );
  }
  searchState.search = { machine: "selected" };
  await act(() => {
    renderer = create(<SearchResults />);
  });
  expect(renderer!.root.findByType("output").children.join("")).toContain("Run Script: Selected");
  searchState.search = { machine: "primary" };
  await act(() => {
    renderer!.update(<SearchResults />);
  });
  expect(renderer!.root.findByType("output").children.join("")).toContain("Run Script: Primary");
  expect(renderer!.root.findByType("output").children.join("")).not.toContain(
    "Run Script: Selected",
  );
});

describe("unavailable settings", () => {
  it("groups disabled controls under one reason", () => {
    const markup = renderToStaticMarkup(
      <SettingsUnavailableGroup message="Only available in the desktop app.">
        <SettingsRow title="Window capture" description="Capture a window." />
      </SettingsUnavailableGroup>,
    );

    expect(markup).toContain("Only available in the desktop app.");
    expect(markup).toContain("border-border/60");
    expect(markup).toContain("[&amp;_h3]:opacity-64");
  });
});

describe("settings search targets", () => {
  it("does not persist destination styling in the rendered row", () => {
    const markup = renderToStaticMarkup(
      <SettingsSearchTargetProvider targetId="word-wrap">
        <SettingsRow id="word-wrap" title="Word wrap" description="Wrap long lines." />
        <SettingsRow id="time-format" title="Time format" description="Choose a clock." />
      </SettingsSearchTargetProvider>,
    );

    expect(markup).toContain('id="word-wrap" tabindex="-1"');
    expect(markup).not.toContain("data-settings-search-target");
    expect(markup).not.toContain("settings-search-target-pulse");
  });

  it("scrolls directly to a section header and restarts the destination pulse", () => {
    const sectionScrollIntoView = vi.fn();
    const headerScrollIntoView = vi.fn();
    const focus = vi.fn();
    const remove = vi.fn();
    const add = vi.fn();
    const addEventListener = vi.fn();
    const target = {
      tagName: "SECTION",
      firstElementChild: { scrollIntoView: headerScrollIntoView },
      scrollIntoView: sectionScrollIntoView,
      focus,
      classList: { remove, add },
      addEventListener,
      offsetWidth: 100,
    } as unknown as HTMLElement;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => target),
    });
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: false })),
    });

    expect(scrollToSettingsTarget("providers")).toBe(true);
    expect(headerScrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(sectionScrollIntoView).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(remove).toHaveBeenCalledWith("settings-search-target-pulse");
    expect(add).toHaveBeenCalledWith("settings-search-target-pulse");
    expect(addEventListener).toHaveBeenCalledWith("blur", expect.any(Function), { once: true });
  });

  it("does not animate the destination when reduced motion is requested", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const remove = vi.fn();
    const add = vi.fn();
    const target = {
      tagName: "DIV",
      firstElementChild: null,
      scrollIntoView,
      focus,
      classList: { remove, add },
      offsetWidth: 100,
    } as unknown as HTMLElement;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => target),
    });
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
    });

    expect(scrollToSettingsTarget("word-wrap")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(remove).toHaveBeenCalledWith("settings-search-target-pulse");
    expect(add).not.toHaveBeenCalled();
  });

  it("leaves not-yet-mounted destinations to their mount lifecycle", () => {
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => null),
    });

    expect(scrollToSettingsTarget("archive")).toBe(false);
  });
});
