import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectIconOverride } from "@t3tools/contracts";
import {
  getProjectFaviconResourceKey,
  isProjectFaviconFallbackUrl,
} from "@t3tools/shared/projectFavicon";
import { FolderCodeIcon } from "lucide-react";
import type { IconName } from "lucide-react/dynamic";
import type { ComponentType } from "react";
import { lazy, Suspense, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { projectFaviconUrlAtom } from "../state/assets";
import { deriveProjectIdentity } from "../projectIdentity";
import { projectIconColorClassName } from "../projectIconColors";
import { ProjectMonogram } from "./ProjectMonogram";
import { cn } from "~/lib/utils";

const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({ default: module.DynamicIcon })),
);

function DynamicProjectIconFallback() {
  return <FolderCodeIcon className="size-full text-[inherit]" />;
}

// The slice of a project that decides its icon. Every surface must pass the
// project record itself (or a snapshot spread from it) so the saved title, favicon
// and icon override always travel together. Passing a display label as the title
// changes the automatic icon, which is how the command palette drifted once.
export type ProjectFaviconProject = Pick<
  EnvironmentProject,
  "environmentId" | "workspaceRoot" | "title" | "faviconPath" | "projectIcon"
>;
export function ProjectFavicon(input: {
  project: ProjectFaviconProject;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const { project } = input;
  const src = useAtomValue(
    projectFaviconUrlAtom({
      environmentId: project.environmentId,
      cwd: project.workspaceRoot,
      faviconPath: project.faviconPath,
    }),
  );
  if (project.projectIcon) {
    // Called as a plain function (no hooks inside) so the rendered tree is
    // exactly the glyph markup, with no extra component layer in between.
    return ProjectIconOverrideGlyph({ icon: project.projectIcon, className: input.className });
  }
  const FallbackIcon = input.fallbackIcon ?? FolderCodeIcon;

  if (!src || isProjectFaviconFallbackUrl(src)) {
    return (
      <ProjectFaviconFallback
        className={input.className}
        icon={FallbackIcon}
        projectName={project.title}
      />
    );
  }

  const cacheKey = getProjectFaviconResourceKey(
    project.environmentId,
    project.workspaceRoot,
    project.faviconPath,
  );

  return (
    <ProjectFaviconImage
      key={cacheKey}
      src={src}
      className={input.className}
      fallbackIcon={FallbackIcon}
      fallbackProjectName={project.title}
    />
  );
}

/** Renders a saved icon override on its own: projects and thread groups share
 * the picker, so they share the glyph too. */
export function ProjectIconOverrideGlyph({
  icon,
  className,
}: {
  readonly icon: ProjectIconOverride;
  readonly className?: string | undefined;
}) {
  if (icon.kind === "monogram") {
    return <ProjectMonogram text={icon.text} color={icon.color} className={className} />;
  }
  if (icon.kind === "emoji") {
    return (
      <ProjectFaviconFallback className={className} icon={FolderCodeIcon} emoji={icon.emoji} />
    );
  }
  const colorClassName = projectIconColorClassName(icon.color);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        colorClassName,
        className,
      )}
    >
      <Suspense fallback={<DynamicProjectIconFallback />}>
        <DynamicIcon
          name={icon.name as IconName}
          className={cn("size-full", colorClassName)}
          fallback={DynamicProjectIconFallback}
        />
      </Suspense>
    </span>
  );
}

function ProjectFaviconFallback({
  className,
  icon: Icon,
  emoji,
  projectName,
}: {
  readonly className?: string | undefined;
  readonly icon: ComponentType<{ className?: string }>;
  readonly emoji?: string | undefined;
  readonly projectName?: string | undefined;
}) {
  if (projectName && projectName.trim().length > 0) {
    const identity = deriveProjectIdentity(projectName);
    return (
      <ProjectMonogram text={identity.monogram} color={identity.color} className={className} />
    );
  }

  if (emoji) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center leading-none [container-type:size]",
          className,
        )}
      >
        <span className="text-[length:80cqh] leading-none">{emoji}</span>
      </span>
    );
  }

  return <Icon className={cn("size-3.5 shrink-0 text-icon-muted", className)} />;
}

function ProjectFaviconImage({
  src,
  className,
  fallbackIcon: FallbackIcon,
  fallbackProjectName,
}: {
  readonly src: string;
  readonly className?: string | undefined;
  readonly fallbackIcon: ComponentType<{ className?: string }>;
  readonly fallbackProjectName?: string | undefined;
}) {
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(() =>
    src.startsWith("data:image/") ? src : null,
  );
  const isLoading = displayedSrc !== src;
  const handleLoadError = (failedSrc: string) => {
    setDisplayedSrc((currentSrc) => (currentSrc === failedSrc ? null : currentSrc));
  };

  return (
    <>
      {displayedSrc === null ? (
        <ProjectFaviconFallback
          className={className}
          icon={FallbackIcon}
          projectName={fallbackProjectName}
        />
      ) : null}
      {displayedSrc ? (
        <img
          src={displayedSrc}
          alt=""
          className={cn("size-3.5 shrink-0 rounded-[37.5%] object-contain", className)}
          onError={() => handleLoadError(displayedSrc)}
        />
      ) : null}
      {isLoading ? (
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={() => {
            setDisplayedSrc(src);
          }}
          onError={() => handleLoadError(src)}
        />
      ) : null}
    </>
  );
}
