import type {
  ProjectId,
  PullRequestProviderSummary,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { ListFilterIcon, LoaderIcon, SearchIcon, type LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

/**
 * The shell every filter group shares: an inset track that groups its options into one control,
 * so a row of them reads as one question with one answer rather than as loose words.
 */
const FILTER_GROUP_CLASS =
  "inline-flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 dark:bg-white/5";

/** The option itself, with the selected one lifted onto the surface rather than tinted. */
const filterOptionClass = (selected: boolean, disabled = false) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-[7px] px-2.5 py-0.5 text-sm whitespace-nowrap transition-colors",
    selected ? "bg-background text-foreground shadow-sm dark:bg-white/10" : "text-muted-foreground",
    disabled ? "cursor-not-allowed opacity-45" : !selected && "hover:text-foreground",
  );

export interface PullRequestFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /**
   * Carries the option's own tone, so an icon reads the same here as it does on a row. Left
   * uncoloured, which lets the pill's selected state stay the thing the eye follows.
   */
  readonly Icon: LucideIcon;
}

export function PullRequestFilterPills<Value extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: Value;
  options: ReadonlyArray<PullRequestFilterOption<Value>>;
  label: string;
  onChange: (value: Value) => void;
}) {
  return (
    <div className={FILTER_GROUP_CLASS} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            if (option.value !== value) onChange(option.value);
          }}
          className={filterOptionClass(option.value === value)}
        >
          <option.Icon aria-hidden className="size-3.5" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface PullRequestExpectedHost {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
}

/**
 * What to call a host in the row. The provider's own name reads best — "GitHub" over
 * "github.com" — but it stops naming anything once a workspace has two hosts of one kind, so
 * those wear the host itself instead. Only the ambiguous ones: a lone GitLab beside two GitHub
 * installs is still "GitLab".
 */
export function pullRequestHostLabel(
  entries: ReadonlyArray<{ readonly host: string; readonly kind: SourceControlProviderKind }>,
  entry: { readonly host: string; readonly kind: SourceControlProviderKind },
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1
    ? entry.host
    : getSourceControlPresentationForKind(entry.kind).providerName;
}

/**
 * Host switcher, in the same pill chrome as the filters beside it. It only renders once a
 * workspace actually spans more than one host: with a single host there is nothing to switch
 * between, and an always-visible control would only raise the question. It also renders while
 * a host is selected whatever the list says, so a link that arrives already filtered still
 * offers the way back out.
 *
 * A host that cannot be read stays in the row, disabled, carrying the server's reason as its
 * title — the projects on it are missing from the list either way, and a dimmed pill explains
 * that where an absent one would not.
 */
