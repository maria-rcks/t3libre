import type { ProjectId, PullRequestProviderSummary } from "@t3tools/contracts";
import { CircleIcon } from "lucide-react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PullRequestFilterPills,
  PullRequestProjectFilter,
  PullRequestProviderFilter,
} from "./PullRequestListFilters";

type Clickable = ReactElement<{
  readonly "aria-pressed"?: boolean;
  readonly children?: ReactNode;
  readonly onClick?: () => void;
}>;

function buttonsIn(element: ReactElement<{ readonly children?: ReactNode }> | null): Clickable[] {
  if (element === null) return [];
  return Children.toArray(element.props.children).filter(isValidElement) as Clickable[];
}

function findValueChange(
  node: ReactNode,
):
  | ReactElement<{ readonly children?: ReactNode; readonly onValueChange: (value: string) => void }>
  | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as {
      readonly children?: ReactNode;
      readonly onValueChange?: (value: string) => void;
    };
    if (props.onValueChange) {
      return child as ReactElement<{
        readonly children?: ReactNode;
        readonly onValueChange: (value: string) => void;
      }>;
    }
    const nested = findValueChange(props.children);
    if (nested) return nested;
  }
  return undefined;
}

describe("pull request list filters", () => {
  it("does not emit a change when the selected filter pill is pressed again", () => {
    const onChange = vi.fn();
    const view = PullRequestFilterPills({
      value: "open",
      label: "State",
      onChange,
      options: [
        { value: "open", label: "Open", Icon: CircleIcon },
        { value: "closed", label: "Closed", Icon: CircleIcon },
      ],
    });
    const [selected, unselected] = buttonsIn(view);

    selected?.props.onClick?.();
    expect(onChange).not.toHaveBeenCalled();

    unselected?.props.onClick?.();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("closed");
  });

  it("does not emit a change when the selected host or All is pressed again", () => {
    const providers = [
      {
        host: "github.com",
        kind: "github",
        searchesOnHost: true,
        projectCount: 1,
        configured: true,
        detail: null,
      },
      {
        host: "gitlab.com",
        kind: "gitlab",
        searchesOnHost: true,
        projectCount: 1,
        configured: true,
        detail: null,
      },
    ] as ReadonlyArray<PullRequestProviderSummary>;
    const onChange = vi.fn();

    const selectedHost = PullRequestProviderFilter({
      providers,
      value: "github.com",
      expectedHosts: [],
      onChange,
    });
    buttonsIn(selectedHost)
      .find((button) => button.props["aria-pressed"])
      ?.props.onClick?.();
    expect(onChange).not.toHaveBeenCalled();

    const allHosts = PullRequestProviderFilter({
      providers,
      value: undefined,
      expectedHosts: [],
      onChange,
    });
    buttonsIn(allHosts)
      .find((button) => button.props["aria-pressed"])
      ?.props.onClick?.();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not emit a change when the selected project is chosen again", () => {
    const projectId = "project-1" as ProjectId;
    const onChange = vi.fn();
    const view = PullRequestProjectFilter({
      projects: [{ id: projectId, title: "T3 Code" }],
      value: projectId,
      unavailable: new Map(),
      onChange,
    });
    const radioGroup = findValueChange(view);
    expect(radioGroup).toBeDefined();

    radioGroup?.props.onValueChange(projectId);
    expect(onChange).not.toHaveBeenCalled();

    radioGroup?.props.onValueChange("all");
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
