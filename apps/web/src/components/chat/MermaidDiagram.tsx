import DOMPurify from "dompurify";
import type { Mermaid } from "mermaid";
import { use } from "react";

import { fnv1a32 } from "../../lib/diffRendering";
import { LRUCache } from "../../lib/lruCache";

type MermaidRenderResult =
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "error"; readonly message: string };

let mermaidModulePromise: Promise<Mermaid> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();
let nextDiagramId = 0;
const renderCache = new LRUCache<Promise<MermaidRenderResult>>(64, 8 * 1024 * 1024);

// Mermaid is ~1MB, so it only loads once a diagram is actually shown.
function loadMermaid(): Promise<Mermaid> {
  mermaidModulePromise ??= import("mermaid")
    .then((module) => module.default)
    .catch((error: unknown) => {
      mermaidModulePromise = null;
      throw error;
    });
  return mermaidModulePromise;
}

// Diagrams can come from untrusted PR descriptions, so strip anything that can
// navigate or run script on top of Mermaid's own strict sanitization.
function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    FORBID_ATTR: ["href", "xlink:href", "onerror", "onload", "onclick"],
    FORBID_TAGS: ["foreignObject", "script"],
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

async function renderMermaid(
  source: string,
  theme: "light" | "dark",
): Promise<MermaidRenderResult> {
  const id = `mermaid-diagram-${nextDiagramId++}`;
  try {
    const mermaid = await loadMermaid();
    // initialize() mutates global config, so renders run one at a time.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    const { svg } = await mermaid.render(id, source);
    return { status: "rendered", svg: sanitizeMermaidSvg(svg) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The diagram could not be rendered.",
    };
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
}

function mermaidRenderPromise(source: string, theme: "light" | "dark") {
  const key = `${fnv1a32(source).toString(36)}:${source.length}:${theme}`;
  const cached = renderCache.get(key);
  if (cached) return cached;
  const result = renderQueue.then(() => renderMermaid(source, theme));
  renderQueue = result;
  renderCache.set(key, result, source.length * 8);
  return result;
}

/** Converts a rendered diagram into a standalone image URL with fixed size and background. */
function mermaidSvgImageUrl(svg: string, background: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const element = document.documentElement;
  const viewBox = element.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    element.setAttribute("width", String(viewBox[2]));
    element.setAttribute("height", String(viewBox[3]));
  }
  element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  element.style.maxWidth = "none";
  element.style.backgroundColor = background;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(element))}`;
}

/** Suspends until the diagram renders; failures show the parser message above the source. */
export function MermaidDiagram({
  source,
  theme,
  onExpand,
}: {
  source: string;
  theme: "light" | "dark";
  onExpand: (imageUrl: string) => void;
}) {
  const result = use(mermaidRenderPromise(source.trim(), theme));

  if (result.status === "error") {
    return (
      <div className="px-3 pt-1 pb-3">
        <p className="m-0 text-xs text-destructive">Unable to render diagram: {result.message}</p>
        <pre className="mt-2 mb-0 overflow-auto font-mono text-xs whitespace-pre-wrap">
          {source}
        </pre>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto px-3 pt-2 pb-3">
      <button
        type="button"
        aria-label="Expand diagram"
        className="flex w-full cursor-zoom-in justify-center rounded-md focus-visible:outline-2 focus-visible:outline-ring [&_svg]:h-auto [&_svg]:max-w-full"
        onClick={() =>
          onExpand(mermaidSvgImageUrl(result.svg, getComputedStyle(document.body).backgroundColor))
        }
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    </div>
  );
}
