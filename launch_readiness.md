# Launch Readiness Definition

## Purpose

This document defines exactly what launch-ready means for this product so launch decisions do not drift over time.

This definition exists to prevent scope creep, avoid recurring re-interpretation, and create a single go/no-go standard.

## Product / Launch Scope

This launch-readiness definition applies to the first public launch of the eBay Photos application.

### In-scope launch path

- Public web app launch
- Intended auth / purchase path: `AUTH_MODE=gumroad`
- Public application runtime: the Flask/Gunicorn app and its server-rendered workspace
- Backend, frontend, packaging, deployment configuration, and launch evidence required to support that path
- Production legal/business/support values
- Operational checks needed to safely run and support the app

### Explicitly out of scope for v1 launch

These items are not launch blockers unless promoted into the Must-Pass Launch Gate by explicit decision:

- Alternate auth or payment paths not used for v1 launch
- Nonessential analytics enhancements
- Nice-to-have UX polish that does not affect trust, payments, security, core use, or supportability
- Performance optimization beyond the agreed launch evidence threshold
- Broad roadmap features unrelated to the current launch promise
- The standalone Vite client under `web/`, including `/centering`, until it is explicitly wired into the authenticated public deployment
- Extra automation around internal operations that is not required for safe launch

## Canonical Definition

The app is launch-ready only when all of the following are true:

1. The repository is internally coherent and reproducible.
2. The intended production launch path can be configured with real deployment values.
3. The deployed service can be operated and supported with acceptable risk.
4. The required launch evidence artifacts actually exist.
5. Every item in the Must-Pass Launch Gate is either:
   - Passed
   - Explicitly waived in writing
   - Or intentionally moved to a post-launch bucket in writing

If any Must-Pass Launch Gate item is unresolved, the app is not launch-ready.

## The Four Readiness States

### 1. Repo-Ready

The codebase, docs, scripts, and release packaging are coherent.

Repo-ready means:

- A fresh reviewer can identify the supported launch path without ambiguity.
- The documented build/test/package commands are correct.
- Checked-in example config is safe, non-live, and clearly marked as operator-supplied.
- Release packaging produces the intended bundle and excludes junk artifacts.
- Launch docs and QA docs refer to real files and real paths.
- There is no stale or contradictory launch messaging in the repo.

Repo-ready does not mean the app can launch publicly.

### 2. Deploy-Ready

A real production deployment can be configured correctly.

Deploy-ready means:

- Real production environment variables can be supplied outside the repo.
- The intended v1 launch mode is configured correctly.
- Required support/legal/business identity values are present.
- Secrets are real deployment values and not defaults/placeholders.
- Preflight/readiness checks pass in the real launch configuration.

Deploy-ready does not mean launch evidence is complete.

### 3. Operate-Ready

The app can be safely run and supported after launch.

Operate-ready means:

- Health/readiness checks work.
- Error handling is acceptable for public use.
- Logging/monitoring/support paths are sufficient for v1.
- Security basics for the public launch path are in place.
- Abuse controls appropriate to the exposed surfaces are in place.
- The team can diagnose and respond to foreseeable failures.

### 4. Launch-Ready

Launch-ready means Repo-Ready + Deploy-Ready + Operate-Ready + required launch evidence complete.

## Must-Pass Launch Gate

These are the only items that block launch.

### A. Repository and Build Integrity

All of the following must be true:

- Backend automated tests pass on the supported launch branch/commit.
- The server-rendered launch UI is covered by the backend launch/security tests.
- The standalone Vite production build succeeds as a supplemental repository-integrity check, but is not evidence that those routes are publicly deployed.
- The documented release packaging command succeeds.
- The produced release archive contains only intended contents.
- Launch docs, preflight docs, and packaging docs are consistent with the current repo.
- `.env.production.example` exists and clearly distinguishes:
  - safe example values
  - required operator-supplied real values
  - optional/recommended values
- There are no known contradictions between code behavior and launch documentation.

Pass evidence: command outputs or CI results plus manual archive inspection.

### B. Production Configuration Readiness

All of the following must be true in the intended production launch configuration:

- `APP_ENV=production`
- `APP_BASE_URL` is the real public production base URL
- `PHOTO_PREP_APP_SECRET` is a real non-default secret
- `AUTH_MODE=gumroad`
- Support contact values are real and launch-appropriate
- Legal/business identity values are real and launch-appropriate
- Required Gumroad launch fields are set correctly for the live launch path
- Preflight passes for the real launch configuration
- `/readiness` reports healthy in the real launch configuration

For this launch, the following are required before launch:

- `APP_ENV`
- `APP_BASE_URL`
- `PHOTO_PREP_APP_SECRET`
- `SUPPORT_EMAIL`
- `LEGAL_ENTITY_NAME`
- `LEGAL_CONTACT_ADDRESS`
- Gumroad values required for the intended v1 launch path

For this launch, the following are recommended but not launch-blocking unless explicitly promoted:

