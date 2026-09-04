import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

/** Tracks only pending rows, and only when the list or its viewport changes. */
export function SidebarQuestionIndicators({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const targets = useRef<{ above: HTMLElement | null; below: HTMLElement | null }>({
    above: null,
    below: null,
  });
  const [directions, setDirections] = useState({ above: false, below: false });

  useEffect(() => {
    const container = containerRef.current;
    const viewport = container?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const content = container?.querySelector<HTMLElement>('[data-sidebar="content"]');
    if (!viewport || !content) return;
    let rows: HTMLElement[] = [];
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      // A row inside the scroll fade is no longer a useful visible target.
      const top = bounds.top + 24;
      const bottom = bounds.bottom - 24;
      let above: HTMLElement | null = null;
      let below: HTMLElement | null = null;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const visible = rect.height > 0 && rect.bottom > top && rect.top < bottom;
        row.toggleAttribute("data-question-visible", visible);
        if (rect.height === 0) continue;
        if (rect.bottom <= top) above = row;
        if (rect.top >= bottom && below === null) below = row;
      }
      targets.current = { above, below };
      setDirections((current) =>
        current.above === (above !== null) && current.below === (below !== null)
          ? current
          : { above: above !== null, below: below !== null },
      );
    };
    const reconcile = () => {
      rows = Array.from(content.querySelectorAll<HTMLElement>("[data-pending-question]"));
      measure();
    };
    const mutations = new MutationObserver(reconcile);
    mutations.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-pending-question"],
    });
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    resize.observe(content);
    viewport.addEventListener("scroll", measure, { passive: true });
    reconcile();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, [containerRef]);

  return (["above", "below"] as const).map((direction) => {
    if (!directions[direction]) return null;
    const Icon = direction === "above" ? ArrowUpIcon : ArrowDownIcon;
    return (
      <button
        key={direction}
        type="button"
        aria-label={`Show pending question ${direction}`}
        className={`absolute left-1/2 z-20 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-indigo-400/70 bg-sidebar text-indigo-600 shadow-sm hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring dark:text-indigo-300 ${direction === "above" ? "top-1" : "bottom-1"}`}
        onClick={() => {
          const row = targets.current[direction];
          row?.scrollIntoView({ block: "center", behavior: "instant" });
          row
            ?.querySelector<HTMLElement>('[role="button"], a, button')
            ?.focus({ preventScroll: true });
        }}
      >
        <Icon aria-hidden="true" className="sidebar-question-arrow size-4" />
      </button>
    );
  });
}
