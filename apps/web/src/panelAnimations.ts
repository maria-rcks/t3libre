import { useEffect, useState } from "react";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

export const PANEL_ANIMATION_DURATION_MS = 200;

export function usePanelAnimationsActive(): boolean {
  const enabled = useClientSettings((settings) => settings.panelAnimationsEnabled);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return enabled && !prefersReducedMotion;
}

/** Keeps closing panel content mounted until its opt-in width transition ends. */
export function usePanelPresence(open: boolean, animated: boolean): boolean {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => setPresent(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!animated) {
      const timeout = window.setTimeout(() => setPresent(false), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(() => setPresent(false), PANEL_ANIMATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [animated, open]);

  return open || (animated && present);
}
