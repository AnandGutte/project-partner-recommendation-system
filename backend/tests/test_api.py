import json

import numpy as np
import pandas as pd
import pytest

from backend import app as api


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    for key in ("PARTNER_DATA_DIR", "PARTNER_MODEL_PATH", "PARTNER_CORS_ORIGINS", "FLASK_DEBUG"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("PARTNER_DATA_DIR", str(tmp_path))
    profiles = pd.DataFrame(
        {
            "Username": ["tester", "alpha", "beta", "gamma"],
            "Location": ["East", "Test [City]", "West", "West"],
            "Profile_URL": [
                "https://github.com/tester",
                "https://github.com/alpha",
                "https://github.com/beta",
                "javascript:alert(1)",
            ],
            "Bio": ["python", "python python", "python java", "rust"],
            "Languages": ["Python", "Python", "Python, Java", "Rust"],
            "Repositories": ["web", "web api", "jvm", "systems"],
            "Followers": [10, 9, 7, 3],
            "Following": [10, 9, 7, 3],
            "Public_Repos": [10, 9, 7, 3],
            "Name": ["fixture name"] * 4,
            "Latitude": [0] * 4,
            "hybrid_score": [1.0, 0.9, 0.7, 0.6],
        }
    )
    profiles.to_csv(tmp_path / "cleaned_github_users.csv", index=False)
    for method in api.METHODS:
        pd.DataFrame(
            {"Username": profiles["Username"], "Domain_Tag": [method, method, method, None], "Cluster": [0, 0, 0, -1]}
        ).to_csv(tmp_path / f"{method}_optuna_clustered_users_with_domain.csv", index=False)
    np.save(tmp_path / "bio_embeddings.npy", np.array([[1, 0], [3, 1], [1, 2], [0, 1]], dtype=np.float32))
    return tmp_path


@pytest.fixture
def client(data_dir):
    return api.create_app().test_client()


def assert_error(response, status, code):
    assert response.status_code == status
    assert response.is_json
    assert set(response.json) == {"error", "code"}
    assert response.json["code"] == code


def test_partner_ranking_and_public_fields(client):
    response = client.post("/recommend", json={"username": " TeStEr ", "method": "dbscan"})
    assert response.status_code == 200
    assert [item["Username"] for item in response.json] == ["alpha", "beta", "gamma"]
    first = response.json[0]
    assert first["hybrid_score"] > response.json[1]["hybrid_score"]
    assert set(first) == set(api.PARTNER_FIELDS)
    assert {key: first[key] for key in ("Username", "Location", "Profile_URL", "Domain_Tag")} == {
        "Username": "alpha",
        "Location": "Test [City]",
        "Profile_URL": "https://github.com/alpha",
        "Domain_Tag": "dbscan",
    }
    assert response.json[-1]["Profile_URL"] is None
    assert response.json[-1]["Domain_Tag"] is None
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


@pytest.mark.parametrize(("location", "expected"), [("[", ["alpha"]), (".*", []), ("wEsT", ["beta", "gamma"])])
def test_location_is_a_literal_case_insensitive_filter(client, location, expected):
    response = client.post("/recommend", json={"username": "tester", "location": location})
    assert response.status_code == 200
    assert [item["Username"] for item in response.json] == expected


def test_domain_filter_and_unknown_username(client):
    response = client.post("/recommend", json={"username": "unknown", "domain": "hdbscan"})
    assert response.status_code == 200
    assert [item["Username"] for item in response.json] == ["tester", "alpha", "beta"]


@pytest.mark.parametrize(
    "payload",
    [
        {}, {"username": None}, {"username": 1}, {"username": "  "}, {"username": "a" * 40},
        {"username": "x", "method": "other"}, {"username": "x", "method": []},
        {"username": "x", "location": {}}, {"username": "x", "location": "x" * 121},
        {"username": "\ud800"}, {"username": "x", "domain": False}, {"username": "x", "domain": "x" * 121},
    ],
)
def test_invalid_partner_fields(client, payload):
    assert_error(client.post("/recommend", json=payload), 400, "invalid_request")


@pytest.mark.parametrize("payload", [{}, {"bio": 1}, {"bio": None}, {"bio": "\t "}, {"bio": "a" * 1001}, {"bio": "\ud800"}])
def test_invalid_bio_fields(client, payload):
    assert_error(client.post("/semantic-bio-recommend", json=payload), 400, "invalid_request")


@pytest.mark.parametrize("path", ["/recommend", "/api/recommend", "/semantic-bio-recommend", "/api/semantic-bio-recommend"])
@pytest.mark.parametrize(
    ("body", "media_type", "status", "code"),
    [
        ("{", "application/json", 400, "invalid_json"),
        ("", "application/json", 400, "invalid_json"),
        ("null", "application/json", 400, "invalid_request"),
        ("[]", "application/json", 400, "invalid_request"),
        ('"text"', "application/json", 400, "invalid_request"),
        ("{}", "text/plain", 415, "unsupported_media_type"),
        (json.dumps({"padding": "x" * api.BODY_LIMIT}), "application/json", 413, "payload_too_large"),
    ],
)
def test_invalid_request_bodies(client, path, body, media_type, status, code):
    assert_error(client.post(path, data=body, content_type=media_type), status, code)


def test_framework_errors_are_json_and_keep_allow_header(client):
    assert_error(client.get("/missing"), 404, "not_found")
    response = client.get("/recommend")
    assert_error(response, 405, "method_not_allowed")
    assert "POST" in response.headers["Allow"]


def test_missing_cluster_preserves_search_with_general_domain(data_dir):
    (data_dir / "hdbscan_optuna_clustered_users_with_domain.csv").unlink()
    client = api.create_app().test_client()
    response = client.post("/recommend", json={"username": "x"})
    assert response.status_code == 200
    assert {row["Domain_Tag"] for row in response.json} == {"General"}
    assert client.post("/recommend", json={"username": "x", "method": "dbscan"}).status_code == 200


@pytest.mark.parametrize("invalid", [False, True])
def test_unavailable_core_data_returns_503(data_dir, caplog, invalid):
    data = data_dir / "cleaned_github_users.csv"
    if invalid:
        data.write_text("bad,columns\nx,y\n")
    else:
        data.unlink()
    client = api.create_app().test_client()
    for path in ("/recommend", "/api/recommend", "/semantic-bio-recommend", "/api/semantic-bio-recommend"):
        assert_error(client.post(path, json={"username": "x", "bio": "python"}), 503, "recommendation_unavailable")
    for path in ("/api/health", "/api/metadata"):
        assert_error(client.get(path), 503, "recommendation_unavailable")
    assert "PARTNER_DATA_DIR" in caplog.text
    assert str(data_dir) not in caplog.text


@pytest.mark.parametrize("failure", ["missing", "wrong_rows", "invalid_dtype", "wrong_format"])
def test_unavailable_bio_artifacts_use_lexical_fallback(data_dir, monkeypatch, failure):
    import sentence_transformers

    file = data_dir / "bio_embeddings.npy"
    if failure == "missing":
        file.unlink()
    elif failure == "wrong_rows":
        np.save(file, np.ones((3, 2), dtype=np.float32))
    elif failure == "invalid_dtype":
        np.save(file, np.array([["x"]] * 4, dtype=object))
    else:
        file.write_text("invalid")
    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", lambda *args, **kwargs: pytest.fail("Model must not load"))
    client = api.create_app().test_client()
    response = client.post("/api/semantic-bio-recommend", json={"bio": "python"})
    assert response.status_code == 200
    assert response.json["engine"] == "TF-IDF Fallback"
    assert client.post("/recommend", json={"username": "x"}).status_code == 200


def test_missing_model_uses_offline_fallback_once(data_dir, monkeypatch, caplog):
    import sentence_transformers

    attempts = []

    def unavailable(model, **kwargs):
        attempts.append(model)
        assert kwargs == {"local_files_only": True, "trust_remote_code": False}
        raise OSError("internal model location")

    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", unavailable)
    client = api.create_app().test_client()
    for _ in range(2):
        response = client.post("/api/semantic-bio-recommend", json={"bio": "private query"})
        assert response.status_code == 200
        assert response.json["engine"] == "TF-IDF Fallback"
        assert "query" not in response.json
    assert len(attempts) == 1
    assert "internal model location" not in caplog.text
    assert "private query" not in caplog.text


def test_valid_semantic_response_keeps_top_match_and_excludes_raw_profile_data(data_dir, monkeypatch):
    import sentence_transformers

    class Model:
        def encode(self, texts, *, convert_to_numpy):
            assert texts == ["python"]
            assert convert_to_numpy
            return np.array([[1.0, 0.0]])

    monkeypatch.setenv("PARTNER_MODEL_PATH", str(data_dir))
    def local_model(path, **kwargs):
        assert path == str(data_dir)
        assert kwargs == {"local_files_only": True, "trust_remote_code": False}
        return Model()
    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", local_model)
    response = api.create_app().test_client().post("/semantic-bio-recommend", json={"bio": " python "})
    assert response.status_code == 200
    assert [item["Username"] for item in response.json] == ["tester", "alpha", "beta", "gamma"]
    assert set(response.json[0]) == {"Username", "Location", "Profile_URL", "similarity"}
    assert response.json[1]["similarity"] == pytest.approx(0.9487)
    assert response.json[-1]["Profile_URL"] is None


def test_unexpected_exception_does_not_leak(client, monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise RuntimeError("private input and internal path")

    monkeypatch.setattr(api.RecommendationEngine, "recommend_by_bio", fail)
    response = client.post("/semantic-bio-recommend", json={"bio": "test"})
    assert_error(response, 500, "internal_error")
    assert "private input" not in response.get_data(as_text=True)
    assert "private input" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_missing_semantic_and_lexical_resources_returns_503(data_dir, monkeypatch):
    monkeypatch.setenv("PARTNER_MODEL_PATH", str(data_dir / "missing-model"))
    path = data_dir / "cleaned_github_users.csv"
    profiles = pd.read_csv(path)
    profiles["Bio"] = "the"
    profiles.to_csv(path, index=False)
    client = api.create_app().test_client()
    assert_error(client.post("/semantic-bio-recommend", json={"bio": "python"}), 503, "recommendation_unavailable")
    assert client.post("/recommend", json={"username": "tester"}).status_code == 200


def test_production_defaults(data_dir, monkeypatch):
    monkeypatch.setenv("FLASK_DEBUG", "1")
    app = api.create_app()
    assert not app.debug
    assert not app.testing
    assert app.config["MAX_CONTENT_LENGTH"] == 16 * 1024
    response = app.test_client().post(
        "/recommend", json={"username": "x"}, headers={"Origin": "https://unrelated.test"}
    )
    assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.parametrize("origin", ["https://client.example.evil", "http://client.example", "null"])
def test_cors_exact_origins(data_dir, monkeypatch, origin):
    monkeypatch.setenv("PARTNER_CORS_ORIGINS", "https://client.example, http://localhost:3000")
    client = api.create_app().test_client()
    for request_origin, allowed in [("https://client.example", True), (origin, False)]:
        headers = {
            "Origin": request_origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        }
        preflight = client.options("/recommend", headers=headers)
        response = client.post("/recommend", json={"username": "x"}, headers={"Origin": request_origin})
        for result in (preflight, response):
            assert result.headers.get("Access-Control-Allow-Origin") == (request_origin if allowed else None)
            assert "Access-Control-Allow-Credentials" not in result.headers
        if allowed:
            assert "POST" in preflight.headers["Access-Control-Allow-Methods"]
            assert "content-type" in preflight.headers["Access-Control-Allow-Headers"].lower()


@pytest.mark.parametrize("entry", ["*", "https://*.test", "https://example.test/path"])
def test_invalid_cors_configuration_fails_startup(data_dir, monkeypatch, entry):
    monkeypatch.setenv("PARTNER_CORS_ORIGINS", entry)
    with pytest.raises(ValueError, match="PARTNER_CORS_ORIGINS"):
        api.create_app()

@pytest.mark.parametrize("path,payload", [
    ("/api/recommend", {"username": "tester"}),
    ("/api/semantic-bio-recommend", {"bio": "python"}),
])
@pytest.mark.parametrize("top_k", [True, False, None, "5", 1.0, 0, -1, 51, []])
def test_rich_top_k_is_strict(client, path, payload, top_k):
    assert_error(client.post(path, json={**payload, "top_k": top_k}), 400, "invalid_request")


def test_metadata_and_health_are_accessible_to_configured_frontend(data_dir, monkeypatch):
    origin = "http://localhost:3000"
    monkeypatch.setenv("PARTNER_CORS_ORIGINS", origin)
    client = api.create_app().test_client()
    for path in ("/api/health", "/api/metadata"):
        response = client.get(path, headers={"Origin": origin})
        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == origin
        assert response.json["total_users"] == 4
    assert client.get("/api/health").json["sbert_model_ready"] is False
    assert client.get("/api/metadata").json["clustering_methods"]["dbscan"]["domains"] == ["dbscan"]


def test_semantic_model_dimension_mismatch_uses_fallback(client, monkeypatch):
    import sentence_transformers

    class Model:
        def encode(self, *_args, **_kwargs):
            return np.ones((1, 3))

    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", lambda *args, **kwargs: Model())
    response = client.post("/api/semantic-bio-recommend", json={"bio": "python", "top_k": 1})
    assert response.status_code == 200
    assert response.json["engine"] == "TF-IDF Fallback"
    assert response.json["count"] == 1


@pytest.fixture(scope="module")
def real_client():
    return api.app.test_client()


def test_health_endpoint(real_client):
    """GET /api/health returns 200 with runtime indicators."""
    res = real_client.get("/api/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "healthy"
    assert data["total_users"] == 3890
    assert data["bio_embeddings_loaded"] is True
    assert "engine_mode" in data


def test_metadata_endpoint(real_client):
    """GET /api/metadata returns 200 with verified domain tags."""
    res = real_client.get("/api/metadata")
    assert res.status_code == 200
    data = res.get_json()
    assert "clustering_methods" in data
    assert "sample_usernames" in data
    assert len(data["sample_usernames"]) > 0


def test_legacy_recommend_endpoint(real_client):
    """POST /recommend maintains backward-compatible schema (list of dicts)."""
    payload = {
        "username": "abhay",
        "method": "hdbscan",
        "domain": "DevOps & Scripting",
    }
    res = real_client.post("/recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    for key in ["Username", "Location", "Profile_URL", "Domain_Tag", "hybrid_score"]:
        assert key in first


def test_api_recommend_endpoint(real_client):
    """POST /api/recommend returns rich structured object."""
    payload = {
        "username": "abhay",
        "method": "hdbscan",
        "top_k": 3,
    }
    res = real_client.post("/api/recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert "query_user" in data
    assert "recommendations" in data
    assert data["count"] == 3


def test_invalid_method_returns_400(real_client):
    """POST /recommend with invalid method returns 400 Bad Request."""
    payload = {
        "username": "abhay",
        "method": "invalid_method_xyz",
    }
    res = real_client.post("/recommend", json=payload)
    assert res.status_code == 400
    assert "error" in res.get_json()


def test_special_characters_in_location_safe(real_client):
    """Literal substring matching handles regex metacharacters without crashing."""
    payload = {
        "username": "abhay",
        "location": "[San Francisco*+(CA?",
    }
    res = real_client.post("/recommend", json=payload)
    assert res.status_code == 200
    assert isinstance(res.get_json(), list)


def test_legacy_semantic_bio_endpoint(real_client):
    """POST /semantic-bio-recommend maintains backward-compatible schema (list of dicts)."""
    payload = {"bio": "machine learning data science python"}
    res = real_client.post("/semantic-bio-recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert isinstance(data, list)
    assert len(data) > 0
    first = data[0]
    for key in ["Username", "Location", "Profile_URL", "similarity"]:
        assert key in first


def test_api_semantic_bio_endpoint(real_client):
    """POST /api/semantic-bio-recommend returns structured search object."""
    payload = {"bio": "machine learning data science python", "top_k": 3}
    res = real_client.post("/api/semantic-bio-recommend", json=payload)
    assert res.status_code == 200
    data = res.get_json()
    assert "engine" in data
    assert "recommendations" in data
    assert data["count"] == 3

    assert set(data) == {"engine", "count", "recommendations"}
    assert set(data["recommendations"][0]) == {"Username", "Location", "Profile_URL", "similarity"}
