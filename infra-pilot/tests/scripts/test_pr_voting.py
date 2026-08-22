import argparse
import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import pr_voting  # noqa: E402


class FakeGh:
    """Records gh invocations and serves canned responses per route."""

    def __init__(
        self,
        prs=None,
        reactions=None,
        ci_green=True,
        merge_ok=True,
        ci_rollup=None,
        fail_prefixes=None,
    ):
        self.prs = prs or []
        self.reactions = reactions or {"+1": [], "-1": []}
        self.ci_green = ci_green
        self.merge_ok = merge_ok
        self.ci_rollup = ci_rollup
        self.fail_prefixes = fail_prefixes or []
        self.merge_calls = []
        self.comments = []

    def __call__(self, args, check=True):
        args = list(args)
        stdout = ""
        returncode = 0
        for prefix in self.fail_prefixes:
            if args[: len(prefix)] == prefix:
                returncode = 1
        if returncode == 0:
            if args[:2] == ["pr", "list"]:
                stdout = json.dumps(self.prs)
            elif args[:2] == ["pr", "view"]:
                if self.ci_rollup is not None:
                    stdout = json.dumps({"statusCheckRollup": self.ci_rollup})
                elif self.ci_green:
                    stdout = json.dumps(
                        {
                            "statusCheckRollup": [
                                {
                                    "__typename": "CheckRun",
                                    "status": "COMPLETED",
                                    "conclusion": "SUCCESS",
                                }
                            ]
                        }
                    )
                else:
                    stdout = json.dumps(
                        {
                            "statusCheckRollup": [
                                {
                                    "__typename": "CheckRun",
                                    "status": "COMPLETED",
                                    "conclusion": "FAILURE",
                                }
                            ]
                        }
                    )
            elif args[0] == "api":
                endpoint = next(arg for arg in args if arg.startswith("repos/"))
                content = "+1" if "content=%2B1" in endpoint else "-1"
                reactions = self.reactions.get(content, [])
                stdout = "\n".join(json.dumps(reaction) for reaction in reactions)
            elif args[:2] == ["pr", "merge"]:
                self.merge_calls.append(args)
                returncode = 0 if self.merge_ok else 1
            elif args[:2] == ["pr", "comment"]:
                self.comments.append(args)
        if check and returncode != 0:
            raise subprocess.CalledProcessError(returncode, args)
        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr="")


def make_pr(
    number=1,
    title="Fix bug",
    author="alice",
    draft=False,
    created="2026-01-01T00:00:00Z",
):
    return {
        "number": number,
        "title": title,
        "author": {"login": author},
        "isDraft": draft,
        "createdAt": created,
    }


def make_reaction(user, content):
    return {"user": {"login": user}, "content": content}


def run_main(fake, **kwargs):
    argv = ["--repo", "owner/repo"]
    for key, value in kwargs.items():
        if value is True:
            argv.append(f"--{key.replace('_', '-')}")
        elif value is not False:
            argv.extend([f"--{key.replace('_', '-')}", str(value)])
    pr_voting.run_gh = fake
    return pr_voting.main(argv)


@pytest.fixture(autouse=True)
def restore_run_gh():
    """Restore the real pr_voting.run_gh after each test."""
    original = pr_voting.run_gh
    yield
    pr_voting.run_gh = original


# ── count_votes ──────────────────────────────────────────────────────


def test_count_votes_counts_each_user_once():
    pr = make_pr(author="alice")
    up = [
        make_reaction("bob", "+1"),
        make_reaction("bob", "+1"),
        make_reaction("carol", "+1"),
    ]
    down = [make_reaction("dave", "-1")]
    assert pr_voting.count_votes(pr, up, down) == (2, 1, 1)


def test_count_votes_ignores_pr_author():
    pr = make_pr(author="alice")
    up = [make_reaction("alice", "+1"), make_reaction("bob", "+1")]
    down = [make_reaction("alice", "-1")]
    assert pr_voting.count_votes(pr, up, down) == (1, 0, 1)


def test_count_votes_user_with_both_reactions_cancels_out():
    pr = make_pr(author="alice")
    up = [make_reaction("bob", "+1")]
    down = [make_reaction("bob", "-1"), make_reaction("carol", "-1")]
    assert pr_voting.count_votes(pr, up, down) == (0, 1, -1)


# ── select_winner ────────────────────────────────────────────────────


def test_select_winner_returns_highest_score():
    candidates = [
        pr_voting.Candidate(1, "a", "alice", "2026-01-01T00:00:00Z", up=1, down=0),
        pr_voting.Candidate(2, "b", "bob", "2026-01-02T00:00:00Z", up=5, down=1),
        pr_voting.Candidate(3, "c", "carol", "2026-01-03T00:00:00Z", up=2, down=0),
    ]
    assert pr_voting.select_winner(candidates).number == 2


def test_select_winner_breaks_ties_in_favour_of_oldest():
    candidates = [
        pr_voting.Candidate(1, "a", "alice", "2026-02-01T00:00:00Z", up=2, down=0),
        pr_voting.Candidate(2, "b", "bob", "2026-01-01T00:00:00Z", up=2, down=0),
    ]
    assert pr_voting.select_winner(candidates).number == 2


