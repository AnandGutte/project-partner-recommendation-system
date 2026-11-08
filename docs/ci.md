# CI checks and local reproduction

The [CI workflow](../.github/workflows/ci.yml) runs on pull requests targeting `main` and pushes to `main`. The two jobs run independently on Ubuntu 24.04. GitHub Actions caches pip downloads using both requirements files and npm downloads using the frontend lockfile. Each run creates a fresh Python environment and uses `npm ci` for the frontend.

| Job | Checks | Failure policy |
| --- | --- | --- |
| Backend tests and audit | Python 3.12, CPU-only Torch, `pip check`, full pytest suite, pip-audit against OSV for the installed environment | Test and installation errors fail the job. Any vulnerability reported by pip-audit fails the job. |
| Frontend tests, build and audit | Node 22, non-interactive Jest, optimized React production build, npm audit against the locked tree | Test and build failures fail the job. High and critical npm advisories fail the job. Lower severity findings still appear in the report. |

Audits run after a successful install even when tests fail. An audit service error also fails the check. The jobs use read-only repository access, disable persistent checkout credentials, and reference official actions by commit SHA. No repository or deployment secrets are passed to build or test steps. The tests use local fixtures or checked-in datasets, an isolated model cache, and Hugging Face offline settings. Dependency installs and audits access public package or advisory services.

## Reproduce locally

From the repository root, use Python 3.12 and Bash for the commands below. On Windows, use each virtual environment's `Scripts/python.exe` and set the three Hugging Face variables with PowerShell's `$env:` syntax.

```bash
ci_dir=$(mktemp -d)
python3.12 -m venv --upgrade-deps "$ci_dir/backend"
backend_python="$ci_dir/backend/bin/python"
"$backend_python" -m pip install --index-url https://download.pytorch.org/whl/cpu --no-deps torch
"$backend_python" -m pip install -r backend/requirements-dev.txt
"$backend_python" -m pip check
HF_HOME="$ci_dir/hf" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  "$backend_python" -m pytest -q -p no:cacheprovider backend/tests

python3.12 -m venv --upgrade-deps "$ci_dir/audit"
audit_python="$ci_dir/audit/bin/python"
"$audit_python" -m pip install pip-audit==2.10.1
site_packages=$("$backend_python" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
"$audit_python" -m pip_audit --strict --progress-spinner=off --vulnerability-service=osv --path "$site_packages"
```

From the repository root with Node 22 available:

```bash
cd frontend
npm ci --no-audit --no-fund
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
npm audit --audit-level=high
```

Validate workflow syntax and GitHub Actions expressions with `actionlint .github/workflows/ci.yml`.

## Scope and known baseline

The existing frontend dependency tree has high and critical npm audit findings. The workflow deliberately reports these as failures until they are triaged and resolved. Audit output includes build-time dependencies. A report alone does not establish exploitability in the deployed browser bundle.

Python requirements use lower bounds. The installed versions can vary with the operating system, interpreter and date. The workflow audits the versions it actually tests. These checks cover published dependency advisories and do not exercise real Sentence-BERT inference, production load, or repository settings.

Tool references [GitHub Actions setup-python](https://github.com/actions/setup-python) · [GitHub Actions setup-node](https://github.com/actions/setup-node) · [pip-audit](https://github.com/pypa/pip-audit) · [npm audit](https://docs.npmjs.com/cli/v10/commands/npm-audit/)
