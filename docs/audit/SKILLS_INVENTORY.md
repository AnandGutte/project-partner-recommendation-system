# Codex skills and engineering tooling

November 7, 2026. **No skill installation is required to start remediation.** The skills below are named only where a local instruction or publisher source was verified. Priority reflects the project phase where the skill would help.

## Prioritized skills

| Priority | Skill and verified availability | What it does and how this project would use it | Installation decision |
|---|---|---|---|
| P1 | [Codex Security `security-scan`](https://github.com/openai/plugins/blob/main/plugins/codex-security/skills/security-scan/SKILL.md). Official OpenAI plugin, offered by the host and currently uninstalled. | Runs a repository security scan with finding validation. Use as an independent follow-up on Flask request boundaries, data exposure and model loading before public deployment. | Optional. Install the Codex Security plugin only if the independent scan is wanted. The present security review used source and test-client evidence. |
| P1 | [`jupyter-notebook`](https://github.com/openai/skills/blob/main/skills/.curated/jupyter-notebook/SKILL.md). Official curated source, absent from local skill roots and session catalog. | Scaffolds and edits reproducible notebooks. Use for a clean evaluator walkthrough and plots driven by outputs of a scriptable benchmark. | Optional. The evaluation harness and notebook environment can be built without it. |
| P1 | `computer-use:computer-use`. Installed and exposed. Local instruction at bundled `computer-use/26.1103.31037/skills/computer-use/SKILL.md`. | Operates and inspects Windows UI. Use for hands-on keyboard, narrow viewport and visible focus checks when the app runs. | Already available. Pair with automated browser tests and manual assistive-tech checks. |
| P1 | [`playwright`](https://github.com/openai/skills/tree/main/skills/.curated/playwright). Official curated source, absent locally. | Guides real-browser automation. Use for two-route form flows, empty/error/loading behavior, and a viewport matrix. | Optional. Playwright the test dependency is separate from the Codex skill. |
| P2 | `review-agent`. Its instruction exists under `.codex/skills/.system`, but it is absent from this session's callable skill catalog. | Read-only defect review for a delegated code change. Relevant once API, engine or build changes exist. | No installation indicated. Verify whether a future session exposes it before relying on it. |
| P2 | [`gh-fix-ci`](https://github.com/openai/skills/blob/main/skills/.curated/gh-fix-ci/SKILL.md). Official curated source, absent locally. | Reads GitHub Actions PR failures and guides a fix. Use once the first workflow exists and there is an actual failing PR check. | Defer. Its workflow uses `gh`, which was absent from PATH. |
| P2 | `visualize:visualize`. Installed and exposed. Local instruction at curated plugin `visualize/1.0.89/skills/visualize/SKILL.md`. | Creates interactive explanations. Use later for reviewing measured ranking and exposure trade-offs across cohorts. | Already available. Use ordinary plots for reproducible benchmark outputs. |
| P2 | `skill-creator`. Installed system skill and exposed. | Packages repeatable Codex workflows. If artifact validation and release review become frequent, encode them after the checks and contracts stabilize. | Already available. A custom skill is unnecessary for the first implementation. |
| P2 | `skill-installer`. Installed system skill and exposed. Local instructions point to the [OpenAI curated catalog](https://github.com/openai/skills/tree/main/skills/.curated). | Discovers and installs skills from verified repositories. Use only if an optional skill is selected after the audit. | Already available. No install performed. |

## Environment discovery

Checked the exposed session catalog and on-disk `C:/Users/anand/.agents/skills`, `C:/Users/anand/.codex/skills` and `C:/Users/anand/.codex/plugins/cache`. Read relevant instruction headers and the installer discovery instructions. A cache directory alone does not establish active availability. No `AGENTS.md` was found at the checkout root, its C: ancestors, or in project subdirectories outside dependency folders. No project-local skill directory was found.

Other exposed skills were screened by purpose. These include `imagegen`, `openai-docs`, `documents:documents`, `pdf:pdf`, `presentations:Presentations`, both spreadsheet skills, both Sites skills, `template-creator:template-creator`, `plugin-management:plugin-management`, Dreamina Canvas and its three creative workflows, Sparki video editing, and the three Work Pets skills. They address other deliverables or product surfaces and have no installation or usage role in this roadmap. The cache also holds artifact templates and an older Visualize version. Neither was used to infer session availability.

## Engineering capabilities by finding

These are engineering practices and tools. No project-specific Flask, React, recommender, NLP, data engineering, profiling or documentation skill was verified in the inspected local catalog.

| Capability | Priority | Grounded tooling and use |
|---|---|---|
| Python, Flask, API integration | P0 | Use Flask's existing test client and pytest with synthetic fixtures to cover status codes, schema, literal filters, ranking invariants and readiness. Current virtualenv already includes pytest. |
| Security and dependency review | P0 | Use the source review findings, dependency manifests and sanitized fixtures. Follow with npm audit, pip-audit and secret scanning in authorized CI. Review advisories for actual reachability. |
| Data engineering and reproducibility | P1 | Use pandas, NumPy and a deterministic CLI pipeline, checksums, canonical IDs, schema tests and a separate locked experiment environment. Current notebook paths and CSV/NPY alignment need this. |
| Recommenders and NLP | P1 | Keep scikit-learn TF-IDF and Sentence Transformers for baseline comparisons. Use held-out labels, candidate-pool controls, cohort metrics and ablations. No new model library is needed for this baseline. |
| React and UI/UX | P1 | Use existing Testing Library for validation, API interactions, accessible names and result states. Use a browser runner and axe-core as follow-up tools for reflow and automated accessibility checks, alongside manual checks. Keep React while addressing the deprecated CRA build separately. |
| Performance profiling | P1 | Benchmark the actual two routes first with controlled data and warm/cold model runs. Use Python profiling and process RSS for tensor copying, inference and ranking. |
| GitHub Actions and CI/CD | P1 | Author a minimal workflow to reproduce clean setup, tests and build using synthetic artifacts. Add dependency checks after baselining. Release automation is conditional on a deployment decision. |
| Technical documentation | P1 | Update Markdown setup, API contracts, data lineage, model evaluation and a deploy runbook when corresponding changes land. Preserve course and team credits and link the original repository. |

Verified local executables include Git, ripgrep, Python 3.10.11, Node 20.17.0 and npm 10.8.2. There is an existing virtualenv with Flask 3.1.3, scikit-learn 1.7.2, Sentence Transformers 6.2.0 and pytest 9.2.0. Frontend dependencies were already present. `gh`, `jupyter`, `playwright`, `ruff` and `uv` were not discovered on PATH. Availability through another environment or package was not inferred.
