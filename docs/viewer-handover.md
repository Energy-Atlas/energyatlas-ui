# The viewer page and handover package: plan and status

Date: 2026-10-28. Stage 5 of 6 of [decision 0032](decisions/0032-next-stages-directions.md), built on
`claude/next-stages`; not merged into `master`, not pushed.

## Views, Save as, and the viewer shell (2026-10-29): decision 0036

[Decision 0036](decisions/0036-owner-review-of-next-stages.md) renames the handover package to a **view** in the
interface and reworks the viewer. Built on `claude/0036-views-dialogs`, not merged, not pushed. Sections below this
one describe stage 5 as first built; where they disagree, this section wins.

### File > Save as… (replaced File > Hand over…)

`src/app/handover/SaveAsDialog.tsx`, opened by File > Save as… (`file.saveAs`, Ctrl+Shift+S, the palette) through
`services.handover.openDialog()`. A radio group chooses:

- **Project**: a fully editable, runnable copy. `services.lifecycle.saveAs(name)` validates the name, refuses while a
  request is pending, and sends `project.saveAs` (`client.saveProjectAs`), which keeps the copy as a new project in
  this browser's catalog with a new id and returns it as a **project file** (`src/server/projectFile.ts`, format
  `energyatlas-ui.project` version 1, `<name>-<date>.project.json`). The copy holds the project **as it is now,
  unsaved changes and the current views included** (it is a new project, so nothing is overwritten); unsent table
  drafts are not copied, and running jobs are interrupted in the copy as on reopening. The open project stays open;
  the dialog then offers Download project file and Open the copy (`lifecycle.request({ type: 'open' })`, so leaving
  the original asks first). **Open project file…** (File menu and the start screen; `ProjectFileInput`,
  `lifecycle.request({ type: 'openFile' })`, server request `project.openFile`) opens a project file, keeping it in
  this browser; a file of a project this browser already keeps opens as a copy beside it, and a view file, a newer
  format, or a damaged file is refused with a reason.
- **View**: the former handover. It still packages **the copy saved in this browser**, and says so ("Unsaved changes
  stay out"), keeping the owner's answer to decision 2 below. Choice: a view is published, frozen state for others;
  packaging unsaved work would hand over results nobody saved, while the Project choice already covers "save what I
  have now". Save first (Ctrl+S) to include changes. After saving: the view's summary, Download view file
  (`<name>-<date>.view.json`), Open in the viewer, and the views kept in this browser (`ViewsInBrowser`) with Remove
  from this browser… confirmed in the shared dialog (`RemoveViewDialog`).
- **Deferred**: parametric or batch views (several views per project) are named as planned in the dialog, with no
  controls; views that reference a model on a user's server ("copy or reference") are a later discussion.

Compatibility: storage keeps `eaui.handovers.v1` and the `energyatlas-ui.handover` format version 1, so views saved
before still list and open; files named `.handover.json` open as before (the viewer reads content, not the name).
Code names (`services.handover`, `HandoverPackage`, `handover.*` requests, the `project.handover` agent tool) keep
their names; only interface text says "view".

### The viewer start page

`src/viewer/ViewerStart.tsx` now uses the project start screen's layout (`StartScreen` and `StartSection` in
`src/app/project/StartScreen.tsx`, which `ProjectStart` uses too): the menu bar, the heading **Views**, a line saying
what a view is, **Open view file…**, the open error under the buttons as on the Projects screen, then two sections
side by side: **Views in this browser** (a `SelectableList`; Enter opens) and the chosen view's provenance with Open
view and Remove from this browser… (confirmed in the dialog; focus returns to the button, or to the heading once the
last view is gone). It opens views only. A refresh (another tab, window focus) keeps the lists on screen; only the
first read shows "Loading views…".

### The viewer shell is the editor's shell

- **No title in the top bar**; the **View only** tag (same design, `ViewOnlyBadge`) sits in the status bar next to the
  view's name, and the save-state slot reads "View saved <date>".
- **All five menus and the toolbar** come from the shared registry through `forViewer` (`src/app/actions.ts`): every
  editor action stays, and what a view cannot do is unavailable with its reason (Edit: nothing can be changed or
  undone; Run: a view runs nothing; Save, Save as, New, Open project: views are saved and projects opened in the
  modeller; pages and panels the viewer lacks; Save layout; the Account page). Pressing one reports the reason, as
  everywhere. The viewer's own File items lead the menu: Open view file… (Ctrl+O, which `file.openProject` gives up in
  the viewer), Views… (back to the start page), About this view…; View > Layouts has Reset to the view's layout.
