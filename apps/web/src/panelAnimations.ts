import { useEffect, useRef, useState } from "react";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

export const PANEL_ANIMATION_DURATION_MS = 200;

export function usePanelAnimationsActive(): boolean {
  const enabled = useClientSettings((settings) => settings.panelAnimationsEnabled);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return enabled && !prefersReducedMotion;
}

/** Keeps closing panel content mounted until its opt-in width transition ends. */
export function usePanelPresence<T>(
  open: boolean,
  value: T | null,
  animated: boolean,
  scopeKey: string | null,
): { present: boolean; value: T | null } {
  const wantsPresent = open && value !== null;
  const [present, setPresent] = useState(wantsPresent);
  const retainedRef = useRef<{ scopeKey: string | null; value: T } | null>(null);

  useEffect(() => {
    if (wantsPresent) retainedRef.current = { scopeKey, value };
  }, [scopeKey, value, wantsPresent]);

  useEffect(() => {
    if (wantsPresent) {
      const frame = window.requestAnimationFrame(() => setPresent(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!animated) {
      const timeout = window.setTimeout(() => setPresent(false), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => setPresent(false), PANEL_ANIMATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [animated, wantsPresent]);

  const retainedValue =
    retainedRef.current?.scopeKey === scopeKey ? retainedRef.current.value : null;
  const visible = wantsPresent || (animated && present && retainedValue !== null);
  return { present: visible, value: wantsPresent ? value : visible ? retainedValue : null };
}
