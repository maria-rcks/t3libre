import { ArrowDownIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "~/components/ui/button";

/** Keeps pending questions reachable without changing the list's order. */
export function SidebarQuestionIndicators({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = useRef<HTMLElement[]>([]);
  const lastTarget = useRef<HTMLElement | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const content = containerRef.current?.querySelector('[data-sidebar="content"]');
    if (!content) return;
    const reconcile = () => {
      rows.current = Array.from(content.querySelectorAll<HTMLElement>("[data-pending-question]"));
      setCount(rows.current.length);
    };
    const mutations = new MutationObserver(reconcile);
    mutations.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-pending-question"],
    });
    reconcile();
    return () => mutations.disconnect();
  }, [containerRef]);

  return (
    <div className="shrink-0 px-2 pb-2">
      <Button
        variant="outline"
        size="sm"
        disabled={count === 0}
        aria-label={`Next pending question (${count})`}
        className="w-full justify-between border-indigo-400/50 bg-sidebar text-indigo-600 transition-none active:scale-100 dark:bg-sidebar dark:text-indigo-300 [--control-icon-color:currentColor]"
        onClick={() => {
          const candidates = rows.current.filter((row) => row.getClientRects().length > 0);
          const nextIndex =
            (candidates.findIndex((row) => row === lastTarget.current) + 1) % candidates.length;
          const row = candidates[nextIndex];
          if (!row) return;
          lastTarget.current = row;
          row.scrollIntoView({ block: "center", behavior: "instant" });
          const control = row.querySelector<HTMLElement>('[role="button"], a, button');
          control?.focus({ preventScroll: true });
          control?.click();
        }}
      >
        <span>
          Needs input · <span className="tabular-nums">{count}</span>
        </span>
        <ArrowDownIcon aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
