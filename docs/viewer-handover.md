# The viewer page and handover package: plan and status

Date: 2026-10-28. Stage 5 of 6 of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed.

## The owner's decision

A separate viewer page (direction B of the [next stages discussion](next-stages-discussion.md#3-a-viewer-page-for-handover))
opening a frozen handover package (direction C), handed over by catalog and file. The mock server refuses every model
change from a viewer session on the same command path as the edit lock. Features the viewer cannot use are left out
of its page, not shown disabled, and its shell shows a View only badge. The viewer's agent answers questions,
interprets, and changes views, never the model. Project layouts travel in the package and stay read-only there; a
viewer's own layouts are personal, and resetting returns to the handed-over layout. Result versions are deferred, so a
package carries the current published results only.

## Observed in RC (read-only, RCEnergySimulator at `7464c140`)

Recorded in the [next stages discussion](next-stages-discussion.md#view-only-access-and-saved-layouts): RC has no
authentication, roles, view-only mode, or sharing (`EnergyAtlasWeb/Program.cs:46-47` binds Kestrel to localhost); the
nearest mechanism is `Runtime/ProjectEditGate.cs`, which refuses mutating requests with 409 `run_in_progress` while a
run holds the project; pages keep presets in `localStorage`. The viewer's refusal reuses that gate's place in the
command path; everything else here has no RC counterpart.

## What was built

| Part | Where |
| --- | --- |
| Package: shape, freezing, warnings, validation, file name | `src/server/handover.ts` (`HandoverPackage`, `freezeModel`, `buildHandoverPackage`, `handoverBlocker`, `packageWarnings`, `readHandoverPackage`, `readHandoverText`, `packageFileName`) |
| Browser catalog | `src/server/handoverCatalog.ts` (`eaui.handovers.v1`) |
| Server: hand over, viewer sessions, the refusal | `src/server/server.ts` (`mode: 'viewer'`, requests `project.handover`, `handover.list`, `handover.open`, `handover.remove`; `meta.viewOnly`, `meta.handover`, `meta.packages`), `viewOnlySession()` in `src/server/apiError.ts` |
| Client | `handOver`, `listPackages`, `openPackage`, `removePackage` in `src/app/service/projectClient.ts` |
| Modeller | File > Hand over… (`file.handOver` in `src/app/actions.ts`), `src/app/handover/handoverService.ts` (`services.handover`), `src/app/handover/HandoverDialog.tsx`, the `project.handover` agent tool |
| Viewer entry | `viewer.html`, `src/viewer/main.tsx`, `ViewerApp.tsx`, `ViewerStart.tsx` (package list), `ViewerShell.tsx`, `viewerActions.ts` (`forViewer`, `forViewerStart`), `viewerStore.ts`; two inputs in `vite.config.ts` (`build.rolldownOptions.input`) |
| One app, two modes | `WorkbenchProvider mode="viewer"` and `useViewOnly()` in `src/app/WorkbenchContext.tsx` |
| Viewer layout | `LayoutShape`, `VIEWER_LAYOUT`, `VIEWER_LAYOUT_KEY`, `hasPage`, `hasPanel` in `src/app/layout/layoutController.ts`; `setPersonalKey`, `resetToHandedOver` in `src/app/layouts/layoutLibrary.ts`; `viewerLayoutsKey` in `personalLayouts.ts` |
| Viewer agent | `isViewerToolCall`, `describeAgentTools({ viewOnly: true })` in `src/app/agent/tools.ts`; `VIEWER_SESSIONS`, `asksForModelChange`, `VIEW_ONLY_ANSWER` in `sessions.ts`; `viewOnly` in `scriptedAgent.ts` |
| Shared components | `ViewOnlyBadge` and `HandoverSummary` (`src/app/components/HandoverSummary.tsx`), in the gallery; `ReadOnlyDefinition` (`src/app/properties/`) |

### A package

```ts
type HandoverPackage = {
  format: 'energyatlas-ui.handover'
  version: 1                 // a later version is refused as made by a newer EnergyAtlas
  id: string                 // handover:<uuid>
  name: string               // the project name
  createdAt: string
  provenance: {
    projectId, projectName,
    savedAt: string | null,  // the modeller's last save
    unsavedChanges: boolean, // the modeller had unsaved changes, which the package leaves out
    handedOverBy: 'manual' | 'agent' | 'system',
    stages: { id, name, state, finishedAt, runId }[],   // states at handover
    results: { id, label, runId }[],                    // the published results it carries
    excluded: { heldOutputs, jobLogLines, drafts },     // counts of what was left out
  }
  model: WorkbenchState      // validated by projectStateSchema, migrations included
  view: SavedView            // table settings, map layers, project layouts and default
}
```

A package is frozen from the copy of the project saved in this browser, never from unsaved changes (the owner's
answer to decision 2, 2026-10-28). Freezing (`freezeModel`) keeps everything published (buildings, definitions, results, calibration variants, jobs and
run groups as records) and removes held job outputs, every job log line, drafts, the selection, and the focused stage.
Reading a package (`readHandoverPackage`) refuses, with a message each: a file that is not JSON, JSON that is not a
package, a later format version, a damaged package (the first failing path is named), provenance naming another
project, and a package that still carries working data.

### Hand over (modeller)

File > Hand over…, the palette, and the agent's `project.handover` tool (waits for approval) use `services.handover`.
The dialog says what a package holds and leaves out, previews the warnings the package will carry when nothing is
unsaved, warns that unsaved changes (model, views, project layouts, drafts) stay out of the package, and explains a
blocker (never saved, a saved copy saved while jobs ran or without buildings, a pending request). Before the first
save, File > Hand over… is unavailable with that reason. After handing over it shows the package's summary, Download
package (a `.handover.json` file), and Open in the viewer (`viewer.html?package=<id>`, a new tab). The package is
written to `eaui.handovers.v1`; when storage is full or unreadable the package is still returned for download and
the dialog says it was not kept.

### The viewer page

`viewer.html` is a second Vite entry. It creates the same services with `mode: 'viewer'`: the mock server in viewer
mode, the layout controller with the viewer's shape and its own arrangement key, the layout library with read-only
project layouts and a personal key per package, the scripted agent with viewer sessions, and the same view store,
messages, and project client.

- **Package list** (start screen): the catalog newest first, a selected package's provenance and warnings, Open
  package, Remove from this browser… (confirmed inline), and Open package file… (a browser file input, Ctrl+O). A link
  with `?package=<id>` opens that package once the list loads.
- **Shell**: the ribbon with the View only badge and the package name; File (Open package file…, Handover packages…,
  About this handover…), View (pages, panels, docking, layouts, appearance, Reset to handed-over layout), Help. No
  Edit or Run menu, no Save, Undo, or Run buttons. The package's warnings sit under the ribbon until dismissed. The
  status bar shows when the package was handed over instead of the save state, and leaves out Issues, Jobs, the
  current stage, and the simulated workers.
- **Pages and panels**: Map, Table, Dashboard, Results; Assets, Properties, Messages, Reasoning. Left out: Roadmap,
  Measures and scenarios, Settings, Issues, Jobs, Schema matching, Data intake, Archetypes, Calibration, Account, and
  the Workflow panel.
- **Inside shared pages**, `useViewOnly()` leaves out: the Table's cell editing, pending-edit count, Apply, and Discard
  (a note says cells cannot be edited); empty states' Run and Show Workflow buttons (they say the package does not
  include the data); the Dashboard's Run on outdated results, Open Measures and scenarios, and Apply adoption (the
  what-if preview stays, unsaved); definition editors in Properties (`ReadOnlyDefinition` shows a definition or stage
  as handed over); Asset page links to pages the viewer lacks; the demo switch's fixture loader; the Layouts dialog's
  project scope choice and the Update, Rename, Duplicate, Delete, and default controls of handed-over layouts.

### The server's refusal

A viewer session sets `meta.viewOnly`. `handleCommand` refuses every server command (every model change, run, retry,
and cancel) with 403 `view_only` right before the run lock's `run_in_progress` check, so nothing reaches the engine
even when a UI bug or a crafted request sends it. Save, create, open, fixtures, list projects, and hand over are
refused the same way; only `handover.*` and `project.close` (back to the list) are served. The UI's workbench also
refuses drafts (`edits.propose`, `edits.discard`) in the viewer. Local commands (selection, focus) and view operations
work as in the modeller.

### Layouts in the viewer

Opening a package applies its default project layout, as opening a project does. Handed-over layouts are listed as
read-only (Apply, Copy to personal). Personal layouts are kept under `eaui.viewer.layouts.v1:<package id>`, apart
from the modeller's `eaui.layouts.v1` and from other packages. Reset to handed-over layout (View > Layouts, palette,
agent `layouts.resetToHandover`) applies the package's default layout, or the viewer's default arrangement with the
package's table settings and map layers when it has none; personal layouts and handed-over layouts are unchanged. The
viewer's arrangement autosaves under `eaui.viewer.layout.v1`.

