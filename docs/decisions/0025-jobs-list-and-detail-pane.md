# 0025: Jobs list with a detail pane

Date: 2026-10-26

Status: surface direction, held results, and input-compatible failed-item retries accepted by the owner.
The remaining cross-stage choices and autonomous execution scope are in a bundled discussion before implementation.

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

## Pending behavior

The owner requested planning across stages and discussing multiple decisions together before autonomous execution.
Queue behavior, cancellation, save/reopen recovery, notices, later slice boundaries, and integration scope are
proposals in the [rollout plan](../jobs-rollout-plan.md); they are not implied by the accepted choices above.
