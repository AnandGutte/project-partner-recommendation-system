"""
Unit tests for RecommendationEngine and RecommendationEvaluator.
Validates data alignment, real-time hybrid scoring, domain/location filtering,
cold-start handling, bio semantic search, and evaluation metrics.
"""

import pytest
import numpy as np
from backend.engine import RecommendationEngine
from backend.evaluation import RecommendationEvaluator


@pytest.fixture(scope="module")
def engine():
    return RecommendationEngine()


@pytest.fixture(scope="module")
def evaluator(engine):
    return RecommendationEvaluator(engine)


def test_engine_data_alignment(engine):
    """Verify that user profiles and bio embeddings are aligned 1-to-1."""
    assert len(engine.df) == 3890
    assert engine.bio_embeddings is not None
    assert engine.bio_embeddings.shape == (3890, 384)
    # Check L2 normalization
    norms = np.linalg.norm(engine.bio_embeddings, axis=1)
    np.testing.assert_allclose(norms, 1.0, atol=1e-4)


def test_metadata_domains(engine):
    """Verify verified clustering domains without typos or non-existent categories."""
    meta = engine.get_metadata()
    assert meta["total_users"] == 3890
    hdbscan_domains = meta["clustering_methods"]["hdbscan"]["domains"]
    dbscan_domains = meta["clustering_methods"]["dbscan"]["domains"]

    assert "DevOps & Scripting" in hdbscan_domains
    assert "Testing & Sparse Data" in hdbscan_domains
    assert "Unknown Users" in hdbscan_domains
    # Verify typo from old frontend is NOT present
    assert "Unknow Users" not in hdbscan_domains

    assert "Blockchain & Ripple Projects" in dbscan_domains
    assert "MERN & Node.js Dev" in dbscan_domains


def test_hybrid_recommendation_personalized(engine):
    """Verify that recommendations are dynamic and personalized per user."""
    rec_abhay = engine.recommend_hybrid("abhay", top_k=5)
    rec_mojombo = engine.recommend_hybrid("mojombo", top_k=5)

    assert rec_abhay["is_known_user"] is True
    assert rec_mojombo["is_known_user"] is True

    users_abhay = [r["Username"] for r in rec_abhay["recommendations"]]
    users_mojombo = [r["Username"] for r in rec_mojombo["recommendations"]]

    # Self must be excluded
    assert "abhay" not in users_abhay
    assert "mojombo" not in users_mojombo

    # Recommendations must be personalized, not a static identical list
    assert users_abhay != users_mojombo

    # Verify score bounds and structure
    for r in rec_abhay["recommendations"]:
        assert 0.0 <= r["hybrid_score"] <= 1.0
        assert 0.0 <= r["content_score"] <= 1.0
        assert 0.0 <= r["collab_score"] <= 1.0
        assert 0.0 <= r["bio_score"] <= 1.0
        assert len(r["explanation"]) > 0


def test_filters_location_and_domain(engine):
    """Verify filtering candidates by location and cluster domain."""
    rec = engine.recommend_hybrid(
        username="abhay",
        location="San Francisco",
        domain="DevOps & Scripting",
        method="hdbscan",
        top_k=5,
    )
    for r in rec["recommendations"]:
        assert "san francisco" in r["Location"].lower()
        assert r["Domain_Tag"] == "DevOps & Scripting"


def test_cold_start_handling(engine):
    """Verify graceful handling when user is not in the dataset."""
    rec = engine.recommend_hybrid(
        username="definitely_unregistered_octocat_99",
        method="hdbscan",
        top_k=3,
    )
    assert rec["is_known_user"] is False
    assert len(rec["recommendations"]) == 3
    for r in rec["recommendations"]:
        assert "Cold-start" in r["explanation"]


def test_recommend_by_bio(engine):
    """Verify free-text semantic query returns top matches."""
    res = engine.recommend_by_bio("react typescript fullstack frontend", top_k=4)
    assert res["count"] == 4
    assert len(res["recommendations"]) == 4
    for r in res["recommendations"]:
        assert 0.0 <= r["similarity"] <= 1.0
        assert len(r["Username"]) > 0


def test_evaluator_metrics(evaluator, engine):
    """Verify reproducible evaluation protocol produces bounded, valid metrics."""
    res = evaluator.run_benchmark(["abhay", "mojombo"], k=5)
    assert 0.0 <= res["precision@k"] <= 1.0
    assert 0.0 <= res["recall@k"] <= 1.0
    assert 0.0 <= res["map@k"] <= 1.0
    assert 0.0 <= res["intra_list_diversity"] <= 1.0
    assert 0.0 <= res["catalog_coverage_pct"] <= 100.0
