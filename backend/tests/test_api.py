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
            "Bio": ["private fixture"] * 4,
            "Name": ["fixture name"] * 4,
            "Latitude": [0] * 4,
            "hybrid_score": [1.0, 0.9, 0.7, 0.6],
        }
    )
    profiles.to_csv(tmp_path / "final_hybrid_with_semantic.csv", index=False)
    profiles.to_csv(tmp_path / "with_bio_embeddings.csv", index=False)
    for method in api.METHODS:
        pd.DataFrame(
            {"Username": profiles["Username"], "Domain_Tag": [method, method, method, None]}
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
    assert response.json[0] == {
        "Username": "alpha",
        "Location": "Test [City]",
        "Profile_URL": "https://github.com/alpha",
        "Domain_Tag": "dbscan",
        "hybrid_score": 0.9,
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


@pytest.mark.parametrize("payload", [{}, {"bio": 1}, {"bio": None}, {"bio": "\t "}, {"bio": "a" * 2001}, {"bio": "\ud800"}])
def test_invalid_bio_fields(client, payload):
    assert_error(client.post("/semantic-bio-recommend", json=payload), 400, "invalid_request")


@pytest.mark.parametrize("path", ["/recommend", "/semantic-bio-recommend"])
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


def test_missing_partner_artifact_isolated_by_method(data_dir, caplog):
    (data_dir / "hdbscan_optuna_clustered_users_with_domain.csv").unlink()
    client = api.create_app().test_client()
    assert_error(client.post("/recommend", json={"username": "x"}), 503, "recommendation_unavailable")
    assert client.post("/recommend", json={"username": "x", "method": "dbscan"}).status_code == 200
    assert "hdbscan_optuna_clustered_users_with_domain.csv" in caplog.text
    assert str(data_dir) not in caplog.text


def test_missing_score_artifact(data_dir):
    (data_dir / "final_hybrid_with_semantic.csv").unlink()
    client = api.create_app().test_client()
    assert_error(client.post("/recommend", json={"username": "x"}), 503, "recommendation_unavailable")


@pytest.mark.parametrize("failure", ["missing", "wrong_rows", "invalid_dtype", "wrong_format"])
def test_unavailable_bio_artifacts_do_not_load_model(data_dir, monkeypatch, failure):
    file = data_dir / "bio_embeddings.npy"
    if failure == "missing":
        file.unlink()
    elif failure == "wrong_rows":
        np.save(file, np.ones((3, 2), dtype=np.float32))
    elif failure == "invalid_dtype":
        np.save(file, np.array([["x"]] * 4, dtype=object))
    else:
        file.write_text("invalid")
    monkeypatch.setattr(api, "load_model", lambda _: pytest.fail("Model must not load"))
    client = api.create_app().test_client()
    assert_error(client.post("/semantic-bio-recommend", json={"bio": "python"}), 503, "recommendation_unavailable")
    assert client.post("/recommend", json={"username": "x"}).status_code == 200


def test_missing_model_is_sanitized_and_attempted_once(data_dir, monkeypatch, caplog):
    import sentence_transformers

    model_path = data_dir / "missing-model"
    monkeypatch.setenv("PARTNER_MODEL_PATH", str(model_path))
    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", lambda *args, **kwargs: pytest.fail("Missing directory"))
    client = api.create_app().test_client()
    for _ in range(2):
        response = client.post("/semantic-bio-recommend", json={"bio": "private query"})
        assert_error(response, 503, "recommendation_unavailable")
    assert caplog.text.count("Bio model unavailable") == 1
    assert str(model_path) not in caplog.text
    assert "private query" not in caplog.text


def test_model_load_uses_local_trusted_settings(data_dir, monkeypatch):
    import sentence_transformers

    def local_model(path, **kwargs):
        assert path == str(data_dir)
        assert kwargs == {"local_files_only": True, "trust_remote_code": False}
        return "fixture"

    monkeypatch.setattr(sentence_transformers, "SentenceTransformer", local_model)
    assert api.load_model(str(data_dir)) == "fixture"


def test_valid_bio_response_preserves_ranking_and_excludes_raw_profile_data(data_dir, monkeypatch):
    import torch

    class Model:
        def encode(self, texts, *, convert_to_tensor):
            assert texts == ["python"]
            assert convert_to_tensor
            return torch.tensor([[1.0, 0.0]])

    monkeypatch.setattr(api, "load_model", lambda _: Model())
    response = api.create_app().test_client().post("/semantic-bio-recommend", json={"bio": " python "})
    assert response.status_code == 200
    assert [item["Username"] for item in response.json] == ["alpha", "beta", "gamma"]
    assert set(response.json[0]) == {"Username", "Location", "Profile_URL", "similarity"}
    assert response.json[0]["similarity"] == pytest.approx(0.9487)
    assert response.json[-1]["Profile_URL"] is None


def test_inference_exception_does_not_leak(data_dir, monkeypatch, caplog):
    class Model:
        def encode(self, *_args, **_kwargs):
            raise RuntimeError("private input and internal path")

    monkeypatch.setattr(api, "load_model", lambda _: Model())
    response = api.create_app().test_client().post("/semantic-bio-recommend", json={"bio": "test"})
    assert_error(response, 500, "internal_error")
    assert "private input" not in response.get_data(as_text=True)
    assert "private input" not in caplog.text
    assert "RuntimeError" in caplog.text


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

def test_model_and_artifact_dimension_mismatch(data_dir, monkeypatch):
    import torch

    class Model:
        def encode(self, *_args, **_kwargs):
            return torch.ones((1, 3))

    monkeypatch.setattr(api, "load_model", lambda _: Model())
    response = api.create_app().test_client().post("/semantic-bio-recommend", json={"bio": "test"})
    assert_error(response, 503, "recommendation_unavailable")
