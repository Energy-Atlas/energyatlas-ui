# 0025: Jobs list with a detail pane

Date: 2026-10-26

Status: surface direction accepted by the owner. Retry and partial-failure behavior remain in discussion;
this decision does not authorize implementation before that discussion is resolved.

## Decision

Use direction A from the [Jobs discussion](../jobs-discussion.md): extend the existing Jobs page with a list
and a selected job's detail pane. Keep workflow stage runs as the entry point for this slice.
Follow existing appearance tokens and family alignment. Keep the computation and transport mocked under
decisions 0022 and 0023, with manual and agent actions sharing application operations.

## Alternatives discussed

| Direction | Tradeoff |
| --- | --- |
| List and detail pane, chosen | Keeps troubleshooting beside the workflow within one Jobs surface |
| List plus separate job detail tabs | Supports side-by-side run comparison but adds navigation and tab ownership |
| Generic Job Runner first | Adds a job catalog, input forms, and outputs before the later workflow inputs exist |

## Pending behavior

The owner explicitly requested discussion of retry and partial failures before implementation.
Open questions include retry scope and inputs, retained successful items, when partial output can affect
the project, and how downstream stages reflect incomplete work. Candidate behavior and source observations
remain proposals in the [discussion record](../jobs-discussion.md).
