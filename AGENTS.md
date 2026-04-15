# Repository Guidance

## Canonical Launch Gate

- Treat [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md) as the canonical definition of launch readiness for this repo.
- Use the public web app with `AUTH_MODE=gumroad` as the only v1 launch path unless the repo is explicitly re-scoped in writing.
- Do not introduce new launch blockers from roadmap work, alternate auth/payment paths, or nice-to-have polish unless they are explicitly added to the Must-Pass Launch Gate in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md).

## Working Rules

- Keep launch docs, packaging docs, QA docs, and evidence paths consistent with the canonical definition.
- Preserve `.env.production.example` as non-live example config. It must never contain real secrets, live product IDs, or real legal/support values.
- Prefer documentation and repo changes that reduce ambiguity around the production Gumroad launch path.
- When updating launch status, separate repo-ready work from real deployment/operator inputs and from real evidence collection.

## Evidence Rules

- Required evidence artifact groups live under `qa/reports/launch-evidence/heic/`, `qa/reports/launch-evidence/performance/`, `qa/reports/launch-evidence/export-validation/`, `qa/reports/launch-evidence/readiness/`, and `qa/reports/launch-evidence/smoke-tests/`.
- Placeholder folders or TODO notes do not satisfy launch readiness.
- Supplemental evidence such as frontend build logs may be stored alongside the required groups, but they do not replace them.
