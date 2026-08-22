#!/usr/bin/env python3
"""Weekly community-vote PR merger.

Every Saturday at 19:00 UTC, .github/workflows/pr-vote-merge.yml runs this
script: it scores every open pull request by its 👍 (+1) and 👎 (-1)
reactions and merges the winner.

Rules:
- Each user votes once per PR (a user who reacts both 👍 and 👎 cancels out).
- The PR author's own reactions do not count.
- Draft PRs, PRs with a non-positive net score, PRs with too few voters, and
  PRs whose CI is not green are ineligible.
- Ties are broken in favour of the oldest PR.

Interfaces with GitHub through the ``gh`` CLI, which is preinstalled on
GitHub Actions runners.  Use ``--dry-run`` to preview the winner.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

THUMBS_UP = "+1"
THUMBS_DOWN = "-1"
GREEN_CONCLUSIONS = ("SUCCESS", "SKIPPED", "NEUTRAL")
GH_TIMEOUT_SECONDS = 120


@dataclass
class Candidate:
    """One open PR with its vote tallies."""

    number: int
    title: str
    author: str
    created_at: str
    up: int = 0
    down: int = 0
    eligible: bool = True
    reason: str = ""

    @property
    def score(self) -> int:
        return self.up - self.down

    @property
    def voters(self) -> int:
        return self.up + self.down


def run_gh(args: Sequence[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run ``gh`` with the given arguments and return the completed process."""
    return subprocess.run(
        ["gh", *args],
        capture_output=True,
        text=True,
        check=check,
        timeout=GH_TIMEOUT_SECONDS,
    )


def fetch_open_prs(repo: str) -> List[Dict[str, Any]]:
    """Return JSON metadata for every open PR in ``repo``."""
    proc = run_gh(
        [
            "pr",
            "list",
            "--repo",
            repo,
            "--state",
            "open",
            "--json",
            "number,title,author,isDraft,createdAt",
            "--limit",
            "1000",
        ]
    )
    return json.loads(proc.stdout)


def fetch_reactions(repo: str, number: int, content: str) -> List[Dict[str, Any]]:
    """Return the per-user reactions of one ``content`` type on a PR."""
    endpoint = f"repos/{repo}/issues/{number}/reactions"
    query = urllib.parse.urlencode({"content": content, "per_page": 100})
    proc = run_gh(["api", "--paginate", "--jq", ".[]", f"{endpoint}?{query}"])
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


def count_votes(
    pr: Dict[str, Any], up: List[Dict[str, Any]], down: List[Dict[str, Any]]
) -> Tuple[int, int, int]:
    """Tally 👍/👎 reactions into (up, down, net) unique-voter counts.

    Each user votes once per PR: 👍 counts +1, 👎 counts -1, and a user who
    reacted both cancels out.  The PR author's own reactions are ignored.
    """
    author = (pr.get("author") or {}).get("login") or ""
    votes: Dict[str, int] = {}
    for reaction in up:
        user = (reaction.get("user") or {}).get("login")
        if user and user != author:
            votes[user] = votes.get(user, 0) + 1
    for reaction in down:
        user = (reaction.get("user") or {}).get("login")
        if user and user != author:
            votes[user] = votes.get(user, 0) - 1
    up_total = sum(1 for value in votes.values() if value > 0)
    down_total = sum(1 for value in votes.values() if value < 0)
    return up_total, down_total, up_total - down_total


def is_ci_green(repo: str, number: int) -> bool:
    """Return True when every status check on the PR has passed.

    PRs without any checks, or where the check list cannot be read, are
    treated as NOT green: merging code that was never validated would
    defeat the purpose of the CI gates.
    """
    proc = run_gh(
        ["pr", "view", str(number), "--repo", repo, "--json", "statusCheckRollup"],
        check=False,
    )
    if proc.returncode != 0:
        return False
    try:
        rollup = json.loads(proc.stdout).get("statusCheckRollup") or []
    except json.JSONDecodeError:
        return False
    if not rollup:
        return False
    for check in rollup:
        conclusion = check.get("conclusion")
        if conclusion is None:
            conclusion = check.get("state")
        if conclusion is None or conclusion.upper() not in GREEN_CONCLUSIONS:
            return False
    return True


