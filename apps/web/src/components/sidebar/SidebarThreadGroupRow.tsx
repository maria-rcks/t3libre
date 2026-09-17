import type { EnvironmentThreadGroup } from "@t3tools/client-runtime/state/shell";
import { ChevronRightIcon, FolderIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { projectIconColorClassName } from "../../projectIconColors";
import { cn } from "~/lib/utils";
import { ProjectIconOverrideGlyph } from "../ProjectFavicon";
import type { ThreadStatusPill } from "../Sidebar.logic";

/**
 * A user-made folder in the sidebar: a header row that toggles its member
 * thread rows. Members render as ordinary thread rows nested under the
 * header, so every row affordance (status, settle, snooze, selection) works
 * unchanged inside a group.
 */
export const SidebarThreadGroupRow = memo(function SidebarThreadGroupRow(props: {
  group: EnvironmentThreadGroup;
  count: number;
  expanded: boolean;
  // Rolled-up status of the members while collapsed, so a working or
  // blocked thread is not hidden by the fold.
  status: ThreadStatusPill | null;
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
  const colorClassName =
    group.icon && group.icon.kind !== "emoji"
      ? projectIconColorClassName(group.icon.color)
      : "text-sidebar-foreground/90";
  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      if ((event.target as HTMLElement).closest("input")) return;
      onToggle(group);
    },
    [group, onToggle],
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
      onStartRename(group);
    },
    [group, isRenaming, onStartRename],
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
      className="list-none py-0.5"
    >
      <div
        // While renaming, the row hands its semantics to the text box: a
        // textbox inside a button is presentational to assistive tech.
        role={isRenaming ? undefined : "button"}
        tabIndex={isRenaming ? -1 : 0}
        aria-expanded={isRenaming ? undefined : props.expanded}
        aria-label={
          isRenaming
            ? undefined
            : `${group.name} group, ${props.count} thread${props.count === 1 ? "" : "s"}`
        }
        data-testid="sidebar-thread-group-row"
        className="group/sidebar-group flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-sidebar-muted-foreground/70 transition-transform motion-reduce:transition-none",
            props.expanded && "rotate-90",
          )}
        />
        <span className="flex size-4 shrink-0 items-center justify-center">
          {group.icon ? (
            <ProjectIconOverrideGlyph icon={group.icon} className="size-4" />
          ) : (
            <FolderIcon aria-hidden className="size-4 text-sidebar-muted-foreground/70" />
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
              "min-w-0 flex-1 truncate text-sm font-medium transition-opacity motion-reduce:transition-none",
              colorClassName,
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
        {!props.expanded && props.status ? (
          <span
            role="img"
            aria-label={props.status.label}
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              props.status.dotClass,
              props.status.pulse && "animate-status-pulse",
            )}
          />
        ) : null}
        <span className="ml-auto shrink-0 rounded-sm bg-sidebar-border/60 px-1.5 text-[11px] tabular-nums text-sidebar-muted-foreground">
          {props.count}
        </span>
      </div>
      {props.children ? (
        <ul
          role="list"
          data-testid={`sidebar-thread-group-members-${group.id}`}
          className="ml-2.5 flex flex-col gap-px border-l border-sidebar-border/60 pl-1.5"
        >
          {props.children}
        </ul>
      ) : null}
    </li>
  );
});
