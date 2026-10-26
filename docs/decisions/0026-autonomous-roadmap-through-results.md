# 0026: Autonomous roadmap execution through Results, with reviewed local integration

Date: 2026-10-26

Status: accepted by the owner. Preparation and handoff only in the current session; the next agent implements.

## Decision

The owner approved the defaults in the [rollout plan](../jobs-rollout-plan.md), including all D1–D10 choices,
and authorized autonomous sequential implementation through Results:

3. Jobs.
4. Data intake.
5. Archetypes and schedules.
6. Measures and scenarios.
7. Calibration.
8. Results.

After each slice's review and required checks pass, merge it into **local** `master`. Resolve routine implementation
details, review findings, and test failures without asking for additional supervision. Record plans, decisions,
verification evidence, and next steps in Git. Detailed per-slice planning is delegated implementation work, not a
new owner-approval gate. A genuinely unresolved product conflict still pauses the affected work under `AGENTS.md`.

## Publication boundary

- The implementation agent must not push or deploy. Local merges do not authorize publication.
- For this preparation session only, the owner separately authorized pushing the handoff branch and its unpublished
  ancestors. This is a one-time handoff transport exception; it does not authorize later implementation pushes.
- Push `codex/jobs-design` only, not `master`, and do not create a PR or dispatch a workflow. The inspected
  `.github/workflows/pages.yml` deploys on pushes to `master` and has no push trigger for `codex/jobs-design`.
- RC remains read-only, real connections remain deferred, and `feature/agentic` remains unmerged (decision 0022).

## Rationale and continuity

The owner asked to resolve multiple product decisions together so another agent can start immediately and complete
the bounded demo work without routine supervision. Approved defaults include held results, failed-only retry with
unchanged inputs, FIFO jobs/edit locks, cancelled-job fresh runs, saved held output, nonmodal notices, stable-ID
fusion that preserves manual overrides, and explicit adoption of a calibrated baseline variant.

The [handoff](../20261026_autonomous-roadmap-handoff.md) records the startup message, exact repository/worktree
locations, source state, verification baseline, and the first implementation action.
