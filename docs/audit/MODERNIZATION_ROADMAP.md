# Modernization roadmap

The working-tree backend acquired partial Phase 1 and Phase 3 changes during the audit. Review those changes as candidate work. Address the documented startup regression, API validation gaps and compatibility changes before treating the engine as a release candidate.

Work estimates are engineering days for one maintainer, excluding access, labeling and review delays. S is about 0.5–1 day, M is 2–4 days, and L is 5 or more. Implementation follows approval.

| Phase | Priority / estimate | Work | Exit criteria |
|---|---|---|---|
| 0. Contain exposure | P0 / 3–6 days | Agree on audience and data scope. Validate requests, use literal filters, handle errors consistently, disable debug by default, restrict origins and bound inference. Minimize the serving dataset and document provenance and removal. | Invalid and oversized requests fail safely. Approved data fields, access controls and abuse limits are tested before public exposure. |
| 1. Reproducible runtime and CI | P1 / 4–8 days | Fix paths and frontend API config. Lock Python dependencies and model revision. Isolate startup and model readiness. Replace the stale smoke test and add API/UI contract coverage. Add a clean CI build and test workflow using synthetic data. Document setup and credits. | Fresh checkout starts predictably, partner mode can initialize independently, and test/build checks run without live model downloads or real profiles. |
| 2. Data and relevance baseline | P1 / 6–12 days plus labeling | Version ingest and feature artifacts with canonical IDs. Reproduce static order, verify semantic top-k and establish frozen relevance judgments. Evaluate TF-IDF, SBERT and query-specific prototypes with the same pools. | Publish artifact manifest, baseline scorecard, cohort/exposure measures and latency results. Define measurable release criteria. |
| 3. Improve search and UX | P1–P2 / 5–10 days | Release the locally wired query-specific ranker only after validation. Add meaningful cold-start and explanations. Use backend domain metadata, accessible forms and responsive states. Profile and cache reusable retrieval work. Migrate CRA once tests protect the two flows. | Ranking meets agreed thresholds, accessible states pass browser and manual checks, and performance meets agreed budgets. |

## First five implementation tasks

1. **Establish and test the API input/error contract** (P0, M). Add fixture-backed tests for malformed JSON, invalid types, literal location, missing fields, length limits and valid responses. Disable debug by default, restrict cross-origin access and verify error responses contain no details. Evidence in [security review](SECURITY_REVIEW.md).
2. **Define a minimal data and exposure policy** (P0, M). Confirm intended audience and approved source terms, remove unneeded fields from serving artifacts and bio JSON, set request budgets, and document how source and derived records are updated or removed. Evidence in [security review](SECURITY_REVIEW.md).
3. **Make startup and local integration reproducible** (P1, M). Resolve data paths independently of CWD, verify schema and model revision, expose readiness, wire the frontend base URL, and lock Python resolutions. Validate with an offline fixture and a separately provisioned real model. Evidence in [repository audit](REPOSITORY_AUDIT.md).
4. **Replace the failing UI test and gate both stacks in CI** (P1, M). Use test-client and React tests for normal, empty and error states, add a build job and document the working commands. Evidence in [repository audit](REPOSITORY_AUDIT.md).
5. **Create an identity-safe baseline and ranking evaluation** (P1, L). Preserve the existing static baseline, canonicalize candidate IDs and artifact joins, fix bio top-k and test self-exclusion. Collect and freeze relevance labels before changing the production blend. Evidence in [ML evaluation](ML_EVALUATION.md).

Public exposure depends on phase 0. Query-specific rollout depends on phase 2. Browser deployment, GitHub settings and any historical data cleanup need separate decisions. Retain the existing CS 5661 team credits, project history and original team repository link.
