# Jobs: roadmap step 3 discussion

Date: 2026-10-26. Status: direction A accepted ([decision 0025](decisions/0025-jobs-list-and-detail-pane.md));
retry and partial failures are in discussion before implementation.
The owner requested review/integration of project lifecycle, followed by discussion of Jobs.
Decision 0022 keeps computation and transport mocked here; connections are built inside RC later.

## Observed demo behavior

- `src/app/pages/TasksPage.tsx` lists project stage runs newest first, with status, percentage, initiator,
  message, expandable timestamped log, and Cancel for active runs. The page is called Jobs; its component ID
  remains `page.tasks`.
- `src/domain/simulator.ts` starts each Created task independently and advances it on timers. Demo conditions
  can stall a run or fail it partway. Created is not an enforced queue with a concurrency policy.
- There is no selected-job detail, explicit retry operation with attempt lineage, per-item failure summary,
  or dedicated completion-notice interaction. A failure partway through a timer is not a partial-result model.
- Project lifecycle already confirms cancellation before leaving/replacing a session. Stay sends no cancellation.
  A reopened saved snapshot does not resume previously active jobs.

## Read-only RC observations

Reference: `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator`, branch
`feature/archetype-library-schedule-registry`, revision `7464c140fc5d9a49a2ca59954a85ac199a0faf09`.
Inspected with `git --no-optional-locks show`; no builds, dependency installation, source copying, or mutations.

| Exact source path under RC | Observed behavior |
| --- | --- |
| `EnergyAtlasWeb/Runtime/JobRuntimeState.cs` | Created, Running, Completed, Failed, Cancelled; start/finish times, error, logs, signals, structured progress scopes with completed/total/succeeded/failed/reused counts; cancellation request distinct from terminal cancellation; completion waits for a tracked body to stop |
| `EnergyAtlasWeb/Hubs/JobHub.cs` | Joining a job replays retained logs, ordered signals, and latest sequenced progress snapshots |
| `EnergyAtlasWeb/Runtime/JobStore.cs` | Job storage forwards to the current project session; create/open/close start with no jobs. The demo's saved job history is therefore a product choice, not established RC persistence parity |
| `EnergyAtlasWeb/Controllers/JobListController.cs` | `/api/jobList` lists registered job types and their start routes; this endpoint is a launcher catalog, not an execution queue |
| `EnergyAtlasWeb/Controllers/JobRouterController.cs` | Starts a named registered job through `/api/jobList/{jobName}/start` |
| `EnergyAtlasWeb/wwwroot/js/jobList.js` | Lists launchers and navigates a started execution to `job.html?jobId=...`; GUI jobs link to `jobRunner.html?job=...` |
| `EnergyAtlasWeb/Controllers/GUIJobRunnerController.cs` | Separate schema, validate, run, result, upload, and artifact-download routes for GUI jobs |

These observations support scoped progress, retained diagnostics, and an eventual generic runner boundary.
They do not establish a required scheduler policy, retry policy, or partial-output acceptance policy for this demo.

## Directions to discuss

| Direction | Experience and scope | Tradeoff |
| --- | --- | --- |
| A. Integrated Jobs list and detail (recommended) | Extend the existing Jobs page with active/history filtering and a selected run's summary, scoped progress, logs, failure details, Cancel/Retry, and completion notices that open the relevant run; stack list/detail in narrow layouts | Keeps troubleshooting beside the workflow; requires agreeing retry and partial-failure semantics |
| B. List plus separate job detail page | Same lifecycle scope, with each selected run opening a detail page/tab that can be docked alongside other runs | Better comparison of two runs; more navigation, tab ownership, and restoration behavior |
| C. Generic Job Runner first | A catalog of job types with inputs, validation, submission, outputs/artifacts, and the execution monitor | Closer to RC's general launcher surface, but substantially expands scope before data intake/archetype inputs exist |

The owner chose A, retaining stage runs as the entry point, and requested retry/partial-failure discussion before
implementation. The other directions remain recorded as alternatives.
Do not infer a single-worker scheduler or batch prioritization from the current Created label.

## Proposed behavioral boundaries for the next design discussion

- Retry creates a new linked attempt and keeps the original log/error immutable. Choose whether it uses a recorded
  input snapshot or explicitly reviewed current inputs; do not silently reuse a stale run after project edits.
- Distinguish failed request, failed execution, cancellation requested, and cancelled. Cancellation feedback should
  remain visible while pending, and a completion racing cancellation must resolve consistently.
- Use one representative synthetic item-level run to demonstrate partial failure with counts and failed-item
  reasons. Agree whether any partial output is usable before designing actions that accept or retry it.
- Completion notices belong to the project session, open the matching job, and never steal keyboard focus.
  Project switching must not deliver a previous session's notices into the new project.
- Keep history and attempts within the saved project boundary. Decide explicitly how much diagnostic detail is
  retained; no global cross-project job center is implied.
- Manual controls and future agent tools share server commands. Demo conditions expose empty, pending, stalled,
  successful, failed, partially failed, and cancelled runs; verify keyboard interaction, every appearance,
  narrow layouts, and the production base path.

Real: job state transitions, guards, retry lineage, progress/log presentation, notices, and persistence rules.
Mocked: computation, item outcomes, queue timing, faults, storage, and transport. Deferred: HTTP/SignalR,
real batch computation, native artifacts, sign-in/permissions, and a general job-schema editor.

## Retry and partial-failure discussion, 2026-10-26

Additional demo observations: `src/domain/commands.ts` applies stage outputs in `task.complete`; `task.fail`
and `task.cancel` do not publish new stage outputs. `Task` in `src/domain/types.ts` has no per-item outcomes,
attempt-parent link, or recorded input snapshot. Partial progress today does not imply retained item results.
Input revision metadata is recorded when the run completes/fails, rather than being a submission snapshot.

Candidate behavior, not yet accepted:

- Retry is manual and creates a new linked attempt. Original status, log, and item outcomes remain available.
- An execution-wide failure retries the run; an item-level failure can retry only failed items when their inputs
  are still compatible with the successful items. Changed inputs require an explicit fresh run or a clearly
  described rerun with current inputs; do not silently combine outputs from different input revisions.
- For a partial run, retain successful item results and failed-item reasons in the job detail. Whether those
  successes can enter the live project immediately or must wait for a complete result is the next owner choice.
  That choice also determines downstream eligibility and what a failed-item retry may publish.
- Distinguish transport submission failure from execution failure: a rejected submission must not invent a job
  attempt, and any later retry must avoid duplicating an already accepted submission.

Next: settle partial-output publication, then retry inputs/scope and queue policy before implementation.