def test_select_winner_skips_ineligible():
    candidate = pr_voting.Candidate(
        1, "a", "alice", "2026-01-01T00:00:00Z", up=3, down=0, eligible=False
    )
    assert pr_voting.select_winner([candidate]) is None


# ── is_ci_green ──────────────────────────────────────────────────────


def test_is_ci_green_with_no_checks():
    fake = FakeGh(ci_rollup=[])
    pr_voting.run_gh = fake
    assert pr_voting.is_ci_green("owner/repo", 1) is False


def test_is_ci_green_pass_on_success_check():
    fake = FakeGh()
    pr_voting.run_gh = fake
    assert pr_voting.is_ci_green("owner/repo", 1) is True


def test_is_ci_green_false_on_failed_check():
    fake = FakeGh(ci_green=False)
    pr_voting.run_gh = fake
    assert pr_voting.is_ci_green("owner/repo", 1) is False


def test_is_ci_green_pass_on_success_status_context():
    fake = FakeGh(ci_rollup=[{"__typename": "StatusContext", "state": "SUCCESS"}])
    pr_voting.run_gh = fake
    assert pr_voting.is_ci_green("owner/repo", 1) is True


def test_is_ci_green_false_on_failed_status_context():
    fake = FakeGh(ci_rollup=[{"__typename": "StatusContext", "state": "FAILURE"}])
    pr_voting.run_gh = fake
    assert pr_voting.is_ci_green("owner/repo", 1) is False


def test_is_ci_green_unreadable_status_returns_false():
    fake = FakeGh(fail_prefixes=[["pr", "view"]])
    pr_voting.run_gh = fake
    assert pr_voting.is_ci_green("owner/repo", 1) is False


# ── main (end to end) ────────────────────────────────────────────────


def test_main_merges_winner_and_comments():
    fake = FakeGh(
        prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")],
        reactions={
            "+1": [make_reaction("bob", "+1"), make_reaction("carol", "+1")],
            "-1": [],
        },
    )
    assert run_main(fake) == 0
    assert fake.merge_calls == [
        ["pr", "merge", "1", "--repo", "owner/repo", "--squash", "--delete-branch"]
    ]
    assert len(fake.comments) == 1
    assert "weekly community vote" in fake.comments[0][-1]


def test_main_dry_run_does_not_merge():
    fake = FakeGh(
        prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")],
        reactions={"+1": [make_reaction("bob", "+1")], "-1": []},
    )
    assert run_main(fake, dry_run=True, min_voters=1) == 0
    assert fake.merge_calls == []
    assert fake.comments == []


def test_main_no_eligible_winner():
    fake = FakeGh(prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")])
    assert run_main(fake, min_voters=1) == 0
    assert fake.merge_calls == []


def test_main_draft_pr_is_ineligible():
    fake = FakeGh(
        prs=[make_pr(1, "WIP", draft=True, created="2026-01-01T00:00:00Z")],
        reactions={"+1": [make_reaction("bob", "+1")], "-1": []},
    )
    assert run_main(fake, min_voters=1) == 0
    assert fake.merge_calls == []


def test_main_failed_merge_returns_nonzero_and_comments():
    fake = FakeGh(
        prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")],
        reactions={"+1": [make_reaction("bob", "+1")], "-1": []},
        merge_ok=False,
    )
    assert run_main(fake, min_voters=1) == 1
    assert len(fake.comments) == 1
    assert "could not be merged" in fake.comments[0][-1]


def test_main_net_negative_score_is_ineligible():
    fake = FakeGh(
        prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")],
        reactions={"+1": [], "-1": [make_reaction("bob", "-1")]},
    )
    assert run_main(fake, min_voters=1) == 0
    assert fake.merge_calls == []


# ── failure propagation ──────────────────────────────────────────────


def test_fetch_open_prs_raises_on_gh_failure():
    fake = FakeGh(fail_prefixes=[["pr", "list"]])
    pr_voting.run_gh = fake
    with pytest.raises(subprocess.CalledProcessError):
        pr_voting.fetch_open_prs("owner/repo")


def test_fetch_reactions_raises_on_gh_failure():
    fake = FakeGh(fail_prefixes=[["api"]])
    pr_voting.run_gh = fake
    with pytest.raises(subprocess.CalledProcessError):
        pr_voting.fetch_reactions("owner/repo", 1, "+1")


def test_comment_on_pr_failure_is_nonfatal():
    fake = FakeGh(fail_prefixes=[["pr", "comment"]])
    pr_voting.run_gh = fake
    assert pr_voting.comment_on_pr("owner/repo", 1, "body") is None


def test_main_failed_merge_comment_failure_still_returns_1():
    fake = FakeGh(
        prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")],
        reactions={"+1": [make_reaction("bob", "+1")], "-1": []},
        merge_ok=False,
        fail_prefixes=[["pr", "comment"]],
    )
    assert run_main(fake, min_voters=1) == 1
    assert fake.comments == []


def test_main_comment_failure_after_merge_still_prints_result():
    fake = FakeGh(
        prs=[make_pr(1, "Fix bug", created="2026-01-01T00:00:00Z")],
        reactions={"+1": [make_reaction("bob", "+1")], "-1": []},
        fail_prefixes=[["pr", "comment"]],
    )
    assert run_main(fake, min_voters=1) == 0
    assert len(fake.merge_calls) == 1
