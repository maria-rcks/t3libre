"""Tests for the rate limiter strategies and registry."""

import time

import pytest
from rate_limiter import (
    RateLimitConfig,
    RateLimiter,
    RateLimitRegistry,
    RateLimitRule,
    RateLimitStrategy,
)


class TestTokenBucket:
    def test_burst_capacity_allows_initial_burst(self):
        limiter = RateLimiter(RateLimitConfig(strategy=RateLimitStrategy.TOKEN_BUCKET))
        allowed = [limiter.check_token_bucket("user-1") for _ in range(120)]
        assert all(allowed)

    def test_exhaustion_after_burst_and_refill(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=2,
                window_seconds=60,
                burst_size=0,
                strategy=RateLimitStrategy.TOKEN_BUCKET,
            )
        )
        assert limiter.check_token_bucket("k") is True
        assert limiter.check_token_bucket("k") is True
        assert limiter.check_token_bucket("k") is False

        bucket = limiter._get_bucket("k")
        bucket.last_refill = time.time() - 61
        assert limiter.check_token_bucket("k") is True

    def test_cost_greater_than_capacity_is_denied(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=1,
                window_seconds=60,
                burst_size=0,
                strategy=RateLimitStrategy.TOKEN_BUCKET,
            )
        )
        assert limiter.check_token_bucket("k", cost=2.0) is False

    def test_buckets_are_per_key(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=1,
                window_seconds=60,
                burst_size=0,
                strategy=RateLimitStrategy.TOKEN_BUCKET,
            )
        )
        assert limiter.check_token_bucket("a") is True
        assert limiter.check_token_bucket("b") is True


class TestSlidingWindow:
    def test_allows_up_to_limit(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=3,
                window_seconds=60,
                strategy=RateLimitStrategy.SLIDING_WINDOW,
            )
        )
        assert limiter.check_sliding_window("k") is True
        assert limiter.check_sliding_window("k") is True
        assert limiter.check_sliding_window("k") is True
        assert limiter.check_sliding_window("k") is False

    def test_old_entries_are_pruned(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=1,
                window_seconds=60,
                strategy=RateLimitStrategy.SLIDING_WINDOW,
            )
        )
        limiter.check_sliding_window("k")
        assert limiter.check_sliding_window("k") is False
        entry = limiter._sliding_windows["k"]
        entry.timestamps = [time.time() - 120]
        assert limiter.check_sliding_window("k") is True

    def test_remaining_reports_available_slots(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=3,
                window_seconds=60,
                strategy=RateLimitStrategy.SLIDING_WINDOW,
            )
        )
        limiter.check_sliding_window("k")
        assert limiter.get_remaining("k") == 2


class TestFixedWindow:
    def test_enforces_limit_per_window(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=2,
                window_seconds=60,
                strategy=RateLimitStrategy.FIXED_WINDOW,
            )
        )
        assert limiter.check_fixed_window("k") is True
        assert limiter.check_fixed_window("k") is True
        assert limiter.check_fixed_window("k") is False

    def test_new_window_resets_counter(self, monkeypatch):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=1,
                window_seconds=60,
                strategy=RateLimitStrategy.FIXED_WINDOW,
            )
        )
        limiter.check_fixed_window("k")
        key = next(iter(limiter._fixed_windows))
        start = limiter._fixed_windows[key][1]
        monkeypatch.setattr("rate_limiter.time.time", lambda: start + 61)
        assert limiter.check_fixed_window("k") is True


class TestConcurrency:
    def test_concurrency_limit(self):
        limiter = RateLimiter(RateLimitConfig(concurrency_limit=2))
        assert limiter.check_concurrency("k") is True
        assert limiter.check_concurrency("k") is True
        assert limiter.check_concurrency("k") is False
        limiter.release_concurrency("k")
        assert limiter.check_concurrency("k") is True

    def test_release_does_not_go_below_zero(self):
        limiter = RateLimiter(RateLimitConfig(concurrency_limit=2))
        limiter.release_concurrency("k")
        assert limiter._concurrency["k"] == 0


class TestCheckRateLimit:
    def test_dispatches_on_strategy(self):
        for strategy in RateLimitStrategy:
            limiter = RateLimiter(RateLimitConfig(strategy=strategy))
            assert limiter.check_rate_limit("k") in (True, False)


class TestRulesAndRegistry:
    def test_rule_matches_method_and_path(self):
        rule = RateLimitRule("/api/v1/servers*", 10, 60, methods=["GET"])
        assert rule.matches("/api/v1/servers", "GET") is True
        assert rule.matches("/api/v1/servers/123", "GET") is True
        assert rule.matches("/api/v1/servers", "POST") is False
        assert rule.matches("/api/v1/other", "GET") is False

    def test_rule_enforces_limit(self):
        rule = RateLimitRule("/api/v1/servers*", 2, 60)
        assert rule.check("client-1")[0] is True
        assert rule.check("client-1")[0] is True
        allowed, remaining, reset = rule.check("client-1")
        assert allowed is False
        assert remaining == 0
        assert reset > 0

    def test_registry_returns_first_matching_rule(self):
        registry = RateLimitRegistry()
        registry.add_rule(RateLimitRule("/api/v1/auth*", 1, 60, methods=["POST"]))
        allowed, _, _, strategy = registry.check_request(
            "/api/v1/auth/login", "POST", "ip:1"
        )
        assert allowed is True
        assert strategy == "sliding_window"

    def test_registry_returns_no_rule_metadata_when_unmatched(self):
        registry = RateLimitRegistry()
        allowed, remaining, reset, strategy = registry.check_request(
            "/other", "GET", "ip:1"
        )
        assert allowed is True
        assert remaining == -1
        assert reset == 0
        assert strategy == "none"

    def test_default_rules_exist_and_cover_auth(self):
        registry = RateLimitRegistry()
        registry.add_rules(registry.get_default_rules())
        allowed, remaining, _, _ = registry.check_request(
            "/api/v1/auth/login", "POST", "ip:1"
        )
        assert allowed is True
        assert remaining >= 0

    def test_reset_clears_state(self):
        limiter = RateLimiter(
            RateLimitConfig(
                requests=1,
                window_seconds=60,
                burst_size=0,
                strategy=RateLimitStrategy.TOKEN_BUCKET,
            )
        )
        limiter.check_token_bucket("k")
        limiter.reset("k")
        assert limiter.check_token_bucket("k") is True

    def test_stats_shape(self):
        limiter = RateLimiter()
        stats = limiter.get_stats()
        assert stats["config"]["strategy"] == "sliding_window"
        assert "active_buckets" in stats
