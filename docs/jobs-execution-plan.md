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

## Implementation status (2026-10-26)

Built on `claude/slice-3-jobs`. Real: job state transitions, run groups and input signatures, held item outputs and
atomic publication, failed-item and publication-only retry with attempt lineage, changed-input refusal, invalidated
queued attempts, FIFO single runner, edit lock, cancellation that publishes nothing, idempotent submission keys,
save/reopen migration and interruption, list/detail UI, notices, actions, and agent tools. Mocked: computation
(synthetic per-building preprocessing), item faults (demo conditions *Some items fail*, *Publication fails*,
*Fail partway*, *Stall*), timing, storage, and transport. Deferred: HTTP/SignalR, real computation, concurrent
writers, priorities, a generic job-schema runner, and item-level jobs for stages other than preprocessing.

Behavior notes:

- Partial failure leaves the stage Failed with earlier published outputs in place; held results never reach the
  Table, Map, or results. Retry runs only failed or unprocessed members; the publication retry runs no items.
- Workflow panel and Jobs detail offer Retry beside Rerun/Fresh run. A fresh run while results are held says in
  its accessible name and tooltip how many held results it discards.
- Preprocessing refuses submission when any building lacks floors: missing data is not a transient fault a retry
  could fix. Correcting data is an input change and needs a fresh run.
- Notices sit in a strip above the status bar, announce only their message through a polite live region, never
  take focus, and clear on project identity or session generation change. Open job moves focus to the Jobs list;
  dismissing moves focus to the next notice or the workspace.
- Palette and menu actions (Retry/Cancel/Fresh run selected job) act only on an explicitly selected job.

Review: an independent review of the branch found no data-loss, held-output isolation, or scheduler defects and six
lower-severity issues, all fixed: item-mode retry decided by stage, not membership; discard warning on fresh runs;
missing-floor fast rejection; notice focus and live region scope; palette actions requiring explicit selection;
stricter saved run-group cross-checks (index, attempt membership, open group without attempts).

Verification on the final slice commit (2026-10-26, Edge, 4 workers): `npm run typecheck`, `npm run lint`,
`npm run format:check` clean; `npm test` 255 passed (29 files); `npm run test:e2e` 74 passed; `npm run
test:e2e:preview` 3 passed (adds a held-retry job check under the Pages base path). Screenshots of the Jobs page
in all six appearances at 1280 px and at 900 px were reviewed from ignored `tmp/jobs-*.png`. Known warnings are
unchanged: bundle-size warning and MapLibre style-diff console warnings.
