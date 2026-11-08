"""Admission control for the two recommendation route families."""

from contextlib import closing, contextmanager
from pathlib import Path
import os
import sqlite3
from threading import BoundedSemaphore, Lock
import time


class AdmissionError(Exception):
    def __init__(self, status, code, message, retry_after):
        super().__init__(message)
        self.status = status
        self.code = code
        self.retry_after = retry_after


def busy():
    return AdmissionError(503, "recommendation_busy", "Recommendation capacity is temporarily unavailable.", 1)


def is_locked(error):
    return (getattr(error, "sqlite_errorcode", 0) & 0xff) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED)


class RecommendationLimits:
    def __init__(self):
        self.rates = {
            "partner": int(os.getenv("PARTNER_REQUESTS_PER_MINUTE", "120")),
            "bio": int(os.getenv("PARTNER_BIO_REQUESTS_PER_MINUTE", "30")),
        }
        slots = int(os.getenv("PARTNER_MAX_CONCURRENT", "2"))
        if not 1 <= slots <= 32 or any(rate < 1 for rate in self.rates.values()):
            raise ValueError("Recommendation rates must be positive and concurrency must be 1–32.")

        path = os.getenv("PARTNER_LIMITS_DB")
        self.path = Path(path).resolve() if path else None
        self.slot_paths = (
            [self.path.with_name(f"{self.path.name}.slot-{index}") for index in range(slots)]
            if self.path else []
        )
        self.slots = BoundedSemaphore(slots)
        self.rate_lock = Lock()
        self.counts = {}
        if self.path:
            with closing(sqlite3.connect(self.path, timeout=1)) as db:
                db.execute(
                    "CREATE TABLE IF NOT EXISTS limits "
                    "(family TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL)"
                )

    @contextmanager
    def slot(self):
        if not self.path:
            if not self.slots.acquire(blocking=False):
                raise busy()
            try:
                yield
            finally:
                self.slots.release()
            return

        # A write reservation on a separate file is released on close or process exit.
        # It never locks the rate counter while the engine computes.
        for path in self.slot_paths:
            with closing(sqlite3.connect(path, timeout=0)) as db:
                try:
                    db.execute("BEGIN IMMEDIATE")
                except sqlite3.OperationalError as error:
                    if is_locked(error):
                        continue
                    raise
                yield
                return
        raise busy()

    def charge(self, family):
        limit = self.rates[family]
        if self.path:
            with closing(sqlite3.connect(self.path, timeout=0.05)) as db, db:
                db.execute("BEGIN IMMEDIATE")
                window, seconds = divmod(int(time.time()), 60)
                row = db.execute(
                    "INSERT INTO limits VALUES (?, ?, 1) "
                    "ON CONFLICT(family) DO UPDATE SET "
                    "count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END, "
                    "window = excluded.window "
                    "WHERE window != excluded.window OR count < ? RETURNING count",
                    (family, window, limit),
                ).fetchone()
            accepted = row is not None
        else:
            with self.rate_lock:
                window, seconds = divmod(int(time.time()), 60)
                previous, count = self.counts.get(family, (window, 0))
                count = count if previous == window else 0
                accepted = count < limit
                if accepted:
                    self.counts[family] = (window, count + 1)
        if not accepted:
            raise AdmissionError(429, "rate_limited", "Recommendation request limit reached.", 60 - seconds)

    @contextmanager
    def admit(self, family):
        try:
            with self.slot():
                self.charge(family)
                yield
        except sqlite3.Error:
            raise busy() from None
