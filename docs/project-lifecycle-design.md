# Project lifecycle: proposed slice

Date: 2026-10-26

Status: implemented on `codex/project-lifecycle` for review. The dedicated start-screen direction is accepted ([decision 0024](decisions/0024-dedicated-project-start-screen.md)).
The owner also accepted confirmation before cancelling active jobs when leaving or switching. The remaining details
below are implementation choices based on those decisions, not additional owner decisions. Implementation follows
the [plan](project-lifecycle-plan.md), roadmap step 2, and the handoff's discussion checkpoint.

## Intended experience

Launch into the start screen. Put the existing EnergyAtlas mark in the header, followed by a compact working
surface with Recent projects, Open project, and Create project. Use the existing family framing, type scale,
appearance tokens, control grammar, and keyboard focus styling; no new branding or display-font treatment.

Recent rows show the project name, its browser-local location, and last-opened/saved metadata. A recent row opens
that project through the service. An empty list explains that no project has been saved here and offers Create.
The interface states that projects are stored in this browser and are synthetic demo data.

Create asks for a project name, with validation next to the field, then opens a new empty workflow. Open uses the
mock browser-local project catalog; it does not imply access to an arbitrary folder on disk. Recent is the short
list of recently opened projects; Open exposes all saved projects. Demo fixtures remain available as demo
conditions rather than being presented as the user's saved work.

File > Projects returns to the start screen. File > Open and File > New show their choice/creation dialog and use
the same transition guard before replacing the current project. Choosing another project replaces the session only after the requested open
or create succeeds; a fault leaves the current project available. Avoid exposing workbench model controls when
there is no active project.

## Save and leaving a project

- Track applied model changes and unsent table drafts separately. Selection, layout, appearance, and view changes
  do not make the project model dirty.
- Save status distinguishes Unsaved changes, Saving, Saved with a time, and Save failed. A failed save retains the
  working model and any drafts not already applied, and offers retry.
- Save persists the applied model. When unsent drafts are present, explicitly offer Apply and save, rather than
  silently applying them. Failed validation returns to the current project and shows its field issues.
- Leaving with unsaved work offers Save and leave, Discard and leave, and Cancel. With drafts, make the primary
  action explicitly Apply, save and leave. Cancel changes nothing. Discard affects the unsaved working copy, not
  the saved project in the catalog. A failed Apply or Save keeps the current project open.
- During a pending save/open/create/close, explain the wait and prevent duplicate transition requests. Preserve
  the project-generation check from the review fixes so delayed requests cannot edit a replacement project.
- Browser reload or tab close uses the browser's own unsaved-work prompt when needed. Do not promise that
  asynchronous saving can finish during unload.

## Active jobs: accepted confirmation

The owner chose option 1 on 2026-10-26; option 2 was not selected:

1. **Confirm cancellation, recommended:** the leave/switch guard shows the active-job count and makes clear that continuing
   cancels them. Cancel the jobs before closing their project session. If unsaved work also exists, disclose the
   cancellation in the same guard; do not cancel jobs before the user commits to leaving.
2. **Require Jobs first:** refuse switching while jobs are active, explain why, and offer Open Jobs so the user can
   finish or cancel them manually.

RC cancels jobs when replacing the project session (`ProjectController.StartSession` and `CloseSessionAsync` at
`7464c140`). That is the basis for the recommendation the owner accepted.

## Service and storage recommendations

- Represent closed, opening/creating, open, and closing states explicitly at the application-session boundary.
  Keep domain project state separate from the session and pending requests; do not represent no project as a
  loaded, editable empty project.
- Extend the existing mock service with catalog/recent queries and create/open/close requests. The UI and future
  agent tools use those same operations, including validation, transition guards, pending states, and failures.
- Store several named project snapshots with stable project IDs. Keep last opened and last saved separate.
  Creating a project and later saving it must not overwrite a different project with the same display name.
- Preserve the existing `eaui.project.v2` snapshot by exposing it as an existing project during catalog migration.
  Do not delete the old key or replace a readable saved project with an empty one after a migration/storage error.
- Save the model snapshot, not the selection, unsent drafts, or Reasoning transcript. Existing appearance and
  layout preferences continue to be application preferences. Session replacement clears project selection,
  drafts, focused stage, view state that refers to old entities, and active scripted-agent continuations.
- Keep demo faults/delay and held requests usable from the start screen, so failed catalog loading, failed open,
  failed create, and failed save can be reviewed and tested.

## Real, mocked, deferred

| Boundary | Scope |
| --- | --- |
| Real interaction | Start screen, named creation, recent-list interaction, project selection, open/close transitions, validation, pending/error feedback, save status, unsaved-work guard, keyboard navigation |
| Mocked services | Project catalog and its selector, browser-local persistence as a stand-in for server/filesystem storage, request delay/faults, computation/jobs |
| Deferred to RC | HTTP/SignalR connections, real folder/native pickers, authentication and permissions, shared/multiwriter storage |

## Acceptance coverage

