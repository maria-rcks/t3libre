export interface ThreadReferenceCopyTarget {
  readonly kind: "pull-request" | "thread";
  readonly value: string;
  readonly clipboardTarget: string;
  readonly successTitle: string;
}

export function resolveThreadReferenceCopyTarget(input: {
  readonly threadId: string;
  readonly linkedPullRequestUrl?: string | null;
  readonly detectedPullRequestUrl?: string | null;
}): ThreadReferenceCopyTarget {
  const pullRequestUrl = input.linkedPullRequestUrl ?? input.detectedPullRequestUrl;
  return pullRequestUrl
    ? {
        kind: "pull-request",
        value: pullRequestUrl,
        clipboardTarget: "pull request link",
        successTitle: "PR link copied",
      }
    : {
        kind: "thread",
        value: input.threadId,
        clipboardTarget: "thread ID",
        successTitle: "Thread ID copied",
      };
}
