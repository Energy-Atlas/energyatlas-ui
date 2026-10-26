# Jobs and later roadmap slices: rollout proposal

Date: 2026-10-26. Branch: `codex/jobs-design`, based on local `master` at `47f5541`.
Status: draft for one bundled discussion. Accepted choices are listed separately from recommendations.
This is the owner-facing rollout and decision plan; per-slice implementation tasks follow once the bundle is settled.

## Intent and accepted boundaries

Build roadmap step 3, Jobs, so later intake, archetype, scenario, calibration, and results work use the same job
operations and failure rules. The owner asked to settle multiple decisions together, then progress autonomously
within an agreed scope rather than requesting routine supervision.

[Decision 0025](decisions/0025-jobs-list-and-detail-pane.md) accepts:

- A Jobs list with a selected job's detail pane.
- Successful item results stay held until the failed items are resolved.
- Retry only failed items when inputs are unchanged; otherwise require a fresh run.

Existing decisions keep the RC checkout read-only, real backend connections deferred, `feature/agentic` unmerged,
appearance tokens and existing dependencies in use, and manual/agent actions on shared application operations.
No RC implementation, assets, or confidential data may be copied without reuse permission.

## Observations that constrain the plan

Demo source at `47f5541`:

- `src/domain/workflow.ts`: stages derive readiness from satisfied upstream stages; optional stages can be skipped;
  successful runs become stale when their inputs/upstream states change. Existing run controls do not automatically
  launch dependent stages.
- `src/domain/commands.ts`: `workflow.runStage` creates a task, `task.complete` applies stage outputs, and
  `task.fail`/`task.cancel` do not publish new outputs. Item results and submission-time input signatures are absent.
- `src/server/server.ts`: model commands are refused while queued/running jobs hold the project. This is not a
  scheduler: the timer simulator currently starts tasks independently.
- `src/server/projectCatalog.ts` and `projectSchema.ts`: saved project state includes task history and validates the
  full model. New persisted job fields require backward-compatible defaults or migration, not rejection of old saves.
- `src/app/service/projectLifecycle.ts`: project replacement is fenced, confirms active-job cancellation, and does
  not resume cancelled jobs after reopening.

RC source observations, exact revision and paths are in [Jobs discussion](jobs-discussion.md). In particular,
RC's Created state does not establish a scheduler policy, and RC session job storage does not establish saved-history
parity. The future-slice table below contains proposed demo experiences, not newly observed RC behavior.

## Decisions to settle together

All entries in this table are recommendations awaiting the owner, except consequences explicitly tied to accepted rules.

| ID | Recommended default | Meaningful alternative / consequence |
| --- | --- | --- |
| D1 Workflow and publication | Publish a complete, validated result once per job group; until then the stage is incomplete, dependent stages cannot use held items, and earlier published results remain inspectable with current/stale labeling. No automatic downstream runs | Explicitly queue a dependent pipeline; adds orchestration and stop/restart policy |
| D2 Queue and edit lock | One running job per project, FIFO for explicitly submitted eligible jobs; revalidate inputs/prerequisites before starting. Keep the existing model-edit lock while any jobs are queued/running; allow inspection and view changes. A finished partial run releases the lock | Concurrent independent jobs require finer locks and publication conflict handling |
| D3 Retry validity and representative batch | Capture all committed inputs consumed by the stage, stage options, and item membership when submitted. Any consumed input change requires a fresh group; selection/layout/theme changes do not. Prove item-level retry on geospatial preprocessing (one building per item); other existing stages remain whole-stage jobs until their own slice introduces meaningful item outcomes | Item-specific invalidation/reuse after input edits is a more complex policy and would conflict with the owner's chosen fresh-run rule |
| D4 Cancellation | Cancel stops the attempt and never publishes held results. Preserve completed-item diagnostics, mark unfinished work cancelled, and offer a fresh run rather than treating cancelled work as a failed-item retry. Project-leave confirmation keeps its accepted behavior | Resume unfinished cancelled work with unchanged inputs; introduces a separate resume operation and checkpoint lifetime |
| D5 Save and reopen | Explicit Save includes compact job history, logs, and held item outputs. Reopen interrupts previously active attempts; do not restart work automatically. A finished partial group remains retryable if its saved input signature still matches. Preserve old project saves through migration | Session-only diagnostics are smaller but lose failed-item retry across close/reopen |
| D6 Notices and manual/agent parity | Project-scoped, nonmodal notices for completion/failure/partial failure; opening a notice selects its job. No focus stealing or OS notification. Manual retries only; agent retry uses the same command and existing permission mode | Automatic retries or desktop notifications need separate limits/permissions |
| D7 Later-slice shape | Approve the bounded demo slices below as the direction for steps 4–8, using the same staged job contract and synthetic fixtures | Stop at Jobs and discuss each later slice separately |
| D8 Autonomous scope and Git | After the bundle is agreed, implement and verify the agreed slices sequentially, review/fix each, commit coherent stages, and update durable records without routine approval. Proposed scope is Jobs through Results. Keep integration local; leave each slice on a reviewable branch without merging/pushing unless the owner includes local merges in the authorization | Jobs only, or Jobs + Data intake, is a smaller autonomous scope; local merge after each passing slice can also be explicitly authorized |
| D9 Data fusion identity and precedence | Match incoming fixture records by an explicit stable source ID, update matched source attributes, add valid new records, and retain unmatched existing buildings. Preserve manual overrides above imported values and show their conflicts/provenance in the preview. Reject duplicate/ambiguous source IDs rather than guessing. No implicit deletion | Replacing the entire collection requires explicit deletion and override reconciliation semantics |
| D10 Calibration destination | Publish a separate calibrated baseline variant with fit diagnostics. Explicit Adopt makes it the working baseline and stales dependent scenario results; until adoption the current baseline remains in use | Automatically replace the working baseline on fit success; simpler flow but changes dependent results without a separate adoption choice |

