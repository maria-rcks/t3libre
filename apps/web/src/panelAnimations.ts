import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  type PanelAnimationDurationMs,
} from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

export const PANEL_ANIMATION_DURATION_MS = DEFAULT_PANEL_ANIMATION_DURATION_MS;

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: PanelAnimationDurationMs;
} {
  const enabled = useClientSettings((settings) => settings.panelAnimationsEnabled);
  const durationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return { active: enabled && !prefersReducedMotion, durationMs };
}

/** Keeps closing panel content mounted until its opt-in width transition ends. */
export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
  durationMs = PANEL_ANIMATION_DURATION_MS,
): { present: boolean; value: T | null } {
  const [present, setPresent] = useState(open);
  const retainedRef = useRef<{ scopeKey: string | null; value: T | null } | null>(
    open ? { scopeKey, value } : null,
  );

  useEffect(() => {
    if (open) retainedRef.current = { scopeKey, value };
  }, [open, scopeKey, value]);

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => setPresent(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!animated) {
      const timeout = window.setTimeout(() => setPresent(false), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => setPresent(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [animated, durationMs, open]);

  const retainedValue =
    retainedRef.current?.scopeKey === scopeKey ? retainedRef.current.value : null;
  const visible = open || (animated && present && retainedRef.current?.scopeKey === scopeKey);
  return { present: visible, value: open ? value : visible ? retainedValue : null };
}
