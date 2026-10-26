# Jobs execution plan (roadmap slice 3)

Date: 2026-10-26. Branch: `claude/slice-3-jobs`, from local `master` at `cf899e7`.
Authority: [rollout plan](jobs-rollout-plan.md) D1–D10, [decision 0025](decisions/0025-jobs-list-and-detail-pane.md),
[decision 0026](decisions/0026-autonomous-roadmap-through-results.md). This is delegated implementation planning,
not an owner gate.

## Domain model (`src/domain/types.ts`, `src/domain/jobs/`)

- `Task` stays the attempt record (component id `page.tasks`, UI name Jobs). New fields: `groupId`, `attempt`
  (1-based within the group), `parentTaskId`, `requestId` (idempotency key from the client), `items`
  (`{ ids, processed, succeeded, failures: Record<id, message> } | null`; null for whole-stage jobs), and
  `invalidatedReason`. New status `invalidated`: a queued attempt whose captured inputs changed before it started;
  it finishes without executing and releases the queue.
- `RunGroup` (`state.runGroups`, `state.runGroupIds`): one input context. `signature` (`ancestors`: every transitive
  upstream stage revision; `editRevision`; `membership`: item ids), `attemptIds`, `held` item outputs, `status`
  (`open`, `published`, `cancelled`, `invalidated`, `superseded`), `publishError`, `publishedRevision`.
- Pure helpers in `src/domain/jobs/`: `captureSignature`, `signatureMismatch` (names the changed input),
  `itemStatusOf`, `retryBlocker`, `jobSummary`, and the preprocessing item runner `preprocessItem` and
  `publishPreprocessing`, which validate and apply held outputs atomically.
- Selection, layout, appearance, drafts, and focus are never part of a signature.

## Commands

| Command | Owner | Behavior |
| --- | --- | --- |
| `workflow.runStage` | server | Fresh group + attempt 1; supersedes open groups of the stage; idempotent on `requestId` |
| `job.retry` | server | New linked attempt in the same group for failed/unprocessed items only (whole-stage: whole run; all held: publish-only); refuses changed inputs, cancelled/interrupted groups, active attempts; idempotent on `requestId` |
| `task.start` | system | Revalidates the signature; mismatch finishes the attempt `invalidated` |
| `task.processItems` | system | Computes the next items, holding outputs on the group and recording failures on the attempt |
| `task.complete` | system | Whole-stage: existing runner. Item jobs: publishes when every member is held; validates first, a failed publication keeps held output and is retryable |
| `task.fail` / `task.cancel` | system / server | Never publish; cancel marks unfinished items cancelled and closes the group to retry |

## Server scheduling (`src/domain/simulator.ts`)

One running attempt per project; the oldest queued attempt starts when none is running (FIFO). Item jobs process a
chunk of items per step through `task.processItems`; whole-stage jobs keep timer progress. Demo condition
`jobs: itemFailures` fails a deterministic subset of preprocessing items transiently on the first attempt of a group;
`jobs: publishFails` fails the next publication once. The edit lock stays as it is (`MODEL_COMMANDS`).

## Persistence (`src/server/projectSchema.ts`, `projectCatalog.ts`)

New fields default for old saves; the catalog keeps the parsed (migrated) state. Reopen marks active attempts
cancelled as interrupted and closes their groups to retry; finished partial groups stay retryable when their
signature still matches. Held outputs are saved with the group.

## UI

- `src/app/pages/jobs/`: `JobsPage` (list + detail, stacked when narrow), `JobList`, `JobDetail`, `JobItems`,
  `JobLog`, `jobView.ts` (pure labels/eligibility). The old `TasksPage.tsx` re-exports the new page.
- View operations `jobs.select` and `jobs.setFilter` (active, attention, finished, all).
- Actions: Retry selected job, Fresh run of the selected job's stage, Cancel selected job.
- Notices: `createJobNotices` follows finished attempts per project generation; the status bar shows a nonmodal,
  dismissible notice whose button selects the job and opens Jobs without moving focus elsewhere.
- Agent: `job.retry` and `task.cancel` become tools with approval.

## Tests

Domain: signature capture/mismatch, group aggregation, held isolation, failed-only retry, changed-input refusal,
membership change, publish failure and publish-only retry, cancellation, idempotency, invalidated queued attempts,
manual overrides preserved. Server: FIFO, races, old-generation delivery. Catalog: legacy saves, held round trip,
interrupted groups. View/notices/tools. Browser: partial failure → retry → publish, keyboard list/detail,
notices, narrow layout, appearances, preview base path.