Implementation calls delegated to the builder under this proposal: component decomposition, exact type names,
filter controls, log pagination/virtualization thresholds, compact persistence representation, and synthetic failure
distribution. These choices must preserve the accepted interaction rules, accessibility, provenance, and package limits.

## Shared run contract

This section proposes consistent behavior across the slices; it does not claim the current demo has these facilities.

- Keep an immutable attempt record and a group identifying retries of the same input context. A retry creates a new
  attempt; it does not rewrite the earlier log or outcome. Repeated delivery of a submission must not create duplicates.
- Identify the consumed inputs at submission and check them again before execution/publication/retry. This includes
  upstream published versions and stage-owned options, not unrelated UI state. Unsent drafts are excluded from inputs
  and disclosed before submission; users explicitly Apply them before they can affect a run.
  If an earlier queued job invalidates a later job's input context, finish the later job without executing it,
  explain that a fresh run is required, and continue eligible queue entries. Never silently replace its captured inputs
  or leave an invalid entry holding the edit lock indefinitely.
  Fixing an invalid source value or mapping is an input change and therefore requires a fresh run. Failed-only
  retry is for failures resolvable under identical inputs (for example transient execution faults), not a way to
  mix corrected input values into previously held successes.
- Retain per-item success/error plus progress counts. Do not conflate a network/request error, execution failure,
  item-level failure, and a pending cancellation. The RC-shaped error envelope remains the request boundary.
- When all required items succeed in one compatible group, validate and publish their combined output atomically,
  increment the stage revision once, and propagate staleness normally. A failed publish is visible and cannot silently
  rerun completed computations or partially mutate the model; retain held outputs for explicit retry of publication
  after revalidating inputs. Changed inputs still require a fresh run.
- Optional skip remains an explicit workflow action under existing rules. Skipping does not apply held results.
  A fresh run starts a new group and cannot inherit successes from an invalidated group.
- Old callbacks, requests, notices, item selections, and agent queues cannot cross project generations. Item selection
  uses existing domain selection where applicable; selecting a job is view state and does not edit the project.

## Sequential slices and acceptance boundaries

These are two levels: roadmap slices 3–8 below, and the domain workflow stages each slice operates on.
Every slice uses the same job contract; it does not create a separate retry engine.

| Roadmap slice | Bounded demo experience proposed | Job units / publication | Explicitly deferred |
| --- | --- | --- | --- |
| 3 Jobs | Active/history list, detail summary, attempts, scoped progress, item failures, logs, Cancel/Retry/Fresh run, completion notices; existing workflow entry points stay valid | Building-level geospatial preprocessing proves held successes, failed-only retry, changed-input refusal, and one atomic publish. Other stages retain coherent whole-stage jobs | Generic job-schema runner, priorities, concurrent writers, real computation |
| 4 Data intake | Select synthetic upload/dataset fixtures; inspect fields, map to the model schema, see field/row validation and fusion preview, then explicitly apply a valid prepared dataset. Stable-ID merge adds/updates source data, retains unmatched existing buildings, and preserves manual overrides (D9) | Independent source records/geometry items; schema-wide errors block submission, and held fusion output must complete before live data changes | Real native picker, server uploads, arbitrary geospatial format parsing, implicit deletion; no new parsing package implied |
| 5 Archetypes and schedules | Synthetic library, compact editor, daily/weekly schedule editor, assignment preview and coverage; explicit apply with provenance | Validation of definitions precedes building assignment jobs; assignments publish together | RC library copying, full EnergyPlus object editor, exhaustive calendar formats |
| 6 Measures and scenarios | Extend existing creators into an editable synthetic library and scenario composition; preview affected buildings and compare modeled scenarios | Each independent scenario is a batch item; build/publish a coherent requested comparison set | Optimization, real physics, financial calculations |
| 7 Calibration | Synthetic meter-series preview, units/time-range validation, baseline fit job, before/after residual summary; publish a separate calibrated variant, with explicit Adopt to change the working baseline and stale dependent results (D10) | One whole-fit job unless genuinely independent fits are introduced; do not falsely model coupled fitting as independent hourly items | Live meters, real calibration algorithm, credentials, automatic baseline replacement |
| 8 Results | Per-building/scenario drill-down, synthetic time series, provenance/currentness, and browser CSV export of published results | Read published output; a requested export uses a consistent published revision and identifies it. Held output stays out of normal results/export | Native report generator, unreviewed partial totals, unrestricted export of reference data |

