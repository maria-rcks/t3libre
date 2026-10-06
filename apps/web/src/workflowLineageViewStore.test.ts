import { describe, expect, it } from "vite-plus/test";

import { rememberWorkflowLineageView, type WorkflowLineageView } from "./workflowLineageViewStore";

describe("rememberWorkflowLineageView", () => {
  it("keeps the 200 most recently changed workflows", () => {
    let byKey: Record<string, WorkflowLineageView> = {};
    for (let index = 0; index < 200; index += 1) {
      byKey = rememberWorkflowLineageView(byKey, `env:workflow-${index}`, () => ({ open: true }));
    }
    byKey = rememberWorkflowLineageView(byKey, "env:workflow-0", (view) => ({
      ...view,
      phases: { 2: false },
    }));
    byKey = rememberWorkflowLineageView(byKey, "env:workflow-200", () => ({ open: true }));

    expect(Object.keys(byKey)).toHaveLength(200);
    expect(byKey["env:workflow-1"]).toBeUndefined();
    expect(byKey["env:workflow-0"]).toEqual({ open: true, phases: { 2: false } });
    expect(byKey["env:workflow-200"]).toEqual({ open: true });
  });
});
