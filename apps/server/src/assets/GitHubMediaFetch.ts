import Mime from "@effect/platform-node/Mime";
import { githubMediaFileName } from "@t3tools/shared/githubMedia";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpServerResponse,
  type HttpClientResponse,
} from "effect/unstable/http";

import * as GitHubCli from "../sourceControl/GitHubCli.ts";

/** Hosts the credential is for. A redirect off them is answered with its own signature instead. */
const GITHUB_HOST_PATTERN = /^(?:[\w-]+\.)*github(?:usercontent)?\.com$/iu;
const isGitHubHost = (url: string) => {
  try {
    return GITHUB_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** GitHub answers an asset request with a 302 to a signed object URL that needs no credential. */
const MAX_REDIRECTS = 3;
/** Following the redirect here, rather than in `fetch`, is what keeps the token on GitHub. */
const MANUAL_REDIRECT: RequestInit = { redirect: "manual" };
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX_ENTRIES = 32;
/** Passed through so a seek in a long video costs one upstream range request, not a full download. */
const FORWARDED_REQUEST_HEADERS = ["range", "if-range"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;
/** A pull request embeds pictures and recordings. Anything else is not served from our origin. */
const MEDIA_CONTENT_TYPE_PATTERN = /^(?:image|video|audio)\/[\w!#$&^.+-]+$/i;
const SVG_CONTENT_TYPE = "image/svg+xml";
// An SVG is a document: same policy the asset route gives a workspace SVG, so one embedded in a
// body cannot run script against this origin.
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * A media request per image and one per video seek, each of which would otherwise spawn `gh`.
 * The token is what `gh auth token` would print again on the next call, and it is held no longer
 * than a signed asset URL lives.
 */
const tokenCache = new Map<string, { readonly at: number; readonly token: Redacted.Redacted }>();

const githubToken = Effect.fn("GitHubMediaFetch.githubToken")(function* (input: {
  readonly cwd: string;
  readonly host: string;
}) {
  // `gh` stores a token per host, not per repository, so the directory it runs in is not part
  // of the answer and must not fragment the cache a client could otherwise churn.
  const key = input.host;
  const now = yield* Clock.currentTimeMillis;
  const cached = tokenCache.get(key);
  if (cached !== undefined && now - cached.at < TOKEN_CACHE_TTL_MS) return cached.token;
  const github = yield* GitHubCli.GitHubCli;
  // No credential is a normal state: a public asset still loads, and a private one fails the way
  // it does in a browser that is not signed in.
  const token = yield* github
    .execute({
      cwd: input.cwd,
      args: ["auth", "token", "--hostname", input.host],
      env: { GH_DEBUG: "" },
    })
    .pipe(
      Effect.map((output) => output.stdout.trim()),
      Effect.orElseSucceed(() => ""),
    );
  if (token.length === 0) return null;
  if (tokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    tokenCache.delete(tokenCache.keys().next().value!);
  }
  const redacted = Redacted.make(token);
  tokenCache.set(key, { at: now, token: redacted });
  return redacted;
});

/**
 * Follows GitHub's redirect to the signed object itself, and never carries the credential off
 * GitHub: the object URL authorizes with its own signature, and the store it lives in has no
 * business seeing a token.
 */
const fetchFollowingRedirects = Effect.fn("GitHubMediaFetch.fetchFollowingRedirects")(function* (
  url: string,
  headers: Record<string, string>,
  token: Redacted.Redacted | null,
) {
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);
  let target = url;
  for (let hop = 0; ; hop += 1) {
    // The credential rides only on a request to GitHub itself. A redirect leads to a signed
    // object URL that authorizes on its own, and the store it lives in has no business seeing
    // a token — deciding that from the target, not from the hop count, is what makes it so.
    const authorization =
      token !== null && isGitHubHost(target) ? `Bearer ${Redacted.value(token)}` : null;
    const response: HttpClientResponse.HttpClientResponse = yield* httpClient
      .execute(
        HttpClientRequest.get(target).pipe(
          HttpClientRequest.setHeaders({
            ...headers,
            // The bytes are streamed straight through, so never let an encoding layer in.
            "accept-encoding": "identity",
            ...(authorization === null ? {} : { authorization }),
          }),
        ),
      )
      .pipe(Effect.provideService(FetchHttpClient.RequestInit, MANUAL_REDIRECT));
    const location = response.headers.location;
    if (response.status < 300 || response.status >= 400) return response;
    // A chain this long is not GitHub answering with bytes, and its body is not the media.
    if (!location || hop >= MAX_REDIRECTS) return null;
    const next = new URL(location, target);
    if (next.protocol !== "https:") return null;
    target = next.toString();
  }
});

/**
 * Serves media a pull request body points at on GitHub through the `gh` credential, which is the
 * only thing that distinguishes a readable private attachment from a 404.
 */
export const githubMediaResponse = Effect.fn("GitHubMediaFetch.githubMediaResponse")(function* (
  asset: { readonly url: string; readonly cwd: string },
  requestHeaders: Record<string, string | undefined>,
) {
  // Both media hosts are served by github.com's account, which is the host `gh` stores it under.
  const token = yield* githubToken({ cwd: asset.cwd, host: "github.com" });
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = requestHeaders[name];
    if (value !== undefined) forwarded[name] = value;
  }
  const response = yield* fetchFollowingRedirects(asset.url, forwarded, token);
  const headers: Record<string, string> = {
    // The signed asset URL is the grant; a cached copy must not outlive it.
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (response === null) return HttpServerResponse.empty({ status: 502, headers });
  // An upstream refusal is the client's answer, not this server's fault; only a broken hop is.
  // It carries none of the upstream entity headers: a `content-length` with no body behind it
  // holds the connection open until the browser gives up on it.
  if (response.status >= 400) {
    return HttpServerResponse.empty({
      status: response.status >= 500 ? 502 : response.status,
      headers,
    });
  }
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  // Only pictures and recordings leave this origin, and never on GitHub's word alone: the raw
  // host labels every committed binary `application/octet-stream`, so the name decides those.
  const upstreamType = headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentType = MEDIA_CONTENT_TYPE_PATTERN.test(upstreamType)
    ? upstreamType
    : (Mime.getType(githubMediaFileName(asset.url))?.toLowerCase() ?? "");
  if (!MEDIA_CONTENT_TYPE_PATTERN.test(contentType)) {
    return HttpServerResponse.empty({ status: 415 });
  }
  headers["content-type"] = contentType;
  if (contentType === SVG_CONTENT_TYPE) {
    headers["content-security-policy"] = SVG_CONTENT_SECURITY_POLICY;
  }
  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers,
    contentType,
  });
});