- `SENTRY_DSN`
- `PLAUSIBLE_DOMAIN`

For this launch, Stripe configuration is not a blocker when Gumroad is the actual launch path, unless Stripe is intentionally activated for v1 launch.

Pass evidence: preflight output from the real deployment config, readiness output from the live/staging-like environment, and operator verification of the real launch values.

### C. Security / Trust Minimums

All of the following must be true for the public launch path:

- HTTPS is enforced for public access.
- The app does not run with default secrets.
- CSRF/auth/session protections required by the app architecture are functioning.
- Basic rate limiting/throttling exists on abuse-prone endpoints.
- Basic security headers are present in production responses.
- Cross-user access control / ownership checks for user data and artifacts are functioning.
- The release artifact and repo do not contain accidental junk or sensitive launch data.

Pass evidence: tests where available, deployed verification where needed, and manual confirmation that no real secrets are committed in checked-in examples.

### D. Core Product Confidence

The core user promise must be proven for the launch scope.

For this app, that means the team has actual evidence for the launch-critical flows it claims to support.

The following evidence items are launch blockers until they actually exist:

- Real HEIC validation evidence for the supported launch scenarios
- Profile/performance evidence at the agreed launch threshold
- Export validation evidence
- Readiness/prod-like validation evidence
- End-to-end smoke-test evidence for the main launch path

These items may be scaffolded in the repo before completion, but they do not count as complete until real artifacts are collected.

Pass evidence: actual files, reports, screenshots, traces, logs, or checklists stored in the agreed evidence locations.

### E. Operational Support Readiness

All of the following must be true:

- A real support contact exists and is customer-facing ready.
- A responsible operator can interpret health/readiness/preflight failures.
- Launch docs tell an operator exactly how to validate the app before go-live.
- The main failure modes relevant to launch have at least a basic response path.
- The team knows the supported release-bundle path and supported deployment path.

For v1, this does not require enterprise-grade operations. It requires enough clarity to run and support the app responsibly.

Pass evidence: docs, runbooks/checklists, and operator walkthrough.

## Non-Blocking But Important Bucket

These should be tracked, but they do not block launch unless explicitly moved into the Must-Pass Launch Gate.

Examples:

- Better analytics coverage
- Better internal dashboards
- Additional monitoring integrations
- UX polish outside trust-critical flows
- Expanded documentation beyond the supported launch and support path
- Broader payment/provider flexibility not used in v1
- Performance improvements beyond the agreed launch threshold

## Out-of-Scope Bucket

These are intentionally excluded from the launch gate.

Examples:

- Future monetization paths not used for this launch
- Nice-to-have engineering cleanup unrelated to launch risk
- New roadmap features
- Broad platform expansion work
- Automation that is helpful but not required for safe launch

No out-of-scope item may be introduced later as a launch blocker unless it is explicitly reclassified in writing.

## Required Evidence Artifacts

The following evidence must exist before launch:

### Required artifact groups

- `qa/reports/launch-evidence/heic/`
- `qa/reports/launch-evidence/performance/`
- `qa/reports/launch-evidence/export-validation/`
- `qa/reports/launch-evidence/readiness/`
- `qa/reports/launch-evidence/smoke-tests/`

Each artifact group should contain:

- A short README or summary of what was tested
- Date collected
- Commit/build/version tested
- Environment tested
- Result status
- Raw evidence or links to it

A placeholder folder does not satisfy launch readiness.

## Final Go / No-Go Rule

The product may launch only when:

- Every Must-Pass Launch Gate item is passed or explicitly waived in writing
- The waivers, if any, are understood and accepted
- The required evidence artifacts exist
- The actual production launch path is configured with real values

If any of the above is false, the result is No-Go.

## Review Procedure

Any future launch-readiness review must answer only these questions:

1. Which Must-Pass Launch Gate items are still failing?
2. Which required evidence artifacts are still missing?
3. Is any newly raised concern truly a Must-Pass item, or does it belong in the non-blocking or out-of-scope bucket?
4. Is the current judgment based on the real launch path (`AUTH_MODE=gumroad`) rather than a different hypothetical path?

If a concern is not in the Must-Pass Launch Gate, it is not a launch blocker unless explicitly added.

## Current Practical Interpretation For This Project

Based on the current direction of the project, the expected remaining blockers before real launch are likely to be only these categories:

- Real production env/config not yet supplied
- Real legal/support/business identity values not yet supplied
- Real launch evidence artifacts not yet collected

That means the goal of ongoing repo work is:

- eliminate ambiguity
- keep the launch gate strict
- keep evidence honest
- ensure the final remaining blockers are truly operational launch inputs, not repo confusion

## Change Control For This Definition

This document is the canonical definition of launch readiness.

A new launch blocker may be added only if:

- it materially affects the safety, legality, security, trustworthiness, supportability, or core correctness of the public launch, and
- it is explicitly added to the Must-Pass Launch Gate.

Otherwise, it belongs in a non-blocking or post-launch bucket.