def score_candidate(
    repo: str, pr: Dict[str, Any], args: argparse.Namespace
) -> Candidate:
    """Fetch reactions for one PR and build its eligibility verdict."""
    up, down, net = count_votes(
        pr,
        fetch_reactions(repo, pr["number"], THUMBS_UP),
        fetch_reactions(repo, pr["number"], THUMBS_DOWN),
    )
    candidate = Candidate(
        number=pr["number"],
        title=pr["title"],
        author=(pr.get("author") or {}).get("login") or "unknown",
        created_at=pr["createdAt"],
        up=up,
        down=down,
    )
    reasons = []
    if pr.get("isDraft"):
        reasons.append("draft")
    if net <= 0:
        reasons.append("net score <= 0")
    if candidate.voters < args.min_voters:
        reasons.append(f"fewer than {args.min_voters} voters")
    if (
        not reasons
        and not args.skip_ci_check
        and not is_ci_green(repo, candidate.number)
    ):
        reasons.append("CI not green")
    if reasons:
        candidate.eligible = False
        candidate.reason = "; ".join(reasons)
    return candidate


def select_winner(candidates: Sequence[Candidate]) -> Optional[Candidate]:
    """Pick the eligible PR with the highest net score, oldest PR wins ties."""
    eligible = [candidate for candidate in candidates if candidate.eligible]
    if not eligible:
        return None
    eligible.sort(key=lambda candidate: (-candidate.score, candidate.created_at))
    return eligible[0]


def merge_pr(repo: str, number: int, method: str) -> bool:
    """Merge the PR using the given method; return True on success."""
    proc = run_gh(
        [
            "pr",
            "merge",
            str(number),
            "--repo",
            repo,
            f"--{method}",
            "--delete-branch",
        ],
        check=False,
    )
    if proc.returncode != 0:
        print(
            f"Error: gh pr merge for #{number} failed:\n{proc.stderr.strip()}",
            file=sys.stderr,
        )
    return proc.returncode == 0


def comment_on_pr(repo: str, number: int, body: str) -> None:
    """Post a comment on the PR (winner announcement / merge failure).

    Comment failures are logged but never raised: posting a comment must not
    mask the deliberate return code of the caller.
    """
    proc = run_gh(
        ["pr", "comment", str(number), "--repo", repo, "--body", body],
        check=False,
    )
    if proc.returncode != 0:
        stderr = proc.stderr.strip() if proc.stderr else ""
        print(
            f"Warning: failed to post comment on #{number}: {stderr}",
            file=sys.stderr,
        )


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score open PRs by 👍/👎 reactions and merge the winner.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--repo", required=True, help="Repository as owner/name")
    parser.add_argument(
        "--dry-run", action="store_true", help="Score and report without merging"
    )
    parser.add_argument(
        "--min-voters", type=int, default=2, help="Minimum number of unique voters"
    )
    parser.add_argument(
        "--merge-method",
        choices=["squash", "merge", "rebase"],
        default="squash",
        help="Merge method used by gh pr merge",
    )
    parser.add_argument(
        "--skip-ci-check",
        action="store_true",
        help="Do not require all status checks to be green",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    prs = fetch_open_prs(args.repo)
    candidates = [score_candidate(args.repo, pr, args) for pr in prs]

    winner = select_winner(candidates)
    print(f"=== Weekly PR vote: {args.repo} ===")
    if not candidates:
        print("No open pull requests.")
    for candidate in candidates:
        status = "winner" if candidate is winner else "open"
        suffix = f"  [{candidate.reason}]" if candidate.reason else ""
        print(
            f"#{candidate.number:>5} {candidate.title[:60]:<60} "
            f"{candidate.up:+d}/{candidate.down:+d} (net {candidate.score:+d}, "
            f"{candidate.voters} voters) {status}{suffix}"
        )

    if winner is None:
        print("No eligible winner this week.")
        print(json.dumps({"winner": None, "merged": False}))
        return 0

    if args.dry_run:
        print(f"Winner: #{winner.number} {winner.title}")
        print(json.dumps({"winner": winner.number, "merged": False, "dry_run": True}))
        return 0

    if not merge_pr(args.repo, winner.number, args.merge_method):
        print(
            f"Error: merge of #{winner.number} failed (conflicts or "
            "branch protection).",
            file=sys.stderr,
        )
        comment_on_pr(
            args.repo,
            winner.number,
            f":warning: {winner.title} won the weekly community vote "
            f"(:+1: {winner.up} / :-1: {winner.down}) but could not be merged "
            "automatically (merge conflict or branch protection).",
        )
        return 1

    comment_on_pr(
        args.repo,
        winner.number,
        f":tada: Merged by the weekly community vote: "
        f":+1: {winner.up} / :-1: {winner.down} (net {winner.score:+d}).",
    )
    print(
        json.dumps(
            {
                "winner": winner.number,
                "merged": True,
                "up": winner.up,
                "down": winner.down,
                "net": winner.score,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
