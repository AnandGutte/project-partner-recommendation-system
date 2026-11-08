"""
Flask Application for GitHub Project Partner Recommendation System.

Provides endpoints for:
- Health and runtime metadata inspection (/api/health, /api/metadata)
- Dynamic hybrid recommendations with domain/location filtering (/recommend, /api/recommend)
- Free-text semantic bio recommendations (/semantic-bio-recommend, /api/semantic-bio-recommend)

Preserves original endpoint schemas for 100% backward compatibility.
Supports running from both repository root and backend directory.
"""

import sys
from pathlib import Path
from typing import Any, Dict, List
from flask import Flask, jsonify, request
from flask_cors import CORS

# Ensure import paths resolve whether invoked from root or backend directory
CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

try:
    from backend.engine import RecommendationEngine
except ImportError:
    from engine import RecommendationEngine

app = Flask(__name__)
CORS(app)

# Initialize engine with robust path resolution
DATA_DIR = CURRENT_DIR / "data"
engine = RecommendationEngine(data_dir=DATA_DIR)


@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint providing runtime and dataset status."""
    meta = engine.get_metadata()
    return jsonify({
        "status": "healthy",
        "total_users": meta["total_users"],
        "clustering_methods": list(meta["clustering_methods"].keys()),
        "bio_embeddings_loaded": engine.bio_embeddings is not None,
        "sbert_model_ready": engine.sbert_available,
        "engine_mode": "hybrid_vector_scoring",
    })


@app.route("/api/metadata", methods=["GET"])
def metadata():
    """Returns dataset metadata, verified domain tags, and sample users."""
    return jsonify(engine.get_metadata())


@app.route("/recommend", methods=["POST"])
def legacy_recommend():
    """
    Legacy recommendation endpoint.
    Maintains exact original response schema: list of partner dictionaries.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}

    username = str(data.get("username", "")).strip()
    location = data.get("location")
    domain = data.get("domain")
    method = data.get("method", "hdbscan")

    # Map "All" or empty domain to None
    clean_domain = None if not domain or domain == "All" else str(domain).strip()
    clean_location = None if not location or location == "All" else str(location).strip()

    try:
        result = engine.recommend_hybrid(
            username=username,
            location=clean_location,
            domain=clean_domain,
            method=method,
            top_k=5,
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # Return list of records matching original schema
    legacy_records = []
    for r in result["recommendations"]:
        legacy_records.append({
            "Username": r["Username"],
            "Location": r["Location"],
            "Profile_URL": r["Profile_URL"],
            "Domain_Tag": r["Domain_Tag"],
            "hybrid_score": r["hybrid_score"],
            "explanation": r["explanation"],
            "Languages": r.get("Languages", []),
        })

    return jsonify(legacy_records)


@app.route("/api/recommend", methods=["POST"])
def api_recommend():
    """
    Modernized recommendation endpoint returning rich structured metadata.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}

    username = str(data.get("username", "")).strip()
    location = data.get("location")
    domain = data.get("domain")
    method = data.get("method", "hdbscan")

    try:
        top_k = int(data.get("top_k", 5))
    except (ValueError, TypeError):
        top_k = 5

    clean_domain = None if not domain or domain == "All" else str(domain).strip()
    clean_location = None if not location or location == "All" else str(location).strip()

    try:
        result = engine.recommend_hybrid(
            username=username,
            location=clean_location,
            domain=clean_domain,
            method=method,
            top_k=top_k,
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    return jsonify(result)


@app.route("/semantic-bio-recommend", methods=["POST"])
def legacy_semantic_bio_recommend():
    """
    Legacy bio semantic recommendation endpoint.
    Maintains exact original response schema: list of partner dictionaries.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}

    input_bio = str(data.get("bio", "")).strip()

    result = engine.recommend_by_bio(bio_query=input_bio, top_k=5)

    legacy_records = []
    for r in result["recommendations"]:
        legacy_records.append({
            "Username": r["Username"],
            "Bio": r["Bio"],
            "Location": r["Location"],
            "Profile_URL": r["Profile_URL"],
            "similarity": r["similarity"],
        })

    return jsonify(legacy_records)


@app.route("/api/semantic-bio-recommend", methods=["POST"])
def api_semantic_bio_recommend():
    """
    Modernized bio semantic endpoint returning rich structured metadata.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}

    input_bio = str(data.get("bio", "")).strip()

    try:
        top_k = int(data.get("top_k", 5))
    except (ValueError, TypeError):
        top_k = 5

    result = engine.recommend_by_bio(bio_query=input_bio, top_k=top_k)
    return jsonify(result)


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    import os
    debug_mode = os.getenv("FLASK_DEBUG", "0").lower() in ("1", "true")
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, debug=debug_mode)
