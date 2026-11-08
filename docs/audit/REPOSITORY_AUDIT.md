# Repository audit

Audited November 7, 2026. Local checkout: `feature/modernize-recommendation-system` at `128b15238d2d1607f4127477577a29aca4c61598`, 49 tracked files. The pre-existing untracked `backend/engine.py` was reviewed separately. Local `origin/main` points to `8526071`. The remote page could not be fetched during this audit, so remote branches, workflow runs, deployment and settings are unverified.

## Working-tree update observed during the audit

The tracked backend matched HEAD at the start. An external edit to [app.py](../../backend/app.py) wired the local engine during the audit. The findings below describe the committed baseline. In the current working tree, the two legacy routes call the engine and new routes provide health, metadata and structured results. Known users now get query-specific scoring. Unknown users get an activity-based fallback. Bio search keeps rank one and uses an exact-username-deduplicated corpus.

Root package import and health, metadata and offline lexical bio probes succeeded. The README command `cd backend; python app.py` now fails with `ModuleNotFoundError: backend`. Health reports embeddings loaded without establishing model readiness. The legacy partner response adds languages and explanation, and an invalid method now silently falls back to HDBSCAN with 200. The frontend still has hardcoded URLs and domain options. An array, invalid regex and nonnumeric top_k each returned 500. An unrelated origin was still reflected. Real Sentence-BERT inference remains unverified.

## Committed baseline

The CS 5661 project is a two-mode demo backed by a static GitHub snapshot. The browser can request partner and bio matches. Only bio matching scores an input at request time. The notebook experiments demonstrate several ranking methods, but there is no measured partner relevance baseline.

## Ten findings in recommended order

P0 gates public exposure. P1 materially affects correctness or confidence. P2 improves usability or maintenance. S is a localized change, M crosses boundaries, and L includes data collection or substantial evaluation. See the [roadmap](MODERNIZATION_ROADMAP.md) for time estimates.

