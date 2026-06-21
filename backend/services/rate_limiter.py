"""Thread-safe token bucket rate limiter."""
from __future__ import annotations

import asyncio
import threading
import time


class TokenBucket:
    def __init__(self, rate: float = 5.0, capacity: float | None = None) -> None:
        if rate <= 0:
            raise ValueError(f"rate must be > 0, got {rate}")
        cap = float(capacity) if capacity is not None else max(float(rate), 1.0)
        if cap <= 0:
            raise ValueError(f"capacity must be > 0, got {cap}")
        self._rate = float(rate)
        self._capacity = cap
        self._tokens = cap
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()

    @property
    def rate(self) -> float:
        return self._rate

    def _refill_locked(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        if elapsed > 0:
            self._tokens = min(self._capacity, self._tokens + elapsed * self._rate)
            self._last_refill = now

    async def acquire_async(self, tokens: int = 1, timeout: float | None = None) -> bool:
        if tokens > self._capacity:
            raise ValueError(f"requested {tokens} tokens > capacity {self._capacity}")
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            with self._lock:
                self._refill_locked()
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return True
                wait = (tokens - self._tokens) / self._rate
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                wait = min(wait, remaining)
            await asyncio.sleep(wait)
