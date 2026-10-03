import DOMPurify from "dompurify";
import type { Mermaid } from "mermaid";
import { use } from "react";

type MermaidRenderResult =
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "error"; readonly message: string; readonly retryable: boolean };

let mermaidModulePromise: Promise<Mermaid> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();
let nextDiagramId = 0;
const MAX_CACHED_RENDERS = 64;
// Keyed by the full source so distinct diagrams never share an entry. Pending
// renders are never evicted, because use() must get the same promise on retry.
const renderCache = new Map<string, Promise<MermaidRenderResult>>();
const settledRenders = new WeakSet<Promise<MermaidRenderResult>>();

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
// navigate, run script, or fetch remote content on top of Mermaid's own strict
// sanitization. HTML labels inside foreignObject stay, since authors can enable
// them per diagram. Only local url(#id) references survive in CSS.
function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "img", "image", "script"],
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
  }).replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, "none");
}

async function renderMermaid(
  source: string,
  theme: "light" | "dark",
): Promise<MermaidRenderResult> {
  const id = `mermaid-diagram-${nextDiagramId++}`;
  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    return { status: "error", message: "Mermaid failed to load.", retryable: true };
  }
  try {
    // initialize() mutates global config, so renders run one at a time.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      // HTML labels are mounted while Mermaid lays them out, before sanitizing,
      // so diagram directives must not turn them back on.
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "htmlLabels",
      ],
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
      retryable: false,
    };
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
}

function mermaidRenderPromise(source: string, theme: "light" | "dark") {
  const key = `${theme}\n${source}`;
  const cached = renderCache.get(key);
  if (cached) {
    renderCache.delete(key);
    renderCache.set(key, cached);
    return cached;
  }
  const result = renderQueue.then(() => renderMermaid(source, theme));
  renderQueue = result;
  void result.then((settled) => {
    settledRenders.add(result);
    // A failed load retries the next time the diagram mounts.
    if (settled.status === "error" && settled.retryable && renderCache.get(key) === result) {
      renderCache.delete(key);
    }
  });
  renderCache.set(key, result);
  if (renderCache.size > MAX_CACHED_RENDERS) {
    for (const [oldKey, oldResult] of renderCache) {
      if (settledRenders.has(oldResult)) {
        renderCache.delete(oldKey);
        break;
      }
    }
  }
  return result;
}

const imageUrls = new WeakMap<MermaidRenderResult, string>();

/**
 * Converts a rendered diagram into a standalone image with fixed size and background.
 * A blob URL, unlike a data URL, passes the desktop connect-src policy that media
 * save and copy actions fetch through.
 */
function mermaidImageUrl(result: MermaidRenderResult & { status: "rendered" }): string {
  const cached = imageUrls.get(result);
  if (cached) return cached;
  const svgDocument = new DOMParser().parseFromString(result.svg, "image/svg+xml");
  const element = svgDocument.documentElement;
  const viewBox = element.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    element.setAttribute("width", String(viewBox[2]));
    element.setAttribute("height", String(viewBox[3]));
  }
  element.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  element.style.maxWidth = "none";
  element.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml" }),
  );
  imageUrls.set(result, url);
  return url;
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
        onClick={() => onExpand(mermaidImageUrl(result))}
        dangerouslySetInnerHTML={{ __html: result.svg }}
      />
    </div>
  );
}
