/**
 * Lineage choices per Workflow, so a user's open card, phases and completed-agent
 * folds survive thread switches and reloads. Keyed by environment and
 * coordinator subagent, which the parent's row and the Workflow thread's own
 * card share.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** Only what the user changed; anything unset falls back to the card's defaults. */
export interface WorkflowLineageView {
  readonly open?: boolean;
  /** Keyed by phase index; -1 is "Other agents". */
  readonly phases?: Readonly<Record<number, boolean>>;
  /** Phases whose completed agents the user revealed, by phase index. */
  readonly completedShown?: Readonly<Record<number, boolean>>;
}

// Entries are tiny, but every Workflow a user touches adds one.
const MAX_REMEMBERED_WORKFLOWS = 200;

export function workflowLineageViewKey(environmentId: EnvironmentId, coordinatorId: string) {
  return `${environmentId}:${coordinatorId}`;
}

/** Applies a change and keeps the most recently changed Workflows. */
export function rememberWorkflowLineageView(
  byKey: Readonly<Record<string, WorkflowLineageView>>,
  key: string,
  change: (view: WorkflowLineageView) => WorkflowLineageView,
): Record<string, WorkflowLineageView> {
  const { [key]: previous, ...rest } = byKey;
  return Object.fromEntries(
    Object.entries({ ...rest, [key]: change(previous ?? {}) }).slice(-MAX_REMEMBERED_WORKFLOWS),
  );
}

interface WorkflowLineageViewStoreState {
  byKey: Record<string, WorkflowLineageView>;
  remember: (key: string, change: (view: WorkflowLineageView) => WorkflowLineageView) => void;
}

export const useWorkflowLineageViewStore = create<WorkflowLineageViewStoreState>()(
  persist(
    (set) => ({
      byKey: {},
      remember: (key, change) =>
        set((state) => ({ byKey: rememberWorkflowLineageView(state.byKey, key, change) })),
    }),
    {
      name: "t3code:workflow-lineage-view:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byKey: state.byKey }),
    },
  ),
);
