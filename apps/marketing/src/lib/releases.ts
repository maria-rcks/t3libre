const REPO = "pingdotgg/t3code";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const NIGHTLY_RELEASES_URL = `${RELEASES_URL}?q=nightly&expanded=true`;

const LATEST_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const LATEST_CACHE_KEY = "t3code-latest-release";
const NIGHTLY_CACHE_KEY = "t3code-nightly-release";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
  draft?: boolean;
  prerelease?: boolean;
}

function readCachedRelease(key: string): Release | null {
  const cached = sessionStorage.getItem(key);
  if (!cached) return null;

  try {
    const release: unknown = JSON.parse(cached);
    if (isRelease(release)) return release;
    sessionStorage.removeItem(key);
    return null;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GitHub release request failed with ${response.status}`);
  }
  return response.json();
}

function isRelease(value: unknown): value is Release {
  if (!value || typeof value !== "object") return false;
  const release = value as Partial<Release>;
  return (
    typeof release.tag_name === "string" &&
    typeof release.html_url === "string" &&
    Array.isArray(release.assets)
  );
}

export function selectNightlyRelease(releases: readonly Release[]): Release | null {
  return (
    releases.find(
      (release) =>
        !release.draft &&
        release.prerelease === true &&
        /-nightly\.\d{8}\.\d+$/.test(release.tag_name),
    ) ?? null
  );
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = readCachedRelease(LATEST_CACHE_KEY);
  if (cached) return cached;

  const data = await fetchJson(LATEST_API_URL);
  if (!isRelease(data)) throw new Error("GitHub returned an invalid latest release");

  sessionStorage.setItem(LATEST_CACHE_KEY, JSON.stringify(data));
  return data;
}

export async function fetchNightlyRelease(): Promise<Release> {
  const cached = readCachedRelease(NIGHTLY_CACHE_KEY);
  if (cached) return cached;

  const data = await fetchJson(RELEASES_API_URL);
  if (!Array.isArray(data)) throw new Error("GitHub returned an invalid releases list");

  const nightly = selectNightlyRelease(data.filter(isRelease));
  if (!nightly) throw new Error("No nightly release was found");

  sessionStorage.setItem(NIGHTLY_CACHE_KEY, JSON.stringify(nightly));
  return nightly;
}