| # | Priority / effort | Finding and evidence | Next action |
|---|---|---|---|
| 1 | P0 / M | Debug server, permissive CORS, and exception details in app.py (`128b152:backend/app.py:8`). | Define a safe runtime profile and generic error contract. |
| 2 | P0 / M | Malformed request bodies and invalid location regex produce 500s. Bio inference has no app-level size or rate limits. Routes (`128b152:backend/app.py:29`) | Validate, bound and rate-limit requests. Treat location as literal. |
| 3 | P0 / M | Tracked snapshots include identifiable profiles, free-text bios and coordinates despite anonymization language in [data card](../data_card.md). | Decide data-use scope, minimize shipped fields, and document retention and removal. |
| 4 | P1 / M | Partner ranking ignores the query identity except for exact self-exclusion. Ranking (`128b152:backend/app.py:32`) | Record current behavior as a baseline and evaluate a query-specific scorer. |
| 5 | P1 / L | No executable labeled ranking benchmark. [Data card](../data_card.md) names metrics, and notebooks show similarity plots and cluster experiments. | Build a held-out relevance set and report ranking metrics with uncertainty. |
| 6 | P1 / M | 214 duplicate identity rows in the cleaned snapshot, positional embedding joins, and a legacy score-column rename in the notebook. [Hybrid producer](../../notebooks/modeling_hybrid_improvements.ipynb), loader (`128b152:backend/app.py:13`) | Use canonical IDs, deterministic joins, and versioned artifact validation. |
| 7 | P1 / M | Startup depends on CWD and eagerly loads an unpinned model. Startup (`128b152:backend/app.py:13`) | Resolve configurable paths, pin artifacts, and separate model readiness from partner search. |
| 8 | P1 / M | Only checked-in test is stale and fails. No backend test files or GitHub workflow in local history. [Test](../../frontend/src/App.test.js#L4) | Add API and UI contracts and a clean-install CI gate. |
| 9 | P1 / M | Bio ranking discards the best result, may return duplicates, and rebuilds the corpus tensor and sorts it on every request. Semantic route (`128b152:backend/app.py:67`) | Fix top-k and profile inference before optimizing retrieval. |
| 10 | P2 / M | UI has hardcoded loopback, stale domain options, missing labels and feedback, and a fixed two-column grid. [App](../../frontend/src/App.js#L17), [CSS](../../frontend/src/App.css#L67) | Wire configuration and domain metadata. Test keyboard, screen reader and narrow layouts. |

## What runs and what remains experimental

- **Flask.** `POST /recommend` joins the precomputed score table to DBSCAN or HDBSCAN tags at import time. It defaults to HDBSCAN, applies location and domain filters and returns up to five profiles with scores. The clustering selector changes tags and candidate eligibility through the domain filter. `POST /semantic-bio-recommend` encodes free text with all-MiniLM-L6-v2 and compares it with stored bio vectors. No separate metadata or health route appears in source.
- **React.** One page submits both requests through Axios and renders separate result lists. Local config is advertised in [frontend/.env.example](../../frontend/.env.example), but both URLs are literals. Hardcoded DBSCAN `Cloud & Infrastructure` and HDBSCAN `Unknown Users / Sparse Profiles` and `Unknow Users` do not exist in the active artifacts. HDBSCAN's actual `Unknown Users` tag is missing from the selector. Switching method can relabel old results before another request completes. Shared loading and error state and a missing empty-result message make the two flows harder to distinguish.
- **Accessibility.** Text inputs rely on placeholders, selects lack explicit labels, and dynamic status/errors have no live announcement. The root starts at an h2, lacks a main landmark, and links repeat the same text. The viewport and flexible container help, but the grid has no narrow-screen layout and long strings need verification. Test WCAG 2.2 criteria 1.3.1, 1.4.10, 3.3.2, 4.1.2 and 4.1.3, with keyboard focus, contrast and screen-reader checks. Static review only. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- **Notebook pipeline.** [github_analysis](../../notebooks/github_analysis.ipynb) shows an example API request, EDA, placeholder fill, filtering, label encoding and min-max scaling. The data card describes a broader scrape and geocoding pipeline. A reproducible end-to-end collector was not located. The three single-signal notebooks cover content, activity and bio TF-IDF. Two hybrid notebooks blend those scores, and the semantic and embedding notebooks build neighbor scores and the serving matrix separately. Both clustering notebooks explore UMAP and Optuna with density clustering and domain tags. Most modeling notebooks reference `../data` while the tracked data lives in `backend/data`. One semantic notebook installs packages in cells. Runtime requirements omit notebook tooling and experiment dependencies such as Jupyter, UMAP, Optuna and external HDBSCAN.
- **Local prototype.** [engine.py](../../backend/engine.py) implements per-user scoring, metadata, an activity-based unknown-user fallback, score explanations and TF-IDF fallback. Flask has no import or route wiring for it. The README's future activity scoring, live GitHub search and OAuth remain outside the serving paths.
- **Dependencies and docs.** The lockfile resolves React 19.1.0, Axios 1.9.0 and react-scripts 5.0.1. CRA is deprecated upstream. Consider Vite after contract tests exist. Python requirements are lower bounds only. Root README contains a Markdown-form clone command inside shell code, a stale tree, and an incomplete notebook setup. Frontend README still describes the CRA template. Keep the original team attribution and upstream link when updating setup. [React CRA deprecation](https://react.dev/blog/2025/02/14/sunsetting-create-react-app)

## Verification and limits

- Existing Node 20.17.0/npm 10.8.2 and frontend dependencies ran `npm.cmd test -- --watchAll=false --runInBand --no-cache`. One suite and one test failed at the obsolete Learn React assertion.
- The existing Python 3.10 virtual environment supplied Flask, pandas, scikit-learn, Torch and Sentence Transformers. A real import from `backend` in offline mode failed because the model was absent from cache. An in-memory model stub plus actual CSVs and Flask's test client exercised routing, filtering, status codes and CORS. It did not validate model inference or relevance.
- Read notebook sources and inspected all CSV schemas and aggregate counts and the NPY shape. No notebooks were rerun. No browser render, load test, comprehensive dependency scan or production security test was performed.
