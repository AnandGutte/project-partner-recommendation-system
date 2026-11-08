# Backend operation and API security

This backend retains the CS 5661 recommendation project and its original team attribution in the root README.

## Run locally

From the repository root, install the existing Python runtime dependencies, then start Flask. The development server binds only to loopback and runs with debug disabled.

```powershell
python -m pip install -r requirements.txt
$env:PARTNER_CORS_ORIGINS = 'http://localhost:3000'
python backend/app.py
```

Set the origin to the exact React browser origin, including the scheme and port. Add `http://127.0.0.1:3000` to the comma-separated list if you use that URL too. By default, cross-origin browser access is disabled. Same-origin requests work without configuration. For production, use a production WSGI server with the factory `backend.app:create_app()`. Set exact origins only if the frontend runs on a separate origin.

| Environment variable | Behavior |
|---|---|
| `PARTNER_CORS_ORIGINS` | Comma-separated exact HTTP(S) origins. Defaults to empty. Wildcards and origin paths fail startup. |
| `PARTNER_DATA_DIR` | Optional operator-controlled artifact directory. Defaults to `backend/data` resolved from the source file. Prefer an absolute path when overriding. |
| `PARTNER_MODEL_PATH` | Optional operator-controlled local SentenceTransformer directory. If unset, the worker checks its local cache for `sentence-transformers/all-MiniLM-L6-v2`. Provision a trusted snapshot compatible with the embedding artifact. |

The backend loads fixed artifact filenames at worker initialization. An absent or malformed artifact is logged by filename and exception type. The affected route or clustering method returns 503 while available methods continue to serve. Bio search loads the model on its first valid request and never downloads model files during serving. A failed model load returns 503 until the worker restarts. Provision the model and restart after correcting an artifact or configuration problem. The model and data paths are deployment configuration and never come from request fields.

## React and API contracts

Both existing POST routes return arrays on success. No-match searches return `[]`. Send `application/json` and a JSON object. Unknown properties are ignored. Text fields are trimmed after length validation.

| Route | Inputs | Success fields |
|---|---|---|
| `/recommend` | Required nonblank `username` (39 characters max). Optional string `location` and `domain` (120 each). Optional `method` of `dbscan` or `hdbscan`, default `hdbscan`. Use an empty string or omit unused filters. | `Username`, `Location`, `Profile_URL`, `Domain_Tag`, `hybrid_score`. Self-exclusion ignores username case. Location is a literal case-insensitive substring. |
| `/semantic-bio-recommend` | Required nonblank `bio` (2,000 characters max). | `Username`, `Location`, `Profile_URL`, `similarity`. Raw candidate `Bio` was removed. The checked-in React client does not use it. |

Missing optional response values and invalid profile links are JSON null. The existing React client already guards these optional display fields. Keep its current generic error handling or use the API's safe message. Errors have a stable object shape with a human-readable `error` and machine-readable `code`. The API uses 400 for malformed or invalid JSON, 413 for bodies over 16 KiB, 415 for non-JSON media types, 503 for unavailable resources, and 500 for unexpected failures. CORS is a browser control. The API still has no authentication, rate limiter or service-wide concurrency policy.

## Privacy and follow-up

The Git snapshot contains identifiable GitHub handles and URLs, display names, bios, repository histories or lists, self-reported locations and geocoded coordinates. Public source metadata can still identify people when aggregated. The API only loads the columns it needs and still publishes usernames, links and location fields. Query inputs and exception messages are omitted from application logs, and API responses send `Cache-Control: no-store`. Configure reverse-proxy and browser observability separately to avoid collecting request bodies.

Before public hosting, decide the approved audience and data-use scope. Prefer a minimized or synthetic public demo dataset, document provenance and retention, and provide a deletion procedure covering derivatives and embeddings. Review already-tracked files and repository history separately with the owner. Apply rate/concurrency limits and request timeouts at ingress and assess resolved Python dependencies and the pinned model artifact. There is no vector-to-profile identity manifest. Row-count and dimension validation cannot detect reordering, so provision matching artifacts from a trusted pipeline.

## Modernized engine integration

Keep payload validation, exact origin rules, safe error handling and explicit response allowlists at the HTTP boundary when swapping engines. Reuse these controls for new routes and validate any new `top_k` field with a small positive upper bound. Preserve the legacy list envelopes, allowed clustering methods and null handling. Exclude raw bios, names, coordinates and unnecessary profile fields from rich responses. Apply literal location filtering in the engine as well. Treat optional model readiness separately from dataset readiness, and keep model downloads outside serving. The baseline's recommendation weights, duplicate handling and semantic ranking slice were retained for compatibility. Ranking changes and stronger identity alignment should be evaluated separately.

## Tests

```powershell
python -m pip install -r backend/requirements-dev.txt
python -m pytest -q -p no:cacheprovider backend/tests
```

Tests use temporary synthetic CSV/NPY fixtures, a stub encoder for the semantic success path and Flask's test client. They require neither credentials nor network access. Real model inference and deployment load limits require separate integration checks.

References: [Flask configuration](https://flask.palletsprojects.com/en/stable/config/) · [Flask error handling](https://flask.palletsprojects.com/en/stable/errorhandling/) · [SentenceTransformer loading options](https://sbert.net/docs/package_reference/sentence_transformer/model.html)

Implementation verification used the existing Python 3.10 environment with offline model flags. The pytest command above passed 56 tests with zero failures. Both Python sources compiled, and test-client requests with the checked-in DBSCAN and HDBSCAN artifacts each returned HTTP 200 with five results. Real Sentence-BERT inference and production throughput were outside these checks.
