"""
Integration tests for Flask API endpoints.
Verifies backward compatibility of legacy routes, contracts of modernized routes,
input validation, and error resilience.
"""

import pytest
from backend.app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def test_health_endpoint(client):
    """GET /api/health returns 200 with runtime indicators."""
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "healthy"
    assert data["total_users"] == 3890
    assert data["bio_embeddings_loaded"] is True
    assert "engine_mode" in data


def test_metadata_endpoint(client):
    """GET /api/metadata returns 200 with verified domain tags."""
    res = client.get("/api/metadata")
    assert res.status_code == 200
    data = res.get_json()
    assert "clustering_methods" in data
    assert "sample_usernames" in data
    assert len(data["sample_usernames"]) > 0


def test_legacy_recommend_endpoint(client):
    """POST /recommend maintains backward-compatible schema (list of dicts)."""
    payload = {
        "username": "abhay",
        "method": "hdbscan",
        "domain": "DevOps & Scripting",
    }
    res = client.post("/recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    for key in ["Username", "Location", "Profile_URL", "Domain_Tag", "hybrid_score"]:
        assert key in first


def test_api_recommend_endpoint(client):
    """POST /api/recommend returns rich structured object."""
    payload = {
        "username": "abhay",
        "method": "hdbscan",
        "top_k": 3,
    }
    res = client.post("/api/recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert "query_user" in data
    assert "recommendations" in data
    assert data["count"] == 3


def test_invalid_method_returns_400(client):
    """POST /recommend with invalid method returns 400 Bad Request."""
    payload = {
        "username": "abhay",
        "method": "invalid_method_xyz",
    }
    res = client.post("/recommend", json=payload)
    assert res.status_code == 400
    assert "error" in res.get_json()


def test_special_characters_in_location_safe(client):
    """Literal substring matching handles regex metacharacters without crashing."""
    payload = {
        "username": "abhay",
        "location": "[San Francisco*+(CA?",
    }
    res = client.post("/recommend", json=payload)
    assert res.status_code == 200
    assert isinstance(res.get_json(), list)


def test_legacy_semantic_bio_endpoint(client):
    """POST /semantic-bio-recommend maintains backward-compatible schema (list of dicts)."""
    payload = {"bio": "machine learning data science python"}
    res = client.post("/semantic-bio-recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    for key in ["Username", "Bio", "Location", "Profile_URL", "similarity"]:
        assert key in first


def test_api_semantic_bio_endpoint(client):
    """POST /api/semantic-bio-recommend returns structured search object."""
    payload = {"bio": "machine learning data science python", "top_k": 3}
    res = client.post("/api/semantic-bio-recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert "engine" in data
    assert "recommendations" in data
    assert data["count"] == 3
