"""Bounded, deterministic rate limiting primitives for the API server.

The hot path uses fixed-capacity state tables and ring buffers instead of
unbounded dictionaries/lists.  Time is supplied at the public call boundary and
then passed through the core logic so tests can exercise deterministic behavior.
"""

from __future__ import annotations

import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

MAX_RATE_LIMIT_KEYS: int = 4096
MAX_REQUESTS_PER_WINDOW: int = 10_000
MAX_RULES: int = 64
MAX_METHODS_PER_RULE: int = 8
DEFAULT_METHODS: Tuple[str, ...] = ("GET", "POST", "PUT", "DELETE", "PATCH")


class RateLimitStrategy(Enum):
    TOKEN_BUCKET = "token_bucket"
    SLIDING_WINDOW = "sliding_window"
    FIXED_WINDOW = "fixed_window"


@dataclass(frozen=True)
class RateLimitConfig:
    requests: int = 100
    window_seconds: int = 60
    strategy: RateLimitStrategy = RateLimitStrategy.SLIDING_WINDOW
    burst_size: int = 20
    concurrency_limit: int = 10
    max_keys: int = MAX_RATE_LIMIT_KEYS

    def __post_init__(self) -> None:
        assert 1 <= self.requests <= MAX_REQUESTS_PER_WINDOW
        assert 1 <= self.window_seconds <= 86_400
        assert 0 <= self.burst_size <= MAX_REQUESTS_PER_WINDOW
        assert 1 <= self.concurrency_limit <= MAX_REQUESTS_PER_WINDOW
        assert 1 <= self.max_keys <= MAX_RATE_LIMIT_KEYS


@dataclass
class TokenBucket:
    tokens: float
    capacity: float
    refill_rate: float
    last_refill: float = field(default_factory=time.time)

    def consume_at(self, now: float, tokens: float = 1.0) -> bool:
        assert now >= 0.0
        assert 0.0 < tokens <= self.capacity
        assert 0.0 <= self.tokens <= self.capacity
        assert self.refill_rate > 0.0

        elapsed = max(0.0, now - self.last_refill)
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
        assert 0.0 <= self.tokens <= self.capacity

        if self.tokens >= tokens:
            self.tokens -= tokens
            assert 0.0 <= self.tokens <= self.capacity
            return True
        return False

    def consume(self, tokens: float = 1.0) -> bool:
        return self.consume_at(time.time(), tokens)

    def refill_at(self, now: float) -> None:
        assert now >= 0.0
        assert 0.0 <= self.tokens <= self.capacity
        elapsed = max(0.0, now - self.last_refill)
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
        assert 0.0 <= self.tokens <= self.capacity

    def refill(self) -> None:
        self.refill_at(time.time())


@dataclass
class SlidingWindowEntry:
    capacity: int
    timestamps: List[float] = field(init=False)
    start: int = 0
    count_used: int = 0

    def __post_init__(self) -> None:
        assert 1 <= self.capacity <= MAX_REQUESTS_PER_WINDOW
        self.timestamps = [0.0] * self.capacity
        assert len(self.timestamps) == self.capacity

    def prune_at(self, now: float, window_seconds: float) -> None:
        assert now >= 0.0
        assert window_seconds > 0.0
        cutoff = now - window_seconds
        while self.count_used > 0 and self.timestamps[self.start] <= cutoff:
            self.start = (self.start + 1) % self.capacity
            self.count_used -= 1
        assert 0 <= self.count_used <= self.capacity

    def add_at(self, now: float, window_seconds: float) -> bool:
        assert now >= 0.0
        assert window_seconds > 0.0
        self.prune_at(now, window_seconds)
        if self.count_used >= self.capacity:
            return False
        pos = (self.start + self.count_used) % self.capacity
        self.timestamps[pos] = now
        self.count_used += 1
        assert 0 < self.count_used <= self.capacity
        return True

    def count_at(self, now: float, window_seconds: float) -> int:
        assert now >= 0.0
        assert window_seconds > 0.0
        self.prune_at(now, window_seconds)
        assert 0 <= self.count_used <= self.capacity
        return self.count_used

    def oldest(self) -> Optional[float]:
        assert 0 <= self.count_used <= self.capacity
        if self.count_used == 0:
            return None
        return self.timestamps[self.start]

    # Compatibility helpers for existing callers/tests.
    def prune(self, window_seconds: float) -> None:
        self.prune_at(time.time(), window_seconds)

    def add(self) -> None:
        assert self.add_at(time.time(), float("inf"))

    def count(self, window_seconds: float) -> int:
        return self.count_at(time.time(), window_seconds)