- Empty catalog; existing migrated project; several recent projects; duplicate display names without data loss.
- Create/Open success, field rejection, offline/server failure, held and delayed requests, and retry.
- Save success and failure; drafts remain unsent until explicit Apply; Apply rejection preserves the project.
- Cancel leaves the same project, selection, drafts, and job state available; Discard leaves the saved snapshot
  unchanged; a failed Save prevents leaving. Test the selected active-job policy.
- Old commands/replies/agent callbacks cannot mutate or resume against a new project. A failed replacement retains
  the previous usable session.
- Start screen, forms, recent rows, and transition dialogs work by keyboard with focus restoration; verify desktop
  and narrow layouts, all appearances, no serious/critical axe findings, and the production Pages base path.
- Existing workflow, docking, map/table selection, scripted-agent, and fixture deep-link tests remain meaningful.
  Adapt normal entry tests to exercise the start screen instead of adding an undisclosed production bypass.

## Implementation and limits

- Catalog and validation: `src/server/projectCatalog.ts`, `projectSchema.ts`, `projectValidation.ts`; the old
  `eaui.project.v2` snapshot is imported in memory without rewriting it, and the first successful catalog save writes
  `eaui.projects.v1`. Saved identities remain separate from fixture and newly created project IDs. Malformed state
  is rejected, including nested task logs, assets, workflow edges/references, missing collections, and graph cycles.
- Session operations: `src/server/server.ts`, `src/app/service/projectClient.ts`; an unloaded server update has
  `state: null`. `ProjectStart` renders instead of the workbench until a project is open. Fixture URLs explicitly
  enter the workbench for demo review; normal reload shows the start screen.
- Guard/controller: `src/app/service/projectLifecycle.ts`; manual actions and the `project.*` tools share it.
  Committed create/open/close/fixture transitions fence off new model commands, drafts, and history until the reply.
  Cancellation happens only after confirmation. A failed Apply/Save keeps the current project open; jobs already
  cancelled under that confirmation stay cancelled rather than silently restarting.
- For ordinary Save with drafts, offer Apply and save, Save applied changes only, or Cancel. Applying remains
  unavailable while a run holds the edit lock; confirmed leaving can cancel jobs first. Save status/error is scoped
  to the current session. Browser before-unload confirmation supplements the in-app guards.
- Project changes reset selection, draft history, focused stage, project view state, the Inspection surface, and
  scripted-agent transcript/queue/timers. Layout and appearance preferences remain application-wide.
- The start screen exposes all appearances and Demo conditions. Pending lifecycle dialogs also expose Demo
  conditions so held requests can be released; pending controls do not create an inescapable modal.
- Creation uses a disabled submit control plus an explicit live status. This is a deliberate exception to the usual
  React Aria `isPending` recipe: in version 1.21.1 its Button leaves live-announcer `role=img` nodes referencing the
  button after the modal unmounts, producing invalid names in the next surface. Other forms whose buttons stay
  mounted keep `isPending`.
- Storage remains one catalog per browser origin and one in-page server per tab, without multiwriter coordination.
  No real project folder picker, JSON import/export, rename/delete, authentication, or real backend is introduced.
  Create is usable without browser storage, with a visible inability to save; corrupt storage is never overwritten
  automatically. Opening and recent history remain limited to browser-local snapshots.

## Verification record, 2026-10-26

- `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`: passed; 224 unit tests across 26 files.
- `npm run test:e2e`: 68 tests passed in Edge at 1280x800 with 4 workers (4.3 minutes on this run).
- `npm run test:e2e:preview`: production build and 2 tests passed under the Pages base path.
- `git diff --check` and local Markdown target checks passed; staged diff and credentials review is required before
  the final commit. Dependencies and package lock are unchanged. The RC checkout remained clean and read-only.
- Focused browser cases exercised normal Create/Open/Recent/Save, equal-name project separation, Stay preserving
  drafts/jobs, explicit Apply/save/leave, failed-save retention, and unreadable catalog handling.
- An independent review reproduced and drove fixes for delayed-transition edits, fixture identity collision,
  queued-agent delivery crossing sessions, incomplete saved-state validation, hidden name errors, and save status
  leaking across projects. Follow-up review found no remaining actionable issue in those paths.
- `e2e/project-lifecycle.spec.ts` regenerates start/create/guard captures under ignored `tmp/lifecycle-*.png` for six
  appearances at 1280x800, 1600x1000, and 900x700. It waits for theme transitions to settle before screenshots/axe,
  checks horizontal overflow and dialog focus restoration, and runs axe in every appearance at 1280x800.
  The matrix passed and representative captures in every appearance were inspected for layout and legibility.
  Regenerate with `npm run test:e2e -- e2e/project-lifecycle.spec.ts --grep "every appearance"`.
- During development, formatting while the Vite browser run was active caused a stale-context hot reload. Source
  is held fixed during final browser checks. Run development and preview checks sequentially; they share artifacts.

Next: owner review of `codex/project-lifecycle`, then integration if requested. No push or merge of this slice has
been performed; the next roadmap slice is Jobs after this lifecycle review.
