/**
 * Visual primitives shared by controls when they are rendered in the thread details panel.
 *
 * The core control variants intentionally become denser at the `sm` breakpoint. The panel has
 * its own fixed density, so every size and type override here includes its desktop counterpart.
 */
const THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS =
  "bg-transparent shadow-none before:shadow-none not-disabled:not-active:not-data-pressed:before:shadow-none";

const THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS =
  "hover:!bg-black/[0.055] data-pressed:!bg-black/[0.055] dark:hover:!bg-white/[0.075] dark:data-pressed:!bg-white/[0.075]";

const THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS} ${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS}`;

const THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS = `${THREAD_DETAILS_PANEL_RESTING_BUTTON_SURFACE_CLASS} hover:!bg-transparent data-pressed:!bg-transparent`;

export const THREAD_DETAILS_PANEL_ROW_CLASS = `h-7 w-full justify-start gap-2 rounded-md border-transparent bg-transparent px-2 text-xs font-medium text-foreground/80 sm:h-7 sm:text-xs ${THREAD_DETAILS_PANEL_ROW_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SELECT_ROW_CLASS = `${THREAD_DETAILS_PANEL_ROW_CLASS} pe-0 before:pointer-events-none before:absolute before:inset-0 [&_[data-slot=select-icon]]:-me-px [&_[data-slot=select-icon]]:relative [&_[data-slot=select-icon]]:flex [&_[data-slot=select-icon]]:h-full [&_[data-slot=select-icon]]:w-8 [&_[data-slot=select-icon]]:shrink-0 [&_[data-slot=select-icon]]:items-center [&_[data-slot=select-icon]]:justify-center [&_[data-slot=select-icon]]:before:absolute [&_[data-slot=select-icon]]:before:-left-px [&_[data-slot=select-icon]]:before:top-1/2 [&_[data-slot=select-icon]]:before:h-4 [&_[data-slot=select-icon]]:before:w-px [&_[data-slot=select-icon]]:before:-translate-y-1/2 [&_[data-slot=select-icon]]:before:bg-border/65 [&_[data-slot=select-icon]>svg]:me-0 [&_[data-slot=select-icon]>svg]:size-4 [&_[data-slot=select-icon]>svg]:text-muted-foreground [&_[data-slot=select-icon]>svg]:opacity-100`;

export const THREAD_DETAILS_PANEL_LOCKED_ROW_CLASS =
  "h-7 w-full justify-start gap-2 rounded-md border border-transparent px-2 text-xs font-medium text-foreground/80 sm:h-7 sm:text-xs";

export const THREAD_DETAILS_PANEL_ICON_CLASS = "-mx-0.5 size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_CHEVRON_CLASS = "size-4 shrink-0 text-muted-foreground";

export const THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS = `group/thread-details-action flex w-full items-center rounded-md ${THREAD_DETAILS_PANEL_HOVER_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_PRIMARY_CLASS = `h-7 min-w-0 flex-1 justify-start gap-2 rounded-e-none border-transparent bg-transparent px-2 pr-2 text-xs font-medium text-foreground/80 sm:h-7 sm:text-xs ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SECONDARY_CLASS = `h-7 w-8 rounded-s-none border-transparent bg-transparent px-0 sm:h-7 sm:w-8 ${THREAD_DETAILS_PANEL_SPLIT_BUTTON_SURFACE_CLASS}`;

export const THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS = "h-4 w-px shrink-0 bg-border/65";

export const THREAD_DETAILS_PANEL_ROW_POPUP_CLASS = "w-(--anchor-width)";
