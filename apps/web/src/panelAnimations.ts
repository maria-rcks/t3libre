import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  type PanelAnimationDurationMs,
} from "@t3tools/contracts/settings";

import { useMediaQuery } from "./hooks/useMediaQuery";
import { useClientSettings } from "./hooks/useSettings";

export const PANEL_ANIMATION_DURATION_MS = DEFAULT_PANEL_ANIMATION_DURATION_MS;

export function observeResponsiveBreakpointFade(options: {
  target: HTMLElement;
  container: HTMLElement;
  active: boolean;
  durationMs: PanelAnimationDurationMs;
  breakpoint: { value: number; unit: "px" | "rem" };
  fadeDistancePx?: number;
}): () => void {
  const { target, container, active, durationMs, breakpoint, fadeDistancePx = 160 } = options;
  if (!active || typeof ResizeObserver === "undefined") return () => {};

  const resolveBreakpointPx = () => {
    if (breakpoint.unit === "px") return breakpoint.value;
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return breakpoint.value * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
  };

  let previousWidth = container.getBoundingClientRect().width;
  let previousSide = previousWidth >= resolveBreakpointPx();
  let crossedBreakpoint = false;
  let settleTimer: number | null = null;
  let restoreAnimation: Animation | null = null;

  const restoreOpacity = () => {
    settleTimer = null;
    const currentOpacity = getComputedStyle(target).opacity;
    target.style.removeProperty("opacity");
    crossedBreakpoint = false;
    if (currentOpacity === "1") return;
    restoreAnimation = target.animate([{ opacity: currentOpacity }, { opacity: 1 }], {
      duration: Math.min(100, durationMs / 4),
      easing: "ease-out",
    });
  };

  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const width = entry.contentRect.width;
    restoreAnimation?.cancel();
    restoreAnimation = null;
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = null;
    const breakpointPx = resolveBreakpointPx();
    const side = width >= breakpointPx;
    const crossedOnThisFrame = side !== previousSide;
    const movingTowardBreakpoint =
      Math.abs(width - breakpointPx) < Math.abs(previousWidth - breakpointPx);
    if (crossedOnThisFrame) crossedBreakpoint = true;

    if (crossedOnThisFrame) {
      target.style.opacity = "0";
    } else if (movingTowardBreakpoint || crossedBreakpoint) {
      target.style.opacity = Math.min(1, Math.abs(width - breakpointPx) / fadeDistancePx).toFixed(
        3,
      );
    } else {
      target.style.removeProperty("opacity");
    }

    previousWidth = width;
    previousSide = side;
    settleTimer = window.setTimeout(restoreOpacity, 80);
  });

  observer.observe(container);
  return () => {
    observer.disconnect();
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    restoreAnimation?.cancel();
    target.style.removeProperty("opacity");
  };
}

export function usePanelAnimationSettings(): {
  active: boolean;
  durationMs: PanelAnimationDurationMs;
} {
  const durationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return { active: durationMs > 0 && !prefersReducedMotion, durationMs };
}

/** Keeps closing panel content mounted until its opt-in transition ends. */
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
