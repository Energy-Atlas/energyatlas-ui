# Review and project lifecycle discussion, 2026-10-25

## Integration

Reviewed `d6a0a10..01f2af2`: the full lineage of `feature/mock-services`, including the ribbon, Panels menu,
Account page, and decisions 0022 and 0023. Baseline verification reproduced 193 unit tests, 59 browser tests,
and 2 production-preview tests passing. Four regressions were then reproduced and fixed in `2238e0a` on
`codex/review-mock-services` before integrating the reviewed lineage.

Local `master` was fast-forwarded from `d6a0a10` to `2238e0a` in `D:/energyatlas-ui`. This documentation follows
that integration and is also intended for a local fast-forward. No push or deployment was performed. The remote
`origin/master` remains at `d6a0a10`; `feature/mock-services` remains at `01f2af2`.
`feature/agentic` remains at `e52d513` and its additional language-model work is unmerged, as decision 0022 requires.
The review worktree is on `codex/review-mock-services`; all branches and worktrees are preserved.

## Findings and fixes

| Finding | Reproduction | Resulting behavior |
| --- | --- | --- |
| P1: delayed commands could edit a replacement project | Send a measure with Slow delay, switch to None, then load New project before the measure arrives | Requests carry the client's project generation. The server refuses stale requests with 409 `project_changed`. Replacement adoption clears selection, drafts, focus, and draft history; replies from the old project cannot apply local follow-ups to the new one. |
| P2: an old agent reply could end a new session | Hold a model-change request, stop its session, start Restore, then release the held request with a fault | Tool continuations check their session generation before changing the transcript or advancing the session. Stopping does not cancel a request already sent to the server. |
| P2: provenance could cite an unrelated UI operation | Record a local action before applying a server edit; server and UI log numbers diverged | Imported operations keep the server's IDs. Each server lifetime has its own ID namespace; UI actions and fixture history use separate namespaces. Saved/fixture provenance remains historical when its log is unavailable, without falsely identifying a current operation. |
| P2: Apply erased newer unsent draft history | Hold Apply, edit another value while waiting, then release | Draft changes, discard, undo, and redo wait until Apply answers. Table cells and action explanations disclose the wait. A failed Apply keeps the original drafts and undo history; a successful Apply clears submitted history. |

Implementation: `src/server/server.ts`, `src/server/transport.ts`, `src/server/fixtures.ts`,
`src/app/service/projectClient.ts`, `src/domain/workbench.ts`, and their UI/agent callers.
Seven unit regression cases and one browser test were added. Each unit regression failed against the preceding
implementation before its fix. A second review checked the fixes and identified the fixture namespace gap,
which was also fixed.

## Verification

Final code at `2238e0a`:

- `npm ci` with Node 24.21.0 and npm 11.19.0; no dependency changes.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: passed.
- `npm test`: 200 tests across 23 files passed.
- `npm run test:e2e`: 60 tests passed in Edge, 1280x800, 4 workers. The new browser case exercises a held Apply,
  a blocked cell editor, Ctrl+Z preserving the submitted draft, and editing becoming available after the reply.
- `npm run test:e2e:preview`: production build and 2 tests under the Pages base path passed.
- `git diff --check`, `git diff --cached --check`, and manual staged-diff review: clean; no credentials found.
- Local `master` and the review branch had identical code after the fast-forward. The reference checkout remained clean.

An initial concurrent run of the two Playwright configurations produced missing trace-file errors because both
use `test-results/`; one docking assertion also failed in that run. Running the full development suite on its own,
then preview on its own, passed. Keep those two commands sequential. Existing build chunk-size and hidden-chart
dimension warnings remain outside these fixes.

## Step 2: evidence and pending directions

No lifecycle UI has been implemented. The handoff requires discussing this slice before building it.

Observed in the read-only RC reference, `feature/archetype-library-schedule-registry` at
`7464c140fc5d9a49a2ca59954a85ac199a0faf09`:

- `EnergyAtlasWeb/Controllers/ProjectController.cs`: `GET /api/project` returns `loaded: false` without an open
  project. Create, Open, Save, and Close have distinct endpoints. Session replacement closes the prior session and
  cancels its jobs. Open records the project in recent history. Create/Open use a folder or project JSON path.
- `EnergyAtlasWeb/wwwroot/workflow-pages/setup/project-setup.html`: the setup page collects a project name and
  folder before creating the project and advancing the workflow.
- This demo currently creates or restores one synthetic project at startup and saves one browser-local snapshot
  (`src/app/WorkbenchContext.tsx`, `src/server/persistence.ts`). There is no no-project state or recent-project catalog.

Interpretation/recommendation: expose the no-project state deliberately, while retaining the mock server as owner
and the existing shared command paths. Do not copy RC implementation or imply real filesystem access.

| Direction | Experience | Tradeoff |
| --- | --- | --- |
| A: dedicated start screen, recommended | Recent projects, Open, and Create before entering the workbench; File returns to project choice | Clearest boundary between choosing a project and working in it; requires an explicit session state outside the workbench. |
| B: Projects page inside the workbench | Keep the shell visible while choosing, opening, or creating | Reuses docking, but model actions need clear unavailable states until a project is open. |
| C: chooser dialog at launch | Compact project choice over the shell, then the existing workbench | Small visual change; closing or cancelling with no project requires special handling and is less useful for browsing recent work. |

These are pending alternatives, not accepted decisions. The owner was asked to choose the entry flow. No answer
was available when this record was written; continue that discussion before implementation.

Proposed slice boundary for discussion: real start/open/create/close transitions, form validation, recent-list
interaction, save status, failure recovery, and unsaved-changes protection; mocked project catalog, storage,
locations/picker, latency, and faults; real RC connections, authentication, and native pickers deferred to RC.
Resolve warm-start behavior and switching with active jobs, unsent drafts, or a failed save as part of the design.
Cover empty/loading/success/warning/error states, keyboard use, and stale request isolation in its acceptance checks.
