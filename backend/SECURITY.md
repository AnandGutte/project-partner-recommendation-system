# Backend operation and API security

This backend retains the CS 5661 recommendation project and its original team attribution in the root README.

## Run locally

From the repository root, install the existing Python runtime dependencies, then start Flask. The development server binds only to loopback and runs with debug disabled.

```powershell
python -m pip install -r requirements.txt
python backend/app.py
```

The local Vite dev proxy uses same-origin browser requests and needs no CORS allowlist. For direct cross-origin calls, set `PARTNER_CORS_ORIGINS` to the exact React browser origin, including scheme and port. By default, cross-origin browser access is disabled. For production, use a production WSGI server with the factory `backend.app:create_app()`. Set exact origins only if the frontend runs on a separate origin.

| Environment variable | Behavior |
|---|---|
| `PARTNER_CORS_ORIGINS` | Comma-separated exact HTTP(S) origins. Defaults to empty. Wildcards and origin paths fail startup. |
| `PARTNER_DATA_DIR` | Optional operator-controlled artifact directory. Defaults to `backend/data` resolved from the source file. Prefer an absolute path when overriding. |
| `PARTNER_MODEL_PATH` | Optional operator-controlled local SentenceTransformer directory. If unset, the worker checks its local cache for `sentence-transformers/all-MiniLM-L6-v2`. Provision a trusted snapshot compatible with the embedding artifact. |

The backend initializes the engine from fixed artifact filenames. If required artifacts cannot initialize, the API returns 503 and logs the failure type. A missing cluster file falls back to the engine's General domain. Bio search attempts to load a local model once per worker, only when usable embeddings are present. Missing embeddings, a missing model or failed inference uses TF-IDF. If neither search path can operate, the bio route returns 503. Provision corrected artifacts and restart the worker. Request fields cannot select paths.

The environment example is a reference for values to export. `HOST` and `PORT` configure direct script execution. `GET /api/health` reports core engine health, embedding availability and whether a local model was loaded. A successful health response can precede lazy model initialization.

## React and API contracts

Legacy POST routes return arrays on success. Their `/api` counterparts return a structured object with `count` and `recommendations`, plus query identity and method for partner search or the ranking engine name for bio search. No-match searches return `[]`. Send `application/json` and a JSON object. Unknown properties are ignored. Text fields are trimmed after length validation.

| Route | Inputs | Success fields |
|---|---|---|
| `/recommend` | Required nonblank `username` (39 characters max). Optional string `location` and `domain` (120 each). Optional `method` of `dbscan` or `hdbscan`, default `hdbscan`. Use an empty string or omit unused filters. | `Username`, `Location`, `Profile_URL`, `Domain_Tag`, `hybrid_score`, `Languages`, `explanation`. The rich route adds the three component scores. Self-exclusion ignores username case. Location is a literal case-insensitive substring. |
| `/semantic-bio-recommend` | Required nonblank `bio` (1,000 characters max). | `Username`, `Location`, `Profile_URL`, `similarity`. Raw candidate `Bio`, display names and echoed bio queries are excluded. React renders the result card without a candidate bio quote. |

Rich routes accept an optional integer `top_k` from 1 to 50, default 5. Legacy routes use five results. `GET /api/metadata` returns clustering methods and domains, total users and the existing sample usernames.

Missing optional response values and invalid profile links are JSON null. The existing React client already guards these optional display fields. Keep its current generic error handling or use the API's safe message. Errors have a stable object shape with a human-readable `error` and machine-readable `code`. The API uses 400 for malformed or invalid JSON, 413 for bodies over 16 KiB, 415 for non-JSON media types, 503 for unavailable resources, and 500 for unexpected failures. CORS is a browser control. The API still has no authentication. Recommendation routes have configurable rate and concurrency admission. A single-host multi-worker deployment needs the shared SQLite configuration in the [security assessment](../docs/security-assessment.md#phase-7b-remediation-and-deployment-configuration). Per-client limits, cross-replica enforcement and execution deadlines belong at ingress and the WSGI server.

## Privacy and follow-up

The Git snapshot contains identifiable GitHub handles and URLs, display names, bios, repository histories or lists, self-reported locations and geocoded coordinates. Public source metadata can still identify people when aggregated. The API only loads the columns it needs and still publishes usernames, links and location fields. Query inputs and exception messages are omitted from application logs, and API responses send `Cache-Control: no-store`. Configure reverse-proxy and browser observability separately to avoid collecting request bodies.

Before public hosting, decide the approved audience and data-use scope. Prefer a minimized or synthetic public demo dataset, document provenance and retention, and provide a deletion procedure covering derivatives and embeddings. Review already-tracked files and repository history separately with the owner. Apply rate/concurrency limits and request timeouts at ingress and assess resolved Python dependencies and the pinned model artifact. There is no vector-to-profile identity manifest. Row-count and dimension validation cannot detect reordering, so provision matching artifacts from a trusted pipeline.

## Modernized engine integration

Keep payload validation, exact origin rules, safe error handling and explicit response allowlists at the HTTP boundary when swapping engines. Reuse these controls for new routes and validate any new `top_k` field with a small positive upper bound. Preserve the legacy list envelopes, allowed clustering methods and null handling. Exclude raw bios, names, coordinates and unnecessary profile fields from rich responses. Apply literal location filtering in the engine as well. Treat optional model readiness separately from dataset readiness, and keep model downloads outside serving. The integrated implementation retains the incoming personalized weights, cold-start policy, literal location filter and TF-IDF fallback. Stronger artifact identity alignment and ranking quality should be evaluated separately.

## Tests

```powershell
python -m pip install -r backend/requirements-dev.txt
python -m pytest -q -p no:cacheprovider backend/tests
```

Tests use temporary synthetic CSV/NPY fixtures, a stub encoder for the semantic success path and Flask's test client. They require neither credentials nor network access. Real model inference and deployment load limits require separate integration checks.

References: [Flask configuration](https://flask.palletsprojects.com/en/stable/config/) · [Flask error handling](https://flask.palletsprojects.com/en/stable/errorhandling/) · [SentenceTransformer loading options](https://sbert.net/docs/package_reference/sentence_transformer/model.html)
