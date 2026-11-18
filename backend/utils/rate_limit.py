"""Small in-memory failed-attempt limiter.

State is per process: with several gunicorn workers each keeps its own counters.
Use Redis (e.g. Flask-Limiter) if you need a shared limit across workers or hosts.
"""
import threading
import time


class FailureLimiter:
    def __init__(self, max_failures=5, window_seconds=300):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures = {}
        self._lock = threading.Lock()

    def _recent(self, key, now):
        attempts = [t for t in self._failures.get(key, []) if now - t < self.window]
        if attempts:
            self._failures[key] = attempts
        else:
            self._failures.pop(key, None)
        return attempts

    def retry_after(self, key):
        """Seconds until the key may try again, or 0 if it is not blocked."""
        now = time.monotonic()
        with self._lock:
            attempts = self._recent(key, now)
            if len(attempts) < self.max_failures:
                return 0
            return int(self.window - (now - attempts[0])) + 1

    def record_failure(self, key):
        now = time.monotonic()
        with self._lock:
            self._recent(key, now)
            self._failures.setdefault(key, []).append(now)

    def reset(self, key):
        with self._lock:
            self._failures.pop(key, None)
