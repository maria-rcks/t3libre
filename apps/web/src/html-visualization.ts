import DOMPurify from "dompurify";

const MAX_HTML_LENGTH = 100_000;
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'";

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The trusted outer frame's frame-src policy blocks the inner frame's self-navigation. */
export function visualizationDocument(html: string, dark: boolean): string {
  // Resource hints bypass CSP in some browsers; nested documents can hide more hints.
  // DOMPurify parses inertly and handles HTML/SVG reparsing and template contents.
  if (!DOMPurify.isSupported) return "";
  const sanitized = DOMPurify.sanitize(html, {
    FORCE_BODY: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["link", "iframe", "frame", "frameset", "object", "embed", "base", "meta"],
    FORBID_ATTR: [
      "href",
      "xlink:href",
      "src",
      "srcset",
      "action",
      "formaction",
      "ping",
      "autofocus",
    ],
  });
  const head = `<meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer">`;
  const content = `<!doctype html><html><head>${head}<style>:root{color-scheme:${dark ? "dark" : "light"}}body{margin:16px;font:14px system-ui;overflow-wrap:anywhere}</style></head><body>${sanitized}</body></html>`;
  return `<!doctype html><html><head>${head}<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style></head><body><iframe sandbox="" referrerpolicy="no-referrer" title="Visualization content" srcdoc="${escapeAttribute(content)}"></iframe></body></html>`;
}

/** Only an explicitly closed, top-level visualization fence opts into rendering. */
export function isHtmlVisualizationFence(source: string, html: string): boolean {
  if (html.length > MAX_HTML_LENGTH) return false;
  const lines = source.split(/\r?\n/);
  const opening = /^ {0,3}(`{3,}|~{3,})t3-html(?:[ \t].*)?$/.exec(lines[0] ?? "");
  if (!opening) return false;
  const fence = opening[1]!;
  const closing = /^ {0,3}([`~]+)[ \t]*$/.exec(lines.at(-1) ?? "")?.[1];
  return (
    closing !== undefined &&
    closing.length >= fence.length &&
    [...closing].every((character) => character === fence[0])
  );
}