- **Status bar**: Issues and Jobs stay with their counts, unavailable ("The viewer has no Jobs page: a view runs
  nothing"); the current stage and the simulated workers show as in the editor.
- **Account button** shown as in the editor; its Account page item is unavailable, Log out reports the planned
  sign-in as in the editor.
- The viewer keeps its pages (Map, Table, Dashboard, Results) and panels. The server's refusal of every model change
  is unchanged (`viewOnlySession()`), and the scripted agent's refusal answer stays.

### Messages, not banners

- The view's warnings (no published results, results outdated relative to the model, failed result stages) were a
  band under the ribbon that pushed the workspace down. They are now **warning messages** posted when a view opens
  (`openPackage` in `src/viewer/viewerStore.ts`): a toast that stays until dismissed, and the Messages panel.
  About this view still lists them.
- The Dashboard's "Scenario results are outdated" band (editor and viewer) became an **Outdated** state badge beside
  the Dashboard title (the full sentence is its tooltip and screen-reader text), with Run <stage> in the header's
  actions in the editor; in the viewer the view's warning message says it.
- Elsewhere: Schema matching's rule set notice (Saved, Loaded, a file not read) pushed its section down; outcomes are
  now the operation's own message, plus a warning message for skipped mappings and an error message for an unreadable
  file. Asset without a page: an **info** note (toast and Messages), not a red failure.
- Kept: start screens (Projects and Views) show why the last open failed under their buttons, as decision 0024's
  screen does; they have no status bar or Messages panel. The map's "Basemap unavailable" line at the bottom of the
  Map page is the map builder's and was left as is.

### The viewer's agent

The Reasoning panel shows the editor's controls, the permission mode menu included. In a view every mode allows
everything: `autoDecision` in `scriptedAgent.ts` returns the chosen mode for a view session (Plan included), and each
mode's description adds "In a view nothing waits: the agent changes views only." The viewer's sessions still never
change the model; the server refuses model changes and the agent gives the view-only answer.

### Real, mocked, deferred (decision 0036)

- **Real**: the Save as dialog, the project copy and its file round trip through the lifecycle and the mock server,
  view files, the start page, the editor shell with unavailable items, warnings as messages, the confirmation dialog.
- **Mocked**: projects and views live in this browser's storage and files, served by the in-page mock server
  (decision 0023); no sharing or access control.
- **Deferred**: parametric and batch views; views that reference a server-hosted model; the map camera in layouts
  (map builder). Two strings in the viewer's zones session (`src/app/agent/sessions.ts`) still say "package"; they
  were left for the zones builder, who is changing that session, to avoid a merge conflict.

### Verification (decision 0036, 2026-10-29)

`npm run typecheck`, `npm run lint`, `npm run format:check`, `git diff --check`: clean. `npm test`: 593 passed in 55
files (new: `src/server/projectFile.test.ts` for the project copy, the viewer's refusal, the file round trip and the
copy on reopening, and refused files; `src/app/viewerActions.test.ts` for the viewer's actions). Playwright on a dev
server at port 5182 with 3 workers: 145 passed (new `e2e/save-as.spec.ts`; `e2e/viewer.spec.ts` rewritten; layouts,
gallery, schema matching, and the two zones specs updated), with axe on the confirmation dialog, Save as, and the
viewer's start page. `npm run test:e2e:preview`: 4 passed. An earlier full run failed two zones tests whose
`View only` locator also matched the status line ("It is view only."); the locator was made exact and both passed.

## The owner's decision

A separate viewer page (direction B of the [next stages discussion](next-stages-discussion.md#3-a-viewer-page-for-handover))
opening a frozen handover package (direction C), handed over by catalog and file. The mock server refuses every model
change from a viewer session on the same command path as the edit lock. Features the viewer cannot use are left out
of its page, not shown disabled, and its shell shows a View only badge. The viewer's agent answers questions,
interprets, and changes views, never the model. Project layouts travel in the package and stay read-only there, and
resetting returns to the handed-over layout. (Before [decision 0033](decisions/0033-project-layouts-panel-and-scenarios-page.md)
a viewer could also keep personal layouts of its own; they were removed.) Result versions are deferred, so a package
carries the current published results only.

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
| Viewer layout | `LayoutShape`, `VIEWER_LAYOUT`, `VIEWER_LAYOUT_KEY`, `hasPage`, `hasPanel` in `src/app/layout/layoutController.ts`; `createLayoutLibrary({ writable: false })` and `resetToHandedOver` in `src/app/layouts/layoutLibrary.ts`; the shared Layouts panel (`src/app/layouts/LayoutsPanel.tsx`) |
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
mode, the layout controller with the viewer's shape and its own arrangement key, the layout library with the
package's project layouts read-only, the scripted agent with viewer sessions, and the same view store, messages, and
project client.

- **Package list** (start screen): the catalog newest first, a selected package's provenance and warnings, Open
  package, Remove from this browser… (confirmed inline), and Open package file… (a browser file input, Ctrl+O). A link
  with `?package=<id>` opens that package once the list loads. While a package opens or a request is pending, these
  buttons stay focusable and say why they wait; an unreadable catalog shows its error with Try loading packages again
  and a plain "No packages can be listed until the catalog is read" instead of an empty search.
- **Shell**: the ribbon with the View only badge and the package name; File (Open package file…, Handover packages…,
  About this handover…), View (pages, panels, docking, layouts, appearance, Reset to handed-over layout), Help. No
  Edit or Run menu, no Save, Undo, or Run buttons. The package's warnings sit under the ribbon until dismissed. The
  status bar shows when the package was handed over instead of the save state, and leaves out Issues, Jobs, the
  current stage, and the simulated workers.
- **Pages and panels**: Map, Table, Dashboard, Results; Assets, Properties, Messages, Layouts, Reasoning. Left out:
  Roadmap, Scenarios, Settings, Issues, Jobs, Schema matching, Data intake, Archetypes, Calibration, Account, and
  the Workflow panel.
- **Inside shared pages**, `useViewOnly()` leaves out: the Table's cell editing, pending-edit count, Apply, and Discard
  (a note says cells cannot be edited); empty states' Run and Show Workflow buttons (they say the package does not
  include the data); the Dashboard's Run on outdated results, Open Scenarios, and Apply adoption (the what-if preview
  stays, unsaved); definition editors in Properties (`ReadOnlyDefinition` shows a definition or stage as handed over);
  Asset page links to pages the viewer lacks (an asset with no page there, such as Attribute mapping rules, says so in
  the status bar and Messages on Enter or a double-click and shows its Properties); the demo switch's fixture loader;
  and in the Layouts panel the Save layout form, the row menu (Update, Rename…, Duplicate, Delete…), and the Default
  column.

### The server's refusal

A viewer session sets `meta.viewOnly`. `handleCommand` refuses every server command (every model change, run, retry,
and cancel) with 403 `view_only` right before the run lock's `run_in_progress` check, so nothing reaches the engine
even when a UI bug or a crafted request sends it. Save, create, open, fixtures, list projects, and hand over are
refused the same way; only `handover.*` and `project.close` (back to the list) are served. The UI's workbench also
refuses drafts (`edits.propose`, `edits.discard`) in the viewer. Local commands (selection, focus) and view operations
work as in the modeller.

### Layouts in the viewer

Opening a package applies its default project layout, as opening a project does. The Layouts panel (View > Layouts,
Ctrl+Alt+L) lists the handed-over layouts with Apply only; its State column marks the applied one and the handed-over
default, and a package without layouts says so in a line that wraps in the side panel. Reset to handed-over layout
(View > Layouts, palette, agent `layouts.resetToHandover`) applies the package's default layout, or the viewer's
default arrangement with the package's table settings and map layers when it has none; the handed-over layouts are
unchanged. The viewer's arrangement autosaves under `eaui.viewer.layout.v1`; nothing else of the viewer's is kept.

Before decision 0033 the viewer also kept personal layouts per package (`eaui.viewer.layouts.v1:<package id>`, set
with `setPersonalKey` from `personalLayouts.ts`) in a Layouts dialog with Copy to personal. All of that was removed;
values earlier builds left in browser storage are ignored.

### The agent

`describeAgentTools({ viewOnly: true })` lists no server command, draft, lifecycle, or handover tool, no view
operation of a page the viewer lacks, and none of `layouts.save`, `update`, `rename`, `duplicate`, `delete`, or
`setDefault`; `executeToolCall` refuses such a call before it reaches the client. Its sessions are Explain the
published results (totals, currency, the highest-demand building drilled into and selected), Map beside Table with the
tallest buildings, Floors and zones of a building (a building zoned its own way when the package has per-building
overrides, else the largest zoned building; the answer names the project's zoning and every override), and Reset to
the handed-over layout. A message asking to run, change, add, delete, reset, adopt, save, and the like on a model
object gets the view-only answer, even when it also names a session's subject ("reset the baseline results", "remove
the zones from building b-1"); a session that needs data the package lacks says so instead of offering a run. Its
answers point to the handed-over layouts in the Layouts panel and Reset to handed-over layout.

## States

- **Empty**: "No handover packages in this browser yet" with where to get one; a package without saved layouts says
  so in the Layouts panel; pages with no published data say the package does not include it.
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
  view-only server session and its refusal, the viewer entry under the Pages base path, read-only handed-over layouts
  and the reset, the viewer's agent tool filter and sessions.
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
    inline), which lists the packages kept here with their sizes; the layouts handed over in a package go with it.
    (Before decision 0033 removal also deleted that package's personal layouts, `eaui.viewer.layouts.v1:<id>`.)
    Downloaded copies are unaffected. **No catalog cap**: the browser's quota
    is the limit, and a refused save names the space packages take (about 550 KB for the complete fixture) and where
    to remove them; a count cap would refuse a small package while doing nothing about one large one.
15. **The agent's Hand over tool waits for approval** in the modeller. In the viewer, a message gets the view-only
    answer when it names work only the modeller starts (rerun, adopt, calibrate, retry, import) or a change verb
    (including reset, restore, clear, rename) on a model object (measure, scenario, archetype, rule, stage, adoption,
    building, zone, …) without a view word (layer, map, colour, layout, table, season, …), even when it also matches a
    viewer session; otherwise it starts the matching session, or gets the view help answer. "Add a heat layer", "set
    the season", "save my layout", or "reset to the handed-over layout" are not refused. (Before the review of
    2026-10-29 a matching session ran first, so "reset the baseline results" ran Explain the published results.)
16. **The viewer's status bar** shows when the package was handed over instead of save state, and leaves out Issues,
    Jobs, the current stage, and the simulated worker count.
17. **The viewer has no permission modes**: they govern runs and model changes, which its agent never makes, so the
    menu is left out. Since decision 0033 its agent has no tool that waits for approval (before it, updating or
    deleting a personal layout did).
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
  adoption" is not, and a change verb with a view word ("reset the map of the baseline") still passes as a view
  change.
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

## Review fixes (2026-10-29)

A review of the next stages after decision 0033 found, all fixed on `claude/next-stages`:

- File > Hand over… stayed unavailable after one handover: `useAppActions` now follows `handover.store` and the
  session's meta, and `handOver()` resets `busy` in a `finally`, so a failed request cannot leave it busy
  (`src/app/handover/handoverService.test.ts`; the viewer spec hands over twice).
- The viewer agent's answers and the modeller's remove confirmation still mentioned personal or viewer layouts; they
  now name the handed-over layouts in the Layouts panel and Reset to handed-over layout.
- A model change naming a session's subject ran that session; it is now refused first (decision 15). The zones
  answer chose a building with one zone and left out the per-building overrides; it now shows a building zoned its
  own way and names every override, with singular counts ("1 zone").
- The viewer's start screen: an unreadable catalog no longer shows "Nothing matches" with Clear search, and Open
  package file…, Open package, and Remove say why they wait instead of being bare disabled buttons.
- The viewer's Layouts panel: viewer wording for the applied line and the empty state, which wraps; the Default and
  empty Actions columns are left out (State names the handed-over default).
- Assets with no page in the viewer (Attribute mapping rules) explain themselves on Enter or a double-click.

Left for the owner: whether the viewer keeps its own view changes between visits; removing or pruning unreadable
stored packages; merging the three resets (Reset layout, Reset to layout, Reset to handed-over layout).

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
