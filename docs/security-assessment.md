# Application security assessment

**Assessment date:** November 8, 2026
**Scope:** `feature/security-audit` at `ae0a509ba65df9a7ec07ef02aec3d9422621a0aa`, including the Flask service, React/Vite client, tracked artifacts, CI, and accessible local Git refs.

## Executive summary

The initial assessment below records the baseline. See Phase 7B for implemented controls and current validation.

**Hold public deployment** until the recommendation API has abuse controls and the owner approves the dataset and disclosure policy. Local testing confirmed bounded inputs, exact-origin CORS, generic errors, and response field allowlists. It also confirmed that unauthenticated callers can repeatedly invoke CPU-heavy recommendation work and receive identifiable candidate metadata. Raw bios and coordinates remain in Git artifacts. No critical vulnerability or credential was confirmed in the reviewed scope.

The assessment treated Cloudflare Pages and a separately hosted Flask API as a proposed topology. Hosting settings, deployment headers, production request limits, and the real model were outside the verified scope. No external application or production infrastructure was scanned.

## Findings by severity

### High

| ID and status | Evidence and impact | Remediation |
| --- | --- | --- |
| H1. Anonymous computational abuse. Confirmed exposure. Production denial of service remains a risk. | All four POST routes are public and have no application rate or concurrency control. [API routes](../backend/app.py#L196) and [engine](../backend/engine.py#L228) copy, merge, score and sort candidate data. The [lexical fallback](../backend/engine.py#L372) fits the entire TF-IDF corpus on each request. Small valid requests therefore trigger substantial work despite the 16 KiB body cap and top-k bound. Three sequential warmed fallback calls took 26.1, 50.4 and 53.2 ms. Three hybrid calls took 17.3, 25.6 and 15.4 ms. One initial offline model-path request hit the 20-second client timeout before the explicitly missing-model rerun. These observations establish a cost asymmetry and cold-start concern. They do not measure capacity or demonstrate an outage. | Apply ingress rate and burst limits across **both** route families, with a tighter budget for bio search, bounded per-worker concurrency, queue limits and timeouts. Block direct-origin bypass if enforcement is at a proxy. Reuse the fitted lexical index without changing ranking. Measure cold/warm latency, RSS, saturation and 429 behavior on staging before selecting limits. |
| H2. Identifiable dataset in Git and enumerable profile output. Confirmed data handling. Publication authority is unverified. | [Tracked artifacts](../backend/data/) total 25,677,306 bytes across 13 CSVs and one NPY. The raw CSV has 4,150 rows and 3,935 case-folded identities. The cleaned and embedding CSVs each have 4,104 rows and 3,890 identities. CSVs contain handles, names, bios, repository lists, self-reported location and geocoded coordinates. The [data card](data_card.md) describes educational use and modeling anonymization, while tracked files remain identifiable. API tests confirmed handles, profile links and location can be returned, metadata supplies ten sample handles, and rich partner search reveals whether a username is in the dataset. Repeated queries could collect profile metadata. | Confirm data provenance, collection dates, intended audience and permitted reuse before publication. Prefer synthetic or opted-in demo profiles, minimize served and stored fields, and document retention, updates, removal and derivatives. Decide separately how to handle historical copies and existing clones. Review GitHub’s API and acceptable-use terms for the actual collection and redistribution purpose. [GitHub API terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms) |

### Medium

| ID and status | Evidence and impact | Remediation |
| --- | --- | --- |
| M1. Production serving and origin controls are unverified. Configuration risk. | [Direct Flask entry](../backend/app.py#L257) binds to loopback by default with debug off. No tracked production WSGI deployment, proxy policy or Cloudflare header rules were located. A localhost health request carrying an unexpected Host returned 200. No host-based redirect or exploit was demonstrated. Public edge policy could be bypassed if the API is directly reachable. | Select a production WSGI server. Configure explicit accepted hosts and trust forwarded headers only from the actual proxy. Terminate TLS at the platform, validate the API origin certificate and limit direct access when using a proxy. Set request, worker and upstream timeouts. Avoid exposing the Flask development server. [Flask deployment](https://flask.palletsprojects.com/en/stable/deploying/) |
| M2. Runtime readiness and artifact integrity. Confirmed control gaps, conditional impact. | [Health](../backend/app.py#L170) returns healthy after core engine initialization and reports model readiness separately. The [model loader](../backend/engine.py#L120) initializes on demand once per process and uses local-only model loading with remote code disabled. Artifacts are selected by operator config. The NPY loader disables pickle and checks shape, row count, dtype and finiteness, but does not verify profile identity or artifact checksums. Worker processes may duplicate model and dataset memory. | Provision trusted, pinned artifacts with hashes and an identity manifest. Mount artifacts read-only. Distinguish liveness, basic readiness and semantic readiness. Prewarm the model if required and size workers from measured memory and latency. Keep fallback behavior explicit and add restart or degraded-service monitoring. |
| M3. Lint-tool denial-of-service advisory. Confirmed dependency finding, runtime exploitability unverified. | Full npm audit flags 13 moderate package entries through a single `minimatch` 10.2.6 advisory. The path is ESLint, its config array and the React lint plugin's TypeScript parser tooling. The advisory requires a crafted glob pattern and optimization level at least 2. No browser or Flask request path to this library was found. The published fix is outside current 10.x parent ranges. | Track parent releases supporting 11.0.1 or later, then validate lint, tests and build. Keep the existing audit gate and continue reporting all severities. Avoid feeding untrusted glob patterns to lint tooling. [Upstream advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) |

### Low

| ID and status | Evidence and impact | Remediation |
| --- | --- | --- |
| L1. Client trusts profile links from the API. Confirmed defense-in-depth gap. | [Partner cards](../frontend/src/App.jsx#L1099) and [bio cards](../frontend/src/App.jsx#L1174) pass any truthy `Profile_URL` to `href`, with `noopener noreferrer`. The current [Flask serializer](../backend/app.py#L95) filters links with a full-match HTTPS GitHub allowlist, so the normal backend does not return a non-GitHub link. A different or compromised API could supply a misleading external link. No exploitable application XSS was demonstrated. | Mirror the exact GitHub profile restriction at the client boundary. Test a lookalike host, userinfo, an unsupported scheme and valid HTTPS GitHub URLs. Preserve link labels and unavailable-link feedback. |
| L2. Deployment response hardening is absent from tracked config. Confirmed repository gap, live status unknown. | Local Flask responses had `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The local API did not emit CSP, HSTS, frame restrictions or Referrer-Policy. The frontend has a [static inline theme initializer](../frontend/index.html#L12), so a blanket script policy could cause theme flashing or override system preferences. | Configure headers separately for Cloudflare static assets and the API host. Use a CSP that allows the exact API origin in `connect-src`, restrict framing and use a hash of the emitted inline theme initializer or move it to a static script. Verify the theme and accessibility flows under enforcement. Enable HSTS after HTTPS readiness. [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/) |
| L3. Operational log and metadata policy. Confirmed limited disclosure, deployment logging unknown. | The health response exposes model readiness and engine mode. The current API only logs exception classes, and the synthetic username and bio did not appear in captured local logs. Hosted reverse proxies, application monitoring and CDN logs were not inspected. | Keep public health output minimal or separate internal readiness. Retain structured request IDs, route, status, latency and rate-limit counters. Exclude request bodies, sensitive headers and raw queries from logging and error reporting. |

### Informational and ruled-out claims

- The real API returned JSON for HTML-shaped username input and echoed it only as the documented rich `query_user` field. The React code renders returned data through JSX text and no `dangerouslySetInnerHTML` or HTML injection sink was found. This is a source-based conclusion for the reviewed renderer, with no claim about future consumers.
- The location filter uses literal matching with `regex=False`. Brackets, traversal-shaped text, and HTML-shaped text produced valid responses. Recommendation routes do not use client fields as paths, SQL, shell commands or outbound fetch targets. The local Vite proxy target and Flask artifact paths come from operator configuration.
- The exact allowed origin received CORS headers on preflight and actual requests. A lookalike origin and `null` received none, and no response enabled credentialed CORS. Direct callers without browser CORS restrictions still reach the API. There is no cookie-based session or authenticated state-changing operation in this scope.
- A temporary production build embedded the synthetic public API URL, omitted an unrelated Vite-prefixed canary and the private proxy target, and included zero CSV, NPY or source-map files. Vite exports only the explicitly selected public URL. This says nothing about whether raw artifacts are accessible through repository hosting.
- Theme storage contains a preference value constrained to light, dark or system. No query or credential persistence was found in the client. Existing frontend tests cover theme persistence, storage failures and keyboard behavior.

## Reproduction and verification

All HTTP probes used a Flask development instance bound to `127.0.0.1` on a temporary port. Synthetic inputs and aggregate counts were recorded. The follow-up run pointed the worker at a nonexistent local model directory to isolate fallback. No saturation, concurrent traffic or destructive testing was performed.

| Probe | Observed result |
| --- | --- |
| GET health and metadata | 200. Total 3,890 users. Metadata exposes domains and ten sample handles. |
| Valid requests to all four POST routes | 200. Five results each with default top-k. No candidate Bio, Name, Latitude or Longitude fields. The rich semantic response identified TF-IDF fallback and omitted the bio query. |
| Malformed JSON, array payload, missing required fields | 400 with structured `error` and `code` on all four POST routes. |
| Oversized JSON and wrong media type | 413 and 415 respectively on all four POST routes. |
| Boolean or 51 for top-k, non-string username, invalid method and unpaired Unicode surrogate | 400 on rich partner route. |
| Unexpected Host on health | 200 locally. No production edge behavior inferred. |
| Deliberately failing engine and missing core artifacts | Existing pytest tests passed the sanitized 500 and controlled 503 assertions. |

Reproduction commands from the worktree:

```text
python -B -m pytest -q -p no:cacheprovider backend/tests
python -m pip check
python -m pip_audit --strict --progress-spinner=off --vulnerability-service=osv --path <tested-site-packages>
cd frontend
npm ci --no-audit --no-fund
npm run lint
npm test
npm run build
npm audit --json
npm audit --audit-level=high
npm audit --omit=dev --json
```

The backend run used `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`, and an isolated Hugging Face cache. The npm build used CI mode. See [CI reproduction](ci.md) for environment setup.

## Tools and results

| Tool | Scope and result |
| --- | --- |
| Semgrep CE 1.184.0 | Local community `p/default` rules, metrics disabled. Main scan ran 476 rules over 17 tracked targets with zero matches and a partial parsing warning in `frontend/src/App.jsx`. Manual review covered the component. An additional 214 rules ran over three frontend tooling and HTML targets with zero matches and zero parser errors. The primary parser warning is a coverage limitation. |
| Gitleaks 8.30.1 | Checksum-verified release. Default rules, full redaction, tracked HEAD archive and local history with `--all`. Zero matches in both scans. The history scanner reported 14 commits. A merge-aware first-parent diff pass scanned all 23 commits reachable from local refs, including nine merge commits, with zero matches. The checkout is not shallow. |
| Node 22.23.4, npm 10.9.9, Vitest 5.1.0, Vite 8.3.6 | Clean install passed. ESLint passed at zero warnings. Vitest **20 passed**. Production build passed. |
| Python 3.12.10 and pytest 9.2.0 | Existing requirements environment passed `pip check`. **105 tests passed**. |
| pip-audit 2.10.1 against OSV | Strict scan of the tested Windows CPU Python environment, including runtime and test dependencies, returned zero known vulnerabilities. Different platforms and resolutions require their own scan. |
| Bounded local HTTP probes | All six routes exercised. Results above. |
| Existing browser QA harness | Chrome 156.0.8078.80, Puppeteer Core 25.16.0 and axe-core 4.14.0. **12 passed, 0 failed**. A temporary harness copy redirected hardcoded runtime paths, evidence output and ports. Application code and harness assertions were unchanged. |
| CodeQL and OWASP ZAP | Unavailable locally. Semgrep supplied static coverage. The bounded HTTP probes supplied dynamic coverage without running an automated active scanner. |

Secret scan scope excludes untracked `.venv/`, remote-only and unreachable history, external artifact stores, and any secrets outside the rules. No suspected secret values are included in this report. Secret scanning and dependency databases have coverage limits.

## Dependency audit by severity

| Scope | Critical | High | Moderate | Low | Informational | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| npm full locked tree | 0 | 0 | 13 | 0 | 0 | 1 |
| npm runtime tree, `--omit=dev` | 0 | 0 | 0 | 0 | 0 | 0 |
| npm CI gate, `--audit-level=high` | 0 | 0 | 13 | 0 | 0 | 0 |
| pip-audit, installed runtime and test environment | 0 | 0 | 0 | 0 | 0 | 0 |

npm flags `minimatch` and twelve associated package entries. The direct affected entries are development-only `eslint`, `@eslint/js` and `eslint-plugin-react-x`. The remaining entries are transitive `@eslint/config-array`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`, `@eslint-react/ast`, `@eslint-react/core`, `@eslint-react/eslint`, `@eslint-react/jsx`, `@eslint-react/shared`, `@eslint-react/var` and `minimatch`. Runtime roots are Axios, React and React DOM. No audit thresholds were changed.

## Deployment release checks

1. **Hosting boundary.** Publish only `frontend/dist/` to Cloudflare Pages. Build with the public HTTPS API URL when Flask is on another origin. If same-origin routing is selected, explicitly proxy metadata and both recommendation route families. Vite dev and preview proxy rules have no effect on deployed static files. Configure the API hostname and exact production frontend origin, and decide whether preview hosts should reach a separate non-production API. [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
2. **API ingress.** Serve through a production WSGI server with TLS, host validation, body and timeout limits, and per-route throttling. If the API sits behind Cloudflare, use validated origin TLS and enforce rate controls where callers cannot bypass them. Configure reverse-proxy trust for the actual hop count. Keep the existing body limit and origin policy. [Flask security](https://flask.palletsprojects.com/en/stable/web-security/) · [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
3. **Operational readiness.** Validate trusted artifact provisioning, model start latency, per-worker RSS, overload behavior and failover using the intended production image. Verify deployed headers, CORS and HTTPS against an authorized staging target. Confirm that monitoring and error reporting redact request contents.
4. **Data release.** Record the data owner, source, purpose, publication scope and deletion process. Review historical Git data separately before any cleanup.

## Remaining uncertainties

Production account settings, live headers, network controls, certificate chains, rate-limit enforcement, deployed dependency versions and the real Sentence-BERT path were not verified. Local sequential latency does not characterize production capacity. The user profile collection and permission history and the full universe of Git clones or remote refs were not established. No fixes, deployment changes, commit, merge or push were performed.

## Phase 7B remediation and deployment configuration

The four recommendation POST routes now share admission control by family. Validation precedes admission. The defaults are **120 partner requests per minute**, **30 bio requests per minute**, and **two concurrent computations** across the two families. Configure `PARTNER_REQUESTS_PER_MINUTE`, `PARTNER_BIO_REQUESTS_PER_MINUTE`, and `PARTNER_MAX_CONCURRENT` (1–32). These are starting budgets, not production capacity estimates. Each family has a fixed one-minute window, so bursts can span a window boundary. Invalid requests and health/metadata calls do not consume recommendation quota.

Set **`PARTNER_LIMITS_DB`** for multi-worker production on one host. Give every worker the same absolute path in an existing, private, writable directory on a **local filesystem** and use identical limits. The application stores two counters in SQLite and holds a separate SQLite write reservation for each concurrent slot. Process exit releases its reservation. Slots are tried without waiting. Counter writes wait at most 50 ms for a SQLite lock before failing closed. The store requires SQLite 3.35 or newer. An unusable store during initialization prevents app startup. Without a path, counters and slots are per process and intended for local development. Separate hosts or containers with separate volumes have separate budgets. Never put the SQLite files on a network filesystem.

The API returns the existing `error` and `code` envelope. Exhausted quotas return `429 rate_limited` with `Retry-After` to the next window. Saturated slots or unavailable admission storage return `503 recommendation_busy` with `Retry-After: 1`. There is no application queue for a computation slot. The TF-IDF fallback index is fitted at most once per worker under a lock. It uses the same vectorizer, corpus and scoring as before.

### Hosting controls required before public traffic

Configure per-client and aggregate throttling at the trusted ingress, across modern and legacy routes. Global application quotas can be consumed by one client. The app does not use any forwarded client identity. Have the ingress discard inbound forwarding headers and derive client identity only from trusted peers. Restrict direct access to the WSGI origin. A shared gateway must enforce the deployment-wide budget across replicas.

Use a production WSGI server behind an ingress with a bounded accept queue, request/header/body read deadlines, request size limits, and explicit upstream timeouts. An HTTP timeout alone cannot interrupt running Python or native inference. Use a worker execution limit that actually terminates or recycles stuck workers and validate this behavior on the chosen server. Tune the worker count, BLAS/Torch thread limits and process memory limits using staging data. Verify cold model readiness and restart behavior, and set limits against measured latency and memory. Serve the existing module app `backend.app:app` where the server supports a WSGI import string.

### Dataset inventory and publication decision

The original data card attributes collection to the public GitHub REST API, with geocoding through Nominatim. It describes educational use. The repo did not establish the full collection dates, a redistribution license for this snapshot, opt-in evidence, or a documented removal process. Public source data and pseudonymized vectors still need a publication decision. Review actual collection and redistribution purposes against applicable terms and privacy requirements with the dataset owner. [Data card](data_card.md) · [GitHub API terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms)

| Artifact under `backend/data/` | Rows or size | Identifying content and runtime role |
| --- | ---: | --- |
| `github_users_with_location.csv` | 4,150 | Raw handles, names, bios, URLs, repositories, locations and coordinates. Offline input only. |
| `cleaned_github_users.csv` | 4,104 | Same identifying fields plus encoded columns. Runtime uses handle, languages, repository tokens, counts, location, URL and bio. Name is read into internal result objects but filtered from HTTP responses. Coordinates and encoded columns are unused by serving. |
| `with_bio_embeddings.csv` | 4,104 | Profile sidecar with names, bios, locations and coordinates. Current engine does not read it. |
| `dbscan_optuna_clustered_users_with_domain.csv`, `hdbscan_optuna_clustered_users_with_domain.csv` | 4,104 each | Both contain full profile fields. Runtime loads Username, Cluster and Domain_Tag. The serving path uses Username and Domain_Tag after loading, so Cluster could be removed from a serving export after adjusting the loader. |
| `clustered_users_with_domains.csv`, `hdbscan_optuna_clustered_users.csv` | 4,100 and 4,104 | Legacy profile and clustering exports include bios and coordinates. Offline only. |
| `final_hybrid_with_semantic.csv`, `hybrid_recommendations.csv` | 4,106 each | Legacy scores keyed by handle with repositories, location and URL. Offline only. |
| `content_scores.csv`, `bio_semantic_scores.csv` | 3,469 and 4,935 | Handle-linked scores, including target/candidate pairs in the semantic file. Offline only. |
| `bio_recommendations.csv`, `collab_recommendations.csv` | 5 each | Sample results with usernames, locations and links. Bio sample includes raw bios. Offline only. |
| `bio_embeddings.npy` | 6,303,872 bytes | Profile-linked derived vectors by source row order. Runtime hybrid and semantic signal. Preserve row identity when changing exports. Treat vectors and ID manifests as linked data. |
| Other tracked artifacts | 10 notebooks, QA JSON and screenshots | Saved notebook outputs and QA screenshots can reproduce profile details. Review or regenerate with synthetic fixtures. The package JSON files and web manifest are tooling metadata. |

`git log --all -- backend/data` identifies the initial commit `8526071` as a historical source of these artifacts. QA evidence also exists in reachable history. Repository visibility and external copies were not tested. Removing files from a future checkout would leave historical copies in Git and clones.

**Approval proposal:** keep the original artifacts private for reproducibility and publish a synthetic or opted-in demo dataset only after owner review. Prepare a serving-only export with stable IDs, features needed for scoring, and an explicit opt-in policy for public identifiers and location. Omit names, coordinates and redundant artifacts. Move lexical features into an offline-prepared index or use consented text for fallback. Test ranking parity for the same source cohort before changing any features. Approve retention, removal and the treatment of historical material separately. No dataset or Git history changes were made.

## Agent Skills and Security Tools

- **Graphify was available and executed.** A temporary source-only AST graph with 74 nodes and 109 edges covered the Flask entry point, engine, React app and Vite config. It mapped route wrappers, validation and model initialization. The graph was used as a navigation aid. Actual source verified the shared engine closure, per-process model lock, per-request hybrid work and previously repeated TF-IDF fitting. Graph edges do not prove taint, timing, or cross-process state. No semantic extraction or external model was needed for this code-only pass.
- **Ponytail Audit, Ponytail and Ponytail Review were available and applied.** The pre-change audit separated observed admission gaps from hypothetical production saturation. The implementation reused the validation boundary, error envelope, standard library and fitted lexical representation. A separate source review checked both route families, transaction and slot cleanup, forwarding-header independence and the fallback contract. This was a review pass in the same session. Ponytail Help was available as a reference.
- **Confirmed and addressed:** shared-host rate and concurrency admission for both route families, controlled overload responses, lexical index reuse and Semgrep JSX parsing coverage. **Remaining:** per-client and deployment-wide enforcement, real model and production resource validation, the dataset publication decision, and lint-tool dependency advisories.
- **Semgrep and dependency follow-up:** Semgrep CE 1.184.0 ran 490 rules over 21 targets with zero findings and zero parser errors after encoding the JSX text ampersands. The rendered copy is unchanged. The scan skips large artifacts and its default ignored paths. npm still reports 13 moderate development entries from GHSA-g3hv-75wg-m249, zero runtime findings and a passing high gate. Current parent releases still require minimatch 10.x and the newest 10.x is 10.2.6. The published 11.0.1 fix is outside those ranges. No forced upgrade, override or threshold change was applied. pip-audit 2.10.1 reported zero known vulnerabilities in the tested Python environment. [Upstream advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)

- **Gitleaks follow-up:** 8.30.1 returned zero matches in the candidate tracked snapshot with the pending changes and all 23 locally reachable commits, including merge diffs. Redaction was enabled. External refs, untracked environments and unrecognized secret formats remain outside coverage.

### Phase 7B validation

| Check | Result |
| --- | --- |
| Backend pytest | 110 passed, including five focused tests for shared quotas, cross-process slot saturation, error recovery, fail-closed storage contention and index reuse. |
| Frontend Vitest, ESLint and Vite | 20 tests passed. Lint and the production build passed. |
| Local browser QA | 12 passed, 0 failed with shared admission enabled. Temporary evidence and localhost ports were used. |
| Scanners and dependency gates | Semgrep and Gitleaks reported zero findings. Runtime-only npm and pip-audit reported zero findings. Full npm audit reported 13 moderate entries and the high gate passed. |
