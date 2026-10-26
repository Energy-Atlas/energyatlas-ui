# Developer guide

Date: 2026-09-15, after first-slice stage 4 (scripted agent) on the `feature/agentic` branch and the OpenFreeMap basemap over Back Bay footprints ([decision 0012](decisions/0012-openfreemap-basemap-back-bay.md)) on the `feature/basemap` branch.

Updated 2026-10-26 for project lifecycle on `codex/project-lifecycle` ([decision 0024](decisions/0024-dedicated-project-start-screen.md)); this slice is not merged or pushed. The [lifecycle record](project-lifecycle-design.md) contains its verification and limits.

This guide is for a developer or agent taking over without the original conversation. It describes the code as built, how to extend it without breaking the accepted rules, how it is tested, and what is still missing. Product intent and accepted choices live in the [decision records](decisions/README.md); evidence lives in the [first-slice implementation status](first-slice-proposal.md#implementation-status) and the [design alignment record](design-alignment.md#implementation-status).

## Reading order

1. [AGENTS.md](../AGENTS.md): operating rules (reference boundary, Git safety, credentials, verification before commits).
2. [Decisions 0003 to 0015](decisions/README.md): what the product is (shell, layout, workflow, scripted agent), which packages are allowed, the [UI design guidelines](20260915_energyatlas_ui_design_guidelines.md), the Geist typeface, agent chart specifications and missing-state approvals, the basemap and footprint source, 3D building extrusion, LF line endings, and live terrain for display.
3. This guide.
4. [First-slice proposal](first-slice-proposal.md): the plan, the working/simulated/planned boundary, stage-by-stage status, gaps, and next steps.
5. [Design alignment](design-alignment.md): how the build follows the guidelines, verification, and remaining gaps.
6. [Package selection](package-selection.md): constraints each library carries and spike findings.

## What exists

A browser-only React application with a start screen and several named browser-local synthetic projects, one open at a time. Each can be taken through the 12-stage workflow of [decision 0005](decisions/0005-first-slice-workflow-and-panel-scope.md):

- **Project lifecycle:** Recent, Open, and named Create before the workbench; File > Projects returns to the start screen. Shared guards protect unsaved model changes and unsent drafts, and confirm cancelling active jobs. Save status distinguishes pending/saved/unsaved/failure. Appearance and Demo conditions remain available from the start screen; held lifecycle requests expose Demo conditions inside their pending dialog.

- **Shell:** ribbon (menus, quick buttons, the ▶ Run ▾ split button, command palette), FlexLayout docking area, status bar with jobs, issues, requests waiting for the server, unsaved changes, the demo conditions chip, notices, and simulated compute.
- **Left border (icon side bar):** Assets tree and Workflow panel.
- **Center pages:** Map, Table, Dashboard, Roadmap, Creator, Settings; Issues and Jobs (component id `page.tasks`) open from the status bar, and Account from the ribbon's account initials.
- **Right border:** two independent panels ([decision 0016](decisions/0016-reasoning-and-inspection-panels.md)). Reasoning runs scripted agent sessions with tool calls, approvals, send modes, and permission modes; Inspection is a read-only view of the shared selection. Each has its own Panels menu entry and can be docked anywhere.
- **Appearance:** System or one of six curated appearances (Light, Dark, Technical monochrome, Lieflat-inspired, Clean technical light, Dark engineering), set in Geist with a three-size type scale.

There is no real server, no model provider, and no real engineering calculation. A mock server inside the page owns the project and answers through a transport that adds delay and demo faults ([decision 0023](decisions/0023-mock-server-and-fixture-picker.md)); Help > Demo conditions sets those conditions and loads project fixtures. Every number comes from deterministic synthetic code in `src/domain/simulation.ts`, and the UI discloses it as simulated through the capability registry.

Building geometry is real: 464 footprints from a bundled OpenStreetMap extract of Boston Back Bay (`src/domain/fixtures/`, ODbL), with synthetic attributes ([decision 0012](decisions/0012-openfreemap-basemap-back-bay.md)). The Map page loads an OpenFreeMap basemap from the public instance over the network, recolors it from the active appearance, and falls back to a plain background when it is off or cannot load. It can also show live terrain with hillshade from Mapterhorn ([decision 0015](decisions/0015-terrain.md)), for display only: terrain is never project data, and a failure falls back to a flat map.

Run it with `npm ci` then `npm run dev`. Create or open a project on the start screen. To walk the workflow manually: open the Workflow panel, run stages in order (Shading can be skipped), create a measure and a scenario on the Creator page before running Scenario definitions, and expect Grid modeling to fail on its first attempt by design; run it again to recover. An explicit `?fixture=...` demo deep link opens that fixture directly; a normal reload shows the start screen.

## Architecture

```text
main.tsx ── Geist font CSS, src/index.css (fallback tokens, fonts, type scale)
   │
   ├─ ?spike=<name> ──> src/spikes/SpikeApp (package spikes, not product code)
   │
   └─ App ─ WorkbenchProvider (src/app/WorkbenchContext.tsx)
              ├─ storage       getBrowserStorage(): localStorage or null
              ├─ mock server   createMockServer() (src/server/): domain engine, jobs, browser-local project catalog
              ├─ transport     createTransport(server, conditions): delay, faults, ordered pushed updates
              ├─ workbench     createWorkbench(): the UI's copy; refuses server commands, undoes drafts only
              ├─ client        createProjectClient(): server requests, pending requests, server meta
              ├─ lifecycle     createProjectLifecycle(): shared intents, unsaved-work guard, confirmed job cancellation
              ├─ layout        createLayoutController(workbench, storage): FlexLayout model
              ├─ appearance    resolveAppearance(preference, system setting), applied to the root element
              ├─ view          createViewStore(workbench): logged view operations, including context mode
              └─ agent         createScriptedAgent(workbench, client, layout, view): sessions behind the agent adapter
            ProjectSession (src/App.tsx): ProjectStart while closed; ProjectDialogs shared across both states
            WorkbenchShell while open (src/app/shell/WorkbenchShell.tsx)
              ├─ Ribbon, CommandPalette, dialogs ── useAppActions() (src/app/actions.ts)
              ├─ <Layout factory=renderTabContent> ── panels and pages by component id
              └─ StatusBar
```

Data flow is one-directional:

1. A control, shortcut, palette entry, or agent tool call invokes `client.execute({ type, input }, source)`. Local commands (selection, drafts, the focused stage) run on the UI's workbench at once. Server commands (`SERVER_COMMANDS` in `src/server/server.ts`) go through the transport to the mock server and return a promise.
2. On the server, the command's zod schema validates the input; the handler mutates an Immer draft and returns `applied` with a summary or `rejected` with per-field issues. A rejection reaches the UI as RC's error body (`src/server/apiError.ts`) and becomes per-field issues again; model changes during a run are refused with a 409 `run_in_progress`.
3. The server pushes updates (state plus the operations that produced it, in order); the client merges them with the UI's own selection, drafts, and focus (`mergeServerState`), and the UI's store publishes `{ state, log, canUndo, canRedo }`. Components read it through `useWorkbenchSnapshot(selector)`, and requests in flight, the save state, and the demo conditions through `useClientSnapshot(selector)`. The job runner (`startTaskSimulator`) runs on the server as source `system`.
4. Requests carry the client's `projectGeneration`; a request delayed past project replacement gets a 409 `project_changed`. Adoption of a new generation clears selection, drafts, focus, and history. The session subscriber resets project views through `view.resetForProject` and clears agent transcript, queues, and timers with `resetForProject`. Imported operations keep stable server IDs, namespaced per server lifetime; local UI operations and fixture history have separate namespaces. Saved and fixture history is not restored as a log.
5. Draft changes, discard, undo, and redo wait while Apply is pending. A failed Apply retains drafts and undo history. Agent tool continuations also check their session generation, so a stopped session cannot resume a later one.
6. Derived values (stage states, dashboard data, map metrics, asset tree rows, Inspection) are computed from state in pure functions, never stored.

View state that is not project state changes through the layout controller, the appearance service, or view operations (`src/app/view/`), and is recorded with `workbench.record`, so it appears in the operation log with its source. The agent uses exactly these paths through `src/app/agent/tools.ts`.

### Domain layer (`src/domain/`, no React)

| File | Responsibility |
| --- | --- |
| `types.ts` | `WorkbenchState` and every entity type. Start here. |
| `commands.ts` | The command registry: title, description, zod input, `undoable`, handler. `describeCommands()` exports JSON Schema, which `describeAgentTools()` in `src/app/agent/tools.ts` includes in the agent tool catalog. |
| `workbench.ts` | `createWorkbench()`: `execute`, `undo`, `redo`, `record` (log an external operation such as a layout change), `load` (replace state, clear history). Operation log entries carry `source` manual, agent, or system. |
| `workflow.ts` | Default 12 stages and `STAGE_IDS`, graph helpers (`upstreamIds`, `downstreamIds`, `topologicalOrder`), `deriveStageStates`, `stageRunBlocker`. |
| `simulation.ts` | Synthetic stage runners (`runSimulatedStage`) and `computeScenarioResult`, shared by scenario modeling and dashboard previews. |
| `simulator.ts` | Task simulator with an injectable scheduler, so tests step time deterministically. |
| `stagePlan.ts` | `planStages`: which stages to restore or run, in workflow order, so targets have data or current results. |
| `assets.ts` | Asset tree skeleton, `GROUP` ids, `upsertAsset`, `assetPath`. |
| `capabilities.ts` | Working/simulated/planned registry that every honest label reads. |
| `initialState.ts` | Empty project. |
| `fixtures/` | `back-bay-buildings.geo.json`, the OpenStreetMap footprint extract (one feature per line, excluded from Prettier), and its ODbL notice. Regenerate with `node scripts/fetch-osm-buildings.mjs` only when the extract must change; building ids follow the file order. |

Key domain rules:

- **Stage states are derived** in this order: `unavailable` (planned capability), `running` (active task), `skipped`, `failed` (last run failed), `stale` or `executed` (last run succeeded; stale when an upstream revision or the stage's own `editRevision` differs from what the run consumed, or an upstream stage is no longer executed or skipped), `blocked` (an upstream stage failed, is blocked, or is unavailable), `ready` (all upstream satisfied), else `future`. The current stage is only a focus marker. The UI labels `executed` as Complete, `stale` as Outdated, and `unavailable` as Planned.
- **Revisions:** `revision` changes when a stage's outputs change (run, applied edit of data it owns, skip toggle). `editRevision` changes when inputs owned by the stage change (new measure or scenario, adoption change). Both come from the monotonic `nextId`, which undo never rewinds.
- **Undo** covers model commands (`undoable: true`): skip or restore, insert stage, apply edits, create measure or scenario, set adoption. Runs, tasks, selection, pending edits, layout, appearance, and view operations are not undoable.
- **Selection** is one shared `{ entityType, ids }`. Unknown ids are rejected, and an empty selection is explicit rather than meaning "all".
- **Manual overrides** from applied table edits survive reruns of the stage that generated the field.
- **Baseline coverage:** the baseline model skips buildings without an archetype or a floor area.

### App layer (`src/app/`)

| Area | Files |
| --- | --- |
| Services and hooks | `WorkbenchContext.tsx`: `useServices` (including `view`, `agent`, `appearance`, `setAppearance`, `showInspection`, `workedSurface`, `claimWorked`), `useAppearance`, `useWorkbenchSnapshot`, `useViewState`, `useAgentSnapshot`, `useStageStates`, `useLayoutVersion` |
| View state | `view/viewOperations.ts` (`ViewState`, operation registry, `describeViewOperations`), `view/viewStore.ts` (`createViewStore`), `view/chartSpec.ts` (chart specification schema, validation, and compilation) |
| Agent | `agent/types.ts` (the `AgentAdapter` seam and transcript items), `agent/tools.ts` (tool calls, `requiresApproval`, `describeAgentTools`), `agent/sessions.ts` (scripted sessions), `agent/scriptedAgent.ts` (the player) |
| App actions | `actions.ts` (the registry), `useShortcuts.ts`, `shortcuts.ts` (parsing and matching, unit-tested) |
| Layout | `layout/layoutController.ts` (`PAGES`, `PANELS`, `DEFAULT_PAGES`, `openPage`, `togglePanel`, `toggleMaximize`, `setCompact`, `reset`, `placePage`, `splitActiveTab`, `moveActiveTabToNextGroup`, `handleUserAction`), `layout/flexlayout-theme.css` |
| Appearance | `appearance/appearances.ts` (six appearances: chrome tokens, data palette, `resolveAppearance`), `appearance/contrast.ts`, `theme.ts` (stored preference, `applyAppearance`) |
| Shell | `shell/WorkbenchShell.tsx`, `Ribbon.tsx` (menus, quick buttons, Run split button), `StatusBar.tsx`, `CommandPalette.tsx`, `HelpDialogs.tsx` |
| Shared components | `components/ActionButton.tsx` (explains unavailable actions), `StateBadge.tsx` (semantic stage states), `CapabilityBadge.tsx` (`CapabilityBadge` and `StatusTag`), `CapabilityTable.tsx`, `EmptyState.tsx`, `forms.module.css` |
| Panels | `panels/AssetsPanel.tsx` + `assetTree.ts`, `panels/WorkflowPanel.tsx`, `panels/InspectionPanel.tsx` + `inspection.ts` (read-only Inspection view model), `panels/MapProperties.tsx` (the map's scene lighting, shown by Inspection while the map is the worked surface), `panels/ReasoningPanel.tsx` (agent transcript, approvals, composer) + `agent/modes.ts` (send and permission modes) + `agent/suggestions.ts` (suggested next steps) |
| Pages | `pages/*Page.tsx`; pure helpers `mapMetrics.ts`, `dashboardData.ts`, `dashboardCharts.ts`; `basemapStyle.ts` (recolors the OpenFreeMap style from appearance tokens, attribution) and `useBasemap.ts` (loading, failure, retry); `silhouette.ts` (projects a building's ground, roof, and walls with a camera matrix) and `SelectionSilhouette.tsx` (the 3D selection outline: a custom layer supplies the matrix every frame, and the silhouette's boundary is drawn on an overlay canvas); `terrain.ts` (the Mapterhorn source, hillshade paint from appearance tokens, attribution, legend wording) and `useTerrain.ts` (applies terrain once its source exists, with loading, failure, and retry); `sunPosition.ts` (`subsolarPoint`, the globe's one solar state from the season and the UTC time, and `sunFromSubsolar`, any place's own sun derived from it, on NOAA's equations), `lighting.ts` (the controls mapped onto MapLibre's light and sky, mixing colour from the appearance's `data.sky` tokens) and `useSceneLighting.ts` (applies both, and reapplies after a style swap) |
| Visualization | `viz/EChart.tsx` (modular ECharts wrapper and `useChartFont`), `grid/agGrid.ts` (AG Grid theme from CSS tokens) |
| Persistence and global styles | `persistence.ts`, `storage.ts`, `basemapPreference.ts`, `global.css` (radii, heading reset), `src/index.css` (fallback tokens, fonts, type scale) |

### Browser storage

Everything persists in `localStorage` of the current origin only:

- `eaui.projects.v1`: the versioned multi-project catalog, saved atomically with stable IDs, names, last saved/opened metadata, and model snapshots (`src/server/projectCatalog.ts`). Normal entry is the start screen, not automatic restoration. Tasks active at save time load as cancelled. `projectSchema.ts` validates saved state and graph references before opening; malformed or blocked storage produces a visible error and is never silently overwritten.
- `eaui.project.v2`: the previous single snapshot, imported as an existing project if no catalog exists. Reading migration does not rewrite this key; the first successful save writes the new catalog. The old key remains. Projects under `eaui.project.v1` used the synthetic ocean grid and remain unsupported, with the existing explanation on restore.
- `eaui.basemap`: `off` hides the OpenFreeMap basemap; anything else shows it. Changes are logged as `view.setBasemap`.
- `eaui.layout.v1`: the FlexLayout model, saved on every layout change. An unreadable layout falls back to the default. Restored layouts take the current panel names from `PANELS`.
- `eaui.theme`: the appearance preference, `system` or an appearance id. Values stored before curated appearances (`light`, `dark`) stay valid.

To start a new workflow, use File > New project; other saved projects remain in the catalog. View > Reset layout resets the shell. Clearing site data for `127.0.0.1:5173` removes saved projects too. Playwright contexts start with fresh storage.

### Project lifecycle operations

Use `services.lifecycle.request({type: 'create' | 'open' | 'close' | 'save' | 'fixture' | 'list', ...})` for user/agent intents. `openCreate()` and `openCatalog()` open the shared UI. The raw client methods are the service implementation, not a shortcut around guards. `withTransition()` fences new commands/drafts/history during a committed session change and supplies the guard's internal cancel/apply command path. Stay sends nothing. A confirmed cancellation stays cancelled if a later Save fails; the project remains open for retry.

Agent `project.*` tools use the same controller and offer list results as structured project summaries. Model-changing lifecycle tools require approval; their guard remains the same manual unsaved-work/job confirmation. New saved model fields must be represented in `src/server/projectSchema.ts`; its typed schema and fixture round-trip tests pin compatibility. Save persists the server model, never UI selection or unsent drafts.

## Rules for changes, with recipes

These restate [AGENTS.md](../AGENTS.md) as concrete steps.

### Add or change model behavior: a command

1. Add the entity fields to `src/domain/types.ts` (and `initialState.ts`).
2. Add a `defineCommand` entry in `src/domain/commands.ts` with a user-facing `title`, an agent-readable `description`, a zod input whose messages are written for end users, and `undoable: true` only for project-model changes.
3. Reject with `rejected(message, path)`; `path` must name the input field so forms can place the message.
4. If the change invalidates results, bump the owning stage's `revision` or `editRevision` through `nextRevision(state)` so outdated propagation happens automatically.
5. Test it in `src/domain/workbench.test.ts` through `createWorkbench().execute`, including a rejected case and, when undoable, undo and redo.
6. Decide where it runs ([decision 0023](decisions/0023-mock-server-and-fixture-picker.md)). A command that changes the project belongs to the server: add it to `SERVER_COMMANDS` in `src/server/server.ts`, and to `MODEL_COMMANDS` too when a run must lock it out. UI state (selection, drafts, focus) stays local; keep it in `mergeServerState` in `src/app/service/projectClient.ts` so server updates do not overwrite it. Controls send it with `client.execute` and await the result; show `usePendingReason` (or `waitingReason` in lists) as the control's `disabledReason` while its request is in flight, and `isPending` on form submit buttons. Test the round trip with `createTestProject()` from `src/testing/testProject.ts` and `await manual.settle()`.

Never mutate state outside a command. UI-only concerns (hover, open dialogs, draft input text) stay in React state.

### Add view state: a view operation

1. Add the field to `ViewState` and `createInitialViewState` in `src/app/view/viewOperations.ts`.
2. Add a `defineViewOperation` entry with a user-facing `title`, an agent-readable `description`, a zod input, and a `run` that checks the project and returns `applied` with a summary or `rejected` with per-field issues.
3. Read it with `useViewState(selector)` and change it only through `services.view.execute(operation)`; the store records every operation in the operation log with its source.
4. Test it in `src/app/view/viewStore.test.ts`, including a rejected case.

Transient drafts that would flood the log, such as what-if slider positions or text being typed, stay in React state; commit them as a view operation once they settle, as the table filter does.

### Add or change an agent session

Sessions live in `src/app/agent/sessions.ts`. Build steps with the local helpers (`say`, `reason`, `reference`, `tool`, `propose`, `ensure`); a step can be a function that reads the project when the step is reached. Tool calls use `command`, `viewCall`, or `layoutCall` from `src/app/agent/tools.ts`, which run through the shared paths with source `agent`; a session never changes state directly. Calls that run stages or change the project model always wait for approval (`requiresApproval`), and `ensure` offers missing stages as one approval ([decision 0011](decisions/0011-agent-view-specs-and-missing-state.md)). Test sessions in `src/app/agent/scriptedAgent.test.ts` with `manualScheduler` and the task simulator, and cover the user flow in `e2e/agent.spec.ts`.

### Add a user-invokable action or shortcut

Add an `AppAction` in `src/app/actions.ts`. Set `menuPath` to place it in the ribbon menus: `[]` or absent is the top level, `['Panels']` the pages and panels submenu (each entry is ticked while its page or panel is on screen, wherever it is docked: `layout.isPageOpen` and `layout.isPanelOpen` count a tab as open when it is selected in its tab set or border and no maximized tab set or hidden border covers it), `['Appearance', 'Theme']` a submenu of a submenu. `MenuLevel` in `Ribbon.tsx` renders each level from those paths, and the command palette ignores them so search still finds every action by its plain name. The same entry then appears in the ribbon menu, command palette, and shortcut help; Run group actions also appear in the Run split button's menu, and Account group actions (Account, which opens the Account page, and Log out, planned) in the menu behind the ribbon's account initials ([decision 0021, section 16](decisions/0021-energyatlas-family-ui-alignment.md)). Set `disabledReason` whenever it cannot run; `useInvokeAction` records that reason in the operation log and status bar instead of doing nothing. Check `src/app/shortcuts.test.ts` and the shortcut dialog for conflicts. Current shortcuts include Ctrl+S, Ctrl+Z, Ctrl+Shift+Z, Alt+1 to Alt+6 (pages), Ctrl+B (Assets), Ctrl+Shift+E (Workflow), Ctrl+Alt+B (Context), Ctrl+Shift+M (maximize), Ctrl+Enter (run current stage), Ctrl+K (palette), F6 and Shift+F6 (tab groups).

### Add a page or panel

1. Add it to `PAGES` or `PANELS` in `src/app/layout/layoutController.ts` (and to `DEFAULT_PAGES` or the default borders if it belongs in the default layout).
2. Map its component id in `renderTabContent` and give it an icon in `TAB_ICONS` in `src/app/shell/WorkbenchShell.tsx`.
3. Open it only through `layout.openPage` or `layout.togglePanel`, never through FlexLayout directly, so the change is logged and available to the agent. `togglePanel` hides a panel in a side border by collapsing it, and a panel docked among the pages by closing its tab, because a tab set always shows one of its tabs; showing it again docks it back on its home side (`PANEL_HOME`). Opening a page or showing a panel hidden by a maximized tab set restores that tab set first.
4. Saved layouts contain component ids; renaming one breaks restored layouts, which then show the "Unknown tab" message until reset. Rename tab names in `PANELS` instead, as Reasoning did through two renames (its component id stays `panel.reasoning`). Bump `LAYOUT_KEY` if a change makes old layouts invalid; it is at `eaui.layout.v2` since the Reasoning and Inspection split ([decision 0016](decisions/0016-reasoning-and-inspection-panels.md)).
5. Tabs stay mounted while hidden (`tabEnableRenderOnDemand: false`) and can measure 0x0; size-dependent components (maps, charts, React Flow) must refit when they become visible. See `RoadmapPage.tsx` and `viz/EChart.tsx`.

### Label honestly

Anything that is not real behavior needs a `capabilities.ts` entry. Disclose capability quietly, following section 8 of the [guidelines](20260915_energyatlas_ui_design_guidelines.md) as amended on 2026-09-15:

- Use `CapabilityBadge`. It renders nothing for working capabilities, shows Simulated or Planned as quiet text with an icon, and carries the explanation as a tooltip.
- Disclose Simulated once per surface: a panel or page header, a legend, or Inspection provenance.
- Use `StatusTag` only where every status must be named, such as the capability table in Settings and Help.
- Planned controls are visible, focusable (`aria-disabled`, not `disabled`), and explain themselves. Empty states name the missing stage and offer to run it (`EmptyState`).

Stage states use `StateBadge`: routine states are muted text with an icon, Failed and Outdated add tone and a tint, and Running uses the info tone.

### Forms

Use React Aria fields with `isInvalid` and a `FieldError` per field, filled from command issues via `splitIssues` in `src/app/commandErrors.ts`. Editing a field clears only that field's issue. Do not use React Aria `Form` `validationErrors`: it kept corrected fields invalid and blocked resubmission. See `CreatorPage.tsx`.

### Visual design

The [UI design guidelines](20260915_energyatlas_ui_design_guidelines.md) (decisions 0009 and 0010) govern visual choices; [design alignment](design-alignment.md) records how the build follows them.

- **Color:** read chrome tokens (`--color-*`, `--tone-*`) in CSS and `useAppearance().data` in canvas renderers. Never write color literals in components. To change or add an appearance, edit `src/app/appearance/appearances.ts`; the contrast tests in `appearances.test.ts` must pass for every appearance.
- **Type:** Geist through `--font-sans`, Cascadia Code through `--font-mono`, and only `--font-size-small`, `--font-size-base`, and `--font-size-title`. Headings default to the base size and titles opt in. Use `tabular-nums` for aligned numbers.
- **Boundaries:** keep borders for pane edges, tab strips, inputs, buttons, popovers, dialogs, and graph nodes. Group content inside panes with spacing and `--color-surface-raised`, and use `--color-border-subtle` for internal dividers.

### Charts and color

Follow the dataviz method in `dashboardCharts.ts`:

- categorical colors in fixed order, following the entity rather than its rank;
- at most three charted series (the validated slots) and one hue for magnitudes;
- reserved status colors, always with an icon and a label;
- a legend for two or more series, and direct labels only where they do not collide;
- annotations only where they explain a result (currently the baseline peak month);
- quiet scaffolding from the appearance's chart ink;
- an app-rendered data table for every chart, because ECharts has no keyboard navigation.

Canvas text must use `useChartFont().family`, and chart options must depend on the font so they rebuild once Geist loads. Screenshot charts in light and dark appearances before committing; tests do not catch label collisions.

### Packages

Only packages from decisions 0007, 0008, and 0010 are allowed. Record a reason in `docs/package-selection.md` or a new decision before adding one. `react-markdown` and `remark-gfm` render Markdown messages in the Reasoning transcript (`src/app/panels/ReasoningPanel.tsx`).

## Testing

| Command | What it covers |
| --- | --- |
| `npm test` | 224 Vitest tests: domain/views/agent, appearance contrast, spatial helpers, fixtures and service conditions, plus catalog migration/validation, explicit sessions, shared lifecycle guards, mutation fencing, project tool parity, and queued-agent resets |
| `npm run test:e2e` | 68 Playwright tests in Edge with 4 local workers and axe; default 1280x800, plus lifecycle appearance captures at 1600x1000 and 900x700 (no serious or critical violations allowed) |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | Must be clean before committing |

End-to-end specs:

- `e2e/project-lifecycle.spec.ts`: start, named creation/validation, multi-project save/open/recent, equal names, draft and job guards, failed Save, malformed storage, held-request recovery, all six appearances at three sizes, axe, keyboard focus, and reproducible screenshots in `tmp/`.
- `e2e/smoke.spec.ts`: renders with no serious or critical axe violations.
- `e2e/workbench.spec.ts`: shell regions, no visible Working labels, the Run split button and menu, placing pages side by side and moving tabs from the palette, background task progress, explained blocked actions, palette and panel shortcuts, undo, save and layout persistence across reloads, narrow-window overlays, reset layout.
- `e2e/pages.spec.ts`: Assets provenance, Creator validation and creation, Roadmap focus and custom stage insertion.
- `e2e/map-table.spec.ts`: empty states, validated pending table edits, table-map shared selection, basemap credits, the fallback and retry when the basemap cannot load, the Settings toggle persisting across reloads, the 2D/3D switch with its missing-heights note, legend rows, and keyboard hint, and the Terrain switch with its exaggeration slider, legend row, credits, and flat fallback with retry.
- `e2e/test.ts`: not a spec. It exports `test` and `expect` with an automatic fixture that answers OpenFreeMap requests with a stand-in style and empty tiles, plus `blockBasemap` and `serveBasemapStub`. It also stores the demo condition "no delay" in the session before each page loads, unless a test set conditions already, so the mock server answers at once in tests.
- `e2e/demo-conditions.spec.ts`: the Demo conditions dialog and its status-bar chip, an offline request, a held request shown as pending until released, rejected input on its field and the edit lock, fixtures loaded from the URL and the dialog, and a job failing partway with its log.
- `e2e/dashboard.spec.ts`: full manual path to scenario results, preview, apply, outdated notice, data table.
- `e2e/appearance.spec.ts`: Geist loads, appearance switching persists, axe in all six appearances.
- `e2e/context.spec.ts`: Inspection follows the shared selection, and the Inspect selection action opens it.
- `e2e/agent.spec.ts`: the layout session with an approved stage run and a layout restore, a rejected model change, the answer to unmatched free text, and the data representation session with an added chart.
- `e2e/spikes.spec.ts`, `e2e/spikes-flexlayout.spec.ts`: package spike baselines (`/?spike=`), kept as regression checks for library behavior.

Conventions and pitfalls found while building:

- Run `npm run test:e2e` and `npm run test:e2e:preview` sequentially: both use `test-results/`, so concurrent runs can remove each other's trace files and fail during browser cleanup.
- Product entry helpers in `e2e/test.ts` create and reopen projects through the UI. The fixture accepts native before-unload prompts on intentional test navigation/reload; in-app unsaved-work guards remain exercised. Wait for active theme transitions to finish before axe/screenshots, or mixed intermediate colors can report a transient contrast failure.
- A pending submit button that disappears with its modal must not leave React Aria Button's live-announcer label references dangling. Create uses explicit disabled/progress status for that reason; ordinary persistent forms retain `isPending`.
- Playwright treats `aria-disabled` buttons and React Aria's hidden native checkbox and radio inputs as not actionable. Use `focus()` then `Enter` or `Space`.
- Clicking an already selected border tab (Assets, Workflow, Reasoning, Inspection) closes that panel. Check `aria-selected` before clicking; the helper in `e2e/dashboard.spec.ts` shows how.
- Stage runs take about 1.6 seconds each through the simulator; wait for the "Complete" state label rather than sleeping. Long flows set `test.setTimeout`.
- Status messages are asserted through `getByTestId('status-notice')`, and requests waiting for the server through `getByTestId('status-pending')`.
- Reach a project state with `/?fixture=partway` (or `new`, `failed`, `complete`) instead of running stages; set conditions with `?latency=`, `?fault=`, `?jobs=`, and `?hold=1`. Unit tests that pass through the client must `await manual.settle()`, which lets promise continuations run between scheduled steps.
- Hidden docked tabs stay mounted, so page-wide text locators can match hidden content; scope to a region or use `.filter({ visible: true })`. Give buttons in the side panels distinct accessible names (for example "Clear selection from Inspection") so page-level locators stay unique.
- React Aria's `MenuTrigger` names a menu after its trigger button, overriding the menu's own `aria-label`.
- React Aria keeps a checkbox's real `<input>` visually hidden, and a slider thumb is an `<input type="range">` whose slider role is implicit. `getByRole` finds both, but a CSS query for `[role="slider"]` does not, and calling `.click()` on the wrapping `<label>` from a script does not toggle the checkbox. Use `getByRole(...).focus()` and a key press.
- `Map.setSky` requires an argument, unlike `Style.setSky`, so there is no way to clear the sky through the map. Nothing draws the sky at zero pitch, so the flat map simply leaves it in place.
- Playwright matches an accessible name by substring, so pass `exact: true` when two controls share a word. The composer's send control is named "Queue message" (its left half) and "More send options" (its menu half).
- A container with `overflow: auto` that actually scrolls needs `tabIndex={0}`, or axe reports `scrollable-region-focusable`. The agent transcript began scrolling only once the composer grew, so the rule appeared on every page at once.
- At 1280 px the Settings tab can sit in FlexLayout's overflow menu; tests open it through the command palette.
- MapLibre must stay excluded from Vite dependency pre-bundling (`vite.config.ts`), or its worker fails to load.
- Pass react-maplibre a stable, memoized `mapStyle`. A new style object on every render makes it call `setStyle`, whose diff removes sources added at runtime and loses feature state such as the selection outline.
- flexlayout-react 0.11.0 stylesheets reference `.map` files the package does not ship, which made the dev server log "Failed to load source map". A small plugin in `vite.config.ts` loads those stylesheets without the comment; remove it once the package ships its maps or drops the comment.
- Local Playwright runs use 4 workers (`playwright.config.ts`). The default count starved the dev server and timed out tests on a 32-core machine.
- Line endings are LF everywhere through `.gitattributes` ([decision 0014](decisions/0014-lf-line-endings.md)), overriding `core.autocrlf=true` from Git for Windows. A checkout made before that file existed can still hold CRLF working copies; convert them once (they are unchanged in the index), after which `npm run format:check` passes.
- `toBeVisible` does not detect overlap: sticky session controls once covered the newest transcript entries while the tests passed. Review screenshots of new layouts.
- Agent and planner unit tests step time with `src/testing/manualScheduler.ts`, shared by the agent and the task simulator; long flows call `runAll` with a high limit.
- For visual review, write throwaway Playwright captures under the ignored `tmp/` folder and delete them afterwards.
- On machines without Edge: `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`.
- Product specs import `test` and `expect` from `./test.ts`, never from `@playwright/test`, so the Map page never requests real tiles in tests. The spike specs keep `@playwright/test` because spike pages load no basemap. Imports under `e2e/` need the `.ts` extension (`tsconfig.node.json` uses `nodenext`).
- Routed responses to another origin need `Access-Control-Allow-Origin`, or the browser rejects them and the page sees a network failure.
- MapLibre reports basemap tile and TileJSON failures as `error` events with `sourceId` `openmaptiles`; the Map page falls back to the plain background on the first one until Retry basemap.
- Terrain sources stay mounted whenever the map is up and fetch nothing until terrain or hillshade uses them. Removing a source that `setTerrain` still points at throws, and child sources unmount before a parent effect can clear terrain, so `useTerrain.ts` applies and clears terrain instead of driving react-maplibre's `terrain` prop, and re-applies it on `styledata` because style swaps drop it.
- Product specs stub `tiles.mapterhorn.com` with a flat 8x8 terrarium PNG (elevation 0) from `e2e/test.ts`, so terrain renders offline; relief never appears in tests.
- React Aria's `Autocomplete` replays the field's keys on the focused collection item and cancels the real key when the item cancels the replay. A menu item claims Backspace, so the command palette's field would not delete (Delete was unaffected). `CommandPalette.tsx` stops the replayed, untrusted Backspace at the menu element.
- Scrollbars in Chromium here are overlays: they reserve no width (`offsetWidth - clientWidth` is 0) and are invisible to screenshots, even with a deliberately colored track and thumb. Verify scrollbar styling through computed styles, not captures; `scrollbar-width` is set only for Firefox, because setting it makes Chromium ignore the `::-webkit-scrollbar` rules.
- Side ribbons are FlexLayout borders: `borderLeftTabDirection: 'down'` makes the left strip read the same way as the right, `enableRotateBorderIcons: true` rotates the icons with the text, and `borderEnableAutoHide: false` keeps an empty border in place as a drop target. Panel tabs can be closed, so `layoutController.togglePanel` docks a missing panel back on its home side instead of rejecting.
- Each side container collapses on its own from a ribbon button: `layoutController.toggleSide` selects the border's current tab to collapse it and its first tab to expand it, because a border with `getSelected() === -1` is collapsed. `isSideOpen` reads that index.
- FlexLayout's hovering mini-scrollbars only wrap border strips and tab bars, never tab content: the containers report `scrollHeight === clientHeight` and their bars measure 0x0. Panels and pages therefore keep `height: 100%; overflow: auto` and rely on the overlay thumb in `global.css`, which reserves no width.
- The splitter's drag affordance is FlexLayout's `.flexlayout__splitter_handle`, hidden by default through `--flexlayout-splitter-handle-visibility`. It is shown on hover and while dragging, drawn as a filled accent circle with a two-way arrow whose geometry comes from an SVG mask and whose color comes from `--color-on-accent`, so no color literal is needed.
- react-maplibre control options such as `showCompass` apply only when the control is created, so the Map page remounts `NavigationControl` with a `key` when 3D changes. `maxPitch={0}` keeps 2D flat even with right-drag or Shift+arrow tilting, and fits pass the current pitch and bearing so zooming keeps the 3D camera.
- In MapLibre 6 custom layers, `options.modelViewProjectionMatrix` expects world pixel coordinates (Mercator times `512 * 2 ** zoom`), not Mercator 0 to 1, despite its doc example. `options.defaultProjectionData.mainMatrix` takes Mercator 0 to 1 with conformal z, which `silhouette.ts` produces. Using the wrong one projects everything off screen without an error; the e2e pixel check on the silhouette overlay caught it.

## Known gaps and deviations

Behavior promised by the plan or decisions but not built yet:

- **Mock server (decisions 0023/0024):** it restarts with every page load and shows the start screen; browser unload prompts protect unsaved work but cannot finish asynchronous saves. It serves one tab with no coordination between writers. Catalog corruption blocks saving until it is resolved/retried rather than erasing stored projects. While offline, missed updates are caught up as one snapshot without listing the operations between. Layout, view, and appearance changes stay in the UI; only drafts can be undone. Open is a browser-local catalog, with real folder pickers/import/export deferred.

- **Agent (stage 4):** scripted sessions only. Free text starts a session only when it matches a session's keywords, and otherwise the agent says so. Transcripts, view state, and added charts are not saved with the project, and a stage failure during an approved run ends the session. See [stage 4 status](first-slice-proposal.md#stage-4-scripted-agent-2026-09-15).
- **Design alignment:** the six-appearance reading of the palette answer is unconfirmed, axe runs in non-Light appearances on the default workbench only, the context mode resets on reload, and Inspection is read-only. See [remaining gaps](design-alignment.md#remaining-gaps).
- **Keyboard docking:** the command palette splits the active tab and moves it to the next tab group; there is no keyboard way to pick a specific target group or side.
- **View state:** layout, appearance, and view operations (context mode, map metric and overlay, map zoom, map 2D or 3D, terrain and its exaggeration, table view and filter, dashboard compare toggles, added charts) are logged. Dashboard what-if previews stay unlogged drafts, and view state resets on reload.
- **Chart specs:** charts the agent adds use validated specifications (decision 0011); the Dashboard's built-in charts still build ECharts options directly in `dashboardCharts.ts`.
- **Table:** no Zones view (zone counts are a Buildings column) and no column visibility menu.
- **Fixture variants:** Help > Demo conditions loads New, Partway, Failed stage, and Complete fixtures (decision 0023). Fixture provenance uses historical `fixture-…` operation IDs; the operations that built the fixture are not imported into the current UI log.
- **Layout:** at 1280 px with both side panels open, the Settings tab moves into FlexLayout's overflow menu. Layout changes are logged but not undoable.
- **Accessibility:** the map canvas is not screen-reader accessible (the Table page is the equivalent); automated axe runs cover 1280x800 only.
- **3D buildings** ([decision 0013](decisions/0013-3d-building-extrusion.md)): heights are synthetic (floors × 3.2 m) and appear only after Geospatial preprocessing; the 2D/3D choice resets on reload with the rest of the view state; grid lines and points stay on the ground and can be hidden behind extrusions; the silhouette outline is drawn above the map, so it shows through taller buildings in front, and adjacent selected buildings share one outline; extrusion rendering is checked by screenshot review only.
- **Terrain** ([decision 0015](decisions/0015-terrain.md)): display only, never project data. Mapterhorn states no usage terms or service level and serves Back Bay to zoom 16. Back Bay is nearly flat, so relief needs exaggeration and a tilted camera to be visible; tests use a flat stand-in tile, so real relief is checked by screenshot review only.
- **Basemap:** the public OpenFreeMap instance has no SLA, and one failed tile drops the whole basemap until Retry basemap. Basemap labels use OpenFreeMap's Noto Sans glyphs, not Geist. Tests exercise a stand-in style, so the recolored real style is checked by screenshot review only.
- **Hosting:** only the Vite dev server and `npm run preview` are verified; loading the bundle inside the reference ASP.NET or Eto host is not, and that host would also need network access for the basemap.

## Deployment

`master` publishes to GitHub Pages through `.github/workflows/pages.yml` ([decision 0017](decisions/0017-github-pages-deployment.md)). The workflow runs the same checks used locally (`typecheck`, `lint`, `format:check`, `npm test`, `npm run build`) plus the browser specs on Playwright's Chromium and `e2e/production.spec.ts` against the bundle it just built, all in one `verify` job, and deploys only when that job passes. Pull requests run the checks and publish nothing.

- **Base path.** A project site is served from `/<repository>/`, so `vite.config.ts` sets `base` only when `command === 'build'` or `isPreview`. The dev server stays at `/`, which the Playwright specs depend on, since they visit `/` against `http://127.0.0.1:5173`. `basePath.ts` is the one place the prefix and its `EAUI_BASE_PATH` override live; the build, `playwright.preview.config.ts`, and `e2e/production.spec.ts` all import `BASE_PATH` from it, and the workflow sets `EAUI_BASE_PATH` from the repository name for the whole job. Never hardcode the prefix again: a renamed repository blanked the published page once already ([decision 0017](decisions/0017-github-pages-deployment.md#revision-2026-09-18-the-rename-blanked-the-published-page)).
- **Check a production bundle locally** with `npm run build` then `npm run preview`: `/energyatlas-ui/` is already the default, so no environment variable is needed. Do not set `EAUI_BASE_PATH` from Git Bash on Windows without `MSYS_NO_PATHCONV=1`, because MSYS path conversion rewrites a value like `/energyatlas-ui/` into `C:/Program Files/Git/energyatlas-ui/`.
- **MapLibre brightens lit extrusion faces.** The shader uses `mix(1 - intensity, max(0.5 + intensity, 1), dot)`, so an intensity above 0.5 multiplies a lit face past its own colour and a pale palette saturates to white. `lighting.ts` states this in `faceShading` and dims the light colour to a `litCeiling` instead of lowering the intensity, which is what keeps the shaded side deep.
- **The map is a globe.** `map.setProjection({ type: 'globe' })` is applied on load and again on `styledata`, because projection is style state that a basemap or appearance swap drops ([decision 0019](decisions/0019-globe-projection-and-solar-state.md)). At street zoom it is indistinguishable from Mercator; the sphere appears below about zoom 5.
- **MapLibre's worker is not bundled.** It builds its own URL from `import.meta.url` at run time, so the build has to copy `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` into the assets directory; `vite.config.ts` does it. A missing emitted file is invisible in dev, where MapLibre resolves from `node_modules`.
- **`vite preview` hides missing files.** It answers them with `index.html` and a 200, so a 404 appears only as a `text/html` MIME warning in the console. Assert the content type, not the status. GitHub Pages returns a real 404.
- **Check the production bundle with `npm run test:e2e:preview`**, which builds and runs `e2e/production.spec.ts`. The dev-server specs cannot see base-path or emitted-file problems.
- **`vite preview` reports `command: "serve"`**, like the dev server, so the base path test also needs `isPreview`. Without it preview serves the built bundle at `/` while its asset URLs carry the prefix, and the page renders blank.
- **`vitest.config.ts` merges the Vite config**, so it calls the exported function (`viteConfig({ command: 'serve', mode: 'test' })`) rather than passing it.
- **No secrets.** The build reads no environment variable except the base path. Never give a credential a `VITE_` prefix; Vite would put it in the browser bundle, and a static deployment cannot hold one safely.
