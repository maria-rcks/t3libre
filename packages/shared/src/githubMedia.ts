/**
 * Media a pull request body points at on GitHub's own hosts. In a private repository GitHub
 * answers an unauthenticated request for one with 404 — a screenshot dropped into a description
 * becomes `github.com/user-attachments/assets/<id>`, and a file committed alongside the code
 * becomes a `raw.githubusercontent.com` path — so the renderer, which carries no GitHub session,
 * draws a broken image where the reviewer expects the evidence. The server can fetch these with
 * the repository's `gh` credential and hand the bytes back.
 *
 * Only hosts where a credential is what decides the answer belong here. `objects.githubusercontent.com`
 * and the `private-user-images` links GitHub's own HTML carries are already signed and load on their
 * own, and a token does nothing for them once that signature expires.
 */

const RAW_HOST = "raw.githubusercontent.com";
const ATTACHMENT_PATH_PATTERN = /^\/user-attachments\/assets\/[\w-]+$/u;
/** `blob` and `raw` both address file bytes; `raw` is the one the token is honoured on. */
const REPOSITORY_FILE_PATTERN = /^\/([^/]+)\/([^/]+)\/(?:raw|blob)\/(.+)$/u;

/**
 * The URL to fetch with a GitHub credential for `source`, or null when the source is not
 * GitHub-hosted media — those keep loading directly, exactly as they do today.
 */
export function githubMediaFetchUrl(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === RAW_HOST) return url.toString();
  if (host !== "github.com" && host !== "www.github.com") return null;
  if (ATTACHMENT_PATH_PATTERN.test(url.pathname)) return `https://github.com${url.pathname}`;
  const repositoryFile = REPOSITORY_FILE_PATTERN.exec(url.pathname);
  // `?raw=true` is how the web UI spells "the bytes, not the page"; the raw host needs no query.
  return repositoryFile
    ? `https://${RAW_HOST}/${repositoryFile[1]}/${repositoryFile[2]}/${repositoryFile[3]}`
    : null;
}

/** Last path segment, for the signed URL's display name and the download filename. */
export function githubMediaFileName(fetchUrl: string): string {
  const segment = new URL(fetchUrl).pathname.split("/").pop() ?? "";
  const name = decodeURIComponent(segment).replace(/[\\/\0]/gu, "");
  return name.length > 0 ? name : "github-media";
}