### The agent

`describeAgentTools({ viewOnly: true })` lists no server command, draft, lifecycle, or handover tool, no view
operation of a page the viewer lacks, and no `layouts.setDefault`; `executeToolCall` refuses such a call before it
reaches the client. Its sessions are Explain the published results (totals, currency, the highest-demand building
drilled into and selected), Map beside Table with the tallest buildings, and Reset to the handed-over layout. A
message asking to run, change, add, delete, adopt, save, and the like gets the view-only answer; a session that
needs data the package lacks says so instead of offering a run.

## States

- **Empty**: "No handover packages in this browser yet" with where to get one; a package without saved layouts says
  so in the Layouts dialog; pages with no published data say the package does not include it.
- **Loading**: "Loading handover packages…" while the catalog is read; "Opening "name"…" while a package or file is
  opened; the dialog's "Preparing…" while handing over.
- **Success**: the dialog's handed-over summary; the shell with the View only badge; Messages and the status bar
  report each operation.
- **Warning**: packages with no published results or with outdated or failed result stages (warning icon in the list,
  the summary's alerts, and the band under the ribbon); stored packages this version cannot read (kept unchanged);
  a package not kept because storage is full (still downloadable).
- **Error**: invalid file (not JSON, not a package, damaged, carrying working data), a newer format, an unreadable
  catalog (with Try loading packages again), a package removed from the catalog meanwhile, and server refusals.
- **Keyboard**: the package list is a `SelectableList` (arrows, type-ahead, Enter opens); Ctrl+O opens a file; the
  ribbon, palette (Ctrl+K), layouts (Ctrl+Alt+L), and F6 docking work as in the modeller; the remove confirmation
  focuses Keep it.

## Real, mocked, deferred

- **Real**: freezing and validating packages, the browser catalog, the package file download and file input, the
  view-only server session and its refusal, the viewer entry under the Pages base path, read-only handed-over layouts,
  per-package personal layouts and the reset, the viewer's agent tool filter and sessions.
- **Mocked**: "handing over" is a browser-local catalog and a file, served by the in-page mock server (decision
  0023); there is no sharing, account, or access control, which belong in RC (decision 0022). A viewer session is
  read-only because the viewer page asks for it; a real server would bind that to the person, not the page.
- **Deferred**: result versions (a package carries current published results only); exporting more than results
  (the Results page's CSV export works); a Roadmap page and Issues list in the viewer; a viewer's own annotations or
  comments; pruning or size limits for the catalog beyond the browser's quota.

## Decisions taken for review

1. **`viewer.html` as a second Vite entry**, not `?viewer`: the Pages base path works for a second HTML file (the
   build emits `dist/viewer.html` with prefixed asset URLs, and `npm run test:e2e:preview` opens it under the base
   path), and the viewer's entry imports only the pages it shows.
2. **The package freezes the copy saved in this browser** (the owner's answer, 2026-10-28, choosing "saved copy
   only" over the built default of the server's current model). Unsaved model changes, view changes, project layout
   changes, and drafts stay out; the provenance records when the copy was saved and whether there were unsaved
   changes, and the dialog warns before handing over. Handing over neither saves nor discards them. A project never
   saved cannot be handed over.
3. **Hand over is refused when the saved copy was saved while jobs ran** (and when it has no buildings): a running job
   would freeze as "running" forever and its held output is excluded anyway. Jobs running now do not block a handover
   of a copy saved before them.
4. **Jobs and run groups stay in the package as records** without logs or held outputs, so stage states and result
   provenance (the run that published a result) derive as in the modeller; the viewer has no Jobs page to show them.
5. **A package with working data is refused**, not cleaned, so a tampered or foreign file cannot smuggle drafts,
   held results, queued or running jobs, or open runs into a viewer. Freezing closes a run the modeller left open (a
   partial failure awaiting retry) as cancelled, so the modeller never writes one. Results and stage states in the
   provenance are derived from the model when a package is read, never trusted from the file.
6. **Format versioning**: `format` names the file type, `version` 1; a higher version is refused as "made by a newer
   version"; the model inside goes through the saved-project migrations (`projectStateSchema`).
7. **Viewer pages**: Map, Table, Dashboard, Results; panels Assets, Properties, Messages, Reasoning. Roadmap (named
   read-only in direction B) is left out because every stage card carries run and edit controls; stage states at
   handover are in About this handover.
8. **Demo conditions stay on the viewer page** (delay, faults, offline, held requests) because they exercise its
   loading and error states over the same mock transport; the fixture loader is left out. Direction B had left Demo
   conditions out.
9. **The Dashboard's what-if adoption preview stays** in the viewer as an unsaved preview; Apply is left out.
10. **Properties shows definitions read-only** with `ReadOnlyDefinition` (kind, name, a few facts, "Definitions are
    edited in the modeller") rather than the modeller's editors in a read-only state, which would show Save and Cancel
    disabled.
11. *(Replaced by [decision 0033](decisions/0033-project-layouts-panel-and-scenarios-page.md): there are no personal
    layouts; the viewer applies the handed-over layouts in the Layouts panel and can reset to the handed-over one.)*
    **Personal layouts are keyed per package** (`eaui.viewer.layouts.v1:<package id>`): a new handover of the same
    project starts without the earlier package's personal layouts. Keying by project would carry them over; per
    package was chosen so a layout never meets views it was not made for.
12. **Reset to handed-over layout** returns to the package's default layout, else to the viewer's default arrangement
    with the package's table settings and map layers; the modeller's "Reset to layout" (last applied) stays too.
13. **Opening a package applies its default project layout**, and tabs the viewer does not show are dropped silently
    (tabs no version knows are still reported).
14. **Packages can be removed** from the viewer's list and from the modeller's Hand over dialog (both confirmed
    inline), which lists the packages kept here with their sizes; removal also deletes that package's personal
    layouts (`eaui.viewer.layouts.v1:<id>`). Downloaded copies are unaffected. **No catalog cap**: the browser's quota
    is the limit, and a refused save names the space packages take (about 550 KB for the complete fixture) and where
    to remove them; a count cap would refuse a small package while doing nothing about one large one.
15. **The agent's Hand over tool waits for approval** in the modeller. In the viewer, a message first starts a
    matching viewer session; otherwise it gets the view-only answer when it names work only the modeller starts
    (rerun, adopt, calibrate, retry, import) or a change verb on a model object (measure, scenario, archetype, rule,
    stage, adoption, building, …) without a view word (layer, map, colour, layout, table, season, …), and the view
    help answer otherwise. "Add a heat layer", "set the season", or "save my layout" are not refused.
16. **The viewer's status bar** shows when the package was handed over instead of save state, and leaves out Issues,
    Jobs, the current stage, and the simulated worker count.
17. **The viewer has no permission modes**: they govern runs and model changes, which its agent never makes; the
    menu is left out and the agent asks before the only approvals left (updating or deleting a personal layout).
18. **The viewer's job runner never starts**: a viewer session's mock server does not start the task simulator, which
    executes on the engine directly, past the view-only refusal.
19. **A package file is size-checked before it is read** (20 MB), and the package list refreshes when another tab
    changes the catalog or the window regains focus.
20. **A stage reference** from a future viewer session opens the stage's read-only properties instead of the Roadmap,
    which the viewer lacks.

## Known issues and limits

- The package is large (the full model, about the size of a saved project); a browser catalog of several packages
  can fill `localStorage`, which the dialog reports and Download covers.
- The model-change detection is a scripted keyword heuristic: "change the adoption" is refused while "show the
  adoption" is not, and a message matching a viewer session (such as one mentioning results) starts that session
  even if it also asks for a change.
- The viewer's server session is read-only because the page asks for it (`mode: 'viewer'`); the modeller and the
  viewer each run their own in-page mock server, as every tab does (decision 0023).

## Review (2026-10-28)

An independent review's findings, all fixed on `claude/next-stages`:

- **High**: a forged package with a queued job and an open run made the viewer's job runner run and publish it,
  bypassing the view-only refusal, and left the viewer unable to close the package. Packages with queued or running
  jobs or open runs are now refused, freezing closes open runs, and a viewer session never starts the job runner
  (unit tests for each).
- The viewer's agent refused view changes ("add a layer", "save my layout") and its answer said nothing could be
  saved: sessions now match first, the refusal needs a model object (decision 15), and the answers were corrected.
- Packages share storage with saved projects: a failed save now names the space packages take and where to remove
  them, the modeller's Hand over dialog lists and removes packages, and removal deletes the package's viewer layouts.
- The viewer's Reasoning panel no longer offers permission modes; the provenance's results and stage states are
  derived from the model; the file size is checked before reading; `DefinitionCard` (the read-only definition) is in
  the gallery; the package list refreshes on other tabs' changes and on focus; stage references no longer open the
  Roadmap in the viewer.

## Saved copy only (2026-10-28)

The owner answered decision 2: a handover packages the saved copy only. `project.handover` now builds the package from
the project's catalog entry (`restoreProject`, its saved views and layouts) instead of the server's current model;
the request carries `viewUnsaved` instead of the UI's current views, for the provenance only. The client's blocker
names `NOT_SAVED_FOR_HANDOVER` before the first save, and `handoverBlocker(state, 'saved')` words its refusals for
the saved copy. Unit tests cover a project never saved, a package holding the saved zoning after an unsaved
`zoning.set` (with the modeller's change kept), and the saved-copy blockers; the viewer spec checks the unavailable
menu item, the dialog's warning, and that a project layout added after saving is not in the package. The other
handover specs save first. Verification is in the completion report.

## Verification (2026-10-28)

After the review fixes: typecheck, lint, format check, `git diff --check`: clean. `npm test`: 494 passed in 48 files
(6 new: forged packages refused, open runs closed by freezing, no job runner in a viewer session, provenance derived
from the model, modeller listing and removal with the viewer layouts key, a full-storage save naming packages, and
view versus model requests to the agent). `npm run test:e2e` on port 5180: 125 passed with 4 workers (the viewer spec
now also removes a package from the modeller's dialog and checks the viewer has no permission modes).
`npm run test:e2e:preview`: 4 passed.

Before the review:

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean.
- `npm test`: 488 Vitest tests in 48 files passed (17 new: `src/server/handover.test.ts` covers what a package keeps
  and leaves out, file round trips, corrupt, foreign, newer, damaged, and unfrozen packages, warnings, the handover
  blocker, the catalog, a full storage, the viewer session refusing every server command at the server and through the
  client while selection still works, files, removal, and an unreadable catalog; `src/app/agent/viewerAgent.test.ts`
  covers the viewer's tool list, a refused call that never reaches the client, the view-only answer, missing data
  explained instead of a run, the modeller's Hand over tool, the viewer's layout shape, per-package personal layouts,
  and the reset).
- `npm run test:e2e` (dev server on port 5180, as port 5173 is held by the owner's RC build): 125 Playwright tests
  passed with 4 workers, including the 4 new in `e2e/viewer.spec.ts`.
- `npm run test:e2e:preview`: 4 passed, including the viewer opened under the Pages base path.
- Screenshots of the Hand over dialog, the package list, and the viewer shell in Light and Dark at 1280x800 and the
  shell at 900x700 were reviewed and deleted.
