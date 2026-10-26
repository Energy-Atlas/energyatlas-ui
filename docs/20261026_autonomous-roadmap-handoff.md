# Autonomous implementation handoff: Jobs through Results

Date: 2026-10-26. Ready for another agent to start immediately. This session prepared documentation only;
Jobs implementation has not started.

## Short kickoff message

> Start EnergyAtlas from local `master` in `D:/energyatlas-ui` and read
> `docs/20261026_autonomous-roadmap-handoff.md`. The owner approved defaults D1–D10 through Results.
> Implement slices 3–8 autonomously, reviewing and running required checks for each, then merge each passing
> slice into local `master`. Do not push/deploy or merge `feature/agentic`; RC is read-only.
> Start with the detailed Jobs execution plan and implementation. Do not repeat settled design approvals.

## Authority and scope

The owner approved the defaults through Results and explicitly instructed:

- Another agent, not this preparing agent, starts implementation.
- Implement the six bounded slices sequentially: Jobs; Data intake; Archetypes/schedules; Measures/scenarios;
  Calibration; Results.
- Progress autonomously, resolving routine engineering choices, review findings, and test failures.
- Merge each slice into **local master** only after its review and required checks pass.
- Do not push or deploy implementation work.

Accepted authority is durable in [decision 0025](decisions/0025-jobs-list-and-detail-pane.md),
[decision 0026](decisions/0026-autonomous-roadmap-through-results.md), and the
[approved rollout plan](jobs-rollout-plan.md). Detailed per-slice task plans are delegated work, not another
owner gate. Pause only the affected work for a genuinely new product conflict, missing required source,
or action beyond this authorization; do not reopen settled defaults or ask about routine implementation details.

The owner separately authorized this preparing agent to push **the handoff branch and its unpublished ancestors**.
That one-time publication exception does not authorize the next agent to push. Do not push `master`, create a PR,
or dispatch a workflow. `.github/workflows/pages.yml` deploys on `master` pushes; it has no branch-push trigger for
`codex/jobs-design`. This handoff branch is transport for source and decisions, not a deployment.

## Repository and survival of this worktree

| Item | Location / state |
| --- | --- |
| Repository | `https://github.com/Energy-Atlas/energyatlas-ui.git` |
| Main checkout, local master | `D:/energyatlas-ui` |
| Preparing checkout | `C:/Users/cl2749/.codex/worktrees/c947/energyatlas-ui` |
| Preparing branch | `codex/jobs-design` — a linked Git worktree, not the main checkout |
| Published handoff ref | `origin/codex/jobs-design`, after the handoff push succeeds |
| Application baseline | `47f5541`, local master after reviewed project lifecycle integration |
| Earlier planning checkpoints | `c42776a` (list/detail choice), `7f1c9f7` (held-result rules and rollout discussion) |
| Read-only RC checkout | `C:/Users/cl2749/Documents/GitHub/RCEnergySimulator` |
| Audited RC branch/revision | `feature/archetype-library-schedule-registry` at `7464c140fc5d9a49a2ca59954a85ac199a0faf09` |

This preparation commits the approved scope and this file on `codex/jobs-design`, fast-forwards local `master`
to the same handoff commit, and pushes only `codex/jobs-design`. Verify completion from the final handoff message
and Git refs; this file itself does not assert that a future push succeeded. No worktree removal is performed here.

Before preparation, local master was 17 commits ahead of `origin/master`; the preparing branch also contained
two unpublished documentation commits. Therefore **do not start from `origin/master`**: it lacks the reviewed
foundation/lifecycle work. Start from the local master containing this file, or the published handoff ref.

On this machine, removing only the preparing worktree after a clean commit/push does not remove commits from
the shared Git repository, local master, or the published handoff branch. Keep the branch and main checkout.
Ignored files such as dependencies, local environment files, generated screenshots, and test artifacts are not
part of Git; this handoff does not depend on them. Do not delete an active checkout used by the next agent.

