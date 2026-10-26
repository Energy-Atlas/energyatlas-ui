# 0025: Jobs list with a detail pane

Date: 2026-10-26

Status: accepted by the owner, including the rollout defaults through Results and reviewed local merges
([decision 0026](0026-autonomous-roadmap-through-results.md)).

## Decision

Use direction A from the [Jobs discussion](../jobs-discussion.md): extend the existing Jobs page with a list
and a selected job's detail pane. Keep workflow stage runs as the entry point for this slice.
Follow existing appearance tokens and family alignment. Keep the computation and transport mocked under
decisions 0022 and 0023, with manual and agent actions sharing application operations.

Accepted by the owner in the follow-up discussion:

- Hold successful item results until the failed items are resolved; do not apply partial results to the project.
- Retry only the failed items if inputs have not changed.
- If inputs have changed, require a fresh run. Do not combine successes from an old input context with a new one.

## Alternatives discussed

| Direction | Tradeoff |
| --- | --- |
| List and detail pane, chosen | Keeps troubleshooting beside the workflow within one Jobs surface |
| List plus separate job detail tabs | Supports side-by-side run comparison but adds navigation and tab ownership |
| Generic Job Runner first | Adds a job catalog, input forms, and outputs before the later workflow inputs exist |

## Cross-stage behavior and execution

The owner approved the bundled defaults in the [rollout plan](../jobs-rollout-plan.md): queue behavior,
cancellation, save/reopen recovery, notices, later slice boundaries, fusion precedence, calibration destination,
and autonomous implementation scope. Each slice merges into local `master` after review and checks pass.
The [handoff](../20261026_autonomous-roadmap-handoff.md) is the next agent's entry point; no further routine
design approval is needed before starting Jobs.
