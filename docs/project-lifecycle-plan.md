# Project lifecycle implementation plan

Date: 2026-10-26. Implements [decision 0024](decisions/0024-dedicated-project-start-screen.md) and the
[lifecycle design](project-lifecycle-design.md). Follow repository checkpoints and commands; no additional workflow
approval gate. Implementation used `codex/project-lifecycle`; the owner requested local merge after review on
2026-10-26. No push is requested.

## Architecture and constraints

The existing mock server remains the owner. Its update explicitly distinguishes no project (`state: null`) from an
open project. The client mirrors that session in metadata, and App renders the dedicated start screen while closed.
A browser-local catalog stores several snapshots by stable IDs and preserves the previous single saved project.
A shared lifecycle controller handles create/open/close/save intents, unsaved-work guards, and confirmed job
cancellation. Manual actions and agent tools use the same controller. No new package, real connection, or filesystem
access. All styling uses the existing appearance tokens and family grammar.

## Stages

### 1. Catalog and session service

- [x] Add `src/server/projectCatalog.ts` and tests: catalog read/write, legacy `eaui.project.v2` import, distinct IDs,
  malformed or unavailable storage, and atomic failed writes without replacing saved data.
- [x] Extend `src/server/server.ts`: nullable session state; metadata with current project, saved catalog, readiness,
  and storage error; asynchronous list/create/open/close requests through the transport. New named projects are
  unsaved until Save. Failed opening/creation leaves the old session usable; active runs block unconfirmed replacement.
- [x] Extend `src/app/service/projectClient.ts` and service tests: mirror closed/open state, expose the lifecycle
  request methods, preserve generation checks and stable IDs, and refuse project commands without an open project.
- [x] Confirm failing regression tests first, then focused passing tests and typecheck.

### 2. Shared lifecycle and surfaces

- [x] Add `src/app/service/projectLifecycle.ts` and tests: shared intent/guard state; Cancel changes nothing;
  confirmed exit cancels jobs before applying drafts/saving; failed Apply/Save prevents replacement; pending requests
  prevent duplicate transitions. Save with drafts explicitly offers Apply and save or Save applied changes only.
- [x] Add start screen and lifecycle dialogs under `src/app/project/`: Recent, Open catalog, named Create, progress,
  errors/retry, unsaved-work/job confirmation. Use React Aria field issues, existing tokens, and focus restoration.
- [x] Update `WorkbenchContext.tsx`, `App.tsx`, shell actions, save status, and Demo conditions to share that controller.
  Reset project-specific view/agent state at successful replacement; retain application appearance/layout preferences.
- [x] Add lifecycle operations to `src/app/agent/tools.ts`, with the same guards as manual controls.
- [x] Confirm focused controller/tool tests and typecheck before browser verification.

### 3. Workflow verification and handoff

- [x] Adapt legacy browser entry helpers to create/open through the start screen; retain explicit fixture deep links.
  Reload/save tests must reopen the saved project rather than relying on automatic restoration.
- [x] Add browser coverage for named multi-project creation, switching/recent/open, Save failure and retry,
  dirty/draft guards, active jobs (Stay and confirm cancellation), keyboard/focus, and startup storage failures.
- [x] Check start/forms/guards visually in all appearances at 1280x800 and a larger desktop; check narrow layout and
  serious/critical axe findings. Keep basemap tests offline through `e2e/test.ts`.
- [x] Run typecheck, lint, format, unit tests, development e2e, then production-preview e2e sequentially, plus Git
  diff checks and staged secret review. Request a fresh review of the whole change, fix concrete findings, and record
  final counts, remaining gaps, and commands in the design/developer documentation before committing.

## Review focus

1. Never overwrite one project because another has the same name; test distinct IDs and reopen both.
2. A failed Save, invalid draft, or failed Open preserves the current project; test every refused transition.
3. Cancel leaves jobs and unsaved state untouched; test against the server's task state as well as visible labels.
4. Malformed/blocked storage cannot erase the legacy snapshot; test read and write failure independently.
5. A stale command, callback, selection, view, or entity reference cannot cross a successful project switch; exercise
   the existing generation guards and reset both view and agent state.

## Execution record

- Base: `1fa90ab`, matching local `master`; worktree clean before lifecycle documentation.
- Owner choices: dedicated start screen; confirmation before cancelling active jobs on leave/switch.
- Verification: typecheck, lint, formatting, 224 unit tests, 68 development browser tests, and 2 production-preview tests passed. Browser configurations ran sequentially.
- Review: fixed mutation during transitions, startup-fixture identity collision, queued-agent delivery, malformed saved snapshots, hidden name validation, and cross-project save errors; follow-up review found no remaining actionable issue.
- Ruling: create submit uses explicit disabled/progress feedback because React Aria 1.21.1 pending-button announcements otherwise outlive the modal and leave invalid label references.
- Ruling: saved snapshots use a complete typed Zod schema plus graph/index validation; partial shape checks allowed corrupted graphs to crash the workbench.
- Ruling: Demo conditions stays reachable inside pending lifecycle dialogs, allowing held requests to be released without trapping the user.
- Integration: owner-requested review reproduced and fixed silent Recent-open errors, then all checks passed again (224 unit, 69 development browser, 2 preview). Local `master` fast-forwarded from `1fa90ab` to `4fb94b1`; no push. See the [merge record](project-lifecycle-design.md#merge-review-2026-10-26). Jobs is in discussion, with no implementation yet.