export function PullRequestProviderFilter({
  providers,
  value,
  expectedHosts,
  onChange,
}: {
  providers: ReadonlyArray<PullRequestProviderSummary>;
  value: string | undefined;
  /**
   * The hosts the workspace's own projects point at, which is known before the list is. The row
   * shows them while it loads so it does not appear from nowhere and push the page down; none of
   * them can be picked until the server has said which can actually be read.
   */
  expectedHosts: ReadonlyArray<PullRequestExpectedHost>;
  onChange: (host: string | undefined) => void;
}) {
  if (providers.length === 0 && value === undefined) {
    // The real row, locked until the hosts land. Shimmering placeholders draw the eye to the one
    // part of the page with nothing to say yet, and the row's shape is already known — only which
    // of these can be read has to wait for the server.
    return expectedHosts.length < 2 ? null : (
      <div className={FILTER_GROUP_CLASS} role="group" aria-label="Filter by host">
        <button type="button" disabled aria-pressed className={filterOptionClass(true)}>
          All
        </button>
        {expectedHosts.map((expected) => {
          const { Icon } = getSourceControlPresentationForKind(expected.kind);
          return (
            <button key={expected.host} type="button" disabled className={filterOptionClass(false)}>
              <Icon className="size-3.5" />
              {pullRequestHostLabel(expectedHosts, expected)}
            </button>
          );
        })}
      </div>
    );
  }
  if (providers.length < 2 && value === undefined) {
    return null;
  }
  return (
    <div className={FILTER_GROUP_CLASS} role="group" aria-label="Filter by host">
      <button
        type="button"
        aria-pressed={value === undefined}
        onClick={() => {
          if (value !== undefined) onChange(undefined);
        }}
        className={filterOptionClass(value === undefined)}
      >
        All
      </button>
      {providers.map((provider) => {
        const { Icon } = getSourceControlPresentationForKind(provider.kind);
        const label = pullRequestHostLabel(providers, provider);
        const active = provider.host === value;
        return (
          <button
            key={provider.host}
            type="button"
            aria-pressed={active}
            disabled={!provider.configured}
            // The host itself when it reads as a provider name, so a switcher showing "GitHub"
            // still says which install it means.
            title={provider.configured ? provider.host : (provider.detail ?? undefined)}
            onClick={() => {
              if (!active) onChange(provider.host);
            }}
            // Opacity rather than a muted colour: the icons are brand-coloured, so text colour
            // alone would leave a disabled host looking active.
            className={filterOptionClass(active, !provider.configured)}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function PullRequestSearchInput({
  value,
  busy,
  onChange,
}: {
  value: string;
  /** A search is on its way to the hosts, said where the typing is rather than over the list. */
  busy?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      {busy ? (
        <LoaderIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : (
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      )}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Search pull requests"
        aria-label="Search pull requests"
        // Tracks the shared input's height at both widths, so it stays level with the icon
        // button beside it rather than towering over it on wide screens.
        className="h-9 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 sm:h-8"
      />
    </div>
  );
}

/**
 * Project scope lives behind the filter icon so the row stays two controls wide. It is the
 * same menu chrome as the detail panel's actions, which also owns its own spacing.
 */
const ALL_PROJECTS_VALUE = "all";

export function PullRequestProjectFilter({
  projects,
  value,
  unavailable,
  onChange,
}: {
  projects: ReadonlyArray<{ readonly id: ProjectId; readonly title: string }>;
  value: ProjectId | undefined;
  /**
   * Projects whose repository could not be read this time round. They are named here, where
   * the reader is already choosing between projects, rather than as a count above the list
   * that says something is missing without saying which.
   */
  unavailable: ReadonlyMap<ProjectId, string>;
  onChange: (projectId: ProjectId | undefined) => void;
}) {
  const selectedTitle = projects.find((project) => project.id === value)?.title;
  return (
    <Menu>
      <MenuTrigger
        className={cn(
          // The icon-button size that pairs with a full-height input, so the two read as one strip.
          "relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground sm:size-8",
          value !== undefined && "text-foreground",
        )}
        aria-label={`Filter by project: ${selectedTitle ?? "All projects"}`}
      >
        <ListFilterIcon className="size-4" />
        {value !== undefined ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-56">
        <MenuRadioGroup
          value={value ?? ALL_PROJECTS_VALUE}
          onValueChange={(next) => {
            const projectId = next === ALL_PROJECTS_VALUE ? undefined : (next as ProjectId);
            if (projectId !== value) onChange(projectId);
          }}
        >
          <MenuRadioItem value={ALL_PROJECTS_VALUE}>All projects</MenuRadioItem>
          {/* The ones that can be chosen first: a list that opens with three disabled rows reads
              as a broken menu rather than as a workspace with three unreadable repositories. */}
          {projects
            .toSorted(
              (left, right) => Number(unavailable.has(left.id)) - Number(unavailable.has(right.id)),
            )
            .map((project) => {
              const reason = unavailable.get(project.id);
              return (
                <MenuRadioItem
                  key={project.id}
                  value={project.id}
                  disabled={reason !== undefined}
                  title={reason}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{project.title}</span>
                    {reason === undefined ? null : (
                      <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400/90">
                        Unavailable
                      </span>
                    )}
                  </span>
                </MenuRadioItem>
              );
            })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