If starting on another machine, fetch the published handoff branch, inspect the local master state, and integrate
the handoff with a non-destructive fast-forward where possible. Do not reset or overwrite divergent/user changes.
The reference path must be located explicitly on that machine; if unavailable, ask for its exact path/URL.

## Read before application work

1. [AGENTS.md](../AGENTS.md), the [complete source handoff](20260913_product-ui-experiment-agent-handoff.md), and
   [documentation index](README.md), as repository instructions require.
2. [Approved rollout plan](jobs-rollout-plan.md), decisions 0025/0026, and [Jobs observations](jobs-discussion.md).
3. [Developer guide](developer-guide.md), [project lifecycle record](project-lifecycle-design.md), and
   [pre-connection roadmap](pre-connection-roadmap.md).
4. [Family alignment](design-alignment-family.md), [decision 0021](decisions/0021-energyatlas-family-ui-alignment.md),
   and the owner's [UI guidelines](20260915_energyatlas_ui_design_guidelines.md). Do not edit the owner's guidelines.

No new stack/package choice is pending. Use the existing React/TypeScript/Vite, Zustand/Immer, Zod,
React Aria, FlexLayout, AG Grid, ECharts, and MapLibre boundaries. Node.js 24 LTS and exact lockfile versions.

## Settled product rules

- Jobs uses a list plus detail pane, keeping the existing `page.tasks` layout identity and workflow run entry points.
- Hold successful item outputs outside the live project until all required items in a compatible group succeed.
  Then validate/publish once atomically; never export held data as normal project results.
- Retry only failed items if consumed inputs, options, and membership are unchanged. A changed input requires a
  fresh group. Correcting invalid data/mapping also changes inputs; transient faults can be retried unchanged.
- Capture input context when submitted, check at start/retry/publication, and keep immutable linked attempts.
  Selection, layout, and appearance changes are not input changes.
- One running job per project; FIFO for explicitly submitted eligible work. Keep the edit lock while work is
  queued/running; finished partial runs release it. Revalidate queued jobs and visibly finish invalidated entries
  without executing or permanently holding the lock. Do not automatically launch downstream stages or retry jobs.
- Prove partial retry using geospatial preprocessing, one building per item. Other stages start as whole-stage
  jobs until their later slice introduces meaningful independent items. Do not fake per-item retention with timers.
- Cancellation preserves diagnostics, publishes nothing, and requires a fresh run rather than resuming cancelled
  work. Keep the existing confirmation before leaving/replacing a project with active jobs.
- Save compact history/logs/held outputs. Reopened finished partial groups can retry if inputs still match;
  previously active work is interrupted and never restarts automatically. Migrate old saves compatibly.
- Nonmodal, project-scoped notices open the relevant job; no focus stealing or OS notifications. Agent operations
  use the same commands and existing permission mode as manual operations.
- Data fusion uses stable source IDs; add/update matched source records, retain unmatched existing buildings,
  preserve manual overrides and provenance, expose conflicts, and reject ambiguous IDs. No implicit deletions.
- Calibration publishes a separate calibrated variant. Explicit Adopt changes the working baseline and makes
  dependent scenario results stale. No automatic baseline replacement.

The rollout plan bounds each later slice. Data intake uses synthetic datasets/mapping/fusion; archetypes include
synthetic definitions and daily/weekly schedules; measures/scenarios extend the existing creators; calibration
uses synthetic meter data; Results adds published-result drill-down/time series/browser CSV export.
Real computation, HTTP/SignalR, native pickers, authentication, RC data/assets reuse, and a generic job-schema runner
remain outside this scope. `feature/agentic` stays unmerged. Full district benchmarking is a separately recorded
cross-cutting deliverable; do relevant scale/accessibility checks within each bounded slice.

## First action and implementation order

1. Inspect current status/refs and preserve user changes. Base isolated implementation work on the local master
   containing this file, not origin/master or the unmerged agentic branch. Existing worktrees must be preserved.