class RateLimiter:
    def __init__(self, config: Optional[RateLimitConfig] = None):
        self.config = config or RateLimitConfig()
        assert isinstance(self.config.strategy, RateLimitStrategy)
        assert self.config.max_keys <= MAX_RATE_LIMIT_KEYS
        self._token_buckets: OrderedDict[str, TokenBucket] = OrderedDict()
        self._sliding_windows: OrderedDict[str, SlidingWindowEntry] = OrderedDict()
        self._fixed_windows: OrderedDict[str, Tuple[int, int, float]] = OrderedDict()
        self._concurrency: OrderedDict[str, int] = OrderedDict()

    def _ensure_capacity(self, table: OrderedDict, key: str) -> None:
        assert isinstance(key, str) and key != ""
        assert len(table) <= self.config.max_keys
        if key in table:
            table.move_to_end(key)
            return
        if len(table) >= self.config.max_keys:
            table.popitem(last=False)
        assert len(table) < self.config.max_keys

    def _get_bucket(self, key: str, now: Optional[float] = None) -> TokenBucket:
        assert key
        assert self.config.window_seconds > 0
        self._ensure_capacity(self._token_buckets, key)
        if key not in self._token_buckets:
            refill_rate = self.config.requests / self.config.window_seconds
            capacity = float(self.config.requests + self.config.burst_size)
            self._token_buckets[key] = TokenBucket(
                capacity, capacity, refill_rate, now or time.time()
            )
        return self._token_buckets[key]

    def check_token_bucket_at(self, key: str, now: float, cost: float = 1.0) -> bool:
        assert key
        assert now >= 0.0
        bucket = self._get_bucket(key, now)
        if cost > bucket.capacity:
            return False
        return bucket.consume_at(now, cost)

    def check_token_bucket(self, key: str, cost: float = 1.0) -> bool:
        return self.check_token_bucket_at(key, time.time(), cost)

    def _get_sliding_entry(self, key: str) -> SlidingWindowEntry:
        assert key
        assert self.config.requests <= MAX_REQUESTS_PER_WINDOW
        self._ensure_capacity(self._sliding_windows, key)
        if key not in self._sliding_windows:
            self._sliding_windows[key] = SlidingWindowEntry(self.config.requests)
        return self._sliding_windows[key]

    def check_sliding_window_at(self, key: str, now: float) -> bool:
        assert key
        assert now >= 0.0
        return self._get_sliding_entry(key).add_at(now, self.config.window_seconds)

    def check_sliding_window(self, key: str) -> bool:
        return self.check_sliding_window_at(key, time.time())

    def check_fixed_window_at(self, key: str, now: float) -> bool:
        assert key
        assert now >= 0.0
        window_id = int(now // self.config.window_seconds)
        self._ensure_capacity(self._fixed_windows, key)
        count, stored_window, start = self._fixed_windows.get(key, (0, window_id, now))
        if stored_window != window_id:
            count, stored_window, start = 0, window_id, now
        if count >= self.config.requests:
            self._fixed_windows[key] = (count, stored_window, start)
            return False
        self._fixed_windows[key] = (count + 1, stored_window, start)
        assert self._fixed_windows[key][0] <= self.config.requests
        return True

    def check_fixed_window(self, key: str) -> bool:
        return self.check_fixed_window_at(key, time.time())

    def check_rate_limit_at(self, key: str, now: float, cost: float = 1.0) -> bool:
        assert key
        assert now >= 0.0
        if self.config.strategy == RateLimitStrategy.TOKEN_BUCKET:
            return self.check_token_bucket_at(key, now, cost)
        if self.config.strategy == RateLimitStrategy.SLIDING_WINDOW:
            return self.check_sliding_window_at(key, now)
        if self.config.strategy == RateLimitStrategy.FIXED_WINDOW:
            return self.check_fixed_window_at(key, now)
        raise AssertionError(f"unsupported strategy: {self.config.strategy}")

    def check_rate_limit(self, key: str, cost: float = 1.0) -> bool:
        return self.check_rate_limit_at(key, time.time(), cost)

    def check_concurrency(self, key: str) -> bool:
        assert key
        assert self.config.concurrency_limit > 0
        self._ensure_capacity(self._concurrency, key)
        count = self._concurrency.get(key, 0)
        if count >= self.config.concurrency_limit:
            return False
        self._concurrency[key] = count + 1
        assert 0 < self._concurrency[key] <= self.config.concurrency_limit
        return True

    def release_concurrency(self, key: str) -> None:
        assert key
        assert self.config.concurrency_limit > 0
        count = self._concurrency.get(key, 0)
        if count > 1:
            self._concurrency[key] = count - 1
        elif count == 1:
            self._concurrency[key] = 0
        else:
            self._ensure_capacity(self._concurrency, key)
            self._concurrency[key] = 0
        assert self._concurrency[key] >= 0

    def get_remaining_at(self, key: str, now: float) -> int:
        assert key
        assert now >= 0.0
        if self.config.strategy == RateLimitStrategy.TOKEN_BUCKET:
            return int(self._get_bucket(key, now).tokens)
        if self.config.strategy == RateLimitStrategy.SLIDING_WINDOW:
            entry = self._sliding_windows.get(key)
            return (
                self.config.requests
                if entry is None
                else max(
                    0,
                    self.config.requests
                    - entry.count_at(now, self.config.window_seconds),
                )
            )
        if self.config.strategy == RateLimitStrategy.FIXED_WINDOW:
            count, window_id, _ = self._fixed_windows.get(
                key, (0, int(now // self.config.window_seconds), now)
            )
            current_window = int(now // self.config.window_seconds)
            return (
                self.config.requests
                if window_id != current_window
                else max(0, self.config.requests - count)
            )
        raise AssertionError(f"unsupported strategy: {self.config.strategy}")

    def get_remaining(self, key: str) -> int:
        return self.get_remaining_at(key, time.time())

    def get_reset_time_at(self, key: str, now: float) -> float:
        assert key
        assert now >= 0.0
        if self.config.strategy == RateLimitStrategy.FIXED_WINDOW:
            _, window_id, _ = self._fixed_windows.get(
                key, (0, int(now // self.config.window_seconds), now)
            )
            return (window_id + 1) * self.config.window_seconds
        if self.config.strategy == RateLimitStrategy.SLIDING_WINDOW:
            entry = self._sliding_windows.get(key)
            oldest = entry.oldest() if entry else None
            if oldest is not None:
                return oldest + self.config.window_seconds
        return now + self.config.window_seconds

    def get_reset_time(self, key: str) -> float:
        return self.get_reset_time_at(key, time.time())

    def reset(self, key: Optional[str] = None) -> None:
        assert key is None or key != ""
        if key:
            self._token_buckets.pop(key, None)
            self._sliding_windows.pop(key, None)
            self._fixed_windows.pop(key, None)
            self._concurrency.pop(key, None)
        else:
            self._token_buckets.clear()
            self._sliding_windows.clear()
            self._fixed_windows.clear()
            self._concurrency.clear()
        assert len(self._token_buckets) <= self.config.max_keys

    def get_stats(self) -> Dict:
        assert len(self._token_buckets) <= self.config.max_keys
        assert len(self._sliding_windows) <= self.config.max_keys
        return {
            "config": {
                "requests": self.config.requests,
                "window_seconds": self.config.window_seconds,
                "strategy": self.config.strategy.value,
                "burst_size": self.config.burst_size,
                "concurrency_limit": self.config.concurrency_limit,
                "max_keys": self.config.max_keys,
            },
            "active_buckets": len(self._token_buckets),
            "active_windows": len(self._sliding_windows),
            "active_concurrency": dict(self._concurrency),
        }


def rate_limit_middleware(config: Optional[RateLimitConfig] = None):
    limiter = RateLimiter(config)

    async def middleware(scope, receive, send):
        assert callable(send)
        assert isinstance(scope, dict)
        if scope["type"] != "http":
            await send(scope, receive, send)
            return
        now = time.time()
        client_ip = scope.get("client", ("127.0.0.1", 0))[0]
        key = f"ip:{client_ip}"
        if not limiter.check_rate_limit_at(key, now):
            reset_time = limiter.get_reset_time_at(key, now)
            await send(
                {
                    "type": "http.response.start",
                    "status": 429,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (
                            b"retry-after",
                            str(max(1, int(reset_time - now) + 1)).encode(),
                        ),
                        (b"x-ratelimit-limit", str(limiter.config.requests).encode()),
                        (
                            b"x-ratelimit-remaining",
                            str(limiter.get_remaining_at(key, now)).encode(),
                        ),
                        (b"x-ratelimit-reset", str(int(reset_time)).encode()),
                    ],
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": b'{"error":"rate_limit_exceeded","message":"Too many requests"}',
                }
            )
            return
        await send(scope, receive, send)

    return middleware


class RateLimitRule:
    def __init__(
        self,
        path: str,
        requests: int,
        window: int,
        methods: Optional[List[str]] = None,
        strategy: RateLimitStrategy = RateLimitStrategy.SLIDING_WINDOW,
    ):
        assert path.startswith("/")
        assert 1 <= requests <= MAX_REQUESTS_PER_WINDOW
        assert 1 <= window <= 86_400
        selected_methods = tuple(methods or DEFAULT_METHODS)
        assert 1 <= len(selected_methods) <= MAX_METHODS_PER_RULE
        self.path = path
        self.requests = requests
        self.window = window
        self.methods = frozenset(selected_methods)
        self.strategy = strategy
        self._pattern = re.compile("^" + re.escape(path).replace("\\*", ".*") + "$")
        self.limiter = RateLimiter(
            RateLimitConfig(requests=requests, window_seconds=window, strategy=strategy)
        )

    def matches(self, path: str, method: str) -> bool:
        assert path.startswith("/")
        assert method
        return method in self.methods and bool(self._pattern.match(path))

    def check(self, key: str) -> Tuple[bool, int, float]:
        assert key
        now = time.time()
        allowed = self.limiter.check_rate_limit_at(key, now)
        remaining = self.limiter.get_remaining_at(key, now)
        reset = self.limiter.get_reset_time_at(key, now)
        assert remaining >= 0
        return allowed, remaining, reset


class RateLimitRegistry:
    def __init__(self):
        self.rules: List[RateLimitRule] = []

    def add_rule(self, rule: RateLimitRule) -> None:
        assert isinstance(rule, RateLimitRule)
        assert len(self.rules) < MAX_RULES
        self.rules.append(rule)

    def add_rules(self, rules: List[RateLimitRule]) -> None:
        assert len(rules) <= MAX_RULES
        assert len(self.rules) + len(rules) <= MAX_RULES
        self.rules.extend(rules)

    def check_request(
        self, path: str, method: str, client_key: str
    ) -> Tuple[bool, int, float, str]:
        assert path.startswith("/")
        assert client_key
        for rule in self.rules:
            if rule.matches(path, method):
                allowed, remaining, reset = rule.check(client_key)
                return allowed, remaining, reset, rule.strategy.value
        return True, -1, 0, "none"

    def clear(self) -> None:
        self.rules.clear()
        assert len(self.rules) == 0

    def get_default_rules(self) -> List[RateLimitRule]:
        rules = [
            RateLimitRule("/api/v1/servers*", 60, 60),
            RateLimitRule("/api/v1/deployments*", 30, 60),
            RateLimitRule("/api/v1/builds*", 10, 60),
            RateLimitRule("/api/v1/containers*", 60, 60),
            RateLimitRule("/api/v1/logs*", 120, 60),
            RateLimitRule("/api/v1/auth*", 10, 60, methods=["POST"]),
            RateLimitRule("/api/v1/register*", 5, 300, methods=["POST"]),
            RateLimitRule("/api/v1/webhooks*", 200, 60, methods=["POST"]),
            RateLimitRule("/api/v1/health*", 300, 60),
            RateLimitRule("/api/v1/metrics*", 60, 60),
            RateLimitRule("/api/v1/search*", 20, 60),
            RateLimitRule("/api/v1/export*", 5, 60),
            RateLimitRule("/api/v1/billing*", 10, 60),
            RateLimitRule("/api/v1/admin*", 20, 60),
            RateLimitRule("/api/v1/*/bulk*", 5, 60, methods=["POST", "PUT", "DELETE"]),
        ]
        assert len(rules) <= MAX_RULES
        return rules


_default_registry = RateLimitRegistry()
_default_registry.add_rules(_default_registry.get_default_rules())

__all__ = [
    "RateLimiter",
    "RateLimitConfig",
    "RateLimitStrategy",
    "RateLimitRule",
    "RateLimitRegistry",
    "rate_limit_middleware",
    "TokenBucket",
    "SlidingWindowEntry",
    "_default_registry",
]
