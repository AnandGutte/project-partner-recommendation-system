"""Flask API for the CS 5661 partner recommendation project."""

import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import BadRequest, HTTPException, UnsupportedMediaType

if __package__:
    from .engine import BioSearchUnavailable, RecommendationEngine
else:
    from engine import BioSearchUnavailable, RecommendationEngine

BASE_DIR = Path(__file__).resolve().parent
METHODS = ("dbscan", "hdbscan")
PARTNER_FIELDS = ("Username", "Location", "Profile_URL", "Domain_Tag", "hybrid_score", "Languages", "explanation")
SCORE_FIELDS = ("content_score", "collab_score", "bio_score")
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


def read_top_k(payload):
    value = payload.get("top_k", 5)
    if type(value) is not int or not 1 <= value <= 50:
        raise APIError(400, "invalid_request", "top_k must be an integer from 1 to 50.")
    return value


def public_records(result, fields):
    records = []
    for candidate in result["recommendations"]:
        row = {field: candidate[field] for field in fields}
        url = row["Profile_URL"]
        row["Profile_URL"] = url if isinstance(url, str) and PROFILE_URL.fullmatch(url) else None
        for field in ("Location", "Domain_Tag"):
            if row.get(field) in ("nan", "<NA>", ""):
                row[field] = None
        records.append(row)
    return records


def create_app():
    app = Flask(__name__)
    app.config.update(DEBUG=False, MAX_CONTENT_LENGTH=BODY_LIMIT)
    origins = cors_origins(os.environ.get("PARTNER_CORS_ORIGINS", ""))
    if origins:
        CORS(
            app,
            resources={
                r"^/api/(?:health|metadata)$": {"methods": ["GET"]},
                r"^/(?:api/)?(?:recommend|semantic-bio-recommend)$": {"methods": ["POST"]},
            },
            origins=origins,
            allow_headers=["Content-Type"],
            supports_credentials=False,
        )

    data_dir = Path(os.environ.get("PARTNER_DATA_DIR") or BASE_DIR / "data")
    engine = None
    try:
        engine = RecommendationEngine(data_dir=data_dir, model_path=os.environ.get("PARTNER_MODEL_PATH"))
    except (OSError, ValueError, KeyError) as error:
        app.logger.error(
            "Recommendation data unavailable (%s). Check PARTNER_DATA_DIR and artifact schemas.",
            type(error).__name__,
        )

    def require_engine():
        if engine is None:
            raise APIError(503, "recommendation_unavailable", "Recommendation data is unavailable.")
        return engine

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

    @app.get("/api/health")
    def health():
        service = require_engine()
        meta = service.get_metadata()
        return jsonify(
            status="healthy",
            total_users=meta["total_users"],
            clustering_methods=list(meta["clustering_methods"]),
            bio_embeddings_loaded=service.bio_embeddings is not None,
            sbert_model_ready=service.sbert_available,
            engine_mode="hybrid_vector_scoring",
        )

    @app.get("/api/metadata")
    def metadata():
        meta = require_engine().get_metadata()
        return jsonify(
            total_users=meta["total_users"],
            clustering_methods={
                method: {field: meta["clustering_methods"][method][field] for field in ("label", "domains")}
                for method in METHODS
            },
            sample_usernames=meta["sample_usernames"],
        )

    def partner_response(rich):
        payload = read_payload()
        username = read_text(payload, "username", 39, required=True)
        location = read_text(payload, "location", 120)
        domain = read_text(payload, "domain", 120)
        method = read_text(payload, "method", 16, default="hdbscan").lower()
        if method not in METHODS:
            raise APIError(400, "invalid_request", "method must be dbscan or hdbscan.")
        top_k = read_top_k(payload) if rich else 5
        result = require_engine().recommend_hybrid(
            username=username,
            location=None if location == "All" else location,
            domain=domain,
            method=method,
            top_k=top_k,
        )
        recommendations = public_records(result, PARTNER_FIELDS + SCORE_FIELDS if rich else PARTNER_FIELDS)
        if not rich:
            return jsonify(recommendations)
        return jsonify(
            query_user=result["query_user"],
            is_known_user=result["is_known_user"],
            method=result["method"],
            count=len(recommendations),
            recommendations=recommendations,
        )

    @app.post("/recommend")
    def recommend():
        return partner_response(rich=False)

    @app.post("/api/recommend")
    def api_recommend():
        return partner_response(rich=True)

    def bio_response(rich):
        payload = read_payload()
        bio = read_text(payload, "bio", 1000, required=True)
        top_k = read_top_k(payload) if rich else 5
        try:
            result = require_engine().recommend_by_bio(bio_query=bio, top_k=top_k)
        except BioSearchUnavailable:
            raise APIError(503, "recommendation_unavailable", "Bio recommendations are unavailable.") from None
        recommendations = public_records(result, BIO_FIELDS)
        if not rich:
            return jsonify(recommendations)
        return jsonify(engine=result["engine"], count=len(recommendations), recommendations=recommendations)

    @app.post("/semantic-bio-recommend")
    def semantic_bio_recommend():
        return bio_response(rich=False)

    @app.post("/api/semantic-bio-recommend")
    def api_semantic_bio_recommend():
        return bio_response(rich=True)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")), debug=False)
