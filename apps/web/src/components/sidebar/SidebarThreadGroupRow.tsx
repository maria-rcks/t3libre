import type { EnvironmentThreadGroup } from "@t3tools/client-runtime/state/shell";
import { FolderIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { projectIconColorClassName, projectIconTintClassName } from "../../projectIconColors";
import { cn } from "~/lib/utils";
import { ProjectIconOverrideGlyph } from "../ProjectFavicon";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";

// Longest gap between the clicks of a double-click on common platforms.
const DOUBLE_CLICK_WINDOW_MS = 500;

/**
 * A user-made folder in the sidebar: a tinted card carrying the group's color
 * with a header row that toggles its member thread rows. Members render as
 * ordinary thread rows nested inside the card, so every row affordance
 * (status, settle, snooze, selection) works unchanged inside a group.
 */
export const SidebarThreadGroupRow = memo(function SidebarThreadGroupRow(props: {
  group: EnvironmentThreadGroup;
  count: number;
  /** Members that carry a pull request, shown on the header while collapsed. */
  pullRequestCount: number;
  expanded: boolean;
  isRenaming: boolean;
  renamingName: string;
  onToggle: (group: EnvironmentThreadGroup) => void;
  onContextMenu: (group: EnvironmentThreadGroup, position: { x: number; y: number }) => void;
  onStartRename: (group: EnvironmentThreadGroup) => void;
  onRenameNameChange: (name: string) => void;
  onCommitRename: (group: EnvironmentThreadGroup, name: string) => void;
  onCancelRename: () => void;
  children?: ReactNode;
}) {
  const {
    group,
    isRenaming,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onRenameNameChange,
    onStartRename,
    onToggle,
    renamingName,
  } = props;
  const isNaming = group.nameGeneration != null;
  const color = group.icon && group.icon.kind !== "emoji" ? group.icon.color : null;
  const nameClassName = color ? projectIconColorClassName(color) : "text-sidebar-foreground";
  // The card's surface comes from the group color; a group
  // without a color takes a neutral tint so it still reads as a container.
  const tintClassName = color ? projectIconTintClassName(color) : "bg-sidebar-foreground/[0.05]";
  // The header's label replaces its children for assistive tech, so the
  // member and collapsed-only pull request counts are spelled out here.
  const headerLabel = [
    `${group.name} group, ${props.count} thread${props.count === 1 ? "" : "s"}`,
    ...(!props.expanded && props.pullRequestCount > 0
      ? [`${props.pullRequestCount} pull request${props.pullRequestCount === 1 ? "" : "s"}`]
      : []),
  ].join(", ");
  // Folds made by the clicks of a rename double-click, so the double-click can
  // undo them. Touch reports every tap as a first click, so this counts folds
  // instead of trusting `event.detail`.
  const foldClicksRef = useRef({ count: 0, at: 0 });
  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      // A click beside the text box commits the rename; it must not fold too.
      if (isRenaming || (event.target as HTMLElement).closest("input")) return;
      // The second click of a mouse double-click must not fold the group back.
      if (event.detail > 1) return;
      const now = event.timeStamp;
      const clicks = foldClicksRef.current;
      foldClicksRef.current = {
        count: now - clicks.at < DOUBLE_CLICK_WINDOW_MS ? clicks.count + 1 : 1,
        at: now,
      };
      onToggle(group);
    },
    [group, isRenaming, onToggle],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onToggle(group);
    },
    [group, onToggle],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(group, { x: event.clientX, y: event.clientY });
    },
    [group, onContextMenu],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if ((event.target as HTMLElement).closest("input")) return;
      event.preventDefault();
      // Put back whatever the clicks of this pair folded so renaming never
      // changes the fold.
      if (foldClicksRef.current.count % 2 === 1) onToggle(group);
      foldClicksRef.current = { count: 0, at: 0 };
      onStartRename(group);
    },
    [group, isRenaming, onStartRename, onToggle],
  );
  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCommitRename(group, renamingName);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCancelRename();
      }
    },
    [group, onCancelRename, onCommitRename, renamingName],
  );
  const handleRenameBlur = useCallback(() => {
    if (!renameCommittedRef.current) onCommitRename(group, renamingName);
  }, [group, onCommitRename, renamingName]);

  return (
    <li
      data-thread-selection-safe
      data-testid={`sidebar-thread-group-${group.id}`}
      className={cn(
        "list-none rounded-lg py-0.5 transition-colors motion-reduce:transition-none",
        props.expanded ? "my-1" : "my-px",
        // Member rows (all of them, or only the open thread while collapsed)
        // need room above the card's bottom edge.
        props.children ? "pb-1" : null,
        tintClassName,
      )}
    >
      <div
        // While renaming, the row hands its semantics to the text box: a
        // textbox inside a button is presentational to assistive tech.
        role={isRenaming ? undefined : "button"}
        tabIndex={isRenaming ? -1 : 0}
        aria-expanded={isRenaming ? undefined : props.expanded}
        aria-label={isRenaming ? undefined : headerLabel}
        data-testid="sidebar-thread-group-row"
        className="group/sidebar-group mx-0.5 flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-left outline-none select-none hover:bg-sidebar-row-hover/70 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-[25%]",
            // A monogram paints its own tile.
            group.icon?.kind !== "monogram" &&
              "bg-[color-mix(in_srgb,currentColor_14%,transparent)]",
            nameClassName,
          )}
        >
          {group.icon ? (
            <ProjectIconOverrideGlyph
              icon={group.icon}
              // A monogram is its own tile, so it takes the tile's size.
              className={group.icon.kind === "monogram" ? "size-5" : "size-3.5"}
            />
          ) : (
            <FolderIcon aria-hidden className="size-3.5" />
          )}
        </span>
        {isRenaming ? (
          <input
            autoFocus
            value={renamingName}
            aria-label="Group name"
            onChange={(event) => onRenameNameChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameBlur}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
          />
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-semibold transition-opacity motion-reduce:transition-none",
              nameClassName,
              isNaming && "opacity-[0.55]",
            )}
          >
            {group.name}
          </span>
        )}
        {isNaming ? (
          <span role="status" className="sr-only">
            Generating group name
          </span>
        ) : null}
        {!props.expanded && props.pullRequestCount > 0 ? (
          <span
            aria-hidden
            className="inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-sidebar-muted-foreground"
          >
            <PullRequestGlyph.pullRequest aria-hidden className="size-3" />
            {props.pullRequestCount}
          </span>
        ) : null}
      </div>
      {props.children ? (
        <ul
          role="list"
          data-testid={`sidebar-thread-group-members-${group.id}`}
          className="mx-1 flex flex-col gap-px"
        >
          {props.children}
        </ul>
      ) : null}
    </li>
  );
});
