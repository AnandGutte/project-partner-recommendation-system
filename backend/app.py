"""Flask API for the CS 5661 partner recommendation project."""

import os
import re
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, HTTPException, UnsupportedMediaType

BASE_DIR = Path(__file__).resolve().parent
METHODS = ("dbscan", "hdbscan")
PARTNER_FIELDS = ["Username", "Location", "Profile_URL", "Domain_Tag", "hybrid_score"]
BIO_FIELDS = ["Username", "Location", "Profile_URL", "similarity"]
PROFILE_URL = re.compile(r"https://github\.com/[A-Za-z0-9-]+/?")
BODY_LIMIT = 16 * 1024


class APIError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def read_payload():
    if not request.is_json:
        raise UnsupportedMediaType()
    try:
        payload = request.get_json()
    except (BadRequest, RecursionError):
        raise APIError(400, "invalid_json", "Request body must be valid JSON.") from None
    if not isinstance(payload, dict):
        raise APIError(400, "invalid_request", "Request body must be a JSON object.")
    return payload


def read_text(payload, field, limit, *, required=False, default=""):
    value = payload.get(field, default)
    if not isinstance(value, str):
        raise APIError(400, "invalid_request", f"{field} must be a string.")
    if len(value) > limit:
        raise APIError(400, "invalid_request", f"{field} must be at most {limit} characters.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise APIError(400, "invalid_request", f"{field} must be valid Unicode text.") from None
    value = value.strip()
    if required and not value:
        raise APIError(400, "invalid_request", f"{field} is required.")
    return value


def cors_origins(raw_origins):
    origins = []
    for entry in raw_origins.split(","):
        origin = entry.strip()
        if not origin:
            continue
        try:
            parts = urlsplit(origin)
            port = parts.port
        except ValueError:
            raise ValueError("Invalid PARTNER_CORS_ORIGINS entry.") from None
        if (
            parts.scheme not in ("http", "https")
            or not parts.hostname
            or parts.username is not None
            or parts.path
            or parts.query
            or parts.fragment
            or "*" in origin
            or any(character.isspace() for character in origin)
            or origin != f"{parts.scheme}://{parts.netloc}"
            or (port is None and parts.netloc.endswith(":"))
        ):
            raise ValueError("PARTNER_CORS_ORIGINS must contain exact HTTP(S) origins.")
        origins.append(re.compile(r"\A" + re.escape(origin) + r"\Z"))
    return origins


def load_artifact(app, path, loader):
    try:
        return loader(path)
    except (OSError, ValueError, EOFError, KeyError) as error:
        app.logger.error(
            "Recommendation artifact %s unavailable (%s). Check PARTNER_DATA_DIR and artifact format.",
            path.name,
            type(error).__name__,
        )
        return None


def read_partner_scores(path):
    fields = ["Username", "Location", "Profile_URL"]
    profiles = pd.read_csv(path, usecols=[*fields, "hybrid_score"], dtype=dict.fromkeys(fields, "string"))
    profiles["hybrid_score"] = pd.to_numeric(profiles["hybrid_score"])
    if not np.isfinite(profiles["hybrid_score"]).all():
        raise ValueError("Invalid partner scores.")
    return profiles


def read_embeddings(path):
    embeddings = np.load(path, allow_pickle=False)
    if (
        not isinstance(embeddings, np.ndarray)
        or embeddings.ndim != 2
        or embeddings.shape[1] == 0
        or embeddings.dtype not in (np.dtype("float32"), np.dtype("float64"))
        or not np.isfinite(embeddings).all()
    ):
        if isinstance(embeddings, np.lib.npyio.NpzFile):
            embeddings.close()
        raise ValueError("Invalid bio embedding matrix.")
    return embeddings.astype(np.float32, copy=False)


def load_model(model_path):
    from sentence_transformers import SentenceTransformer

    if model_path and not Path(model_path).is_dir():
        raise FileNotFoundError("Configured model directory does not exist.")
    return SentenceTransformer(
        model_path or "sentence-transformers/all-MiniLM-L6-v2",
        local_files_only=True,
        trust_remote_code=False,
    )


def records(frame, fields):
    result = frame[fields].astype(object)
    result = result.where(result.notna(), None)
    result["Profile_URL"] = result["Profile_URL"].map(
        lambda value: value if isinstance(value, str) and PROFILE_URL.fullmatch(value) else None
    )
    return result.to_dict(orient="records")


def create_app():
    app = Flask(__name__)
    app.config.update(DEBUG=False, MAX_CONTENT_LENGTH=BODY_LIMIT)
    origins = cors_origins(os.environ.get("PARTNER_CORS_ORIGINS", ""))
    if origins:
        CORS(
            app,
            resources={r"^/(?:recommend|semantic-bio-recommend)$": {"origins": origins}},
            methods=["POST"],
            allow_headers=["Content-Type"],
            supports_credentials=False,
        )

    data_dir = Path(os.environ.get("PARTNER_DATA_DIR") or BASE_DIR / "data")
    model_path = os.environ.get("PARTNER_MODEL_PATH")
    hybrid = load_artifact(app, data_dir / "final_hybrid_with_semantic.csv", read_partner_scores)
    partner_data = {}
    if hybrid is not None:
        for method in METHODS:
            clusters = load_artifact(
                app,
                data_dir / f"{method}_optuna_clustered_users_with_domain.csv",
                lambda path: pd.read_csv(path, usecols=["Username", "Domain_Tag"], dtype="string"),
            )
            if clusters is not None:
                partner_data[method] = hybrid.merge(clusters, on="Username", how="left")

    profiles = load_artifact(
        app,
        data_dir / "with_bio_embeddings.csv",
        lambda path: pd.read_csv(path, usecols=["Username", "Location", "Profile_URL"], dtype="string"),
    )
    embeddings = load_artifact(app, data_dir / "bio_embeddings.npy", read_embeddings)
    if profiles is not None and embeddings is not None and len(profiles) != len(embeddings):
        app.logger.error("Bio profile and embedding row counts differ. Check PARTNER_DATA_DIR.")
        embeddings = None

    model = None
    model_attempted = False
    model_lock = Lock()

    @app.errorhandler(APIError)
    def handle_api_error(error):
        return jsonify(error=str(error), code=error.code), error.status

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        messages = {
            400: ("invalid_request", "Invalid request."),
            404: ("not_found", "Endpoint not found."),
            405: ("method_not_allowed", "Method not allowed."),
            413: ("payload_too_large", "Request body is too large."),
            415: ("unsupported_media_type", "Content-Type must be application/json."),
        }
        code, message = messages.get(error.code, ("http_error", "Request could not be completed."))
        response = error.get_response()
        response.set_data(app.json.dumps({"error": message, "code": code}))
        response.mimetype = "application/json"
        return response

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        app.logger.error("Recommendation request failed (%s).", type(error).__name__)
        return jsonify(error="Internal server error.", code="internal_error"), 500

    @app.after_request
    def prevent_caching(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.post("/recommend")
    def recommend():
        payload = read_payload()
        username = read_text(payload, "username", 39, required=True)
        location = read_text(payload, "location", 120)
        domain = read_text(payload, "domain", 120)
        method = read_text(payload, "method", 16, default="hdbscan")
        if method not in METHODS:
            raise APIError(400, "invalid_request", "method must be dbscan or hdbscan.")
        candidates = partner_data.get(method)
        if candidates is None:
            raise APIError(503, "recommendation_unavailable", "Partner recommendations are unavailable.")

        results = candidates[candidates["Username"].str.casefold() != username.casefold()]
        if location:
            results = results[results["Location"].str.contains(location, case=False, na=False, regex=False)]
        if domain:
            results = results[results["Domain_Tag"] == domain]
        results = results.drop_duplicates(subset="Username")
        results = results.sort_values("hybrid_score", ascending=False).head(5)
        return jsonify(records(results, PARTNER_FIELDS))

    @app.post("/semantic-bio-recommend")
    def semantic_bio_recommend():
        nonlocal model, model_attempted
        bio = read_text(read_payload(), "bio", 2000, required=True)
        if profiles is None or embeddings is None:
            raise APIError(503, "recommendation_unavailable", "Bio recommendations are unavailable.")
        if profiles.empty:
            return jsonify([])

        with model_lock:
            if not model_attempted:
                try:
                    model = load_model(model_path)
                except Exception as error:
                    app.logger.error(
                        "Bio model unavailable (%s). Provision the local model and restart the worker.",
                        type(error).__name__,
                    )
                model_attempted = True
        if model is None:
            raise APIError(503, "recommendation_unavailable", "Bio recommendations are unavailable.")

        import torch
        from sentence_transformers import util

        query = model.encode([bio], convert_to_tensor=True).detach().cpu().float()
        if query.shape != (1, embeddings.shape[1]):
            app.logger.error("Bio model dimension differs from the embedding artifact.")
            raise APIError(503, "recommendation_unavailable", "Bio recommendations are unavailable.")
        scores = util.pytorch_cos_sim(query, torch.from_numpy(embeddings))[0]
        # Keep the legacy ranking slice for compatibility.
        top = scores.argsort(descending=True)[1:6]
        results = profiles.iloc[top.numpy()].copy()
        results["similarity"] = scores[top].numpy().round(4)
        return jsonify(records(results, BIO_FIELDS))

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
