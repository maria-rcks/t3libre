import { useSyncExternalStore } from "react";

export const DESIGN_DIRECTIONS = [
  "current",
  "linen",
  "noir",
  "capsule",
  "terminal",
  "gallery",
] as const;
export type DesignDirection = (typeof DESIGN_DIRECTIONS)[number];

const STORAGE_KEY = "t3:design-direction";
const listeners = new Set<() => void>();

function isDirection(value: string | null): value is DesignDirection {
  return DESIGN_DIRECTIONS.some((direction) => direction === value);
}

function initialDirection(): DesignDirection {
  if (!import.meta.env.DEV || typeof window === "undefined") return "current";
  const query = new URLSearchParams(window.location.search).get("design");
  if (isDirection(query)) return query;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return isDirection(stored) ? stored : "current";
  } catch {
    return "current";
  }
}

let direction = initialDirection();

export function setDesignDirection(next: DesignDirection) {
  if (!import.meta.env.DEV) return;
  direction = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The exploration still works when browser storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Development directions render the normal app, with its existing state and actions. */
export function useDesignDirection() {
  return useSyncExternalStore(
    subscribe,
    () => direction,
    () => "current" as DesignDirection,
  );
}
