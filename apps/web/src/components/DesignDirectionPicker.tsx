import { CheckIcon, SwatchBookIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "~/hooks/useTheme";
import { DESIGN_DIRECTIONS, setDesignDirection, useDesignDirection } from "~/designDirections";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";

const descriptions = {
  current: "Original workspace",
  linen: "Warm, quiet, editorial",
  noir: "A conversation in focus",
  capsule: "Soft, floating surfaces",
  terminal: "Precise, compact, monochrome",
  gallery: "A spacious project studio",
};

export function DesignDirectionPicker() {
  const direction = useDesignDirection();
  const { appearanceMode, setAppearanceMode } = useTheme();
  const originalAppearance = useRef(appearanceMode);
  const previousDirection = useRef(direction);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const storageKey = "t3:design-original-appearance";
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark" || saved === "system") {
        originalAppearance.current = saved;
      } else if (direction !== "current") {
        originalAppearance.current = appearanceMode;
        window.sessionStorage.setItem(storageKey, appearanceMode);
      }
      if (direction === "current") window.sessionStorage.removeItem(storageKey);
    } catch {
      // Restore from the mounted component when session storage is unavailable.
    }
    if (direction !== "current") {
      const next = direction === "noir" || direction === "terminal" ? "dark" : "light";
      if (appearanceMode !== next) setAppearanceMode(next);
    } else if (previousDirection.current !== "current") {
      setAppearanceMode(originalAppearance.current);
    }
    previousDirection.current = direction;
  }, [direction, appearanceMode, setAppearanceMode]);
  if (!import.meta.env.DEV) return null;
  return (
    <div className="design-direction-picker">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label="Choose design direction" />}
        >
          <SwatchBookIcon className="size-4" />
        </PopoverTrigger>
        <PopoverPopup side="top" align="end" className="w-72">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Design explorations</p>
          <div className="flex flex-col gap-1">
            {DESIGN_DIRECTIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={direction === value}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => {
                  setDesignDirection(value);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm capitalize">{value}</span>
                  <span className="block text-xs text-muted-foreground">{descriptions[value]}</span>
                </span>
                {direction === value && <CheckIcon className="size-4" />}
              </button>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