Within each slice: empty/loading/success/warning/error and cancellation states, keyboard use, all appearances,
desktop/narrow layouts, server delay/faults, manual/agent parity, save/migration, and project-switch isolation.
Use meaningful item boundaries; independent retry is not promised for computations whose outputs are coupled.
Scale checks accompany slices without inflating the UI with 10,000 DOM rows; a full district benchmark remains
a separately documented cross-cutting deliverable rather than silently expanding every editor's scope.

## Jobs implementation sequence after the bundle is settled

1. **Run records and input context.** Extend `src/domain/types.ts`; put focused job/input helpers in
   `src/domain/jobs/`; adapt `commands.ts` and `workflow.ts`. Define immutable attempts, group aggregation,
   signature eligibility, stage currentness and atomic publication. Domain tests prove success/failure combinations,
   unchanged/changed inputs, item membership changes, publish failure, and preserved manual overrides.
2. **Server scheduler and held computation.** Adapt `src/domain/simulator.ts`, `simulation.ts`,
   `src/server/server.ts`, and demo conditions/fixtures. One scheduler policy implements queue/cancel and partial
   preprocessing, feeding the shared commands. Test pending cancel/completion races, idempotent submission,
   deterministic item failure/retry, edit locks, and old-generation delivery. Timer progress alone cannot stand in
   for retained per-item results.
3. **Persistence and recovery.** Extend `projectSchema.ts`, `projectCatalog.ts`, and session tests with compatibility
   for old snapshots and held outputs. Test close/reopen, storage read/write failure, stale signatures, interrupted
   work, and corruption without overwriting the saved bytes. Existing lifecycle confirmation remains authoritative.
4. **Jobs surface and shared operations.** Split `TasksPage.tsx` into focused Jobs list/detail/log/item components
   under `src/app/pages/jobs/`, preserving `page.tasks`. Add view operations for job selection/filter state;
   register actions in `src/app/actions.ts`, server operations in `projectClient.ts`/server command registry,
   agent paths in `agent/tools.ts`, and project-scoped notices in the existing shell. Explain every disabled action.
5. **Workflow integration and acceptance.** Exercise the partial preprocessing vertical slice through normal
   workflow controls, Jobs retry, and tools. Confirm held items never reach Table/Map/results until complete;
   failed/retried attempts retain their own outcomes; successful publication stales descendants once. Add browser
   coverage for keyboard list/detail use, notice navigation, long diagnostics, narrow panes, themes and base path.
6. **Review and handoff or next slice.** Run the required commands, inspect staged diffs/secrets, resolve review
   findings, commit coherent stages, and update developer/decision/roadmap records. Continue to the next authorized
   slice autonomously; otherwise finish with a concrete reviewable branch and verification evidence.

Each later slice gets its own focused implementation task list derived from the agreed boundary before code is
changed. Exact signatures and test cases belong in those execution plans; do not freeze six subsystems' interfaces
before the Jobs contract exists. This is implementation planning within the delegated scope, not another owner gate.
Before each slice, inspect its relevant RC surfaces read-only, record exact paths/revision and observations,
and implement original synthetic demo behavior. A substantive conflict with the agreed boundary is reported,
rather than silently importing reference implementation or expanding scope.

## Verification and autonomy contract to confirm

- For application changes, run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
  `npm run test:e2e`, `npm run test:e2e:preview`, `git diff --check`, and inspect `git diff --cached` before commits.
  Run dev/preview browser suites sequentially and keep app sources fixed during them.
- Inspect visual layout and keyboard transitions, not only state assertions. Use the product test helper for offline
  basemap/terrain fixtures, preserve the human Git identity, and inspect staged content for credentials.
- Resolve routine engineering choices, bugs, test failures and review feedback autonomously. Report outcomes with
  evidence; do not ask for approval of file names, ordinary commits, or routine fixes.
- Do not push/deploy, mutate RC, merge `feature/agentic`, add packages outside the recorded decisions, or discard user
  changes under this proposal. Merge into local master only if D8 explicitly includes that authorization.
- A genuinely unresolved product decision or unavailable required source pauses the affected work; continue useful
  independent work and explain the specific issue. Do not reopen settled choices or add routine approval gates.

## Current checkpoint

Planning only; no application code changed. The owner can approve defaults for D1–D7 and D9–D10, choose D8's endpoint
and local-merge policy together, or override any numbered entry. No autonomous implementation starts until that response.

Builder check: a fresh reviewer found no additional Jobs choices outside D1–D8, and identified fusion identity/
override handling and calibration destination as product decisions for a longer autonomous scope. They are now
explicitly included as D9–D10. No contradiction with the accepted held-result/failed-item-retry rules was found.

Documentation verification: all 67 relative file-link targets in changed Markdown files resolve; working/staged
diff whitespace checks and staged credential-pattern review passed. No application, browser-test, or dependency
files differ from the fully verified lifecycle integration at `47f5541` (224 unit, 69 development browser,
2 preview tests plus static/build checks). This planning-only update does not claim a new application test run.
