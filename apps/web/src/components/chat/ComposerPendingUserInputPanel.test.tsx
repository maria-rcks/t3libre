// @vitest-environment jsdom

import { RuntimeRequestId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import type { PendingUserInput } from "../../session-logic";

vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

const prompt: PendingUserInput = {
  requestId: RuntimeRequestId.make("request-1"),
  responseCapability: "live" as const,
  createdAt: "2026-08-15T00:00:00.000Z",
  questions: [
    {
      id: "question-1",
      header: "Approach",
      question: "Which approach should the migration take?",
      options: [
        { label: "Incremental", description: "Move one module at a time" },
        { label: "Big bang", description: "Move everything in one release" },
      ],
      multiSelect: false,
    },
  ],
  dismissible: true,
};

function renderPanel(pendingUserInput: PendingUserInput = prompt) {
  return renderToStaticMarkup(
    <ComposerPendingUserInputPanel
      pendingUserInputs={[pendingUserInput]}
      respondingRequestIds={[]}
      answers={{}}
      questionIndex={0}
      onToggleOption={() => {}}
      onAdvance={() => {}}
      onDismiss={() => {}}
    />,
  );
}

describe("ComposerPendingUserInputPanel", () => {
  it("updates the markdown preview on focus and selection and clears it across questions and requests", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onToggleOption = vi.fn();
    const onAdvance = vi.fn();
    const panelProps = {
      pendingUserInputs: [
        {
          ...prompt,
          questions: [
            {
              ...prompt.questions[0]!,
              multiSelect: true,
              options: [
                {
                  ...prompt.questions[0]!.options[0]!,
                  preview: "**Safe rollout**\n\nUse `batch = 1`.\n\n<script>unsafe()</script>",
                },
                prompt.questions[0]!.options[1]!,
                { label: "Empty preview", description: "No draft", preview: "  \n" },
              ],
            },
            {
              ...prompt.questions[0]!,
              id: "question-2",
            },
          ],
        },
      ],
      respondingRequestIds: [],
      answers: {},
      questionIndex: 0,
      onToggleOption,
      onAdvance,
      onDismiss: vi.fn(),
    };
    try {
      await act(() => root.render(<ComposerPendingUserInputPanel {...panelProps} />));
      expect(container.querySelector("section strong")?.textContent).toBe("Safe rollout");
      expect(container.querySelector("section code")?.textContent).toBe("batch = 1");
      expect(container.querySelector("section script")).toBeNull();
      const options = container.querySelectorAll<HTMLButtonElement>("button.group");
      await act(() => options[1]!.focus());
      expect(container.querySelector("section")).toBeNull();
      await act(() => options[0]!.focus());
      expect(container.querySelector("section")?.textContent).toContain("Safe rollout");
      expect(onToggleOption).not.toHaveBeenCalled();
      await act(() => options[2]!.click());
      expect(container.querySelector("section")).toBeNull();
      expect(onToggleOption).toHaveBeenLastCalledWith("question-1", "Empty preview");
      expect(onAdvance).not.toHaveBeenCalled();
      await act(() =>
        root.render(<ComposerPendingUserInputPanel {...panelProps} questionIndex={1} />),
      );
      expect(container.querySelector("section")).toBeNull();
      await act(() =>
        root.render(<ComposerPendingUserInputPanel {...panelProps} questionIndex={0} />),
      );
      expect(container.querySelector("section")?.textContent).toContain("Safe rollout");
      await act(() => container.querySelectorAll<HTMLButtonElement>("button.group")[1]!.focus());
      expect(container.querySelector("section")).toBeNull();
      await act(() =>
        root.render(
          <ComposerPendingUserInputPanel
            {...panelProps}
            pendingUserInputs={[
              {
                ...panelProps.pendingUserInputs[0]!,
                requestId: RuntimeRequestId.make("request-2"),
              },
            ]}
          />,
        ),
      );
      expect(container.querySelector("section")?.textContent).toContain("Safe rollout");
    } finally {
      await act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("renders the header as a disclosure control for the question body", () => {
    const markup = renderPanel();

    const toggle = markup.match(/<button[^>]*data-pending-user-input-toggle="[^"]*"[^>]*>/)?.[0];
    expect(toggle).toBeDefined();
    expect(toggle).toContain('data-pending-user-input-toggle="expanded"');
    expect(toggle).toContain('aria-expanded="true"');
    expect(toggle).toContain('type="button"');

    const controlledId = toggle?.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlledId).toBeDefined();
    expect(markup).toMatch(new RegExp(`<div[^>]*\\sid="${controlledId}"`));
  });

  it("offers dismiss only for async questions", () => {
    expect(renderPanel()).toContain("data-pending-user-input-dismiss");
    expect(renderPanel({ ...prompt, dismissible: false })).not.toContain(
      "data-pending-user-input-dismiss",
    );
  });

  it("starts expanded so the question and its options are visible", () => {
    const markup = renderPanel();

    expect(markup).toContain("Approach");
    expect(markup).toContain("Which approach should the migration take?");
    expect(markup).toContain("Incremental");
    expect(markup).toContain("Big bang");
  });
});