2. Write a concrete Jobs execution plan from the approved rollout: exact files/types/operations and meaningful
   tests. The six Jobs implementation stages in the rollout are the starting structure. No further owner approval
   is needed to start. Then implement; do not stop after merely producing another plan.
3. Deliver domain run groups/input context and atomic publication; server scheduling/held item computation;
   migration/save recovery; Jobs list/detail/actions/notices/shared tools; normal workflow/browser integration.
4. Test, obtain a fresh code review, fix findings, and run the required checks. Review should target data loss,
   held-output isolation, retry compatibility, repeated requests, cancellation/publication races, project switching,
   malformed/legacy saved state, keyboard use, and disabled-action explanations.
5. Commit coherent stages after staged diff/secret review. If `D:/energyatlas-ui` is still the clean master checkout,
   integrate the passing branch there with `git -C D:/energyatlas-ui merge --ff-only <slice-branch>` when possible.
   Preserve user changes and never force/reset if master diverges. Keep useful branches; branch deletion is forbidden.
6. Record evidence/status, then proceed autonomously to the next approved slice, basing it on the newly integrated
   local master. Audit its relevant RC surface read-only with exact paths/revision; write its focused task plan,
   implement, review, verify, and merge locally. Continue until Results is complete.

Manual operations use `client.execute`; server commands are registered in `src/server/server.ts`. The UI's
workbench refuses server-owned commands. Lifecycle changes use `services.lifecycle`, view changes use view
operations, layout changes use the layout controller, and agent calls use `src/app/agent/tools.ts`.
Every unavailable control explains why. Use appearance tokens; keep mono uppercase headers and contrast tests.

## Verification baseline and required commands

Last application verification was on the lifecycle integration, whose application code is unchanged by this
planning/handoff work: 224 unit tests across 26 files, 69 development end-to-end tests, and 2 production-preview
tests; typecheck, lint, formatting, build, and diff checks passed. Do not report these as newly run implementation
tests. Existing hidden-chart/map-style and bundle-size warnings were documented, with no failed checks.

For each implementation slice, run the actual commands and record results:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run test:e2e:preview
git diff --check
git diff --cached
```

Use `npm ci` if dependencies must be installed. Playwright uses installed Edge and four local workers;
elsewhere install Chromium and set `PLAYWRIGHT_CHANNEL=chromium`. Product specs import from `e2e/test.ts` to keep
basemap/terrain offline. Run development/preview suites sequentially because they share artifacts. Do not format
or edit app sources during a browser run: Vite hot reload previously invalidated the running context.

Inspect visual layout and keyboard behavior across all six appearances and desktop/narrow sizes, plus the
production Pages base path. The lifecycle matrix regenerates screenshots under ignored `tmp/lifecycle-*.png`.
A preview may still exist on port 5190; verify server/project ownership before reusing or stopping a process.

Human Git identity at preparation: `Cheng Xuan Li <cl2749@cornell.edu>`; preserve configured identity, no assistant
trailers. Keep `.env.local` ignored; do not read or reproduce real credentials. The RC checkout must remain read-only:
use `git --no-optional-locks -C C:/Users/cl2749/Documents/GitHub/RCEnergySimulator ...` for inspection only.

## Completion report expected from the implementing agent

State which slices are complete, local master/branch commits, actual verification results and any material limits,
and durable next steps. Explicitly report that no implementation push/deployment or agentic merge occurred.
Continue until the approved bounded Results slice is complete rather than requesting routine per-slice sign-off.

## Preparation verification

All 142 relative file-link targets in changed documentation resolve. Working/staged diff whitespace checks and
staged/publication-range credential-pattern review passed. No application, test, dependency, or workflow files
differ from `47f5541`; the last full application verification above remains the baseline, not a new test run.
The main checkout and RC reference were clean before integration. The preparing worktree is retained.
