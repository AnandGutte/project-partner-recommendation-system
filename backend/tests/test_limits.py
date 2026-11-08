import multiprocessing
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest

from backend import limits
from backend.app import create_app


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    for name in ("PARTNER_LIMITS_DB", "PARTNER_REQUESTS_PER_MINUTE", "PARTNER_BIO_REQUESTS_PER_MINUTE",
                 "PARTNER_DATA_DIR", "PARTNER_MODEL_PATH"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PARTNER_MAX_CONCURRENT", "1")
    monkeypatch.setenv("PARTNER_CORS_ORIGINS", "https://frontend.example")
    monkeypatch.setattr(limits, "time", SimpleNamespace(time=lambda: 125))


def test_shared_rate_across_apps_and_aliases_with_recovery(tmp_path, monkeypatch):
    monkeypatch.setenv("PARTNER_LIMITS_DB", str(tmp_path / "limits.db"))
    monkeypatch.setenv("PARTNER_REQUESTS_PER_MINUTE", "1")
    monkeypatch.setenv("PARTNER_BIO_REQUESTS_PER_MINUTE", "1")
    monkeypatch.setenv("PARTNER_MODEL_PATH", str(tmp_path / "missing-model"))
    one, two = create_app().test_client(), create_app().test_client()
    body = {"username": "abhay"}
    assert one.post("/recommend", json={}).status_code == 400
    assert one.post("/recommend", json=body).status_code == 200
    origin = "https://frontend.example"
    blocked = two.post("/api/recommend", json=body, headers={"Origin": origin, "X-Forwarded-For": "192.0.2.9", "X-Real-IP": "192.0.2.10"})
    assert blocked.status_code == 429
    assert blocked.json["code"] == "rate_limited"
    assert blocked.headers["Retry-After"] == "55"
    assert blocked.headers["Access-Control-Allow-Origin"] == origin
    assert blocked.headers["Cache-Control"] == "no-store"
    assert two.get("/api/metadata").status_code == 200
    assert two.post("/semantic-bio-recommend", json={"bio": "python"}).status_code == 200
    assert one.post("/api/semantic-bio-recommend", json={"bio": "python"}).status_code == 429
    monkeypatch.setattr(limits, "time", SimpleNamespace(time=lambda: 180))
    assert two.post("/api/recommend", json=body).status_code == 200


def hold_shared_slot(ready, release):
    with limits.RecommendationLimits().slot():
        ready.set()
        if not release.wait(10):
            raise RuntimeError("Test did not release slot")


def test_cross_process_busy_then_recovers(tmp_path, monkeypatch):
    monkeypatch.setenv("PARTNER_LIMITS_DB", str(tmp_path / "limits.db"))
    client = create_app().test_client()
    context = multiprocessing.get_context("spawn")
    ready, release = context.Event(), context.Event()
    worker = context.Process(target=hold_shared_slot, args=(ready, release))
    worker.start()
    try:
        assert ready.wait(10)
        blocked = client.post("/recommend", json={"username": "abhay"})
        assert blocked.status_code == 503
        assert blocked.json["code"] == "recommendation_busy"
        assert blocked.headers["Retry-After"] == "1"
    finally:
        release.set()
        worker.join(10)
        if worker.is_alive():
            worker.terminate()
            worker.join(5)
    assert worker.exitcode == 0
    assert client.post("/recommend", json={"username": "abhay"}).status_code == 200


def test_memory_slot_releases_after_engine_error(monkeypatch):
    from backend.engine import RecommendationEngine

    app = create_app()
    started, release = Event(), Event()
    original = RecommendationEngine.recommend_hybrid

    def fail(*args, **kwargs):
        started.set()
        if not release.wait(5):
            raise RuntimeError("Test did not release engine")
        raise RuntimeError("sensitive-internal-test-string")

    monkeypatch.setattr(RecommendationEngine, "recommend_hybrid", fail)
    payload = {"username": "abhay"}
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(lambda: app.test_client().post("/recommend", json=payload))
        try:
            assert started.wait(5)
            blocked = app.test_client().post("/api/recommend", json=payload)
            assert blocked.status_code == 503
            assert blocked.json["code"] == "recommendation_busy"
        finally:
            release.set()
        failed = pending.result(5)
    assert failed.status_code == 500
    assert b"sensitive-internal-test-string" not in failed.data
    monkeypatch.setattr(RecommendationEngine, "recommend_hybrid", original)
    assert app.test_client().post("/recommend", json=payload).status_code == 200


def test_contended_rate_store_fails_closed_and_recovers(tmp_path, monkeypatch):
    path = tmp_path / "limits.db"
    monkeypatch.setenv("PARTNER_LIMITS_DB", str(path))
    client = create_app().test_client()
    db = sqlite3.connect(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        reply = client.post("/recommend", json={"username": "abhay"})
        assert reply.status_code == 503
        assert reply.json["code"] == "recommendation_busy"
    finally:
        db.close()
    assert client.post("/recommend", json={"username": "abhay"}).status_code == 200


def test_lexical_search_reuses_index_without_changing_scores(tmp_path, monkeypatch):
    from backend.engine import RecommendationEngine, TfidfVectorizer

    engine = RecommendationEngine(model_path=str(tmp_path / "missing-model"))
    original = TfidfVectorizer.fit_transform
    calls = []

    def fit(self, *args, **kwargs):
        calls.append(True)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(TfidfVectorizer, "fit_transform", fit)
    first = engine.recommend_by_bio("python and flask")
    assert first["engine"] == "TF-IDF Fallback"
    assert engine.recommend_by_bio("python and flask") == first
    assert len(calls) == 1
